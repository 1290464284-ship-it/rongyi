/**
 * 高值耗材标记路由。
 *
 * POST /api/v2/inventory-items/:id/high-value { isHighValue, catalogId? }
 * 该路径命中既有 /inventory 策略（覆盖 /inventory-items），无需新规则。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { HighValueService } from '../../application/service-modules/high-value';
import type { RouteDependencies } from './deps';
import { parseBooleanStrict } from '../validation';

export function registerHighValueRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new HighValueService(db);

  app.post('/api/v2/inventory-items/:id/high-value', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = service.mark(String(req.params.id), {
      isHighValue: parseBooleanStrict(body.isHighValue, 'isHighValue'),
      catalogId: body.catalogId == null ? undefined : String(body.catalogId),
    }, req.context!);
    res.json({ success: true, data: result });
  }));
}
