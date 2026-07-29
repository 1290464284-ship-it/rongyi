/* eslint-disable security/detect-non-literal-fs-filename -- 手动备份路径来自服务端配置，非用户输入 */
import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppLogger } from "../../../common/services/logger.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { AuditLogService } from "../../../common/services/audit-log.service";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { AuditLogType } from "../../../common/constants";
import {
  getBackupDir,
  validateBackupFilename,
  resolveAndValidatePath,
  readAndDecryptBackup,
  encryptAndWriteBackup,
  checkIntegrity,
  verifyCoreTablesReadable,
  findBackupRecordById,
  isEncryptedBuffer,
} from './backup-core';

@Injectable()
export class BackupManualService {
  private readonly logger = new AppLogger(BackupManualService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private auditLogService: AuditLogService,
  ) {}

  async findMany() {
    const { clause, params } = buildClinicFilter(this.clinicContext.getClinicId());
    return this.dbService.prepare(`SELECT * FROM BackupRecord WHERE 1=1${clause} ORDER BY createdAt DESC`).all(...params);
  }

  async create(type: string | undefined, remark: string | undefined, _user: Record<string, unknown>) {
    const id = crypto.randomUUID();
    const filename = "dental-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite";
    const backupDir = getBackupDir(this.dbService);
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, filename);

    try {
      this.dbService.checkpoint('FULL');
    } catch (err: unknown) {
      this.logger.warn('WAL checkpoint before backup failed, proceeding anyway', err instanceof Error ? err.message : String(err));
    }

