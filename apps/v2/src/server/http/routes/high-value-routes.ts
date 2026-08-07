/**
 * 高值耗材标记路由。
 *
 * POST /api/v2/inventory-items/:id/high-value { isHighValue, catalogId? }
 * 该路径命中既有 /inventory 策略（覆盖 /inventory-items），无需新规则。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { HighValueService } from '../../application/service-modules/high-value';

export function registerHighValueRoutes(app: Express, db: Database.Database): void {
  const service = new HighValueService(db);

  app.post('/api/v2/inventory-items/:id/high-value', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = service.mark(String(req.params.id), {
      isHighValue: Boolean(body.isHighValue),
      catalogId: body.catalogId == null ? undefined : String(body.catalogId),
    }, req.context!);
    res.json({ success: true, data: result });
  }));
}
