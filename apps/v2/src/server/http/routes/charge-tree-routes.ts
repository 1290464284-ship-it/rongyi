/**
 * 收费标准二级分类树 + 快捷划价路由。
 *
 * GET  /api/v2/charge-trees                        收费分类树
 * POST /api/v2/charge-trees/:catalogId/quick-charge 按收费标准一键划价
 * 收费标准词典的写操作走通用资源 /resources/treatmentCatalogs。
 * 路径策略 /charge-trees → financeStaff 已由 route-policy 覆盖。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { ChargeTreeService } from '../../application/service-modules/charge-tree';

export function registerChargeTreeRoutes(app: Express, db: Database.Database): void {
  const service = new ChargeTreeService(db);

  app.get('/api/v2/charge-trees', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.tree(req.context!) });
  }));

  app.post('/api/v2/charge-trees/:catalogId/quick-charge', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = service.quickCharge(String(req.params.catalogId), {
      patientId: String(body.patientId ?? ''),
      visitId: body.visitId == null ? undefined : String(body.visitId),
      doctorId: body.doctorId == null ? undefined : String(body.doctorId),
      quantity: body.quantity == null ? undefined : Number(body.quantity),
      itemId: body.itemId == null ? undefined : String(body.itemId),
      remark: body.remark == null ? undefined : String(body.remark),
    }, req.context!);
    res.status(201).json({ success: true, data: result });
  }));
}
