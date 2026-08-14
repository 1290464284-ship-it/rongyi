import type Database from 'better-sqlite3';

export const migrations156 = [
  {
    version: 156,
    name: 'v2-wechat-reminder-dedup-unique-index',
    up(db: Database.Database): void {
      const table = db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'WechatReminder'`,
      ).get();
      if (!table) return;
      const columns = (db.prepare('PRAGMA table_info(WechatReminder)').all() as Array<{ name: string }>)
        .map((column) => column.name);
      for (const column of ['clinicId', 'patientId', 'scene', 'scheduledDate', 'sourceId', 'deletedAt']) {
        if (!columns.includes(column)) return;
      }
      // 去重：同一业务键只保留最早一条，避免唯一索引创建失败。
      db.exec(`
        DELETE FROM WechatReminder
        WHERE deletedAt IS NULL AND rowid NOT IN (
          SELECT MIN(rowid) FROM WechatReminder
          WHERE deletedAt IS NULL
          GROUP BY COALESCE(clinicId, ''), patientId, scene, scheduledDate, sourceId
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_wechat_reminder_dedup_active
          ON WechatReminder(clinicId, patientId, scene, scheduledDate, sourceId)
          WHERE deletedAt IS NULL;
      `);
    },
  },
];
