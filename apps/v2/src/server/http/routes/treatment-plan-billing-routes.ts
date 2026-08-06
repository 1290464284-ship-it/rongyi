/**
 * 治疗计划折扣与收费联动路由：
 * - POST /api/v2/treatment-plans/:id/discount          整单折（NONE/WHOLE/DOUBLE）
 * - POST /api/v2/treatment-plans/:id/items/:itemId/discount  单条折扣
 * - POST /api/v2/treatment-plans/:id/bill              勾选明细划价
 * - POST /api/v2/treatment-plans/:id/follow-up         计划回访追踪
 *
 * 路径前缀 /api/v2/treatment-plans 由调用方在 route-policy.ts 挂接鉴权规则（clinical）。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { TreatmentPlanBillingService } from '../../application/service-modules/treatment-plan-billing';

export function registerTreatmentPlanBillingRoutes(app: Express, db: Database.Database): void {
  const service = new TreatmentPlanBillingService(db);

  app.post('/api/v2/treatment-plans/:id/discount', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: service.setPlanDiscount(String(req.params.id), {
      discountType: body.discountType as 'NONE' | 'WHOLE' | 'DOUBLE',
      discountRate: body.discountRate as number | undefined,
    }, req.context!) });
  }));

  app.post('/api/v2/treatment-plans/:id/items/:itemId/discount', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: service.setItemDiscount(String(req.params.id), String(req.params.itemId), {
      discountRate: body.discountRate as number | null,
    }, req.context!) });
  }));

  app.post('/api/v2/treatment-plans/:id/bill', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: service.bill(String(req.params.id), {
      itemIds: body.itemIds === undefined ? undefined : (body.itemIds as string[]),
    }, req.context!) });
  }));

  app.post('/api/v2/treatment-plans/:id/follow-up', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: service.planFollowUp(String(req.params.id), {
      followUpStatus: body.followUpStatus as 'NONE' | 'PENDING' | 'HORIZONTAL_SHOULD' | 'HORIZONTAL_DONE' | 'LOST',
      nextFollowUpAt: body.nextFollowUpAt as string | undefined,
      trackingNote: body.trackingNote as string | undefined,
    }, req.context!) });
  }));
}
