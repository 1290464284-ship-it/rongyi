import type Database from 'better-sqlite3';
import { resourceRegistry } from '../../../domain/resources';
import { migrations101to110 } from './v101-110';
import { migrations111to120 } from './v111-120';
import { migrations121to130 } from './v121-130';
import { migrations131to140 } from './v131-140';
import { migrations141to146 } from './v141-146';
import { migrations147 } from './v147-147';
import { migrations148 } from './v148-148';
import { migrations149 } from './v149-149';
import { migrations150 } from './v150-150';
import { migrations151 } from './v151-151';
import { migrations152 } from './v152-152';
import { dedupNullClinicRows, snapshotDatabase } from './helpers';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * Versioned schema migrations for V2（M-04：按版本区间拆分自 migrations.ts）.
 *
 * 版本双轨说明（M-06）：
 * - 版本 1-100 不在此 registry 中——它们对应 legacy 基线表结构，由
 *   `syncLegacySchema`（src/server/infrastructure/legacy-schema.ts，经
 *   database.ts re-export）在开库时同步建立，schema_migrations 不记录；
 * - 版本 101 起是本 registry 拥有的 V2 自有迁移，追加新迁移时在
 *   v141-146.ts 之后新建 `v<next>-<max>.ts` 并在下方数组展开，或按区间
 *   并入现有文件，保持单一扁平数组（按 version 升序）。
 *
 * 回滚约定（Round7 M11）：迁移只有 up、没有 down——schema 迁移是前向
 * 不可逆变更，坏迁移的回滚路径 = 启动前自动快照
 * （见 snapshotDatabase：<snapshotDir>/pre-migration/pre-<ts>.sqlite，
 * 保留最近 3 份）+ 手工 restore-backup.mjs / delivery-drill 演练
 * （详见 docs/delivery/rollback.md）。编写破坏性迁移（删列/改约束/数据
 * 回填）时，必须在 up 前先做数据保全或回填，并在 name 中标注"不可逆"；
 * 禁止在生产库上直接删除仍被读取的数据列。
 */
export const migrations: Migration[] = [
  ...migrations101to110,
  ...migrations111to120,
  ...migrations121to130,
  ...migrations131to140,
  ...migrations141to146,
  ...migrations147,
  ...migrations148,
  ...migrations149,
  ...migrations150,
  ...migrations151,
  ...migrations152,
];

const MIGRATION_BUSY_RETRY_DELAYS_MS = [200, 400, 800, 1500, 3000, 5000, 5000];

function isMigrationBusy(error: unknown): boolean {
  return error instanceof Error && /SQLITE_(BUSY|LOCKED)/.test(String((error as { code?: unknown }).code ?? ''));
}

function sleepSync(milliseconds: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
}

function runMigrationsOnce(db: Database.Database, options?: { snapshotDir?: string }): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAt TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number | string }>).map((row) => Number(row.version)),
  );
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  if (options?.snapshotDir && pending.length > 0) {
    try {
      snapshotDatabase(db, options.snapshotDir);
    } catch (error) {
      // 快照失败不阻断启动；迁移本身仍会继续。
      console.warn('[migrations] pre-migration snapshot failed, continuing', error);
    }
  }
  // 121 将 NULL clinicId 回填为最早诊所；旧库 (NULL, 同唯一键) 重复行会撞 118 的唯一索引。
  // 在应用 121 前对带 clinicId 列与唯一字段的表执行去重（不动 121 内容本身）。
  if (!applied.has(121)) {
    for (const resource of resourceRegistry.all()) {
      const uniqueField = resource.fields.find((field) => field.unique);
      if (!uniqueField) continue;
      const cols = (db.prepare(`PRAGMA table_info("${resource.table}")`).all() as Array<{ name: string }>).map((c) => c.name);
      // 列缺失（旧 schema 中唯一列可能由更晚的迁移添加）时跳过，避免 preflight 本身抛错。
      if (!cols.includes('clinicId') || !cols.includes(uniqueField.name)) continue;
      dedupNullClinicRows(db, resource.table, uniqueField.name);
    }
  }
  let appliedCount = 0;
  for (const migration of pending) {
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)')
        .run(String(migration.version), migration.name, new Date().toISOString());
    });
    run();
    appliedCount++;
  }
  return appliedCount;
}

/**
 * Two API processes may start against the same SQLite file at once (e.g. LAN
 * deployment or a double launch). Concurrent DDL during migrations then fails
 * immediately with SQLITE_BUSY/SQLITE_LOCKED; retry with backoff so the second
 * process waits for the first migration transaction instead of crashing.
 */
export function withMigrationBusyRetry<T>(run: () => T): T {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MIGRATION_BUSY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return run();
    } catch (error) {
      lastError = error;
      if (!isMigrationBusy(error) || attempt === MIGRATION_BUSY_RETRY_DELAYS_MS.length) throw error;
      sleepSync(MIGRATION_BUSY_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export function runMigrations(db: Database.Database, options?: { snapshotDir?: string }): number {
  return withMigrationBusyRetry(() => runMigrationsOnce(db, options));
}
