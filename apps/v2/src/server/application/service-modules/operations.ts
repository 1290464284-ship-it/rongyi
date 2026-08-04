import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SqliteRepository } from '../../infrastructure/repository';
import { stripProtectedWriteFields } from '../../infrastructure/security';
import { validatePayload } from '../../http/validation';
import { SqliteUnitOfWork } from '../../infrastructure/unit-of-work';
import { removeSqliteSidecars, summarizeSqliteFile } from '../../infrastructure/sqlite-files';
import {
  SqliteAlertRepository,
  SqliteFollowUpRepository,
  SqliteHrRepository,
  SqliteInventoryRepository,
} from '../../infrastructure/repositories/core.repositories';
import { resourceRegistry } from '../../../domain/resources';
import { withIdempotency } from '../../infrastructure/idempotency';
import { SystemClock } from '../../infrastructure/clock';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext, IUnitOfWork } from '../../../domain/contracts';
import type {
  AlertRepository,
  FollowUpRepository,
  HrRepository,
  InventoryRepository,
} from '../ports';
import { BACKUP_MAGIC, backupEncryptionKey, hashRefreshToken, newRefreshToken } from './common';

export class InventoryService {
  private readonly db: Database.Database;
  private readonly inventoryRepository: InventoryRepository;
  private readonly unitOfWork: IUnitOfWork;

  constructor(db: Database.Database, inventoryRepository?: InventoryRepository, unitOfWork?: IUnitOfWork) {
    this.db = db;
    this.inventoryRepository = inventoryRepository ?? new SqliteInventoryRepository(db);
    this.unitOfWork = unitOfWork ?? new SqliteUnitOfWork(db);
  }

