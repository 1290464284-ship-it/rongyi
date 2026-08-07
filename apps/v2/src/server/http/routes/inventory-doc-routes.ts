/**
 * 库存独立单据路由：退回厂商 / 库损 / 调拨。
 * 写操作走 InventoryDocService（事务 + 租户隔离），不走通用资源 CRUD。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { InventoryDocService } from '../../application/service-modules/inventory-docs';
import type { RouteDependencies } from './deps';

export function registerInventoryDocRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new InventoryDocService(db);

  app.post('/api/v2/inventory-docs/return-supplier', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.createReturnSupplier(req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/inventory-docs/loss', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.createLoss(req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/inventory-docs/transfer', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.createTransfer(req.body ?? {}, req.context!) });
  }));
}
