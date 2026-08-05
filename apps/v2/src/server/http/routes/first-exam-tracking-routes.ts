/**
 * 首诊追踪/流失登记路由。
 *
 * 两条路径均已命中 route-policy 既有临床规则
 * （/^\/api\/v2\/(registrations|visits|first-exams|treatments|medical-records|patients\/.*\/risk|prescriptions|cephalometric|treatment-plans)/，
 * 临床角色可见），无需新增规则。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { FirstExamTrackingService } from '../../application/service-modules/first-exam-tracking';

export function registerFirstExamTrackingRoutes(app: Express, db: Database.Database): void {
  const service = new FirstExamTrackingService(db);

  app.patch('/api/v2/first-exams/:id/tracking', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.updateTracking(String(req.params.id), req.body ?? {}, req.context!) });
  }));

  app.get('/api/v2/first-exams/tracking-overview', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.overview(req.context!) });
  }));
}
