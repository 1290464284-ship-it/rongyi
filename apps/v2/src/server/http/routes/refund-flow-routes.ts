/**
 * 退费审批流路由：列表 + 审批通过 / 驳回 / 取消 / 确认退款。
 *
 * 路由策略规则 /^\/api\/v2\/refunds(\/|$)/（financeStaff）由调用方在
 * route-policy.ts 中集成，本文件不触碰策略层。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { RefundFlowService } from '../../application/service-modules/refund-flow';

export function registerRefundFlowRoutes(app: Express, db: Database.Database): void {
  const service = new RefundFlowService(db);

  app.get('/api/v2/refunds', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.list(req.context!) });
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
