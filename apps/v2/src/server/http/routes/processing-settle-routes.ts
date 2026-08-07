/**
 * 加工单对账结算路由。
 *
 * 三条路径均命中 route-policy 既有规则 /^\/api\/v2\/processing-orders/（financeStaff），
 * 无需新增规则。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { ProcessingSettleService } from '../../application/service-modules/processing-settle';
import type { RouteDependencies } from './deps';

export function registerProcessingSettleRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new ProcessingSettleService(db);

  app.post('/api/v2/processing-orders/:id/settle', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.settle(String(req.params.id), req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/processing-orders/:id/unsettle', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.unsettle(String(req.params.id), req.context!) });
  }));

  app.get('/api/v2/processing-orders/settle-stats', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.stats(req.context!) });
  }));
}
