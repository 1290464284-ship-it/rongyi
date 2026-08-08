/**
 * 采购单审核流路由：审核列表 / 汇总 + 提交审核 / 通过 / 驳回 / 重新提交。
 *
 * 路由策略由调用方在 route-policy.ts 集成：既有规则 /^\/api\/v2\/purchase-orders/
 * 已覆盖本文件全部端点，本文件不触碰策略层、不注册到 app.ts。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { parsePagination } from '../pagination';
import { PurchaseReviewService } from '../../application/service-modules/purchase-review';
import type { RouteDependencies } from './deps';

export function registerPurchaseReviewRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new PurchaseReviewService(db);

  app.get('/api/v2/purchase-orders/review', wrapAsync(async (req, res) => {
    const reviewStatus = typeof req.query?.reviewStatus === 'string' && req.query.reviewStatus
      ? req.query.reviewStatus
      : undefined;
    const { page, pageSize } = parsePagination(req, { defaultPageSize: 200 });
    res.json({
      success: true,
      data: service.list(req.context!, { ...(reviewStatus ? { reviewStatus } : {}), page, pageSize }),
    });
  }));

  app.get('/api/v2/purchase-orders/review-stats', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.stats(req.context!) });
  }));

  app.post('/api/v2/purchase-orders/:id/submit', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.submit(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/purchase-orders/:id/approve', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.approve(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/purchase-orders/:id/reject', wrapAsync(async (req, res) => {
    res.json({
      success: true,
      data: service.reject(String(req.params.id), { reason: String(req.body?.reason ?? '') }, req.context!),
    });
  }));

  app.post('/api/v2/purchase-orders/:id/reopen', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.reopen(String(req.params.id), req.context!) });
  }));
}
