import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SqliteWechatMessageRepository } from '../../infrastructure/repositories/core.repositories';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import type { WechatMessageRepository } from '../ports';
import type { Logger } from '../../infrastructure/logger';
import { secretFileValue } from '../../infrastructure/secret-file';

const SENDABLE_WECHAT_STATUSES = new Set(['PENDING', 'DRAFT', 'IN_PROGRESS']);

export interface WechatMessagePayload {
  id: string;
  clinicId?: string | null;
  patientId?: string | null;
  wechatId?: string | null;
  type?: string | null;
  content?: string | null;
  templateId?: string | null;
  /** 上游网关幂等键（B-M8）：同一消息重试不会在网关侧重复下发。 */
  idempotencyKey?: string | null;
}

export interface WechatSendResult {
  ok: boolean;
  result?: string;
  detail?: string;
}

export interface WechatProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(payload: WechatMessagePayload): Promise<WechatSendResult>;
}

export class UnconfiguredWechatProvider implements WechatProvider {
  readonly name = 'unconfigured';

  isConfigured(): boolean {
    return false;
  }

  async send(): Promise<WechatSendResult> {
    return { ok: false, result: 'wechat_channel_not_configured' };
  }
}

export class HttpWechatProvider implements WechatProvider {
  readonly name = 'http';

