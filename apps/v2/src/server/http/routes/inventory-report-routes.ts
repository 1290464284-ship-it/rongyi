/**
 * 库存明细报表路由：GET /api/v2/inventory-reports/:type。
 * supplierId 目前不参与过滤，但透传回响应供前端展示。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { InventoryReportService } from '../../application/service-modules/inventory-reports';
import type { RouteDependencies } from './deps';

export function registerInventoryReportRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new InventoryReportService(db);

  app.get('/api/v2/inventory-reports/:type', wrapAsync(async (req, res) => {
    const query = req.query ?? {};
    const from = typeof query.from === 'string' && query.from !== '' ? query.from : undefined;
    const to = typeof query.to === 'string' && query.to !== '' ? query.to : undefined;
    const itemId = typeof query.itemId === 'string' && query.itemId !== '' ? query.itemId : undefined;
    const supplierId = typeof query.supplierId === 'string' && query.supplierId !== '' ? query.supplierId : undefined;
    const data = service.report(String(req.params.type), { from, to, itemId, supplierId }, req.context!);
    res.json({ success: true, data: { ...data, supplierId: supplierId ?? null } });
  }));
}
