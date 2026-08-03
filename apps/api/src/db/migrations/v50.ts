import {
  getMigrationDb,
  logger,
} from './helpers';

export const migrateToV50 = () => {
  const db = getMigrationDb();

  const migrateTx = db.transaction(() => {
    // ── 存量重复检测与修复 ──────────────────────────────────────────
    // 加唯一索引前必须先确认存量数据无重复编号，如有重复则先修复
    fixDuplicateCodes(db, 'Patient', 'code');
    fixDuplicateCodes(db, 'Charge', 'number');

    // ── 创建诊所内唯一索引（兜底） ──────────────────────────────────
    // v25 已通过表重建添加 UNIQUE(clinicId, code/number) 表级约束，
    // 但以下场景可能缺失：
    //   1. 数据库从 v25 之前的旧版本经 createSchema 直接初始化
    //   2. 表重建过程中约束丢失
    // 显式 CREATE UNIQUE INDEX IF NOT EXISTS 作为安全网，保证约束一定存在
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uidx_patient_clinic_code
      ON Patient(clinicId, code)
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uidx_charge_clinic_number
      ON Charge(clinicId, number)
    `);
  });

  migrateTx();
  logger.log('v50: Patient.code / Charge.number 诊所内唯一索引兜底');
};

/**
 * 检测并修复指定表内的重复编号（同一 clinicId 下）
 * 修复策略：为重复行追加递增后缀，直到编号唯一
 */
function fixDuplicateCodes(
  db: ReturnType<typeof getMigrationDb>,
  table: string,
  column: string,
): void {
  const duplicates = db.prepare(`
    SELECT clinicId, ${column}, COUNT(*) as cnt
    FROM ${table}
    WHERE deletedAt IS NULL
    GROUP BY clinicId, ${column}
    HAVING cnt > 1
  `).all() as Array<{ clinicId: string; [key: string]: unknown; cnt: number }>;

  if (duplicates.length === 0) return;

  logger.warn(`v50: 检测到 ${table}.${column} 存在 ${duplicates.length} 组重复编号，开始修复`);

  for (const dup of duplicates) {
    const code = dup[column] as string;

    // 取出该诊所下所有同编号的行（按 rowid 排序，保留第一行不动）
    const rows = db.prepare(`
      SELECT rowid FROM ${table}
      WHERE clinicId = ? AND ${column} = ? AND deletedAt IS NULL
      ORDER BY rowid ASC
    `).all() as Array<{ rowid: number }>;

    // 跳过第一行（保留原始编号），从第二行开始追加后缀
    for (let i = 1; i < rows.length; i++) {
      const newCode = `${code}_${i}`;
      db.prepare(`
        UPDATE ${table} SET ${column} = ?, updatedAt = datetime('now')
        WHERE rowid = ?
      `).run(newCode, rows[i].rowid);
      logger.warn(`v50: ${table} rowid=${rows[i].rowid} ${column} "${code}" → "${newCode}"`);
    }
  }

  logger.warn(`v50: ${table}.${column} 重复编号修复完成`);
}
