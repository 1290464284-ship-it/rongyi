/**
 * 首诊重启与牙列/主诉标记路由。
 *
 * - POST /api/v2/first-exams/:id/restart        重启首诊（复制临床内容，不复制牙齿明细）
 * - POST /api/v2/first-exams/:id/dentition      切换乳牙/恒牙/混合牙列
 * - POST /api/v2/first-exams/:id/teeth/:toothId/chief-mark  主诉牙横向标记
 * - GET  /api/v2/first-exams/history?patientId=xxx          患者首诊历史（按创建时间倒序）
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { FirstExamRestartService } from '../../application/service-modules/first-exam-restart';
import type { RouteDependencies } from './deps';

export function registerFirstExamRestartRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new FirstExamRestartService(db);

  app.post('/api/v2/first-exams/:id/restart', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.restart(String(req.params.id), req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/first-exams/:id/dentition', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.setDentition(String(req.params.id), req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/first-exams/:id/teeth/:toothId/chief-mark', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.setChiefMark(String(req.params.id), String(req.params.toothId), req.body ?? {}, req.context!) });
  }));

  app.get('/api/v2/first-exams/history', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.history(String(req.query.patientId ?? ''), req.context!) });
  }));
}
