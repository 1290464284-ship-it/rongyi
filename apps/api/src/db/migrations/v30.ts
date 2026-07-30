import { addColumnIfMissing, tableExists, getMigrationDb, logger } from './helpers';
import * as crypto from 'node:crypto';

/**
 * v30: 审计日志哈希链（防篡改）
 *
 * 为 AuditLog 表新增 prevHash / hash 列，形成追加式哈希链。
 * 每条记录的 hash = SHA-256(prevHash|type|targetId|targetType|beforeData|afterData|clinicId|createdAt)
 * 修改任何历史记录会导致后续哈希链断裂，从而实现防篡改检测。
 *
 * 迁移策略：
 *  1. 添加 prevHash / hash 列
 *  2. 按 createdAt 升序遍历已有记录，逐条回填哈希（形成完整链）
 */
export const migrateToV30 = () => {
  if (!tableExists('AuditLog')) {
    logger.log('v30: AuditLog 表不存在，跳过哈希链迁移');
    return;
  }

  addColumnIfMissing('AuditLog', 'prevHash', 'TEXT');
  addColumnIfMissing('AuditLog', 'hash', 'TEXT');

  // 回填已有记录的哈希链
  const db = getMigrationDb();

  const rows = db.prepare(
    'SELECT id, type, targetId, targetType, beforeData, afterData, clinicId, createdAt FROM AuditLog ORDER BY createdAt ASC, id ASC',
  ).all() as Array<{
    id: string;
    type: string;
    targetId: string;
    targetType: string;
    beforeData: string | null;
    afterData: string | null;
    clinicId: string;
    createdAt: string;
  }>;

  if (rows.length === 0) {
    logger.log('v30: AuditLog 无历史数据，跳过回填');
    return;
  }

  const updateStmt = db.prepare('UPDATE AuditLog SET prevHash = ?, hash = ? WHERE id = ?');

  const backfillTx = db.transaction(() => {
    let prevHash = '0';
    for (const row of rows) {
      const hashInput = [
        prevHash,
        row.type,
        row.targetId,
        row.targetType,
        row.beforeData || '',
        row.afterData || '',
        row.clinicId,
        row.createdAt,
      ].join('|');
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
      updateStmt.run(prevHash, hash, row.id);
      prevHash = hash;
    }
  });

  backfillTx();
  logger.log(`v30: 已回填 ${rows.length} 条审计日志哈希链`);
};
