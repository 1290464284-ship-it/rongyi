/**
 * 处方处理路由。
 *
 * POST /api/v2/prescriptions/:id/process 处方 -> 划价单 + 领药单（可勾选部分明细）
 * GET  /api/v2/prescriptions/:id/status  处方处理状态（供前端刷新）
 *
 * 路由策略已覆盖 /api/v2/prescriptions 前缀（clinical），无需新增规则。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { PrescriptionProcessService } from '../../application/service-modules/prescription-process';

export function registerPrescriptionProcessRoutes(app: Express, db: Database.Database): void {
  const service = new PrescriptionProcessService(db);

  app.post('/api/v2/prescriptions/:id/process', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as { itemIds?: unknown };
    const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String) : undefined;
    res.json({
      success: true,
      data: service.process(String(req.params.id), { itemIds }, req.context!),
    });
  }));

  app.get('/api/v2/prescriptions/:id/status', wrapAsync(async (req, res) => {
    res.json({
      success: true,
      data: service.status(String(req.params.id), req.context!),
    });
  }));
}
