import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError, NotFoundError, ValidationError, isSystematicSqliteError } from '../../infrastructure/errors';
import { SqliteRepository } from '../../infrastructure/repository';
import { applyStateMachineDefaults, stripProtectedWriteFields } from '../../infrastructure/security';
import { validatePayload } from '../../http/validation';
import { SqlitePatientRiskRepository } from '../../infrastructure/repositories/core.repositories';
import { resourceRegistry } from '../../../domain/resources';
import { tenantAnd, tenantParams, tenantWhere } from '../../infrastructure/tenant';
import { keysetCondition, keysetOrder, nextCursorFrom } from '../../infrastructure/keyset';
import type { AppContext } from '../../../domain/contracts';
import type { PatientRiskRepository } from '../ports';
import { FORBIDDEN_BULK_IMPORT_RESOURCES, assertPatientExists } from './common';
import { RESOURCE_PERMISSION_MAP } from './permissions';
import { sharedDbWriteQueue } from './serial-queue';

export class PatientRiskService {
  private readonly db: Database.Database;
  private readonly patientRiskRepository: PatientRiskRepository;

  constructor(db: Database.Database, patientRiskRepository?: PatientRiskRepository) {
    this.db = db;
    this.patientRiskRepository = patientRiskRepository ?? new SqlitePatientRiskRepository(db);
  }

  calculate(patientId: string, context: AppContext): Record<string, unknown> {
    assertPatientExists(this.db, patientId, context.clinicId);
    const treatmentCount = this.patientRiskRepository.treatmentCount(patientId, context.clinicId);
    const periodontalCount = this.patientRiskRepository.periodontalCount(patientId, context.clinicId);
    const cariesScore = Math.min(100, treatmentCount * 5);
    const periodontalScore = Math.min(100, periodontalCount * 10);
    const implantScore = Math.min(100, treatmentCount * 2);
    const level = (score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' => {
      if (score >= 80) return 'EXTREME';
      if (score >= 60) return 'HIGH';
      if (score >= 30) return 'MEDIUM';
      return 'LOW';
    };
    const now = context.now().toISOString();
    const id = randomUUID();
    const snapshot = { treatmentCount, periodontalCount, dataSources: { treatmentCount, periodontalCount } };
    this.patientRiskRepository.insert({
      id,
      clinicId: context.clinicId ?? null,
      createdAt: now,
      updatedAt: now,
      patientId,
      cariesScore,
      periodontalScore,
      implantScore,
      cariesLevel: level(cariesScore),
      periodontalLevel: level(periodontalScore),
      implantLevel: level(implantScore),
      factorSnapshotJson: JSON.stringify(snapshot),
      assessedById: context.userId,
    });
    return { id, cariesScore, periodontalScore, implantScore };
  }
}

export class PrescriptionSafetyService {
  constructor(private readonly db: Database.Database) {}

  check(prescriptionId: string, context: AppContext): { safe: boolean; warnings: string[] } {
    const prescription = this.db.prepare(`SELECT * FROM Prescription WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`).get(prescriptionId, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    if (!prescription) throw new NotFoundError('Prescription not found');
    const patient = this.db.prepare(
      `SELECT allergies, medicalHistory FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(prescription.patientId, ...tenantParams(context.clinicId)) as
      | { allergies: string; medicalHistory: string }
      | undefined;
    const allergies = patient ? parseStringArray(patient.allergies) : [];
    const items = this.db.prepare(
      `SELECT name FROM PrescriptionItem WHERE prescriptionId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).all(prescriptionId, ...tenantParams(context.clinicId)) as Array<{ name: string }>;
    const warnings = items
      .flatMap((item) => allergies.filter((allergy) => item.name.toUpperCase().includes(allergy.toUpperCase())))
      .map((allergy) => `Potential allergy: ${allergy}`);
    return { safe: warnings.length === 0, warnings };
  }
}

export class CephalometricService {
  constructor(private readonly db: Database.Database) {}

