import type Database from 'better-sqlite3';

export function buildFtsQuery(query: string): string {
  return query.split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' ');
}

// 单行 INSERT 与 rebuildSearchIndex 的 6 段 SQL 同源（逐字一致），每段追加
// `WHERE 主表.id = ? AND 主表.deletedAt IS NULL` 限定单行。
const SEARCH_UPSERT_SQL: Record<string, string> = {
  Patient: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'Patient', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, '') || ' ' || COALESCE(wechatId, ''))
            FROM Patient WHERE id = ? AND deletedAt IS NULL`,
  InventoryItem: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'InventoryItem', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(category, ''))
            FROM InventoryItem WHERE id = ? AND deletedAt IS NULL`,
  Supplier: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'Supplier', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, ''))
            FROM Supplier WHERE id = ? AND deletedAt IS NULL`,
  Appointment: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'Appointment', A.id, A.clinicId,
                   trim(COALESCE(P.name, '') || ' ' || COALESCE(A.startTime, '') || ' ' || COALESCE(A.status, ''))
            FROM Appointment A LEFT JOIN Patient P ON P.id = A.patientId
            WHERE A.id = ? AND A.deletedAt IS NULL`,
  Charge: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'Charge', C.id, C.clinicId,
                   trim(COALESCE(P.name, '') || ' ' || COALESCE(C.number, '') || ' ' || COALESCE(C.status, ''))
            FROM Charge C LEFT JOIN Patient P ON P.id = C.patientId
            WHERE C.id = ? AND C.deletedAt IS NULL`,
  FollowUp: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'FollowUp', F.id, F.clinicId,
                   trim(COALESCE(P.name, '') || ' ' || COALESCE(F.content, '') || ' ' || COALESCE(F.status, '') || ' ' || COALESCE(F.planDate, ''))
            FROM FollowUp F LEFT JOIN Patient P ON P.id = F.patientId
            WHERE F.id = ? AND F.deletedAt IS NULL`,
};

const CHILD_SEARCH_TABLES = [
  { table: 'Appointment', resource: 'Appointment' },
  { table: 'Charge', resource: 'Charge' },
  { table: 'FollowUp', resource: 'FollowUp' },
] as const;

function hasSearchIndex(db: Database.Database): boolean {
  return !!db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'SearchIndex'`,
  ).get();
}

export function upsertSearchRow(db: Database.Database, resource: string, id: string): void {
  const sql = SEARCH_UPSERT_SQL[resource];
  if (!sql) return; // 未知 resource：无可维护的索引内容，直接返回。
  if (!hasSearchIndex(db)) return; // 无 FTS 表（未应用迁移 115 的库）时跳过，避免误伤精简环境。
  db.transaction(() => {
    db.prepare(`DELETE FROM SearchIndex WHERE resource = ? AND recordId = ?`).run(resource, id);
    db.prepare(sql).run(id);
  })();
}

export function removeSearchRow(db: Database.Database, resource: string, id: string): void {
  if (!hasSearchIndex(db)) return;
  db.prepare(`DELETE FROM SearchIndex WHERE resource = ? AND recordId = ?`).run(resource, id);
}

/**
 * Unified search-index write facade: every app write path goes through this
 * function instead of calling upsert/remove directly, so future writers only
 * need to know one API and one operation name.
 */
export function touchSearchIndex(
  db: Database.Database,
  resource: string,
  id: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
): void {
  if (operation === 'DELETE') removeSearchRow(db, resource, id);
  else upsertSearchRow(db, resource, id);
}

export function refreshPatientChildSearchRows(db: Database.Database, patientId: string): void {
  for (const { table, resource } of CHILD_SEARCH_TABLES) {
    // 精简/异构 schema 可能缺 patientId 列或整表缺失，跳过该表。
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'patientId')) continue;
    const rows = db.prepare(`SELECT id FROM ${table} WHERE patientId = ? AND deletedAt IS NULL`).all(patientId) as Array<{ id: string }>;
    for (const row of rows) {
      upsertSearchRow(db, resource, String(row.id));
    }
  }
}

export function rebuildSearchIndex(db: Database.Database): void {
  // 无 FTS 表（未应用迁移 115 的库）时无可重建，直接返回；避免误伤精简环境。
  const hasFts = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'SearchIndex'`,
  ).get();
  if (!hasFts) return;
  db.transaction(() => {
    db.exec('DELETE FROM SearchIndex');
  // SQL 与迁移 115（v2-fts-search-index）回填段逐字一致。
  db.exec(`
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'Patient', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, ''))
    FROM Patient WHERE deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'InventoryItem', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(category, ''))
    FROM InventoryItem WHERE deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'Supplier', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, ''))
    FROM Supplier WHERE deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'Appointment', A.id, A.clinicId,
           trim(COALESCE(P.name, '') || ' ' || COALESCE(A.startTime, '') || ' ' || COALESCE(A.status, ''))
    FROM Appointment A LEFT JOIN Patient P ON P.id = A.patientId
    WHERE A.deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'Charge', C.id, C.clinicId,
           trim(COALESCE(P.name, '') || ' ' || COALESCE(C.number, '') || ' ' || COALESCE(C.status, ''))
    FROM Charge C LEFT JOIN Patient P ON P.id = C.patientId
    WHERE C.deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'FollowUp', F.id, F.clinicId,
           trim(COALESCE(P.name, '') || ' ' || COALESCE(F.content, '') || ' ' || COALESCE(F.status, '') || ' ' || COALESCE(F.planDate, ''))
    FROM FollowUp F LEFT JOIN Patient P ON P.id = F.patientId
    WHERE F.deletedAt IS NULL;
  `);
  })();
}
