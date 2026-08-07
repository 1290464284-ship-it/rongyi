/**
 * 库存盘点路由。
 *
 * 命中 route-policy 既有规则 /^\/api\/v2\/stocktakes/（BOSS/ADMIN），
 * 规则由调用方在 route-policy.ts 集成时添加。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { StocktakeService } from '../../application/service-modules/stocktake';
import type { RouteDependencies } from './deps';

export function registerStocktakeRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new StocktakeService(db);

  app.get('/api/v2/stocktakes', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.list(req.context!) });
  }));

  app.post('/api/v2/stocktakes', wrapAsync(async (req, res) => {
    res.status(201).json({
      success: true,
      data: service.start(req.body ?? {}, req.context!),
    });
  }));

  app.get('/api/v2/stocktakes/:id/items', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.items(String(req.params.id), req.context!) });
  }));

  app.patch('/api/v2/stocktakes/:id/items/:itemId', wrapAsync(async (req, res) => {
    res.json({
      success: true,
      data: service.recordCount(
        String(req.params.id),
        String(req.params.itemId),
        (req.body ?? {}).countedStock,
        req.context!,
      ),
    });
  }));

  app.post('/api/v2/stocktakes/:id/lock', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.lock(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/stocktakes/:id/complete', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.complete(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/stocktakes/:id/cancel', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.cancel(String(req.params.id), req.context!) });
  }));
}
