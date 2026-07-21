import { Injectable, NotFoundException, BadRequestException, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { AppLogger } from "../../../common/services/logger.service";
import { encryptBuffer, decryptBufferIfEncrypted, isEncryptedBuffer } from "../../../common/utils/encryption";

@Injectable()
export class BackupsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('BackupsService');
  private autoBackupTimer: NodeJS.Timeout | null = null;
  private autoVerifyTimer: NodeJS.Timeout | null = null;
  private readonly AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  private readonly AUTO_VERIFY_INTERVAL_MS = 12 * 60 * 60 * 1000;
  private readonly MAX_AUTO_BACKUPS = 7;

  constructor(private dbService: DbService) {}

  onModuleInit() {
    this.startAutoBackup();
    this.startAutoVerify();
  }

  onModuleDestroy() {
    this.stopAutoBackup();
    this.stopAutoVerify();
  }

  private startAutoBackup() {
    if (this.autoBackupTimer) return;
    this.logger.log('自动备份已启动，间隔 24 小时');
    this.autoBackupTimer = setInterval(() => {
      this.performAutoBackup().catch((err) => {
        this.logger.error('自动备份失败', err instanceof Error ? err.stack : String(err));
      });
    }, this.AUTO_BACKUP_INTERVAL_MS);

    process.nextTick(() => {
      this.ensureDailyBackup().catch((err) => {
        this.logger.warn('检查今日备份失败', err instanceof Error ? err.message : String(err));
      });
    });
  }

  private stopAutoBackup() {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
      this.logger.log('自动备份已停止');
    }
  }

  private startAutoVerify() {
    if (this.autoVerifyTimer) return;
    this.logger.log('自动备份验证已启动，间隔 12 小时');
    this.autoVerifyTimer = setInterval(() => {
      this.performAutoVerify().catch((err) => {
        this.logger.error('自动备份验证失败', err instanceof Error ? err.stack : String(err));
      });
    }, this.AUTO_VERIFY_INTERVAL_MS);
  }

  private stopAutoVerify() {
    if (this.autoVerifyTimer) {
      clearInterval(this.autoVerifyTimer);
      this.autoVerifyTimer = null;
      this.logger.log('自动备份验证已停止');
    }
  }

  private async performAutoVerify() {
    this.logger.log('开始执行自动备份验证...');
    const backups = this.dbService.prepare(
      "SELECT id, filename, createdAt FROM BackupRecord WHERE type = 'AUTO' ORDER BY createdAt DESC LIMIT 3"
    ).all() as Array<{ id: string; filename: string; createdAt: string }>;

    if (backups.length === 0) {
      this.logger.warn('没有找到自动备份文件，跳过验证');
      return;
    }

    for (const backup of backups) {
      this.logger.log(`验证备份: ${backup.filename} (${backup.createdAt})`);
      try {
        const result = await this.verifyBackup(backup.id);
        if (!result.success) {
          this.logger.error(`备份验证失败: ${backup.filename}`, JSON.stringify(result.results));
        } else {
          this.logger.log(`备份验证通过: ${backup.filename}`);
        }
      } catch (err) {
        this.logger.error(`验证备份 ${backup.filename} 时发生错误`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  private async ensureDailyBackup() {
    const today = new Date().toISOString().split('T')[0];
    const todayBackups = this.dbService.prepare(
      "SELECT COUNT(*) as cnt FROM BackupRecord WHERE type = 'AUTO' AND DATE(createdAt) = ?"
    ).get(today) as { cnt: number };
    if (todayBackups.cnt === 0) {
      this.logger.log('今日暂无自动备份，执行首次自动备份');
      await this.performAutoBackup();
    }
  }

  private async performAutoBackup() {
    try {
      this.logger.log('开始执行自动备份...');
      const result = await this.create('AUTO', '自动定时备份', { id: 'system', name: 'system' } as Record<string, unknown>);
      this.logger.log(`自动备份完成: ${result.filename}`);
      await this.cleanupOldAutoBackups();
    } catch (err) {
      this.logger.error('自动备份执行失败', err instanceof Error ? err.stack : String(err));
    }
  }

  private async cleanupOldAutoBackups() {
    try {
      const autoBackups = this.dbService.prepare(
        "SELECT * FROM BackupRecord WHERE type = 'AUTO' ORDER BY createdAt DESC"
      ).all() as Array<{ id: string; filename: string }>;

      if (autoBackups.length > this.MAX_AUTO_BACKUPS) {
        const toDelete = autoBackups.slice(this.MAX_AUTO_BACKUPS);
        for (const backup of toDelete) {
          try {
            await this.removeById(backup.id);
            this.logger.log(`清理过期自动备份: ${backup.filename}`);
          } catch (err) {
            this.logger.warn(`清理备份 ${backup.filename} 失败`, err instanceof Error ? err.message : String(err));
          }
        }
      }
    } catch (err) {
      this.logger.error('清理旧备份失败', err instanceof Error ? err.message : String(err));
    }
  }

  async findMany() {
    return this.dbService.prepare("SELECT * FROM BackupRecord ORDER BY createdAt DESC").all();
  }

  async create(type: string | undefined, remark: string | undefined, user: Record<string, unknown>) {
    const id = crypto.randomUUID();
    const filename = "dental-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite";
    const dbPath = this.dbService.db.name;
    const backupDir = path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, filename);

    try {
      this.dbService.checkpoint('FULL');
    } catch (err) {
      this.logger.warn('WAL checkpoint before backup failed, proceeding anyway', err instanceof Error ? err.message : String(err));
    }

    try {
        await this.dbService.db.backup(backupPath);
      } catch (err) {
        this.logger.error('SQLite backup API failed, falling back to file copy', err instanceof Error ? err.message : String(err));
        try {
          this.dbService.checkpoint('FULL');
        } catch (checkpointErr) {
          this.logger.warn('WAL checkpoint before fallback copy failed, proceeding anyway', checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr));
        }
        fs.copyFileSync(dbPath, backupPath);
      }

    let stats;
    try {
      stats = fs.statSync(backupPath);
    } catch (err) {
      throw new BadRequestException(`备份文件创建失败: ${(err as Error).message}`);
    }

    const testDb = new Database(backupPath, { readonly: true });
    try {
      const integrity = testDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      if (integrity.integrity_check !== 'ok') {
        try { 
          fs.unlinkSync(backupPath); 
        } catch (unlinkErr) {
          this.logger.error(`删除损坏的备份文件失败: ${backupPath}`, unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr));
        }
        throw new BadRequestException(`备份完整性检查失败: ${integrity.integrity_check}`);
      }
    } finally {
      testDb.close();
    }

    // P1 修复（备份文件加密 + 文件权限）：加密备份文件并设置 0o600 权限
    try {
      const plaintext = fs.readFileSync(backupPath);
      const encrypted = encryptBuffer(plaintext);
      fs.writeFileSync(backupPath, encrypted, { mode: 0o600 });
    } catch (encryptErr) {
      try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
      throw new BadRequestException(`备份文件加密失败: ${(encryptErr as Error).message}`);
    }

    // 重新获取加密后的文件大小
    let encryptedStats;
    try {
      encryptedStats = fs.statSync(backupPath);
    } catch (err) {
      throw new BadRequestException(`备份文件创建失败: ${(err as Error).message}`);
    }

    this.dbService.prepare("INSERT INTO BackupRecord (id, filename, fileSize, type, remark, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, filename, encryptedStats.size, type || "MANUAL", remark || null, new Date().toISOString());
    this.logger.log(`备份创建成功: ${filename} (${encryptedStats.size} bytes, encrypted)`);
    return { id, filename, fileSize: encryptedStats.size };
  }

  async restore(filename: string, user: Record<string, unknown>) {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new BadRequestException("非法的文件名");
    }
    const record = this.dbService.prepare("SELECT * FROM BackupRecord WHERE filename = ?").get(filename);
    if (!record) throw new NotFoundException("备份文件不存在");
    const dbPath = this.dbService.db.name;
    const backupDir = path.join(path.dirname(dbPath), "backups");
    const backupPath = path.join(backupDir, filename);
    const resolvedBackupDir = path.resolve(backupDir);
    const resolvedBackupPath = path.resolve(backupPath);
    if (!resolvedBackupPath.startsWith(resolvedBackupDir + path.sep) && resolvedBackupPath !== resolvedBackupDir) {
      throw new BadRequestException("非法的文件路径");
    }
    if (!fs.existsSync(backupPath)) throw new NotFoundException("备份文件不存在");

    // P1 修复（备份恢复非原子操作 + 加密备份支持）：
    // 1. 解密备份到临时文件并验证完整性（在关闭生产库之前）
    // 2. 用 rename 实现原子替换：旧库 → .bak-old，临时 → dbPath
    // 3. 失败时回滚：.bak-old → dbPath
    const tmpRestorePath = dbPath + '.restore-tmp';
    const oldDbPath = dbPath + '.bak-old';
    let dbClosed = false;
    try {
      // 读取并解密备份
      const fileData = fs.readFileSync(backupPath);
      let plaintextData: Buffer;
      if (isEncryptedBuffer(fileData)) {
        const decrypted = decryptBufferIfEncrypted(fileData);
        if (!decrypted) throw new BadRequestException("备份文件解密失败，请检查 ENCRYPTION_KEY 配置");
        plaintextData = decrypted;
      } else {
        plaintextData = fileData;
      }

      // 写入临时文件并验证完整性
      fs.writeFileSync(tmpRestorePath, plaintextData, { mode: 0o600 });
      const testDb = new Database(tmpRestorePath, { readonly: true });
      try {
        const integrity = testDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (integrity.integrity_check !== 'ok') {
          throw new BadRequestException(`备份文件完整性检查失败: ${integrity.integrity_check}`);
        }
      } finally {
        testDb.close();
      }

      // 关闭生产库，原子替换
      this.dbService.db.close();
      dbClosed = true;

      // 清理可能残留的 .bak-old
      try { if (fs.existsSync(oldDbPath)) fs.unlinkSync(oldDbPath); } catch { /* ignore */ }

      // 旧库移到 .bak-old（原子操作）
      fs.renameSync(dbPath, oldDbPath);
      try {
        // 临时文件移到 dbPath（原子操作）
        fs.renameSync(tmpRestorePath, dbPath);
        try { fs.chmodSync(dbPath, 0o600); } catch { /* best effort */ }
      } catch (replaceErr) {
        // 替换失败，回滚：把旧库移回来
        try { fs.renameSync(oldDbPath, dbPath); } catch (rollbackErr) {
          this.logger.error('备份恢复回滚失败，生产库可能丢失！请手动恢复 .bak-old 文件', rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr));
        }
        throw new BadRequestException(`备份恢复失败: ${(replaceErr as Error).message}`);
      }

      // 成功，重建连接
      this.dbService.rebuildConnection();
      dbClosed = false;

      // 删除旧库备份
      try { if (fs.existsSync(oldDbPath)) fs.unlinkSync(oldDbPath); } catch { /* ignore */ }
      this.logger.log(`备份恢复成功: ${filename}`);
      return { success: true };
    } catch (err) {
      if (dbClosed) {
        try { this.dbService.rebuildConnection(); } catch (rebuildErr) {
          this.logger.error('备份恢复失败后重建连接也失败，服务可能不可用', rebuildErr instanceof Error ? rebuildErr.message : String(rebuildErr));
        }
      }
      throw err instanceof BadRequestException ? err : new BadRequestException(`备份恢复失败: ${(err as Error).message}`);
    } finally {
      // 清理临时文件
      try { if (fs.existsSync(tmpRestorePath)) fs.unlinkSync(tmpRestorePath); } catch { /* ignore */ }
    }
  }

  async delete(filename: string) {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new BadRequestException("非法的文件名");
    }
    const record = this.dbService.prepare("SELECT * FROM BackupRecord WHERE filename = ?").get(filename);
    if (!record) throw new NotFoundException("备份记录不存在");
    const dbPath = this.dbService.db.name;
    const backupDir = path.join(path.dirname(dbPath), "backups");
    const backupPath = path.join(backupDir, filename);
    const resolvedBackupDir = path.resolve(backupDir);
    const resolvedBackupPath = path.resolve(backupPath);
    if (!resolvedBackupPath.startsWith(resolvedBackupDir + path.sep) && resolvedBackupPath !== resolvedBackupDir) {
      throw new BadRequestException("非法的文件路径");
    }
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    this.dbService.prepare("DELETE FROM BackupRecord WHERE filename = ?").run(filename);
    return { filename };
  }

  async removeById(id: string) {
    const record = this.dbService.prepare("SELECT * FROM BackupRecord WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!record) throw new NotFoundException("备份记录不存在");
    return this.delete(record.filename as string);
  }

  async restoreById(id: string, user: Record<string, unknown>) {
    const record = this.dbService.prepare("SELECT * FROM BackupRecord WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!record) throw new NotFoundException("备份记录不存在");
    return this.restore(record.filename as string, user);
  }

  async list() { return this.dbService.prepare("SELECT * FROM BackupRecord ORDER BY createdAt DESC").all(); }

  async drill() {
    const dbPath = this.dbService.db.name;
    const tmpDir = path.join(path.dirname(dbPath), 'backups', 'drill-' + Date.now());
    const tmpBackupPath = path.join(tmpDir, 'drill.sqlite');
    const results: { step: string; ok: boolean; detail?: string }[] = [];

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      try { this.dbService.db.pragma('wal_checkpoint(FULL)'); } catch (checkpointErr) {
        this.logger.warn('WAL checkpoint before drill backup failed', checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr));
      }
      fs.copyFileSync(dbPath, tmpBackupPath);
      results.push({ step: 'create_backup', ok: true, detail: tmpBackupPath });

      const testDb = new Database(tmpBackupPath, { readonly: true });
      const integrity = testDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      const hasError = integrity.some((row) => row.integrity_check !== 'ok');
      testDb.close();
      results.push({ step: 'integrity_check', ok: !hasError, detail: hasError ? integrity.map(r => r.integrity_check).join('; ') : 'ok' });

      const verifyDb = new Database(tmpBackupPath, { readonly: true });
      const coreTables = ['User', 'Patient', 'Charge', 'Appointment', 'Visit'];
      let allReadable = true;
      for (const table of coreTables) {
        try {
          const count = verifyDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
          results.push({ step: `verify_${table}`, ok: true, detail: `${count.cnt} rows` });
        } catch (err) {
          results.push({ step: `verify_${table}`, ok: false, detail: (err as Error).message });
          allReadable = false;
        }
      }
      verifyDb.close();

      try {
        fs.unlinkSync(tmpBackupPath);
        fs.rmdirSync(tmpDir);
        results.push({ step: 'cleanup', ok: true });
      } catch (err) {
        this.logger.warn('清理临时备份文件失败:', (err as Error).message);
        results.push({ step: 'cleanup', ok: false, detail: (err as Error).message });
      }

      const success = !hasError && allReadable;
      return { success, results, timestamp: new Date().toISOString() };
    } catch (err) {
      try { if (fs.existsSync(tmpBackupPath)) fs.unlinkSync(tmpBackupPath); } catch (cleanupErr) {
        this.logger.warn('清理临时备份文件失败:', (cleanupErr as Error).message);
      }
      try { if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir); } catch (cleanupErr) {
        this.logger.warn('清理临时备份目录失败:', (cleanupErr as Error).message);
      }
      results.push({ step: 'error', ok: false, detail: (err as Error).message });
      return { success: false, results, timestamp: new Date().toISOString() };
    }
  }

  /**
   * Verify a specific backup file without restoring it.
   * Checks integrity and data readability on a temporary copy.
   */
  async verifyBackup(id: string) {
    const record = this.dbService.prepare("SELECT * FROM BackupRecord WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!record) throw new NotFoundException("备份记录不存在");

    const filename = record.filename as string;
    const dbPath = this.dbService.db.name;
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    const backupPath = path.join(backupDir, filename);

    // Security: prevent path traversal
    if (!path.resolve(backupPath).startsWith(path.resolve(backupDir) + path.sep)) {
      throw new BadRequestException("非法的文件路径");
    }

    if (!fs.existsSync(backupPath)) {
      throw new NotFoundException("备份文件不存在");
    }

    const results: { step: string; ok: boolean; detail?: string }[] = [];
    // P1 修复：支持加密备份，解密到临时文件后验证
    let verifyPath = backupPath;
    let tmpPath: string | null = null;
    try {
      const fileData = fs.readFileSync(backupPath);
      if (isEncryptedBuffer(fileData)) {
        const decrypted = decryptBufferIfEncrypted(fileData);
        if (!decrypted) {
          results.push({ step: 'decrypt', ok: false, detail: '解密失败，请检查 ENCRYPTION_KEY' });
          return { success: false, results, timestamp: new Date().toISOString(), filename };
        }
        tmpPath = backupPath + '.verify-tmp';
        fs.writeFileSync(tmpPath, decrypted, { mode: 0o600 });
        verifyPath = tmpPath;
        results.push({ step: 'decrypt', ok: true, detail: `${fileData.length} → ${decrypted.length} bytes` });
      }

      // Step 1: File size check
      const stats = fs.statSync(verifyPath);
      results.push({ step: 'file_exists', ok: true, detail: `${stats.size} bytes` });

      // Step 2: SQLite integrity check
      const testDb = new Database(verifyPath, { readonly: true });
      try {
        const integrity = testDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        const ok = integrity.integrity_check === 'ok';
        results.push({ step: 'integrity_check', ok, detail: integrity.integrity_check });
      } finally {
        testDb.close();
      }

      // Step 3: Core tables readability
      const verifyDb = new Database(verifyPath, { readonly: true });
      const coreTables = ['User', 'Patient', 'Charge', 'Appointment', 'Visit'];
      let allReadable = true;
      for (const table of coreTables) {
        try {
          const count = verifyDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
          results.push({ step: `read_${table}`, ok: true, detail: `${count.cnt} rows` });
        } catch (err) {
          results.push({ step: `read_${table}`, ok: false, detail: (err as Error).message });
          allReadable = false;
        }
      }
      verifyDb.close();

      const success = results.every(r => r.ok);
      return { success, results, timestamp: new Date().toISOString(), filename };
    } catch (err) {
      results.push({ step: 'error', ok: false, detail: (err as Error).message });
      return { success: false, results, timestamp: new Date().toISOString(), filename };
    } finally {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
    }
  }
}