  compute(caseId: string, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare(`SELECT * FROM CephalometricCase WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`).get(caseId, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('Cephalometric case not found');
    const landmarks = parseLandmarks(row.landmarksJson);
    const metrics: Record<string, number> = {};
    if (landmarks.sella && landmarks.nasion) {
      metrics.snLength = distance(landmarks.sella, landmarks.nasion);
    }
    if (landmarks.upperIncisor && landmarks.lowerIncisor) {
      metrics.interincisalAngle = angle(landmarks.upperIncisor, landmarks.lowerIncisor);
    }
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE CephalometricCase SET metricsJson = ?, status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(JSON.stringify(metrics), 'ANALYZED', now, caseId, ...tenantParams(context.clinicId));
    return { id: caseId, metrics };
  }
}

export class TreatmentProgressService {
  constructor(private readonly db: Database.Database) {}

  summary(planId: string, context: AppContext): Record<string, unknown> {
    const plan = this.db.prepare(`SELECT * FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`).get(planId, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    if (!plan) throw new NotFoundError('Treatment plan not found');
    const items = this.db.prepare(
      `SELECT status FROM TreatmentPlanItem WHERE planId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).all(planId, ...tenantParams(context.clinicId)) as Array<{ status: string }>;
    const completed = items.filter((item) => item.status === 'COMPLETED').length;
    return {
      planId,
      totalItems: items.length,
      completedItems: completed,
      progress: items.length === 0 ? 0 : Math.round((completed / items.length) * 100),
    };
  }
}

export class BulkImportService {
  constructor(private readonly db: Database.Database) {}

  async importRows(
    resourceName: string,
    rows: Array<Record<string, unknown>>,
    context: AppContext,
    chunkSize = 100,
  ): Promise<{ imported: number; failed: number; errors: string[]; chunks: number }> {
    return sharedDbWriteQueue(this.db)(() => this.doImport(resourceName, rows, context, chunkSize));
  }

  private async doImport(
    resourceName: string,
    rows: Array<Record<string, unknown>>,
    context: AppContext,
    chunkSize = 100,
  ): Promise<{ imported: number; failed: number; errors: string[]; chunks: number }> {
    const definition = resourceRegistry.get(resourceName);
    if (!definition) throw new ValidationError(`Resource cannot import: ${resourceName}`);
    if (FORBIDDEN_BULK_IMPORT_RESOURCES.has(resourceName)) {
      throw new AppError('FORBIDDEN', `Bulk import is disabled for ${resourceName}`, 403);
    }
    if (!definition.capabilities.create) throw new ValidationError(`Resource cannot import: ${resourceName}`);
    if (!definition.roles.includes(context.role)) {
      throw new AppError('FORBIDDEN', `Forbidden resource: ${resourceName}`, 403);
    }
    const requiredPermission = RESOURCE_PERMISSION_MAP[resourceName];
    // 与通用资源路由一致：模块权限在角色之上收口，避免只授予 system 的账号越权导入业务表。
    if (requiredPermission && context.permissions && !context.permissions.includes(requiredPermission)) {
      throw new AppError('FORBIDDEN', `Forbidden resource: ${resourceName}`, 403);
    }
    if (!Array.isArray(rows) || rows.length > 10_000) {
      throw new ValidationError('Bulk import rows must be an array with at most 10000 rows');
    }
    const repository = new SqliteRepository(this.db, definition);
    const size = Math.min(1000, Math.max(1, Math.floor(Number(chunkSize) || 100)));
    let imported = 0;
    const errors: string[] = [];
    for (let offset = 0; offset < rows.length; offset += size) {
      const chunk = rows.slice(offset, offset + size);
      const chunkStartImported = imported;
      const chunkStartErrors = errors.length;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of chunk) {
          try {
            const payload = stripProtectedWriteFields(
              validatePayload(definition, row),
              undefined,
              resourceName,
              { protectStateMachine: true },
            );
            applyStateMachineDefaults(resourceName, payload);
            repository.insertSync({ id: randomUUID(), ...payload }, context);
            imported += 1;
          } catch (error) {
            if (isSystematicSqliteError(error)) {
              // isSystematicSqliteError 以 instanceof Error 为前提，String(error) 兜底为死代码。
              throw new AppError('IMPORT_SYSTEM_ERROR', `批量导入中止：${(error as Error).message}`, 500);
            }
            errors.push(error instanceof Error ? error.message : String(error));
            continue;
          }
        }
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        // P2-11：chunk 整体回滚，imported 计数必须退回 chunk 起点，
        // 否则错误消息里的"前 N 条已导入"会夸大真实导入数量。
        imported = chunkStartImported;
        errors.length = chunkStartErrors;
        if (e instanceof AppError) throw e;
        if (isSystematicSqliteError(e)) {
          // isSystematicSqliteError 以 instanceof Error 为前提，String(e) 兜底为死代码。
          const message = (e as Error).message;
          throw new AppError('IMPORT_SYSTEM_ERROR', `批量导入中止：前 ${imported} 条已导入，请人工核对后重试（${message}）`, 500);
        }
        throw e;
      }
    }
    return { imported, failed: errors.length, errors, chunks: Math.ceil(rows.length / size) };
  }
}

export class NotificationService {
  constructor(private readonly db: Database.Database) {}

  list(
    userId: string,
    clinicId?: string | null,
    options?: { page?: number; pageSize?: number; cursor?: string | null },
  ): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; truncated?: boolean; nextCursor?: string | null } {
    const rawPage = Number(options?.page);
    const rawPageSize = Number(options?.pageSize);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(100, Math.floor(rawPageSize)) : 100;
    const offset = (page - 1) * pageSize;
    const clinicFilter = tenantWhere(clinicId, 'Notification.clinicId');
    const clinicClause = clinicFilter.sql ? ` AND ${clinicFilter.sql}` : '';
    const clinicParams = clinicFilter.params;
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total FROM Notification WHERE userId = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(userId, ...clinicParams) as { total: number }).total);
    // S-2 keyset：两模式统一按 (createdAt DESC, id DESC) 排序，恒取 pageSize+1 行并回传 nextCursor。
    const keyset = { columns: [{ column: 'createdAt', key: 'createdAt' }], idColumn: 'id', direction: 'DESC' as const };
    const cursorCondition = keysetCondition(options?.cursor, keyset);
    const hasCursor = cursorCondition.where !== '';
    const items = this.db.prepare(
      `SELECT * FROM Notification WHERE userId = ? AND deletedAt IS NULL${clinicClause}${cursorCondition.where}
       ${keysetOrder(keyset)}
       LIMIT ${pageSize + 1} OFFSET ${hasCursor ? 0 : offset}`,
    ).all(userId, ...clinicParams, ...cursorCondition.params) as Array<Record<string, unknown>>;
    return {
      items: items.slice(0, pageSize),
      total,
      page,
      pageSize,
      truncated: total > offset + items.slice(0, pageSize).length,
      nextCursor: nextCursorFrom(items, pageSize, keyset),
    };
  }

  markRead(id: string, userId: string, clinicId?: string | null): Record<string, unknown> {
    const clinicFilter = tenantWhere(clinicId, 'Notification.clinicId');
    const clinicClause = clinicFilter.sql ? ` AND ${clinicFilter.sql}` : '';
    const clinicParams = clinicFilter.params;
    const result = this.db.prepare(`UPDATE Notification SET readAt = ?, updatedAt = ? WHERE id = ? AND userId = ? AND deletedAt IS NULL${clinicClause}`)
      .run(new Date().toISOString(), new Date().toISOString(), id, userId, ...clinicParams);
    if (result.changes === 0) throw new NotFoundError('Notification not found');
    return { id, read: true };
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function angle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rad = Math.atan2(dy, dx);
  return Math.round(Math.abs(rad * 180 / Math.PI));
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]')) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseLandmarks(value: unknown): Record<string, { x: number; y: number }> {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, { x: number; y: number }> : {};
  } catch {
    return {};
  }
}
