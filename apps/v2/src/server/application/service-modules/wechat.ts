import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SqliteWechatMessageRepository } from '../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../domain/contracts';
import type { WechatMessageRepository } from '../ports';
import type { Logger } from '../../infrastructure/logger';

const SENDABLE_WECHAT_STATUSES = new Set(['PENDING', 'DRAFT', 'IN_PROGRESS']);

export interface WechatMessagePayload {
  id: string;
  clinicId?: string | null;
  patientId?: string | null;
  type?: string | null;
  content?: string | null;
  templateId?: string | null;
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: this.appId, appSecret: this.appSecret, message: payload }),
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
  const appId = process.env.V2_WECHAT_APP_ID?.trim() ?? '';
  const appSecret = process.env.V2_WECHAT_APP_SECRET?.trim() ?? '';
  if (url && appId && appSecret) return new HttpWechatProvider(url, appId, appSecret);
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
    const delivery = await this.provider.send({
      id: row.id,
      clinicId: row.clinicId,
      patientId: row.patientId,
      type: row.type,
      content: row.content,
      templateId: row.templateId,
    });
    if (!delivery.ok) {
      this.logger?.error('wechat send failed', {
        action: 'wechat-send',
        recordId: messageId,
        result: delivery.result,
        detail: delivery.detail,
        traceId: context.traceId,
      });
      return { id: messageId, status: 'FAILED', result: delivery.result, detail: delivery.detail };
    }
    const now = context.now().toISOString();
    const changes = this.wechatRepository.markSent(messageId, now, now, context.clinicId);
    if (changes === 0) throw new ConflictError('Wechat message cannot be sent from current status');
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
