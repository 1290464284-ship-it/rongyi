/**
 * 自定义缴费方式（二级支付方式树）路由。
 *
 * 读：GET /api/v2/pay-methods/tree（本服务）；
 * 写：走通用资源 /api/v2/resources/payMethods。
 * 路径策略 /pay-methods → financeStaff 已由 route-policy 覆盖。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { PayMethodService } from '../../application/service-modules/pay-method';

export function registerPayMethodRoutes(app: Express, db: Database.Database): void {
  const service = new PayMethodService(db);

  app.get('/api/v2/pay-methods/tree', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.tree(req.context!) });
  }));
}
