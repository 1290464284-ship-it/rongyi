import type Database from 'better-sqlite3';
import { resourceRegistry } from '../../../domain/resources';
import { migrations101to120 } from './v101-120';
import { migrations121to140 } from './v121-140';
import { migrations141to146 } from './v141-146';
import { dedupNullClinicRows, snapshotDatabase } from './helpers';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * Versioned schema migrations for V2（M-04：按版本区间拆分自 migrations.ts）.
 *
 * Baseline legacy table synchronization is intentionally separate. This
 * registry owns future schema changes and records them in schema_migrations.
 */
export const migrations: Migration[] = [
  ...migrations101to120,
  ...migrations121to140,
  ...migrations141to146,
];

export function runMigrations(db: Database.Database, options?: { snapshotDir?: string }): number {
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

