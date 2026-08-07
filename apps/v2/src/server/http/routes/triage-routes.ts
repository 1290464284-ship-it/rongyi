/**
 * 分诊与预约改期路由。
 *
 * - POST /api/v2/registrations/:id/triage        挂号分诊（可选 科室/医生/分诊备注）
 * - GET  /api/v2/triage/queue                    分诊队列（departmentId/status 可选过滤）
 * - POST /api/v2/appointments/:id/reschedule     预约改期（改时间/改医生/改椅位）
 *
 * 路由策略（route-policy.ts）已配置：/triage → clinicalStaff；/appointments 与
 * /registrations 已有既有规则，无需在本文件内重复鉴权。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { TriageService } from '../../application/service-modules/triage';
import type { RouteDependencies } from './deps';

export function registerTriageRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new TriageService(db);

  app.post('/api/v2/registrations/:id/triage', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as { doctorId?: string; departmentId?: string; triageNote?: string };
    res.json({
      success: true,
      data: service.triage(String(req.params.id), {
        doctorId: body.doctorId,
        departmentId: body.departmentId,
        triageNote: body.triageNote,
      }, req.context!),
    });
  }));

  app.get('/api/v2/triage/queue', wrapAsync(async (req, res) => {
    const departmentId = typeof req.query.departmentId === 'string' && req.query.departmentId !== '' ? req.query.departmentId : undefined;
    const status = (typeof req.query.status === 'string' && req.query.status !== '' ? req.query.status : undefined) as 'REGISTERED' | 'TRIAGED' | undefined;
    res.json({
      success: true,
      data: service.queue({ departmentId, status }, req.context!),
    });
  }));

  app.post('/api/v2/appointments/:id/reschedule', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as { startTime?: string; endTime?: string; doctorId?: string; chairId?: string | null };
    res.json({
      success: true,
      data: service.rescheduleAppointment(String(req.params.id), {
        startTime: body.startTime ?? '',
        endTime: body.endTime,
        doctorId: body.doctorId,
        chairId: body.chairId,
      }, req.context!),
    });
  }));
}
