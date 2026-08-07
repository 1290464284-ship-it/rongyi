/**
 * 技耗分离分账统计路由。
 *
 * 路径 /api/v2/stats/cost-share，由调用方在 route-policy 中按
 * /^\/api\/v2\/stats\/cost-share/（adminStaff: BOSS/ADMIN）挂接鉴权规则。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { CostShareService } from '../../application/service-modules/cost-share';
import type { RouteDependencies } from './deps';

export function registerCostShareRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new CostShareService(db);

  app.get('/api/v2/stats/cost-share', wrapAsync(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    res.json({ success: true, data: service.stats({ from, to }, req.context!) });
  }));
}
