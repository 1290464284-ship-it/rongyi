/**
 * 微信提醒路由。
 *
 * 调用方集成时需在 route-policy.ts 增加规则：
 *   { pattern: /^\/api\/v2\/wechat-reminders/, roles: ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE'] }
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { WechatReminderService } from '../../application/service-modules/wechat-reminder';

export function registerWechatReminderRoutes(app: Express, db: Database.Database): void {
  const service = new WechatReminderService(db);

  app.get('/api/v2/wechat-reminders/today', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.today(req.context!) });
  }));

  app.get('/api/v2/wechat-reminders/config', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.config(req.context!) });
  }));

  app.post('/api/v2/wechat-reminders/:id/mark-sent', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.markSent(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/wechat-reminders/:id/dismiss', wrapAsync(async (req, res) => {
    res.json({ success: true, data: service.dismiss(String(req.params.id), req.context!) });
  }));
}
