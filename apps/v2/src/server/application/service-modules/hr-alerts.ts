import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import {
  SqliteAlertRepository,
  SqliteHrRepository,
} from '../../infrastructure/repositories/core.repositories';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import type { AlertRepository, HrRepository } from '../ports';

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
