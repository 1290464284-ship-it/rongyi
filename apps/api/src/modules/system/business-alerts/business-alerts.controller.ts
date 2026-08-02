import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { DbService } from '../../../db/db.service';
import { AppLogger } from '../../../common/services/logger.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { buildClinicFilter } from '../../../common/utils/db/clinic-filter';
import { AuditLogType } from '../../../common/constants/audit-log-types';
import { BusinessAlertRow } from './business-alert-detector.service';

@ApiTags('经营预警')
@OperationLogResource('经营预警')
@Controller('system/business-alerts')
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
export class BusinessAlertsController {
  private readonly logger = new AppLogger(BusinessAlertsController.name);

  constructor(
    private readonly dbService: DbService,
    private readonly clinicContext: ClinicContextService,
    private readonly auditLog: AuditLogService,
  ) {}

  @ApiOperation({ summary: '获取最新未确认的经营预警（Dashboard banner）' })
  @Get('latest')
  getLatestAlerts(
    @Query('severityIn') severityIn?: string,
  ) {
    const clinicId = this.clinicContext.getClinicId();
    const severities = (severityIn ?? 'WARN,CRITICAL')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const { clause, params } = buildClinicFilter(clinicId);
    const baClause = clause.replace('clinicId', 'ba.clinicId');
    const placeholders = severities.map(() => '?').join(',');

    const rows = this.dbService.prepare(`
      SELECT ba.*
      FROM BusinessAlert ba
      WHERE ba.acknowledged = 0
        AND ba.severity IN (${placeholders})
        AND ba.deletedAt IS NULL
        ${baClause}
      ORDER BY
        CASE ba.severity
          WHEN 'CRITICAL' THEN 1
          WHEN 'WARN' THEN 2
          ELSE 3
        END ASC,
        ba.occurredAt DESC
      LIMIT 20
    `).all(...severities, ...params) as BusinessAlertRow[];

    return {
      data: rows.map((r) => ({
        id: r.id,
        alertType: r.alertType,
        severity: r.severity,
        metricName: r.metricName,
        currentValue: r.currentValue,
        baselineValue: r.baselineValue,
        deviationPercent: r.deviationPercent,
        message: r.message,
        suggestion: r.suggestion,
        occurredAt: r.occurredAt,
      })),
      total: rows.length,
    };
  }

  @ApiOperation({ summary: '确认经营预警（标记已读）' })
  @Post(':id/acknowledge')
  @Roles(Role.BOSS)
  acknowledge(@Param('id') id: string) {
    const clinicId = this.clinicContext.getClinicId();
    const userId = this.clinicContext.getUserId();
    const userName = this.clinicContext.getRole();
    const now = new Date().toISOString();

    const { clause, params } = buildClinicFilter(clinicId);
    const baClause = clause.replace('clinicId', 'ba.clinicId');

    const existing = this.dbService.prepare(`
      SELECT * FROM BusinessAlert ba
      WHERE ba.id = ? AND ba.deletedAt IS NULL ${baClause}
    `).get(id, ...params) as BusinessAlertRow | undefined;

    if (!existing) {
      return { success: false, message: '预警不存在或无权限' };
    }

    this.dbService.transaction((tx) => {
      tx.prepare(`
        UPDATE BusinessAlert
        SET acknowledged = 1, acknowledgedAt = ?, acknowledgedBy = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(now, userId, id);

      this.auditLog.logAudit(
        tx,
        AuditLogType.BUSINESS_ALERT_ACKNOWLEDGED,
        id,
        'BusinessAlert',
        clinicId,
        {
          operatorId: userId ?? undefined,
          operatorName: userName ?? undefined,
          beforeData: { acknowledged: 0 },
          afterData: { acknowledged: 1, acknowledgedAt: now, acknowledgedBy: userId },
        },
      );
    });

    return { success: true, id };
  }
}
