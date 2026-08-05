import type Database from 'better-sqlite3';

export function buildFtsQuery(query: string): string {
  return query.split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' ');
}

export function rebuildSearchIndex(db: Database.Database): void {
  // 无 FTS 表（未应用迁移 115 的库）时无可重建，直接返回；避免误伤精简环境。
  const hasFts = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'SearchIndex'`,
  ).get();
  if (!hasFts) return;
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
}
