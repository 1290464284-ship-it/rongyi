/**
 * 班次模板 + 固定排班路由（排班中心）。
 *
 * 端点：
 * - GET   /api/v2/shift-templates（?activeOnly=1）
 * - POST  /api/v2/shift-templates
 * - PATCH /api/v2/shift-templates/:id
 * - POST  /api/v2/shift-templates/generate（body { templateId, userId, weekStart }）
 * - GET   /api/v2/schedules/week?weekStart=YYYY-MM-DD
 *
 * 统一 `{ success: true, data }` 响应；错误由 wrapAsync + app 级错误中间件处理。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { ShiftTemplateService } from '../../application/service-modules/shift-template';

export function registerShiftTemplateRoutes(app: Express, db: Database.Database): void {
  const service = new ShiftTemplateService(db);

  app.get('/api/v2/shift-templates', wrapAsync((req, res) => {
    const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true';
    res.json({
      success: true,
      data: service.list(req.context!, activeOnly ? { activeOnly: true } : undefined),
    });
  }));

  app.post('/api/v2/shift-templates', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(201).json({
      success: true,
      data: service.create({
        name: body.name === undefined || body.name === null ? '' : String(body.name),
        startTime: body.startTime === undefined || body.startTime === null ? '' : String(body.startTime),
        endTime: body.endTime === undefined || body.endTime === null ? '' : String(body.endTime),
        workDaysJson: body.workDaysJson === undefined || body.workDaysJson === null
          ? undefined
          : (body.workDaysJson as string | number[]),
        color: body.color === undefined || body.color === null ? undefined : String(body.color),
        active: body.active === undefined ? undefined : Boolean(body.active),
      }, req.context!),
    });
  }));

  app.patch('/api/v2/shift-templates/:id', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined && body.name !== null) patch.name = String(body.name);
    if (body.startTime !== undefined && body.startTime !== null) patch.startTime = String(body.startTime);
    if (body.endTime !== undefined && body.endTime !== null) patch.endTime = String(body.endTime);
    if (body.workDaysJson !== undefined && body.workDaysJson !== null) {
      patch.workDaysJson = body.workDaysJson as string | number[];
    }
    if (body.color !== undefined) patch.color = body.color === null ? null : String(body.color);
    if (body.active !== undefined) patch.active = Boolean(body.active);
    res.json({
      success: true,
      data: service.update(String(req.params.id), patch, req.context!),
    });
  }));

  app.post('/api/v2/shift-templates/generate', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({
      success: true,
      data: service.generate({
        templateId: body.templateId === undefined || body.templateId === null ? '' : String(body.templateId),
        userId: body.userId === undefined || body.userId === null ? '' : String(body.userId),
        weekStart: body.weekStart === undefined || body.weekStart === null ? '' : String(body.weekStart),
      }, req.context!),
    });
  }));

  app.get('/api/v2/schedules/week', wrapAsync((req, res) => {
    const weekStart = typeof req.query.weekStart === 'string' ? req.query.weekStart : '';
    res.json({
      success: true,
      data: service.weekSchedules(weekStart, req.context!),
    });
  }));
}
