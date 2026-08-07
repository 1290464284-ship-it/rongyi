/**
 * 治疗计划打印 + 电子签字路由。
 * 两条路径已命中 route-policy 既有临床规则（/^\/api\/v2\/(...|treatment-plans)/），无需新增规则。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { TreatmentPlanDocumentService } from '../../application/service-modules/treatment-plan-document';
import type { RouteDependencies } from './deps';

export function registerTreatmentPlanRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new TreatmentPlanDocumentService(db);

  app.post('/api/v2/treatment-plans/:id/print', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.print(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/treatment-plans/:id/sign', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.sign(String(req.params.id), req.body ?? {}, req.context!) });
  }));
}
