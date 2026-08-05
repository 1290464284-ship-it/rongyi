/**
 * 回访执行结构化记录 + NPS（净推荐值）统计路由。
 *
 * 两条路径均命中 route-policy 既有规则 /^\/api\/v2\/follow-ups/（operationalStaff），
 * 无需新增规则。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { FollowUpExecutionService } from '../../application/service-modules/follow-up-execution';

export function registerFollowUpExecutionRoutes(app: Express, db: Database.Database): void {
  const service = new FollowUpExecutionService(db);

  app.post('/api/v2/follow-ups/:id/execute', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.execute(String(req.params.id), req.body ?? {}, req.context!) });
  }));

  app.get('/api/v2/follow-ups/nps', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.nps(req.context!) });
  }));
}
