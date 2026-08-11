import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { AppError } from '../../infrastructure/errors';
import { CommissionService } from '../../application/service-modules/commission';
import type { RouteDependencies } from './deps';

function requireFinanceAdmin(context: { role: string }): void {
  if (!['BOSS', 'ADMIN'].includes(context.role)) {
    throw new AppError('FORBIDDEN', 'Only BOSS or ADMIN can manage commission rules', 403);
  }
}

export function registerCommissionRoutes(app: Express, deps: RouteDependencies): void {
  const service = new CommissionService(deps.db);

  app.get('/api/v2/commission/rules', wrapAsync((req, res) => {
    res.json({ success: true, data: service.listRules(req.context!) });
  }));

  app.post('/api/v2/commission/rules', wrapAsync((req, res) => {
    requireFinanceAdmin(req.context!);
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(201).json({
      success: true,
      data: service.createRule({
        name: String(body.name ?? ''),
        category: body.category === undefined || body.category === null ? null : String(body.category),
        costType: body.costType === undefined || body.costType === null || body.costType === ''
          ? null
          : String(body.costType) as 'SERVICE' | 'MATERIAL',
        rateType: String(body.rateType ?? '') as 'PERCENT' | 'FIXED',
        rate: Number(body.rate ?? 0),
        doctorId: body.doctorId === undefined || body.doctorId === null || body.doctorId === ''
          ? null
          : String(body.doctorId),
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      }, req.context!),
    });
  }));

  app.patch('/api/v2/commission/rules/:id', wrapAsync((req, res) => {
    requireFinanceAdmin(req.context!);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined && body.name !== null) patch.name = String(body.name);
    if (body.category !== undefined) patch.category = body.category === null ? null : String(body.category);
    if (body.costType !== undefined) {
      patch.costType = body.costType === null || body.costType === ''
        ? null
        : String(body.costType) as 'SERVICE' | 'MATERIAL';
    }
    if (body.rateType !== undefined) patch.rateType = String(body.rateType) as 'PERCENT' | 'FIXED';
    if (body.rate !== undefined) patch.rate = Number(body.rate);
    if (body.doctorId !== undefined) {
      patch.doctorId = body.doctorId === null || body.doctorId === '' ? null : String(body.doctorId);
    }
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    res.json({
      success: true,
      data: service.updateRule(String(req.params.id), patch, req.context!),
    });
  }));

  app.delete('/api/v2/commission/rules/:id', wrapAsync((req, res) => {
    requireFinanceAdmin(req.context!);
    service.deleteRule(String(req.params.id), req.context!);
    res.json({ success: true, data: { id: String(req.params.id) } });
  }));

  app.post('/api/v2/commission/calculate', wrapAsync((req, res) => {
    requireFinanceAdmin(req.context!);
    const period = String((req.body as { period?: unknown } | undefined)?.period ?? '');
    res.json({ success: true, data: service.calculate(period, req.context!) });
  }));

  app.get('/api/v2/commission/statements', wrapAsync((req, res) => {
    const period = typeof req.query.period === 'string' ? req.query.period : '';
    const doctorId = typeof req.query.doctorId === 'string' && req.query.doctorId !== ''
      ? req.query.doctorId
      : null;
    res.json({ success: true, data: service.statements(period, req.context!, { doctorId }) });
  }));
}
