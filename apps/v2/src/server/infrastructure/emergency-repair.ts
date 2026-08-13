import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Logger } from './logger';

export interface EmergencyRepairResult {
  repaired: boolean;
  backupPath?: string;
  detail: string;
}

/**
 * 受控紧急修复：只做「证据副本 + 工作副本上 REINDEX + integrity_check」，
 * 不做任何业务 DML，且**绝不打开原文件写入**——修复失败时原文件逐字节不变
 * （fail-closed 不因修复引入新损坏）。默认开启；V2_EMERGENCY_REPAIR=0 时
 * 直接返回未修复。
 */
export function attemptEmergencyRepair(dbPath: string, logger: Logger): EmergencyRepairResult {
  if (process.env.V2_EMERGENCY_REPAIR === '0') {
    return { repaired: false, detail: 'emergency repair disabled by V2_EMERGENCY_REPAIR=0' };
  }
  const backupPath = `${dbPath}.corrupt-${Date.now()}`;
  const workPath = `${dbPath}.repair-${Date.now()}`;
  try {
    // 1. 证据副本：保留修复前原样，供人工诊断
    fs.copyFileSync(dbPath, backupPath);
    // 2. 工作副本：修复只在它上面进行
    fs.copyFileSync(dbPath, workPath);
  } catch (error) {
    logger.error('emergency repair pre-copy failed', { action: 'emergency-repair', error });
    try {
      fs.rmSync(workPath, { force: true });
    } catch {
      // best effort
    }
    return { repaired: false, detail: 'pre-repair copy failed' };
  }

  let detail = 'REINDEX restored integrity';
  let db: Database.Database | null = null;
  try {
    db = new Database(workPath);
    db.pragma('journal_mode = WAL');
    db.exec('REINDEX');
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const ok = Array.isArray(rows) && rows.length === 1 && rows[0].integrity_check === 'ok';
    if (ok) {
      // 修复成功：checkpoint 后把工作副本覆盖回原库（boot 阶段无并发写，
      // copyFile 覆盖即生效），并清掉工作副本产生的侧车。
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      db = null;
      for (const suffix of ['-wal', '-shm']) {
        try {
          fs.rmSync(`${dbPath}${suffix}`, { force: true });
          fs.rmSync(`${workPath}${suffix}`, { force: true });
        } catch {
          // best effort
        }
      }
      fs.copyFileSync(workPath, dbPath);
      fs.rmSync(workPath, { force: true });
      logger.warn('emergency repair succeeded; original kept as corrupt copy', {
        action: 'emergency-repair',
        backupPath,
      });
      return { repaired: true, backupPath, detail };
    }
    db.close();
    db = null;
    detail = 'integrity_check still failing after REINDEX';
  } catch (error) {
    try {
      db?.close();
    } catch {
      // best effort
    }
    detail = error instanceof Error ? error.message : String(error);
    logger.error('emergency repair failed', { action: 'emergency-repair', error });
  }

  // 修复无效：丢弃工作副本，原文件从未被打开写入，保持逐字节不变。
  try {
    fs.rmSync(workPath, { force: true });
  } catch {
    // best effort
  }
  return { repaired: false, detail };
}
