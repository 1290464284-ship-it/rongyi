// WechatService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { HttpWechatProvider, WechatService } from '../workflow-services';
import type { WechatMessageRepository } from '../ports';
import type { Logger } from '../../infrastructure/logger';
import type { AppContext } from '../../../domain/contracts';

describe('WechatService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-wechat-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(now),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('reports wechat provider HTTP and network failures with detail', async () => {
    const provider = new HttpWechatProvider('https://wechat.test', 'app', 'secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    try {
      const httpFailure = await provider.send({ id: 'wechat-http-fail' });
      expect(httpFailure).toEqual({ ok: false, result: 'http_503', detail: 'status 503' });
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    try {
      const networkFailure = await provider.send({ id: 'wechat-net-fail' });
      expect(networkFailure).toEqual({ ok: false, result: 'network_error', detail: 'ECONNREFUSED' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('logs wechat send failures with the provider detail', async () => {
    const repo: WechatMessageRepository = {
      findById: (id) => ({ id: String(id), status: 'PENDING', clinicId: context.clinicId }),
      markSent: () => 1,
    };
    const provider = {
      name: 'failing',
      isConfigured: () => true,
      send: async () => ({ ok: false, result: 'network_error', detail: 'connection refused' }),
    };
    const loggerError = vi.fn();
    const logger = { error: loggerError } as unknown as Logger;
    const service = new WechatService(db, repo, provider, logger);

    await expect(service.send('wechat-fail-detail', context)).rejects.toThrow('Wechat channel send failed');
    expect(loggerError).toHaveBeenCalledWith('wechat send failed', expect.objectContaining({
      action: 'wechat-send',
      recordId: 'wechat-fail-detail',
      result: 'network_error',
      detail: 'connection refused',
      traceId: 'test-trace',
    }));

    const batch = await service.sendBatch(['wechat-fail-detail'], context);
    expect(batch.sent).toBe(0);
    expect(batch.failed).toBe(1);
    expect(batch.results[0]).toEqual({
      id: 'wechat-fail-detail',
      status: 'FAILED',
      result: 'network_error',
      detail: 'connection refused',
    });
  });

  it('sends wechat batches with at most 10 concurrent provider calls and full coverage', async () => {
    const repo: WechatMessageRepository = {
      findById: (id) => ({ id: String(id), status: 'PENDING', clinicId: context.clinicId }),
      markSent: () => 1,
    };
    let concurrent = 0;
    let maxConcurrent = 0;
    const provider = {
      name: 'counting',
      isConfigured: () => true,
      send: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setImmediate(resolve));
        concurrent -= 1;
        return { ok: true, result: 'sent' };
      },
    };
    const ids = Array.from({ length: 300 }, (_, index) => `wechat-concurrent-${index}`);
    const service = new WechatService(db, repo, provider);
    const result = await service.sendBatch(ids, context);
    expect(result.sent).toBe(300);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(300);
    expect(maxConcurrent).toBeLessThanOrEqual(10);
  });

  it('keeps individual wechat batch failures without aborting the batch', async () => {
    const repo: WechatMessageRepository = {
      findById: (id) => ({ id: String(id), status: 'PENDING', clinicId: context.clinicId }),
      markSent: () => 1,
    };
    const provider = {
      name: 'flaky',
      isConfigured: () => true,
      send: async (payload: { id: string }) => {
        if (Number(payload.id.split('-').pop()) % 2 === 1) {
          return { ok: false, result: 'http_503', detail: 'status 503' };
        }
        return { ok: true, result: 'sent' };
      },
    };
    const ids = Array.from({ length: 25 }, (_, index) => `wechat-flaky-${index}`);
    const service = new WechatService(db, repo, provider);
    const result = await service.sendBatch(ids, context);
    expect(result.results).toHaveLength(25);
    expect(result.failed).toBe(12);
    expect(result.sent).toBe(13);
    expect(result.results[1]).toMatchObject({
      id: 'wechat-flaky-1',
      status: 'FAILED',
      result: 'http_503',
      detail: 'status 503',
    });
  });

  it('reports non-Error fetch rejections in the wechat provider detail', async () => {
    const provider = new HttpWechatProvider('https://wechat.test', 'app', 'secret');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('plain failure'));
    try {
      const result = await provider.send({ id: 'wechat-string-fail' });
      expect(result).toEqual({ ok: false, result: 'network_error', detail: 'plain failure' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes a null wechatId when the patient row is missing', async () => {
    const repo: WechatMessageRepository = {
      findById: (id) => ({ id: String(id), status: 'PENDING', clinicId: context.clinicId, patientId: 'patient-missing-wechat' }),
      markSent: () => 1,
    };
    const sentPayloads: Array<{ wechatId?: string | null }> = [];
    const provider = {
      name: 'capture',
      isConfigured: () => true,
      send: async (payload: { wechatId?: string | null }) => {
        sentPayloads.push(payload);
        return { ok: true, result: 'sent' };
      },
    };
    const service = new WechatService(db, repo, provider);
    await expect(service.send('wechat-missing-patient', context)).resolves.toMatchObject({ status: 'SENT' });
    expect(sentPayloads[0].wechatId).toBeNull();
  });

  it('runs wechat sends under a global context with a null clinic', async () => {
    let calls = 0;
    const repo: WechatMessageRepository = {
      findById: (id) => ({ id: String(id), status: 'PENDING', clinicId: null }),
      markSent: () => 0,
    };
    const provider = {
      name: 'global',
      isConfigured: () => true,
      send: async () => {
        calls += 1;
        return calls === 1 ? { ok: false, result: 'rejected' } : { ok: true, result: 'sent' };
      },
    };
    const error = vi.fn();
    const service = new WechatService(db, repo, provider, { error } as unknown as Logger);
    const globalContext = { ...context, clinicId: null };

    // 第一次：claim/回滚 UPDATE 都以 null clinic 运行（tenantAnd 无过滤），投递失败 → FAILED
    await expect(service.send('wechat-global-fail', globalContext)).rejects.toThrow('Wechat channel send failed');
    // 第二次：markSent 竞态为 0 → 补偿 UPDATE 以 null clinic 运行（本地行缺失 → 记录丢失告警）
    await expect(service.send('wechat-global-compensate', globalContext)).resolves.toMatchObject({ status: 'SENT' });
    expect(error).toHaveBeenCalledWith('wechat delivery succeeded but local message row is missing', expect.anything());
  });

  it('rolls a failed DRAFT send back to DRAFT', async () => {
    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, NULL, 'TEXT', 'draft rollback', 'DRAFT')`,
    ).run('wechat-draft-rollback', context.clinicId, new Date().toISOString(), new Date().toISOString());
    const provider = {
      name: 'draft-fail',
      isConfigured: () => true,
      send: async () => ({ ok: false, result: 'rejected' }),
    };
    const service = new WechatService(db, undefined, provider);
    await expect(service.send('wechat-draft-rollback', context)).rejects.toThrow('Wechat channel send failed');
    const row = db.prepare('SELECT status FROM WechatMessage WHERE id = ?').get('wechat-draft-rollback') as { status: string };
    expect(row.status).toBe('DRAFT');
  });

  it('captures non-Error sendOne failures as string details in batches', async () => {
    const repo: WechatMessageRepository = {
      findById: (id) => {
        if (id === 'wechat-string-throw') throw 'boom';
        return { id: String(id), status: 'PENDING', clinicId: context.clinicId };
      },
      markSent: () => 1,
    };
    const provider = { name: 'ok', isConfigured: () => true, send: async () => ({ ok: true, result: 'sent' }) };
    const service = new WechatService(db, repo, provider);
    const batch = await service.sendBatch(['wechat-string-throw'], context);
    expect(batch.results[0]).toEqual({ id: 'wechat-string-throw', status: 'FAILED', detail: 'boom' });
  });

  it('captures Error sendOne failures with their message in batches', async () => {
    const repo: WechatMessageRepository = {
      findById: () => {
        throw new Error('row exploded');
      },
      markSent: () => 1,
    };
    const provider = { name: 'ok', isConfigured: () => true, send: async () => ({ ok: true, result: 'sent' }) };
    const service = new WechatService(db, repo, provider);
    const batch = await service.sendBatch(['wechat-error-throw'], context);
    expect(batch.results[0]).toEqual({ id: 'wechat-error-throw', status: 'FAILED', detail: 'row exploded' });
  });

  it('handles claim races where the fresh row is SENT, IN_PROGRESS or missing', async () => {
    const sequences = new Map<string, Array<{ status?: string } | null>>([
      ['wechat-race-sent', [{ status: 'PENDING' }, { status: 'SENT' }]],
      ['wechat-race-progress', [{ status: 'PENDING' }, { status: 'IN_PROGRESS' }]],
      ['wechat-race-missing', [{ status: 'PENDING' }, null]],
    ]);
    const repo: WechatMessageRepository = {
      findById: (id) => {
        const queue = sequences.get(String(id));
        if (!queue) return null;
        const row = queue.shift();
        return row ? { id: String(id), status: row.status ?? 'PENDING', clinicId: context.clinicId } : null;
      },
      markSent: () => 1,
    };
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('UPDATE WechatMessage') && sql.includes('IN_PROGRESS')) {
        return { run: () => ({ changes: 0 }) } as never;
      }
      return originalPrepare(sql);
    });
    const provider = { name: 'race', isConfigured: () => true, send: async () => ({ ok: true, result: 'sent' }) };
    const service = new WechatService(db, repo, provider);

    // fresh=SENT → 幂等成功
    await expect(service.send('wechat-race-sent', context)).resolves.toMatchObject({ status: 'SENT' });
    // fresh=IN_PROGRESS → 并发冲突（keepProcessing）
    await expect(service.send('wechat-race-progress', context)).rejects.toThrow('already being sent');
    // fresh 缺失 → 不可发送
    await expect(service.send('wechat-race-missing', context)).rejects.toThrow('cannot be sent');
  });
});