  async createTransaction(
    input: { itemId: string; type: 'IN' | 'OUT' | 'ADJUST'; quantity: number; remark?: string },
    context: AppContext,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, {
      operation: 'inventory.transaction',
      userId: context.userId,
      clinicId: context.clinicId,
      requestId: requestId ?? '',
    }, () => {
      if (!['IN', 'OUT', 'ADJUST'].includes(input.type)) {
        throw new ValidationError('Inventory transaction type must be IN, OUT, or ADJUST');
      }
      if (!Number.isFinite(input.quantity) || input.quantity === 0) {
        throw new ValidationError('Inventory transaction quantity must be a non-zero number');
      }
      if (input.type !== 'ADJUST' && input.quantity < 0) {
        throw new ValidationError('Inventory transaction quantity must be positive');
      }
      const item = this.inventoryRepository.findItem(input.itemId, context.clinicId);
      if (!item) throw new NotFoundError('Inventory item not found');
      const before = Number(item.stock);
      const delta = input.type === 'IN' ? input.quantity : input.type === 'OUT' ? -input.quantity : input.quantity;
      const after = before + delta;
      if (after < 0) throw new ConflictError('Insufficient stock');
      const now = context.now().toISOString();
      const id = randomUUID();
      this.unitOfWork.run(() => {
        this.inventoryRepository.updateStock(input.itemId, after, now, context.clinicId);
        this.inventoryRepository.createTransaction({
          id,
          clinicId: context.clinicId ?? null,
          itemId: input.itemId,
          type: input.type,
          quantity: input.quantity,
          beforeStock: before,
          afterStock: after,
          operatorId: context.userId,
          remark: input.remark ?? null,
          createdAt: now,
          updatedAt: now,
        });
      });
      return { id, beforeStock: before, afterStock: after };
    });
  }

  lowStock(context: AppContext): Array<Record<string, unknown>> {
    return this.inventoryRepository.lowStock(context.clinicId).map((row) => ({ ...row }));
  }

  expiringSoon(days = 30, context: AppContext): Array<Record<string, unknown>> {
    const clock = new SystemClock();
    const today = clock.clinicDate();
    const cutoff = clock.clinicDate(Date.now() + Math.max(1, days) * 86_400_000);
    const params = context.clinicId ? [today, cutoff, context.clinicId] : [today, cutoff];
    return this.db.prepare(
      `SELECT * FROM InventoryItem
       WHERE deletedAt IS NULL
         AND expireDate IS NOT NULL
         AND expireDate >= ?
         AND expireDate <= ?
         ${tenantAnd(context.clinicId)}
       ORDER BY expireDate ASC
       LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
  }
}

export class FollowUpService {
  private readonly db: Database.Database;
  private readonly followUpRepository: FollowUpRepository;

  constructor(db: Database.Database, followUpRepository?: FollowUpRepository) {
    this.db = db;
    this.followUpRepository = followUpRepository ?? new SqliteFollowUpRepository(db);
  }

  reminders(context: AppContext): Array<Record<string, unknown>> {
    return this.followUpRepository.reminders(context.clinicId);
  }

  complete(id: string, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT id, status FROM FollowUp WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { id: string; status: string } | undefined;
    if (!row) throw new NotFoundError('Follow-up not found');
    if (!['PENDING', 'IN_PROGRESS'].includes(row.status)) {
      throw new ConflictError('Follow-up cannot be completed from current status');
    }
    const now = context.now().toISOString();
    const changes = this.followUpRepository.complete(id, now, now, context.clinicId);
    if (changes === 0) throw new ConflictError('Follow-up cannot be completed');
    return { id, status: 'COMPLETED', completedAt: now };
  }

  async batchGenerate(limit = 50, context: AppContext): Promise<{ processed: number; generated: number }> {
    const maxLimit = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
    const rowParams = context.clinicId ? [context.clinicId, maxLimit] : [maxLimit];
    const rows = this.db.prepare(
      `SELECT DISTINCT V.patientId,
              COALESCE(T.completedDate, V.createdAt) AS completedAt
       FROM Visit V
       INNER JOIN Treatment T ON T.visitId = V.id
       WHERE V.status = 'COMPLETED'
         AND T.status = 'COMPLETED'
         AND V.deletedAt IS NULL
         AND T.deletedAt IS NULL
         ${tenantAnd(context.clinicId, 'V.clinicId')}
       LIMIT ?`,
    ).all(...rowParams) as Array<{ patientId: string; completedAt: string }>;
    const templateParams = context.clinicId ? [context.clinicId] : [];
    const templates = this.db.prepare(
      `SELECT id, name, daysAfter, content, assigneeId
       FROM FollowUpTemplate
       WHERE isEnabled = 1 AND deletedAt IS NULL
         ${tenantAnd(context.clinicId)}
       ORDER BY daysAfter ASC
       LIMIT 20`,
    ).all(...templateParams) as Array<{ id: string; name: string; daysAfter: number; content: string | null; assigneeId: string | null }>;
    let generated = 0;
    const now = context.now().toISOString();
    const alreadyExists = (patientId: string, planDate: string, templateId: string | null): boolean => {
      const templateClause = templateId ? 'templateId = ?' : 'templateId IS NULL';
      const params = [patientId, planDate, ...(templateId ? [templateId] : []), ...tenantParams(context.clinicId)];
      return Boolean(this.db.prepare(
        `SELECT 1 FROM FollowUp
         WHERE patientId = ? AND planDate = ? AND ${templateClause}
           AND status IN ('PENDING', 'IN_PROGRESS')
           AND deletedAt IS NULL${tenantAnd(context.clinicId)}
         LIMIT 1`,
      ).get(...params));
    };
    const run = this.db.transaction(() => {
      for (const row of rows) {
        if (templates.length === 0) {
          const planDate = new SystemClock().clinicDate(Date.now() + 14 * 86_400_000);
          if (alreadyExists(row.patientId, planDate, null)) continue;
          this.followUpRepository.insert({
            id: randomUUID(),
            clinicId: context.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            patientId: row.patientId,
            planDate,
            content: 'Scheduled follow-up',
            status: 'PENDING',
          });
          generated += 1;
          continue;
        }
        /* v8 ignore start -- the query returns a non-null COALESCE value. */
        const completedAt = new Date(String(row.completedAt ?? Date.now())).getTime();
        /* v8 ignore stop */
        if (!Number.isFinite(completedAt)) throw new ValidationError('Completed date is invalid for follow-up generation');
        for (const template of templates) {
          const planDate = new SystemClock().clinicDate(completedAt + Number(template.daysAfter ?? 1) * 86_400_000);
          if (alreadyExists(row.patientId, planDate, template.id)) continue;
          this.followUpRepository.insert({
            id: randomUUID(),
            clinicId: context.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            patientId: row.patientId,
            planDate,
            content: template.content ?? template.name,
            status: 'PENDING',
            assigneeId: template.assigneeId ?? null,
            templateId: template.id,
          });
          generated += 1;
        }
      }
    });
    run();
    return { processed: rows.length, generated };
  }

  adherence(context: AppContext): { total: number; onTime: number; rate: number } {
    const params = tenantParams(context.clinicId);
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN substr(completedAt, 1, 10) <= planDate THEN 1 ELSE 0 END), 0) AS onTime
       FROM FollowUp
       WHERE status = 'COMPLETED' AND planDate IS NOT NULL AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(...params) as { total: number; onTime: number };
    /* v8 ignore start -- the aggregate query always returns numeric columns. */
    const total = Number(row.total ?? 0);
    const onTime = Number(row.onTime ?? 0);
    /* v8 ignore stop */
    return { total, onTime, rate: total === 0 ? 0 : Math.round((onTime / total) * 100) };
  }
}

export interface BackupCreateOptions {
  type?: 'MANUAL' | 'AUTO' | 'RESTORE';
  operatorId?: string | null;
  operatorName?: string | null;
  encrypted?: boolean;
}

export class BackupService {
  constructor(
    private readonly db: Database.Database,
    private readonly dbPath: string,
    private readonly backupDir: string,
  ) {}

  list(): Array<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    return fs.readdirSync(this.backupDir)
      .filter((name) => name.endsWith('.sqlite') || name.endsWith('.enc'))
      .filter((name) => !name.startsWith('.staged-'))
      .map((name) => {
        const stat = fs.statSync(path.join(this.backupDir, name));
        return {
          filename: name,
          fileSize: stat.size,
          createdAt: stat.mtime.toISOString(),
          encrypted: name.endsWith('.enc'),
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async create(options: BackupCreateOptions = {}): Promise<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const encrypted = options.encrypted ?? Boolean(process.env.V2_BACKUP_KEY);
    const base = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const filename = encrypted ? `${base}.enc` : `${base}.sqlite`;
    const tempPath = path.join(this.backupDir, `${base}.tmp`);
    const finalPath = path.join(this.backupDir, filename);
    await this.db.backup(tempPath);
    if (encrypted) {
      await this.encryptFile(tempPath, finalPath);
      fs.unlinkSync(tempPath);
    } else {
      fs.renameSync(tempPath, finalPath);
    }
    const fileSize = fs.statSync(finalPath).size;
    this.db.prepare(
      `INSERT INTO BackupRecord (
         id, clinicId, createdAt, updatedAt, deletedAt,
         filename, fileSize, type, operatorId, operatorName
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      null,
      new Date().toISOString(),
      new Date().toISOString(),
      filename,
      fileSize,
      options.type ?? 'MANUAL',
      options.operatorId ?? null,
      options.operatorName ?? null,
    );
    return { filename, fileSize, encrypted, type: options.type ?? 'MANUAL', message: 'Backup created' };
  }

  async verify(filename: string): Promise<Record<string, unknown>> {
    const file = this.safePath(filename);
    if (!fs.existsSync(file)) throw new NotFoundError('Backup file not found');
    const encrypted = file.endsWith('.enc');
    let sqlitePath = file;
    let tempPath: string | undefined;
    if (encrypted) {
      tempPath = path.join(this.backupDir, `.verify-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`);
      await this.decryptFile(file, tempPath);
      sqlitePath = tempPath;
    }
    try {
      const backupDb = new Database(sqlitePath, { readonly: true });
      try {
        const integrity = backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
        return {
          filename,
          integrity: ok ? 'ok' : 'corrupt',
          encrypted,
          summary: ok ? summarizeSqliteFile(sqlitePath) : undefined,
        };
      } finally {
        backupDb.close();
        removeSqliteSidecars(sqlitePath);
      }
    } finally {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  async stageRestore(filename: string): Promise<Record<string, unknown>> {
    const verified = await this.verify(filename);
    if (verified.integrity !== 'ok') throw new Error('Backup integrity check failed before restore');
    const source = this.safePath(filename);
    const stagedPath = path.join(
      this.backupDir,
      `.staged-${path.basename(filename).replace(/\.[^.]+$/, '')}-${Date.now()}.sqlite`,
    );
    if (source.endsWith('.enc')) {
      await this.decryptFile(source, stagedPath);
    } else {
      fs.copyFileSync(source, stagedPath);
    }
    const staged = new Database(stagedPath, { readonly: true });
    try {
      const integrity = staged.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
        throw new Error('staged restore integrity check failed');
      }
    } finally {
      staged.close();
      removeSqliteSidecars(stagedPath);
    }
    const backupSummary = verified.summary as Record<string, number | string | null> | undefined;
    const currentSummary = fs.existsSync(this.dbPath) ? summarizeSqliteFile(this.dbPath) : undefined;
    const markerPath = path.join(path.dirname(this.dbPath), '.restore-pending.json');
    fs.writeFileSync(markerPath, JSON.stringify({ stagedPath }), 'utf8');
    return {
      filename,
      stagedPath,
      backupSummary,
      currentSummary,
      message: 'Backup verified and staged. Restart the application to activate this restore.',
    };
  }

  cleanup(maxKeep = 30): { kept: number; deleted: Array<{ filename: string; fileSize: number }> } {
    const requested = Number.isFinite(Number(maxKeep)) ? Math.floor(Number(maxKeep)) : 30;
    const keep = requested < 1 ? 1 : requested > 365 ? 365 : requested;
    const files = this.list() as Array<{ filename: string; fileSize: number }>;
    const deleteFiles = files.slice(keep);
    const deleted: Array<{ filename: string; fileSize: number }> = [];
    for (const file of deleteFiles) {
      fs.unlinkSync(path.join(this.backupDir, file.filename));
      this.db.prepare('DELETE FROM BackupRecord WHERE filename = ?').run(file.filename);
      deleted.push({ filename: file.filename, fileSize: file.fileSize });
    }
    return {
      kept: Math.min(files.length, keep),
      deleted,
    };
  }

  private safePath(filename: string): string {
    const resolvedDir = path.resolve(this.backupDir);
    const safeName = path.basename(filename);
    const full = path.join(resolvedDir, safeName);
    /* v8 ignore start */
    if (!full.startsWith(resolvedDir)) throw new NotFoundError('Backup path is invalid');
    /* v8 ignore stop */
    return full;
  }

  private async encryptFile(sourcePath: string, targetPath: string): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', backupEncryptionKey(), iv);
    const output = createWriteStream(targetPath);
    output.write(Buffer.concat([BACKUP_MAGIC, iv]));
    await pipeline(createReadStream(sourcePath), cipher, output);
    await fs.promises.appendFile(targetPath, cipher.getAuthTag());
  }

  private async decryptFile(sourcePath: string, targetPath: string): Promise<void> {
    const file = await fs.promises.open(sourcePath, 'r');
    try {
      const { size } = await file.stat();
      const headerSize = BACKUP_MAGIC.length + 12;
      if (size < headerSize + 16) throw new Error('Encrypted backup file is too short');
      const header = Buffer.alloc(headerSize);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      /* v8 ignore start -- a regular file shorter than the checked size cannot return a short header read. */
      if (bytesRead < header.length) throw new Error('Encrypted backup file is too short');
      /* v8 ignore stop */
      const magic = header.subarray(0, BACKUP_MAGIC.length);
      if (!magic.equals(BACKUP_MAGIC)) throw new Error('Encrypted backup header is invalid');
      const iv = header.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 12);
      const authTag = Buffer.alloc(16);
      const { bytesRead: tagBytesRead } = await file.read(authTag, 0, authTag.length, size - authTag.length);
      /* v8 ignore start -- the size guard above guarantees the tag read is complete. */
      if (tagBytesRead < authTag.length) throw new Error('Encrypted backup auth tag is missing');
      /* v8 ignore stop */
      const decipher = createDecipheriv('aes-256-gcm', backupEncryptionKey(), iv);
      decipher.setAuthTag(authTag);
      await pipeline(
        createReadStream(sourcePath, { start: headerSize, end: size - authTag.length - 1 }),
        decipher,
        createWriteStream(targetPath),
      );
    } finally {
      await file.close();
    }
  }
}

