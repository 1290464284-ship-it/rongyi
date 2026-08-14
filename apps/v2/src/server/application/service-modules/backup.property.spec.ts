import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { BackupService } from './backup';

interface Harness {
  service: BackupService;
  db: Database.Database;
  dir: string;
  backupsDir: string;
}

/** 每轮属性运行独立的内存源库 + 临时备份目录，互不污染。 */
function makeHarness(): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-backup-prop-'));
  const backupsDir = path.join(dir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE BackupRecord (
    id TEXT, clinicId TEXT, createdAt TEXT, updatedAt TEXT, deletedAt TEXT,
    filename TEXT, fileSize INTEGER, type TEXT, operatorId TEXT, operatorName TEXT
  )`);
  db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY, payload BLOB)');
  const service = new BackupService(db, path.join(dir, 'v2.sqlite'), backupsDir);
  return { service, db, dir, backupsDir };
}

function destroyHarness(harness: Harness): void {
  try {
    harness.db.close();
  } catch {
    // 连接可能已被关闭，忽略
  }
  fs.rmSync(harness.dir, { recursive: true, force: true });
}

describe('BackupService 加密备份属性测试', () => {
  const prevKey = process.env.V2_BACKUP_KEY;

  beforeEach(() => {
    process.env.V2_BACKUP_KEY = 'property-test-backup-key';
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.V2_BACKUP_KEY;
    else process.env.V2_BACKUP_KEY = prevKey;
  });

  it('任意随机字节源数据库：create 加密备份后 verify 恒为 ok 且摘要可读', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uint8Array({ maxLength: 2048 }), { maxLength: 25 }),
        async (payloads) => {
          const harness = makeHarness();
          try {
            const insert = harness.db.prepare('INSERT INTO Patient (id, payload) VALUES (?, ?)');
            payloads.forEach((payload, index) => insert.run(String(index), Buffer.from(payload)));
            const created = await harness.service.create({ encrypted: true });
            expect(String(created.filename)).toMatch(/\.enc$/);
            const verified = await harness.service.verify(String(created.filename));
            expect(verified.integrity).toBe('ok');
            expect(verified.encrypted).toBe(true);
            const summary = verified.summary as Record<string, number | string | null>;
            expect(summary.Patient).toBe(payloads.length);
          } finally {
            destroyHarness(harness);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('相同密钥加密往返成功，不同密钥解密必然失败', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (keyA, keyB) => {
          const harness = makeHarness();
          try {
            harness.db.prepare('INSERT INTO Patient (id, payload) VALUES (?, ?)').run('1', Buffer.from('payload'));
            process.env.V2_BACKUP_KEY = keyA;
            const created = await harness.service.create({ encrypted: true });
            process.env.V2_BACKUP_KEY = keyB;
            if (keyA === keyB) {
              const verified = await harness.service.verify(String(created.filename));
              expect(verified.integrity).toBe('ok');
            } else {
              await expect(harness.service.verify(String(created.filename))).rejects.toThrow();
            }
          } finally {
            destroyHarness(harness);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('篡改密文任意字节后 verify 必然失败（GCM 认证拦截）', async () => {
    const harness = makeHarness();
    try {
      harness.db.prepare('INSERT INTO Patient (id, payload) VALUES (?, ?)').run('1', Buffer.from('tamper-me'));
      const created = await harness.service.create({ encrypted: true });
      const encPath = path.join(harness.backupsDir, String(created.filename));
      const original = fs.readFileSync(encPath);
      await fc.assert(
        fc.asyncProperty(
          fc.nat({ max: original.length - 1 }),
          async (offset) => {
            const corrupted = Buffer.from(original);
            corrupted[offset] ^= 0xff;
            fs.writeFileSync(encPath, corrupted);
            await expect(harness.service.verify(String(created.filename))).rejects.toThrow();
          },
        ),
        { numRuns: 50 },
      );
    } finally {
      destroyHarness(harness);
    }
  });
});
