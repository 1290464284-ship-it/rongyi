/**
 * 收费组合一键调出路由。
 *
 * 命中 route-policy 新规则 /^\/api\/v2\/charge-combos/（financeStaff），
 * 规则由调用方在 route-policy.ts 集成时添加。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { ChargeComboService } from '../../application/service-modules/charge-combo';
import type { RouteDependencies } from './deps';

export function registerChargeComboRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new ChargeComboService(db);

  app.get('/api/v2/charge-combos', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.list(req.context!) });
  }));

  app.get('/api/v2/charge-combos/:id/items', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.comboWithItems(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/charge-combos/:id/apply', wrapAsync(async (req, res) => {
    res.json({
      success: true,
      data: await service.applyToCharge(String(req.params.id), String(req.body?.patientId ?? ''), req.context!),
    });
  }));
}
