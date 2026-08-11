import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../../../infrastructure/database';
import { ConflictError } from '../../../infrastructure/errors';
import type { AppContext } from '../../../../domain/contracts';
import type { ProcessingOrderRepository } from '../../ports';
import { ProcessingOrderService } from './processing-order.service';

describe('ProcessingOrderService transition guard', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-processing-transition-'));
    db = createDatabase(dataDir);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date('2026-08-05T10:00:00.000Z'),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('passes the source status into the conditional update and rejects stale updates', () => {
    const updateStatus = vi.fn(() => 0);
    const repo = {
      findById: () => ({ id: 'proc-transition-1', status: 'DRAFT' }),
      updateStatus,
    } as unknown as ProcessingOrderRepository;
    const service = new ProcessingOrderService(db, repo);

    expect(() => service.transition('proc-transition-1', 'SENT', context)).toThrow(ConflictError);
    expect(updateStatus).toHaveBeenCalledWith(
      'proc-transition-1',
      'SENT',
      expect.any(String),
      'clinic-v2-001',
      'DRAFT',
    );
  });
});