const SYNC_ALLOWED_TABLES = new Set([
  'Patient',
  'Appointment',
  'Treatment',
  'Charge',
  'InventoryItem',
  'FollowUp',
  'PurchaseOrder',
]);

const SYNC_RESOURCES: Record<string, string> = {
  Patient: 'patients',
  Appointment: 'appointments',
  Treatment: 'treatments',
  Charge: 'charges',
  InventoryItem: 'inventoryItems',
  FollowUp: 'followUps',
  PurchaseOrder: 'purchaseOrders',
};

export class SyncService {
  constructor(private readonly db: Database.Database) {}

  pull(since: string, deviceId: string, deviceToken: string, context: AppContext): { changes: Array<Record<string, unknown>>; serverTime: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    this.assertDevice(deviceId, deviceToken, context);
    const changes = this.db.prepare(
      `SELECT id, tableName, recordId, operation, deviceId, clinicId, createdAt
       FROM SyncChange
       WHERE createdAt > ? AND deviceId != ? AND clinicId = ?
       ORDER BY createdAt ASC
       LIMIT 1000`,
    ).all(since, deviceId, context.clinicId) as Array<Record<string, unknown>>;
    return { changes, serverTime: new Date().toISOString() };
  }

  async push(payload: {
    deviceId: string;
    deviceToken: string;
    changes: Array<{
      tableName: string;
      recordId: string;
      operation: string;
      updatedAt: string;
      data?: Record<string, unknown>;
    }>;
  }, context: AppContext): Promise<{
    accepted: number;
    failed: number;
    errors: Array<{ recordId: string; error: string }>;
  }> {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    this.assertDevice(payload.deviceId, payload.deviceToken, context);
    let accepted = 0;
    const errors: Array<{ recordId: string; error: string }> = [];
    for (const change of payload.changes) {
      if (!SYNC_ALLOWED_TABLES.has(change.tableName)) {
        errors.push({ recordId: change.recordId, error: 'Table is not allowed for sync' });
        continue;
      }
      const resourceName = SYNC_RESOURCES[change.tableName];
      const definition = resourceRegistry.get(resourceName);
      /* v8 ignore start */
      if (!definition) {
        errors.push({ recordId: change.recordId, error: `Resource is not defined: ${resourceName}` });
        continue;
      }
      /* v8 ignore stop */
      try {
        const repo = new SqliteRepository(this.db, definition);
        if (change.operation === 'DELETE') {
          if (!(await repo.findById(change.recordId, context))) {
            throw new Error(`Sync record not found: ${change.recordId}`);
          }
          await repo.softDelete(change.recordId, context);
        } else {
          if (!change.data || typeof change.data !== 'object') {
            throw new Error('Sync change requires row data');
          }
          const existing = await repo.findById(change.recordId, context);
          const payloadRow = stripProtectedWriteFields(validatePayload(
            definition,
            change.data,
            existing ? { partial: true } : {},
          ));
          const entity = { id: change.recordId, ...payloadRow };
          if (existing) await repo.update(entity, context);
          else await repo.insert(entity, context);
        }
        this.record(change.tableName, change.recordId, change.operation, payload.deviceId, context.clinicId);
        accepted += 1;
      } catch (error) {
        /* v8 ignore start -- non-Error rejection is defensive; current repositories throw Error instances. */
        errors.push({ recordId: change.recordId, error: error instanceof Error ? error.message : String(error) });
        /* v8 ignore stop */
      }
    }
    return { accepted, failed: errors.length, errors };
  }

