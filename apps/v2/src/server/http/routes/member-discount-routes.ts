/**
 * 会员折扣方案与报价试算路由。
 *
 * 全部命中既有 route-policy 规则 /^\/api\/v2\/member-cards(\/|$)/（financeStaff），
 * 无需新增规则。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { MemberDiscountService, type QuoteInput } from '../../application/service-modules/member-discount';

export function registerMemberDiscountRoutes(app: Express, db: Database.Database): void {
  const service = new MemberDiscountService(db);

  app.get('/api/v2/member-cards/:id/discount-plan', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.getPlan(String(req.params.id), req.context!) });
  }));

  app.put('/api/v2/member-cards/:id/discount-plan', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.savePlan(String(req.params.id), req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/member-cards/:id/quote', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.quote(String(req.params.id), req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/member-cards/quote', wrapAsync(async (req, res) => {
    const body = (req.body ?? {}) as QuoteInput & { patientId?: string };
    res.json({ success: true, data: service.quoteByPatient(String(body.patientId ?? ''), body, req.context!) });
  }));
}
