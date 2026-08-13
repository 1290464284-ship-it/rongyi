import type Database from 'better-sqlite3';
import { tenantAnd, tenantParams } from './tenant';

/**
 * 大库聚合快照：超过阈值后 dashboard / replenishment 用惰性物化快照，
 * 写路径通过 trackResourceWrite / 显式失效删除快照，下次读取时重建一次。
 */
export const AGGREGATE_THRESHOLD = 100_000;

const SNAPSHOT_AFFECTED_TABLES = new Set([
  'Patient',
  'Appointment',
  'Charge',
  'InventoryItem',
  'FollowUp',
  'InventoryTransaction',
]);

/** 写路径失效钩子：相关表写入后删除对应诊所的快照。 */
export function invalidateStatSnapshots(db: Database.Database, tableName: string, clinicId: string | null | undefined): void {
  if (!clinicId || !SNAPSHOT_AFFECTED_TABLES.has(tableName)) return;
  try {
    if (tableName === 'InventoryTransaction') {
      db.prepare(`DELETE FROM ReplenishmentSnapshot WHERE 1 = 1${tenantAnd(clinicId)}`).run(...tenantParams(clinicId));
    } else {
      db.prepare(`DELETE FROM StatSnapshot WHERE 1 = 1${tenantAnd(clinicId)}`).run(...tenantParams(clinicId));
    }
  } catch {
    // 迁移前表可能不存在：忽略失效，读取侧仍会按 MAX(createdAt) 校验重建。
  }
}

export function tableRowCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number };
  return Number(row.c ?? 0);
}

/** 单次 SQL 判断是否超过聚合阈值（Patient + Charge 行数）。 */
export function aggregateThresholdExceeded(db: Database.Database): boolean {
  const row = db.prepare(
    `SELECT (SELECT COUNT(*) FROM Patient) + (SELECT COUNT(*) FROM Charge) AS c`,
  ).get() as { c: number };
  return Number(row.c ?? 0) > AGGREGATE_THRESHOLD;
}

export function readDashboardSnapshot(
  db: Database.Database,
  clinicId: string | null,
): Record<string, unknown> | null {
  if (!clinicId) return null;
  const row = db.prepare(
    `SELECT valueJson FROM StatSnapshot WHERE key = 'dashboard'${tenantAnd(clinicId)}`,
  ).get(...tenantParams(clinicId)) as { valueJson: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.valueJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function writeDashboardSnapshot(
  db: Database.Database,
  clinicId: string | null,
  value: Record<string, unknown>,
  now: string,
): void {
  if (!clinicId) return;
  db.prepare(
    `INSERT INTO StatSnapshot (clinicId, key, valueJson, updatedAt)
     VALUES (?, 'dashboard', ?, ?)
     ON CONFLICT(clinicId, key) DO UPDATE SET valueJson = excluded.valueJson, updatedAt = excluded.updatedAt`,
  ).run(clinicId, JSON.stringify(value), now);
}

export function readReplenishmentSnapshot(
  db: Database.Database,
  clinicId: string | null,
  windowStart: string,
  windowEnd: string,
  latestTransactionAt: string | null,
): Map<string, number> | null {
  if (!clinicId) return null;
  const row = db.prepare(
    `SELECT windowStart, windowEnd, dataJson, updatedAt
     FROM ReplenishmentSnapshot WHERE 1 = 1${tenantAnd(clinicId)}`,
  ).get(...tenantParams(clinicId)) as
    | { windowStart: string; windowEnd: string; dataJson: string; updatedAt: string }
    | undefined;
  if (!row) return null;
  if (row.windowStart !== windowStart || row.windowEnd !== windowEnd) return null;
  // 写路径失效是尽力而为；此处用最新流水时间戳做二次校验，杜绝漏失效导致的口径偏差。
  if (latestTransactionAt !== null && row.updatedAt < latestTransactionAt) return null;
  try {
    const parsed = JSON.parse(row.dataJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const map = new Map<string, number>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      map.set(key, Number(value ?? 0));
    }
    return map;
  } catch {
    return null;
  }
}

export function writeReplenishmentSnapshot(
  db: Database.Database,
  clinicId: string | null,
  windowStart: string,
  windowEnd: string,
  consumption: Map<string, number>,
  now: string,
): void {
  if (!clinicId) return;
  db.prepare(
    `INSERT INTO ReplenishmentSnapshot (clinicId, windowStart, windowEnd, dataJson, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(clinicId) DO UPDATE SET
       windowStart = excluded.windowStart,
       windowEnd = excluded.windowEnd,
       dataJson = excluded.dataJson,
       updatedAt = excluded.updatedAt`,
  ).run(clinicId, windowStart, windowEnd, JSON.stringify(Object.fromEntries(consumption)), now);
}