  registerDevice(deviceId: string, name: string, context: AppContext): { deviceId: string; token: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    const token = newRefreshToken();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO SyncDevice (
         id, clinicId, userId, deviceId, tokenHash, name, active,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
       ON CONFLICT(clinicId, deviceId) DO UPDATE SET
         tokenHash = excluded.tokenHash,
         name = excluded.name,
         active = 1,
         updatedAt = excluded.updatedAt`,
    ).run(randomUUID(), context.clinicId, context.userId, deviceId, hashRefreshToken(token), name, now, now);
    return { deviceId, token };
  }

  record(tableName: string, recordId: string, operation: string, deviceId: string, clinicId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO SyncChange (id, clinicId, createdAt, updatedAt, deletedAt, tableName, recordId, operation, deviceId)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(randomUUID(), clinicId, now, now, tableName, recordId, operation, deviceId);
  }

  cleanup(before: string | undefined, context: AppContext): { deleted: number; cutoff: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    const cutoff = before ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
    const result = this.db.prepare('DELETE FROM SyncChange WHERE createdAt < ? AND clinicId = ?').run(cutoff, context.clinicId);
    return { deleted: result.changes, cutoff };
  }

  private assertDevice(deviceId: string, deviceToken: string, context: AppContext): void {
    if (!deviceId || !deviceToken || !context.clinicId) {
      throw new AppError('UNAUTHORIZED', 'Device credentials are required', 401);
    }
    const device = this.db.prepare(
      'SELECT id FROM SyncDevice WHERE clinicId = ? AND deviceId = ? AND tokenHash = ? AND active = 1 AND deletedAt IS NULL',
    ).get(context.clinicId, deviceId, hashRefreshToken(deviceToken));
    if (!device) throw new AppError('UNAUTHORIZED', 'Device is not registered or active', 401);
  }
}

export class HrService {
  private readonly db: Database.Database;
  private readonly hrRepository: HrRepository;

  constructor(db: Database.Database, hrRepository?: HrRepository) {
    this.db = db;
    this.hrRepository = hrRepository ?? new SqliteHrRepository(db);
  }

  attendance(workDate?: string, context?: AppContext): Array<Record<string, unknown>> {
    return this.hrRepository.attendance(workDate, context?.clinicId ?? null);
  }

  approveLeave(id: string, reviewerId: string, approved: boolean, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT status FROM LeaveRequest WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { status: string } | undefined;
    if (!row) throw new NotFoundError('Leave request not found');
    if (row.status !== 'PENDING') throw new ConflictError('Leave request cannot be approved from current status');
    const now = new Date().toISOString();
    const status = approved ? 'APPROVED' : 'REJECTED';
    const changes = this.hrRepository.approveLeave(id, status, reviewerId, now, context.clinicId);
    if (changes === 0) throw new ConflictError('Leave request cannot be approved from current status');
    return { id, status };
  }
}

export class AlertService {
  private readonly db: Database.Database;
  private readonly alertRepository: AlertRepository;

  constructor(db: Database.Database, alertRepository?: AlertRepository) {
    this.db = db;
    this.alertRepository = alertRepository ?? new SqliteAlertRepository(db);
  }

  open(context?: AppContext): Array<Record<string, unknown>> {
    return this.alertRepository.open(context?.clinicId ?? null);
  }

  create(input: {
    alertType: string;
    level: 'INFO' | 'WARNING' | 'CRITICAL';
    severity: 'INFO' | 'WARN' | 'CRITICAL';
    title: string;
    message: string;
    source: string;
    metricName?: string;
    suggestion?: string;
    clinicId?: string | null;
  }): Record<string, unknown> {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO BusinessAlert (
         id, clinicId, alertType, severity, metricName, currentValue,
         baselineValue, deviationPercent, message, suggestion, acknowledged,
         acknowledgedAt, acknowledgedBy, occurredAt, level, title, source,
         status, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, 'OPEN', ?, ?, NULL)`,
    ).run(
      id,
      input.clinicId ?? null,
      input.alertType,
      input.severity,
      input.metricName ?? null,
      input.message,
      input.suggestion ?? null,
      now,
      input.level,
      input.title,
      input.source,
      now,
      now,
    );
    return { id, alertType: input.alertType, status: 'OPEN' };
  }

  setStatus(id: string, status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED', userId?: string, context?: AppContext): Record<string, unknown> {
    if (!['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
      throw new ValidationError('Invalid business alert status');
    }
    const row = this.db.prepare(
      `SELECT status FROM BusinessAlert WHERE id = ? AND deletedAt IS NULL${tenantAnd(context?.clinicId ?? null)}`,
    ).get(id, ...tenantParams(context?.clinicId ?? null)) as { status: string } | undefined;
    if (!row) throw new NotFoundError('Business alert not found');
    const transitions: Record<string, readonly string[]> = {
      OPEN: ['ACKNOWLEDGED', 'RESOLVED'],
      ACKNOWLEDGED: ['RESOLVED'],
      RESOLVED: [],
    };
    if (!transitions[row.status]?.includes(status)) {
      throw new ConflictError(`Cannot transition business alert from ${row.status} to ${status}`);
    }
    const now = new Date().toISOString();
    const changes = this.alertRepository.setStatus(id, status, userId ?? null, now, context?.clinicId ?? null);
    if (changes === 0) throw new ConflictError('Business alert status update failed');
    return { id, status };
  }
}
