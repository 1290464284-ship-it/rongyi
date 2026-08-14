/**
 * 主记录 + 明细原子保存路由。
 *
 * PATCH /api/v2/treatment-plans/:id/save  治疗计划主表 + 明细一次事务保存
 * PATCH /api/v2/prescriptions/:id/save    处方主表 + 明细一次事务保存
 *
 * 路由策略已覆盖 /treatment-plans 与 /prescriptions 前缀（clinical），无需新增规则。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { EditSaveService } from '../../application/service-modules/edit-save';
import type { RouteDependencies } from './deps';

export function registerEditSaveRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new EditSaveService(db);

  app.patch('/api/v2/treatment-plans/:id/save', wrapAsync(async (req, res) => {
    res.json({
      success: true,
      data: service.saveTreatmentPlan(String(req.params.id), req.body ?? {}, req.context!),
    });
  }));

  app.patch('/api/v2/prescriptions/:id/save', wrapAsync(async (req, res) => {
    res.json({
      success: true,
      data: service.savePrescription(String(req.params.id), req.body ?? {}, req.context!),
    });
  }));
}
