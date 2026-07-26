import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseConsistencyChecker } from './base-consistency-checker';
import { CheckDefinition, ConsistencyChecker, CheckResult } from './consistency-checker.interface';

@Injectable()
export class BusinessRuleConsistencyChecker extends BaseConsistencyChecker implements ConsistencyChecker {
  readonly name = 'business-rule';

  constructor(private dbService: DbService) {
    super();
  }

  getChecks(): CheckDefinition[] {
    return [
      {
        name: 'appointment_visit_consistency',
        description: '预约状态与就诊记录一致性检查',
        category: 'business_rule',
        fn: () => this.checkAppointmentVisitConsistency(),
      },
    ];
  }

  private checkAppointmentVisitConsistency(): CheckResult {
    return this.measureTime('appointment_visit_consistency', () => {
      const issues: CheckResult['issues'] = [];

      const completedWithoutVisit = this.dbService.prepare(`
        SELECT a.id, a.patientId, a.status
        FROM Appointment a
        WHERE a.deletedAt IS NULL
          AND a.status = 'COMPLETED'
          AND a.visitId IS NULL
      `).all() as Array<{ id: string; patientId: string; status: string }>;

      issues.push(...completedWithoutVisit.map(row => ({
        id: row.id,
        type: 'appointment_completed_no_visit',
        description: '预约状态为 COMPLETED 但没有关联就诊记录',
        details: { patientId: row.patientId, status: row.status },
      })));

      const visitExistsButNoLink = this.dbService.prepare(`
        SELECT v.id, v.patientId, v.appointmentId
        FROM Visit v
        WHERE v.deletedAt IS NULL
          AND v.appointmentId IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM Appointment a
            WHERE a.id = v.appointmentId AND a.deletedAt IS NULL
          )
      `).all() as Array<{ id: string; patientId: string; appointmentId: string }>;

      issues.push(...visitExistsButNoLink.map(row => ({
        id: row.id,
        type: 'visit_appointment_not_found',
        description: '就诊记录引用了不存在的预约',
        details: { patientId: row.patientId, appointmentId: row.appointmentId },
      })));

      return {
        issues,
        message: issues.length === 0
          ? '所有预约与就诊记录一致'
          : `发现 ${issues.length} 个预约与就诊记录不一致`,
      };
    });
  }
}