  constructor(
    private readonly url: string,
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.url) && Boolean(this.appId) && Boolean(this.appSecret);
  }

  async send(payload: WechatMessagePayload): Promise<WechatSendResult> {
    // 强制 TLS：appSecret 经网关转发，明文 http 传输属于敏感信息泄露（审计 L2）
    if (!/^https:\/\//i.test(this.url)) {
      return { ok: false, result: 'insecure_wechat_url', detail: 'wechat gateway must be served over https' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appId: this.appId,
          appSecret: this.appSecret,
          message: payload,
          // B-M8：以消息 id 作为网关幂等键，重试不会在网关侧重复下发
          idempotencyKey: payload.idempotencyKey ?? payload.id,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, result: `http_${response.status}`, detail: `status ${response.status}` };
      const body = await response.json().catch(() => null) as { ok?: boolean; result?: string } | null;
      return { ok: body?.ok !== false, result: body?.result ?? 'sent' };
    } catch (error) {
      return { ok: false, result: 'network_error', detail: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createWechatProvider(): WechatProvider {
  const url = process.env.V2_WECHAT_API_URL?.trim() ?? '';
  const appId = process.env.V2_WECHAT_APP_ID?.trim() ?? secretFileValue('wechatAppId')?.trim() ?? '';
  const appSecret = process.env.V2_WECHAT_APP_SECRET?.trim() ?? secretFileValue('wechatAppSecret')?.trim() ?? '';
  if (url && appId && appSecret) {
    // 环境变量入口强制 TLS：http 网关一律视为未配置，避免 appSecret 明文转发（审计 L2）
    if (!/^https:\/\//i.test(url)) {
      console.warn('[wechat] V2_WECHAT_API_URL must use https; wechat channel disabled');
      return new UnconfiguredWechatProvider();
    }
    return new HttpWechatProvider(url, appId, appSecret);
  }
  return new UnconfiguredWechatProvider();
}

export interface WechatSendOutcome {
  id: string;
  status: 'SENT' | 'FAILED';
  result?: string;
  detail?: string;
}

export interface WechatSendBatchResult {
  sent: number;
  failed: number;
  results: WechatSendOutcome[];
}

const WECHAT_BATCH_CHUNK_SIZE = 10;
const STALE_IN_PROGRESS_MS = 60_000;

export class WechatService {
  private readonly db: Database.Database;
  private readonly wechatRepository: WechatMessageRepository;
  private readonly provider: WechatProvider;
  private readonly logger?: Logger;

  constructor(
    db: Database.Database,
    wechatRepository?: WechatMessageRepository,
    provider?: WechatProvider,
    logger?: Logger,
  ) {
    this.db = db;
    this.wechatRepository = wechatRepository ?? new SqliteWechatMessageRepository(db);
    this.provider = provider ?? createWechatProvider();
    this.logger = logger;
  }

  status(): { configured: boolean; provider: string } {
    return { configured: this.provider.isConfigured(), provider: this.provider.name };
  }

  async send(messageId: string, context: AppContext): Promise<Record<string, unknown>> {
    const outcome = await this.sendOne(messageId, context);
    if (outcome.status === 'FAILED') {
      throw new ConflictError('Wechat channel send failed');
    }
    const result: Record<string, unknown> = { id: messageId, status: 'SENT' };
    if (outcome.result !== undefined) result.result = outcome.result;
    return result;
  }

  async sendBatch(ids: string[], context: AppContext): Promise<WechatSendBatchResult> {
    if (!Array.isArray(ids) || ids.length > 500) {
      throw new ValidationError('Send batch ids must be an array with at most 500 items');
    }
    const results: WechatSendOutcome[] = [];
    for (let offset = 0; offset < ids.length; offset += WECHAT_BATCH_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + WECHAT_BATCH_CHUNK_SIZE);
      const outcomes = await Promise.all(chunk.map((id) => this.sendOneCaptured(id, context)));
      results.push(...outcomes);
    }
    const sent = results.filter((outcome) => outcome.status === 'SENT').length;
    return { sent, failed: results.length - sent, results };
  }

  private async sendOne(messageId: string, context: AppContext): Promise<WechatSendOutcome> {
    const row = this.wechatRepository.findById(messageId, context.clinicId);
    if (!row) throw new NotFoundError('Wechat message not found');
    if (row.status === 'SENT') return { id: messageId, status: 'SENT' };
    if (!SENDABLE_WECHAT_STATUSES.has(row.status)) {
      throw new ConflictError('Wechat message cannot be sent from current status');
    }
    if (!this.provider.isConfigured()) {
      throw new ConflictError('Wechat channel is not configured');
    }
    // B-M2 并发守卫：原子抢占，只有 PENDING/DRAFT 能被本次发送认领。
    // 两个并发请求同时进来时只有一个 UPDATE 成功，另一个在下方按最新状态处理。
    const now = context.now().toISOString();
    let wechatId: string | null = null;
    if (row.patientId) {
      const patient = this.db.prepare(
        `SELECT wechatId FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(row.patientId, ...tenantParams(context.clinicId)) as { wechatId?: string | null } | undefined;
      wechatId = patient?.wechatId ?? null;
    }
    const staleInProgressCutoff = new Date(Date.now() - STALE_IN_PROGRESS_MS).toISOString();
    const claimed = this.db.prepare(
      `UPDATE WechatMessage SET status = 'IN_PROGRESS', updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL
         AND (status IN ('PENDING', 'DRAFT') OR (status = 'IN_PROGRESS' AND updatedAt <= ?))${tenantAnd(context.clinicId)}`,
    ).run(now, messageId, staleInProgressCutoff, ...(context.clinicId ? [context.clinicId] : [])).changes;
    if (claimed === 0) {
      const fresh = this.wechatRepository.findById(messageId, context.clinicId);
      if (fresh?.status === 'SENT') return { id: messageId, status: 'SENT' };
      if (fresh?.status === 'IN_PROGRESS') throw new ConflictError('Wechat message is already being sent');
      // 状态仍为 PENDING/DRAFT（行刚被并发删除或测试用仓库无真实行）：继续发送，
      // markSent 仍会在状态不匹配时以 0 changes 拒绝。
      if (!fresh || !SENDABLE_WECHAT_STATUSES.has(fresh.status)) {
        throw new ConflictError('Wechat message cannot be sent from current status');
      }
    }
    const delivery = await this.provider.send({
      id: row.id,
      clinicId: row.clinicId,
      patientId: row.patientId,
      wechatId,
      type: row.type,
      content: row.content,
      templateId: row.templateId,
      idempotencyKey: row.id,
    });
    if (!delivery.ok) {
      this.logger?.error('wechat send failed', {
        action: 'wechat-send',
        recordId: messageId,
        result: delivery.result,
        detail: delivery.detail,
        traceId: context.traceId,
      });
      // 回退到发送前状态，允许后续重试
      this.db.prepare(
        `UPDATE WechatMessage SET status = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL AND status = 'IN_PROGRESS'${tenantAnd(context.clinicId)}`,
      ).run(row.status === 'DRAFT' ? 'DRAFT' : 'PENDING', now, messageId, ...(context.clinicId ? [context.clinicId] : []));
      return { id: messageId, status: 'FAILED', result: delivery.result, detail: delivery.detail };
    }
    const changes = this.wechatRepository.markSent(messageId, now, now, context.clinicId);
    if (changes === 0) {
      // 网关已投递成功；markSent 若因状态竞争返回 0，直接补偿为 SENT，
      // 避免消息留在可重试状态导致后续重复发送（网关幂等键只作最后兜底）。
      const compensated = this.db.prepare(
        `UPDATE WechatMessage SET status = 'SENT', sentAt = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(now, now, messageId, ...(context.clinicId ? [context.clinicId] : [])).changes;
      if (compensated === 0) throw new ConflictError('Wechat message cannot be sent from current status');
      this.logger?.warn('wechat markSent race compensated after gateway delivery', { recordId: messageId });
    }
    return { id: messageId, status: 'SENT', result: delivery.result ?? 'sent' };
  }

  private async sendOneCaptured(id: string, context: AppContext): Promise<WechatSendOutcome> {
    try {
      return await this.sendOne(id, context);
    } catch (error) {
      return {
        id,
        status: 'FAILED',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
