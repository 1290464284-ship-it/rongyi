/**
 * 退费审批流路由：列表 + 审批通过 / 驳回 / 取消 / 确认退款。
 *
 * 路由策略规则 /^\/api\/v2\/refunds(\/|$)/（financeStaff）由调用方在
 * route-policy.ts 中集成，本文件不触碰策略层。
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { parsePagination } from '../pagination';
import { nextCursorFrom } from '../../infrastructure/keyset';
import { RefundFlowService } from '../../application/service-modules/refund-flow';
import type { RouteDependencies } from './deps';

export function registerRefundFlowRoutes(app: Express, deps: RouteDependencies): void {
  const { db } = deps;
  const service = new RefundFlowService(db);

  app.get('/api/v2/refunds', wrapAsync(async (req, res) => {
    const { page, pageSize } = parsePagination(req);
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor !== '' ? String(req.query.cursor) : null;
    // S-2 keyset：服务端恒取 pageSize+1 行（含多取行判截断），路由裁剪并回传 nextCursor。
    const rows = service.list(req.context!, { page, pageSize, cursor });
    const items = rows.slice(0, pageSize);
    const nextCursor = nextCursorFrom(rows, pageSize, { columns: [{ column: 'createdAt', key: 'createdAt' }], idColumn: 'id', direction: 'DESC' });
    const total = service.count(req.context!);
    res.json({ success: true, data: { items, total, page, pageSize, nextCursor } });
  }));

  app.get('/api/v2/refunds/summary', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.summary(req.context!) });
  }));

  app.post('/api/v2/refunds/:id/approve', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.approve(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/refunds/:id/reject', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.reject(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/refunds/:id/cancel', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.cancel(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/refunds/:id/process', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.process(String(req.params.id), req.context!) });
  }));
}
