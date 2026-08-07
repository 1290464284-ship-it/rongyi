/**
 * 就诊工作台路由。
 *
 * 调用方集成时需在 route-policy.ts 增加规则：
 *   { pattern: /^\/api\/v2\/workbench/, roles: ['BOSS', 'ADMIN', 'DOCTOR', 'NURSE'] }
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { ClinicalWorkbenchService } from '../../application/service-modules/workbench';
import type { RouteDependencies } from './deps';

export function registerWorkbenchRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new ClinicalWorkbenchService(db);

  app.get('/api/v2/workbench/today', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.today(req.context!) });
  }));
}
