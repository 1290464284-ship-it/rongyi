import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError } from '../../infrastructure/errors';
import { SystemClock } from '../../infrastructure/clock';
import { SqliteClinicalWorkflowRepository } from '../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../domain/contracts';
import type { ClinicalWorkflowRepository } from '../ports';

export class ClinicalWorkflowService {
  private readonly db: Database.Database;
  private readonly clinicalRepository: ClinicalWorkflowRepository;

  constructor(db: Database.Database, clinicalRepository?: ClinicalWorkflowRepository) {
    this.db = db;
    this.clinicalRepository = clinicalRepository ?? new SqliteClinicalWorkflowRepository(db);
  }

  registrationStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('Registration', id, context.clinicId);
    const allowed: Record<string, readonly string[]> = {
      REGISTERED: ['TRIAGED', 'IN_PROGRESS', 'CANCELLED'],
      TRIAGED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    const now = context.now().toISOString();
    let visitId = row.visitId ? String(row.visitId) : null;
    if ((status === 'IN_PROGRESS' || status === 'COMPLETED') && !visitId) {
      visitId = randomUUID();
      this.clinicalRepository.createVisit({
        id: visitId,
        clinicId: context.clinicId ?? null,
        createdAt: now,
        updatedAt: now,
        patientId: row.patientId,
        doctorId: row.doctorId ?? context.userId,
        userId: context.userId,
      });
      this.clinicalRepository.updateStatus('Registration', id, row.status as string, now, { visitId }, context.clinicId);
    }
    this.clinicalRepository.updateStatus('Registration', id, status, now, {}, context.clinicId);
    return { id, status, visitId };
  }

  visitStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('Visit', id, context.clinicId);
    const allowed: Record<string, readonly string[]> = {
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    const now = context.now().toISOString();
    this.clinicalRepository.updateStatus(
      'Visit',
      id,
      status,
      now,
      status === 'COMPLETED' ? { endTime: now } : {},
      context.clinicId,
    );
    return { id, status };
  }

  firstExamStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('FirstExam', id, context.clinicId);
    const allowed: Record<string, readonly string[]> = {
      DRAFT: ['SUBMITTED', 'CANCELLED'],
      SUBMITTED: ['APPROVED', 'CANCELLED'],
      APPROVED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    this.clinicalRepository.updateStatus('FirstExam', id, status, context.now().toISOString(), {}, context.clinicId);
    return { id, status };
  }

  treatmentStatus(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.getRow('Treatment', id, context.clinicId);
    const allowed: Record<string, readonly string[]> = {
      PLANNED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    this.assertTransition(row, allowed, status);
    const now = context.now().toISOString();
    const completedDate = status === 'COMPLETED' ? new SystemClock().clinicDate(context.now()) : null;
    this.clinicalRepository.updateStatus(
      'Treatment',
      id,
      status,
      now,
      completedDate ? { completedDate } : {},
      context.clinicId,
    );
    return { id, status };
  }

  lockMedicalRecord(id: string, locked: boolean, context: AppContext): Record<string, unknown> {
    this.getRow('MedicalRecord', id, context.clinicId);
    const now = context.now().toISOString();
    this.clinicalRepository.lockMedicalRecord(id, locked, context.userId, now, context.clinicId);
    return { id, isLocked: locked };
  }

  private getRow(table: string, id: string, clinicId: string | null): Record<string, unknown> {
    const row = this.clinicalRepository.getRow(table, id, clinicId);
    if (!row) throw new NotFoundError(`${table} not found`);
    return row;
  }

  private assertTransition(
    row: Record<string, unknown>,
    allowed: Record<string, readonly string[]>,
    next: string,
  ): void {
    const current = String(row.status);
    if (!allowed[current]?.includes(next)) {
      throw new ConflictError(`Cannot transition from ${current} to ${next}`);
    }
  }
}
