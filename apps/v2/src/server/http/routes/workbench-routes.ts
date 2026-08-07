/**
 * 就诊工作台路由。
 *
 * 调用方集成时需在 route-policy.ts 增加规则：
 *   { pattern: /^\/api\/v2\/workbench/, roles: ['BOSS', 'ADMIN', 'DOCTOR', 'NURSE'] }
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { ClinicalWorkbenchService } from '../../application/service-modules/workbench';

export function registerWorkbenchRoutes(app: Express, db: Database.Database): void {
  const service = new ClinicalWorkbenchService(db);

  app.get('/api/v2/workbench/today', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.today(req.context!) });
  }));
}
