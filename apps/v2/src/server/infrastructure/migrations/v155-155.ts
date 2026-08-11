import type Database from 'better-sqlite3';

export const migrations155 = [
  {
    version: 155,
    name: 'v2-search-index-patient-wechat-id',
    up(db: Database.Database): void {
      const hasFts = db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'SearchIndex'`,
      ).get();
      if (!hasFts) return;
      const columns = (db.prepare('PRAGMA table_info(Patient)').all() as Array<{ name: string }>).map((c) => c.name);
      if (!columns.includes('wechatId')) return;
      // 迁移 115 的 Patient 回填未包含 wechatId，而运行期 upsert 已包含；
      // 此迁移重建 Patient 索引行，使存量患者可按微信 ID 检索。
      db.exec(`
        DELETE FROM SearchIndex WHERE resource = 'Patient';
        INSERT INTO SearchIndex(resource, recordId, clinicId, content)
        SELECT 'Patient', id, clinicId,
               trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, '') || ' ' || COALESCE(wechatId, ''))
        FROM Patient WHERE deletedAt IS NULL;
      `);
    },
  },
];