    const dbPath = this.dbService.db.name;
    try {
        await this.dbService.db.backup(backupPath);
      } catch (err: unknown) {
        this.logger.error('SQLite backup API failed, falling back to file copy', err instanceof Error ? err.message : String(err));
        try {
          this.dbService.checkpoint('FULL');
        } catch (checkpointErr: unknown) {
          this.logger.warn('WAL checkpoint before fallback copy failed, proceeding anyway', checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr));
        }
        fs.copyFileSync(dbPath, backupPath);
      }

    try {
      const _stats = fs.statSync(backupPath);
    } catch (err: unknown) {
      throw new BusinessValidationException(`备份文件创建失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    const integrity = checkIntegrity(this.dbService, backupPath);
    if (!integrity.ok) {
      try { fs.unlinkSync(backupPath); } catch (unlinkErr: unknown) {
        this.logger.error(`删除损坏的备份文件失败: ${backupPath}`, unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr));
      }
      throw new BusinessValidationException(`备份完整性检查失败: ${integrity.detail}`);
    }

    try {
      const plaintext = fs.readFileSync(backupPath);
      encryptAndWriteBackup(backupPath, plaintext);
    } catch (encryptErr: unknown) {
      try { fs.unlinkSync(backupPath); } catch (unlinkErr: unknown) {
        this.logger.warn(`删除加密失败的备份文件失败: ${backupPath}`, unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr));
      }
      throw new BusinessValidationException(`备份文件加密失败: ${encryptErr instanceof Error ? encryptErr.message : String(encryptErr)}`);
    }

    let encryptedStats: fs.Stats;
    try {
      encryptedStats = fs.statSync(backupPath);
    } catch (err: unknown) {
      throw new BusinessValidationException(`备份文件创建失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.dbService.prepare("INSERT INTO BackupRecord (id, filename, fileSize, type, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, filename, encryptedStats.size, type || "MANUAL", remark || null, this.clinicContext.getClinicId(), new Date().toISOString());
    // P2 修复：备份创建是高敏感操作（数据导出），必须记录审计日志
    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.BACKUP_CREATE,
      id,
      "BackupRecord",
      this.clinicContext.getClinicId(),
      { afterData: { filename, fileSize: encryptedStats.size, type: type || "MANUAL" } },
    );
    this.logger.log(`备份创建成功: ${filename} (${encryptedStats.size} bytes, encrypted)`);
    return { id, filename, fileSize: encryptedStats.size };
  }

  async restore(filename: string, _user: Record<string, unknown>) {
    validateBackupFilename(filename);
    const { clause, params } = buildClinicFilter(this.clinicContext.getClinicId());
    const record = this.dbService.prepare(`SELECT * FROM BackupRecord WHERE filename = ?${clause}`).get(filename, ...params);
    if (!record) throw new BusinessNotFoundException("备份文件不存在");
    const backupDir = getBackupDir(this.dbService);
    const backupPath = resolveAndValidatePath(backupDir, filename);
    if (!fs.existsSync(backupPath)) throw new BusinessNotFoundException("备份文件不存在");

    const dbPath = this.dbService.db.name;
    const tmpRestorePath = dbPath + '.restore-tmp';
    const oldDbPath = dbPath + '.bak-old';
    let dbClosed = false;
    try {
      const plaintextData = readAndDecryptBackup(backupPath);

      fs.writeFileSync(tmpRestorePath, plaintextData, { mode: 0o600 });
      const integrity = checkIntegrity(this.dbService, tmpRestorePath);
      if (!integrity.ok) {
        throw new BusinessValidationException(`备份文件完整性检查失败: ${integrity.detail}`);
      }

      this.dbService.db.close();
      dbClosed = true;

      try { if (fs.existsSync(oldDbPath)) fs.unlinkSync(oldDbPath); } catch (unlinkErr: unknown) {
        this.logger.warn('删除旧的备份文件失败', unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr));
      }

      fs.renameSync(dbPath, oldDbPath);
      try {
        fs.renameSync(tmpRestorePath, dbPath);
        try { fs.chmodSync(dbPath, 0o600); } catch (chmodErr: unknown) {
          this.logger.warn('设置数据库文件权限失败', chmodErr instanceof Error ? chmodErr.message : String(chmodErr));
        }
      } catch (replaceErr: unknown) {
        try { fs.renameSync(oldDbPath, dbPath); } catch (rollbackErr: unknown) {
          this.logger.error('备份恢复回滚失败，生产库可能丢失！请手动恢复 .bak-old 文件', rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr));
        }
        throw new BusinessValidationException(`备份恢复失败: ${replaceErr instanceof Error ? replaceErr.message : String(replaceErr)}`);
      }

      this.dbService.rebuildConnection();
      dbClosed = false;

      try { if (fs.existsSync(oldDbPath)) fs.unlinkSync(oldDbPath); } catch (unlinkErr: unknown) {
        this.logger.warn('删除旧的备份文件失败', unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr));
      }
      // P2 修复：改用 AuditLogService.logAudit 统一审计日志写入，确保敏感数据脱敏和字段完整性
      this.auditLogService.logAudit(
        this.dbService,
        AuditLogType.BACKUP_RESTORE,
        filename,
        "BackupRecord",
        this.clinicContext.getClinicId(),
        { afterData: { filename, success: true } },
      );
      this.logger.log(`备份恢复成功: ${filename}`);
      return { success: true };
    } catch (err: unknown) {
      if (dbClosed) {
        try { this.dbService.rebuildConnection(); } catch (rebuildErr: unknown) {
          this.logger.error('备份恢复失败后重建连接也失败，服务可能不可用', rebuildErr instanceof Error ? rebuildErr.message : String(rebuildErr));
        }
      }
      throw err instanceof BusinessValidationException ? err : new BusinessValidationException(`备份恢复失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      try { if (fs.existsSync(tmpRestorePath)) fs.unlinkSync(tmpRestorePath); } catch (cleanupErr: unknown) {
        this.logger.warn('清理临时恢复文件失败', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
      }
    }
  }

  async delete(filename: string) {
    validateBackupFilename(filename);
    const { clause, params } = buildClinicFilter(this.clinicContext.getClinicId());
    const record = this.dbService.prepare(`SELECT * FROM BackupRecord WHERE filename = ?${clause}`).get(filename, ...params);
    if (!record) throw new BusinessNotFoundException("备份记录不存在");
    const backupDir = getBackupDir(this.dbService);
    const backupPath = resolveAndValidatePath(backupDir, filename);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    this.dbService.prepare(`DELETE FROM BackupRecord WHERE filename = ?${clause}`).run(filename, ...params);
    // P2 修复：备份删除是高敏感操作（数据销毁），必须记录审计日志
    this.auditLogService.logAudit(
      this.dbService,
      AuditLogType.BACKUP_DELETE,
      filename,
      "BackupRecord",
      this.clinicContext.getClinicId(),
      { beforeData: { filename } },
    );
    return { filename };
  }

  async removeById(id: string) {
    const { clause, params } = buildClinicFilter(this.clinicContext.getClinicId());
    const record = findBackupRecordById(this.dbService, id, clause, params);
    return this.delete(record.filename as string);
  }

  async restoreById(id: string, user: Record<string, unknown>) {
    const { clause, params } = buildClinicFilter(this.clinicContext.getClinicId());
    const record = findBackupRecordById(this.dbService, id, clause, params);
    return this.restore(record.filename as string, user);
  }

  async list() {
    const { clause, params } = buildClinicFilter(this.clinicContext.getClinicId());
    return this.dbService.prepare(`SELECT * FROM BackupRecord WHERE 1=1${clause} ORDER BY createdAt DESC LIMIT 200`).all(...params);
  }

  async drill() {
    const dbPath = this.dbService.db.name;
    const tmpDir = path.join(path.dirname(dbPath), 'backups', 'drill-' + Date.now());
    const tmpBackupPath = path.join(tmpDir, 'drill.sqlite');
    const results: { step: string; ok: boolean; detail?: string }[] = [];

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      try { this.dbService.db.pragma('wal_checkpoint(FULL)'); } catch (checkpointErr: unknown) {
        this.logger.warn('WAL checkpoint before drill backup failed', checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr));
      }
      fs.copyFileSync(dbPath, tmpBackupPath);
      results.push({ step: 'create_backup', ok: true, detail: tmpBackupPath });

      const verifyDb = this.dbService.openReadonly(tmpBackupPath);
      let hasError = false;
      let allReadable = true;
      try {
        const integrity = verifyDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
        hasError = integrity.some((row) => row.integrity_check !== 'ok');
        results.push({ step: 'integrity_check', ok: !hasError, detail: hasError ? integrity.map(r => r.integrity_check).join('; ') : 'ok' });

        const coreTables = ['User', 'Patient', 'Charge', 'Appointment', 'Visit'];
        for (const table of coreTables) {
          try {
            const row = verifyDb.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
            results.push({ step: `verify_${table}`, ok: true, detail: row ? 'readable' : 'empty' });
          } catch (err: unknown) {
            results.push({ step: `verify_${table}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
            allReadable = false;
          }
        }
      } finally {
        verifyDb.close();
      }

      try {
        fs.unlinkSync(tmpBackupPath);
        fs.rmdirSync(tmpDir);
        results.push({ step: 'cleanup', ok: true });
      } catch (err: unknown) {
        this.logger.warn('清理临时备份文件失败:', err instanceof Error ? err.message : String(err));
        results.push({ step: 'cleanup', ok: false, detail: err instanceof Error ? err.message : String(err) });
      }

      const success = !hasError && allReadable;
      return { success, results, timestamp: new Date().toISOString() };
    } catch (err: unknown) {
      try { if (fs.existsSync(tmpBackupPath)) fs.unlinkSync(tmpBackupPath); } catch (cleanupErr: unknown) {
        this.logger.warn('清理临时备份文件失败:', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
      }
      try { if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir); } catch (cleanupErr: unknown) {
        this.logger.warn('清理临时备份目录失败:', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
      }
      results.push({ step: 'error', ok: false, detail: err instanceof Error ? err.message : String(err) });
      return { success: false, results, timestamp: new Date().toISOString() };
    }
  }

  async verifyBackup(id: string) {
    const { clause, params } = buildClinicFilter(this.clinicContext.getClinicId());
    const record = findBackupRecordById(this.dbService, id, clause, params);

    const filename = record.filename as string;
    const backupDir = getBackupDir(this.dbService);
    const backupPath = resolveAndValidatePath(backupDir, filename);

    if (!fs.existsSync(backupPath)) {
      throw new BusinessNotFoundException("备份文件不存在");
    }

    const results: { step: string; ok: boolean; detail?: string }[] = [];
    let verifyPath = backupPath;
    let tmpPath: string | null = null;
    try {
      const fileData = fs.readFileSync(backupPath);
      if (isEncryptedBuffer(fileData)) {
        try {
          const decrypted = readAndDecryptBackup(backupPath);
          tmpPath = backupPath + '.verify-tmp';
          fs.writeFileSync(tmpPath, decrypted, { mode: 0o600 });
          verifyPath = tmpPath;
          results.push({ step: 'decrypt', ok: true, detail: `${fileData.length} → ${decrypted.length} bytes` });
        } catch {
          results.push({ step: 'decrypt', ok: false, detail: '解密失败，请检查 BACKUP_ENCRYPTION_KEY 或 ENCRYPTION_KEY' });
          return { success: false, results, timestamp: new Date().toISOString(), filename };
        }
      }

      const stats = fs.statSync(verifyPath);
      results.push({ step: 'file_exists', ok: true, detail: `${stats.size} bytes` });

      const integrity = checkIntegrity(this.dbService, verifyPath);
      results.push({ step: 'integrity_check', ok: integrity.ok, detail: integrity.detail });

      const tableResults = verifyCoreTablesReadable(this.dbService, verifyPath);
      for (const tr of tableResults) {
        results.push({ step: `read_${tr.table}`, ok: tr.ok, detail: tr.detail });
      }

      const success = results.every(r => r.ok);
      return { success, results, timestamp: new Date().toISOString(), filename };
    } catch (err: unknown) {
      results.push({ step: 'error', ok: false, detail: err instanceof Error ? err.message : String(err) });
      return { success: false, results, timestamp: new Date().toISOString(), filename };
    } finally {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch (cleanupErr: unknown) {
          this.logger.warn('清理临时验证文件失败', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
        }
      }
    }
  }
}
