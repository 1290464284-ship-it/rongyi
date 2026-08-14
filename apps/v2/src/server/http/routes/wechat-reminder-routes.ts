/**
 * 微信提醒路由。
 *
 * 调用方集成时需在 route-policy.ts 增加规则：
 *   { pattern: /^\/api\/v2\/wechat-reminders/, roles: ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE'] }
 */
import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { WechatReminderService } from '../../application/service-modules/wechat-reminder';
import { AppError } from '../../infrastructure/errors';
import type { RouteDependencies } from './deps';

export function registerWechatReminderRoutes(
  app: Express,
  deps: RouteDependencies,
  service?: WechatReminderService,
): void {
  const { db } = deps;
  const reminderService = service ?? new WechatReminderService(db);

  app.get('/api/v2/wechat-reminders/today', wrapAsync(async (req, res) => {
    res.json({ success: true, data: reminderService.today(req.context!) });
  }));

  app.get('/api/v2/wechat-reminders/config', wrapAsync(async (req, res) => {
    res.json({ success: true, data: reminderService.config(req.context!) });
  }));

  app.patch('/api/v2/wechat-reminders/config', wrapAsync(async (req, res) => {
    if (!['BOSS', 'ADMIN'].includes(req.context!.role)) {
      throw new AppError('FORBIDDEN', '仅老板或管理员可修改提醒配置', 403);
    }
    res.json({ success: true, data: reminderService.updateConfig(req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/wechat-reminders/:id/mark-sent', wrapAsync(async (req, res) => {
    res.json({ success: true, data: reminderService.markSent(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/wechat-reminders/:id/dismiss', wrapAsync(async (req, res) => {
    res.json({ success: true, data: reminderService.dismiss(String(req.params.id), req.context!) });
  }));
}
