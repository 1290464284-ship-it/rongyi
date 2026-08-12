import type { Express } from 'express';
import { createRateLimit } from '../rate-limit';
import { wrapAsync } from '../middleware';
import { parsePagination } from '../pagination';
import { ValidationError } from '../../infrastructure/errors';
import { parseBooleanStrict } from '../validation';
import type { RouteDependencies } from './deps';
import { withIdempotency } from '../../infrastructure/idempotency';

export function registerWorkflowRoutes(app: Express, deps: RouteDependencies): void {
  const {
    appointments,
    bulkImport,
    cephalometric,
    charges,
    clinicalWorkflow,
    debts,
    followUps,
    inventory,
    memberCards,
    notifications,
    patientRisk,
    prescriptionSafety,
    processingOrders,
    purchaseOrders,
    replenishment,
    treatmentProgress,
    wechat,
  } = deps;
  const writeLimiter = createRateLimit({ windowMs: 60_000, max: 120 }, deps.rateLimitStore);
  const batchLimiter = createRateLimit({ windowMs: 60_000, max: 60 }, deps.rateLimitStore);

  app.post('/api/v2/appointments', writeLimiter, wrapAsync(async (req, res) => {
      const result = await withIdempotency(deps.db, {
        operation: 'appointment.create',
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: req.header('idempotency-key') ?? '',
      }, async () => {
        const created = await appointments.create(req.body, req.context!);
        return { success: true, data: created };
      });
      res.status(201).json(result);
  }));

  app.patch('/api/v2/appointments/:id/status', wrapAsync(async (req, res) => {
      const result = await appointments.transition(String(req.params.id), String(req.body?.status ?? ''), req.context!);
      res.json({ success: true, data: result });
  }));

  app.patch('/api/v2/registrations/:id/status', wrapAsync(async (req, res) => {
      res.json({ success: true, data: clinicalWorkflow.registrationStatus(String(req.params.id), String(req.body?.status ?? ''), req.context!) });
  }));

  app.patch('/api/v2/visits/:id/status', wrapAsync(async (req, res) => {
      res.json({ success: true, data: clinicalWorkflow.visitStatus(String(req.params.id), String(req.body?.status ?? ''), req.context!) });
  }));

  app.patch('/api/v2/first-exams/:id/status', wrapAsync(async (req, res) => {
      res.json({ success: true, data: clinicalWorkflow.firstExamStatus(String(req.params.id), String(req.body?.status ?? ''), req.context!) });
  }));

  app.patch('/api/v2/treatments/:id/status', wrapAsync(async (req, res) => {
      res.json({ success: true, data: clinicalWorkflow.treatmentStatus(String(req.params.id), String(req.body?.status ?? ''), req.context!) });
  }));

  app.patch('/api/v2/medical-records/:id/lock', wrapAsync(async (req, res) => {
      const locked = req.body?.locked === undefined ? true : parseBooleanStrict(req.body.locked, 'locked');
      res.json({ success: true, data: clinicalWorkflow.lockMedicalRecord(String(req.params.id), locked, req.context!) });
  }));

  app.post('/api/v2/inventory/replenishment/generate', writeLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: replenishment.generate(req.context!) });
  }));

  app.post('/api/v2/inventory/replenishment/apply', writeLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: replenishment.applyToPurchaseOrder(req.body?.ids ?? [], req.context!) });
  }));

  app.get('/api/v2/wechat/status', wrapAsync(async (req, res) => {
      res.json({ success: true, data: wechat.status() });
  }));

  app.post('/api/v2/wechat/:id/send', writeLimiter, wrapAsync(async (req, res) => {
      const result = await withIdempotency(deps.db, {
        operation: `wechat.send.${String(req.params.id)}`,
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: req.header('idempotency-key') ?? '',
      }, async () => {
        const sent = await wechat.send(String(req.params.id), req.context!);
        return { success: true, data: sent };
      });
      res.json(result);
  }));

  app.post('/api/v2/wechat/send-batch', batchLimiter, wrapAsync(async (req, res) => {
      const result = await withIdempotency(deps.db, {
        operation: 'wechat.send-batch',
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: req.header('idempotency-key') ?? '',
      }, async () => {
        const sent = await wechat.sendBatch(req.body?.ids ?? [], req.context!);
        return { success: true, data: sent };
      });
      res.json(result);
  }));

  app.post('/api/v2/charges', writeLimiter, wrapAsync(async (req, res) => {
      const result = await withIdempotency(deps.db, {
        operation: 'charge.create',
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: req.header('idempotency-key') ?? '',
      }, async () => {
        const created = await charges.create(req.body, req.context!);
        return { success: true, data: created };
      });
      res.status(201).json(result);
  }));

  app.patch('/api/v2/charges/:id/pay', writeLimiter, wrapAsync(async (req, res) => {
      const result = await charges.pay(
        String(req.params.id),
        Number(req.body?.amount ?? 0),
        String(req.body?.method ?? 'CASH'),
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        req.context!,
        typeof req.body?.payMethodName === 'string' ? req.body.payMethodName : undefined,
      );
      res.json({ success: true, data: result });
  }));

  app.post('/api/v2/charges/:id/refund', writeLimiter, wrapAsync(async (req, res) => {
      const result = await charges.refund(
        String(req.params.id),
        Number(req.body?.amount ?? 0),
        String(req.body?.reason ?? ''),
        req.context!,
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
      );
      res.json({ success: true, data: result });
  }));

  app.delete('/api/v2/charges/:id', writeLimiter, wrapAsync(async (req, res) => {
      const result = await charges.cancel(String(req.params.id), req.context!);
      res.json({ success: true, data: result });
  }));

  app.post('/api/v2/member-cards', writeLimiter, wrapAsync(async (req, res) => {
      res.status(201).json({ success: true, data: memberCards.create(req.body ?? {}, req.context!) });
  }));

  app.post('/api/v2/member-cards/:id/recharge', writeLimiter, wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: await memberCards.recharge(
          String(req.params.id),
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
  }));

  app.post('/api/v2/member-cards/:id/consume', writeLimiter, wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: await memberCards.consume(
          String(req.params.id),
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
  }));

  app.post('/api/v2/member-cards/:id/points', writeLimiter, wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: await memberCards.addPoints(
          String(req.params.id),
          Number(req.body?.points ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
  }));

  app.post('/api/v2/purchase-orders', writeLimiter, wrapAsync(async (req, res) => {
      res.status(201).json({
        success: true,
        data: await purchaseOrders.create(req.body ?? {}, req.context!, typeof req.body?.requestId === 'string' ? req.body.requestId : undefined),
      });
  }));

  app.patch('/api/v2/purchase-orders/:id/receive', writeLimiter, wrapAsync(async (req, res) => {
      const result = await withIdempotency(deps.db, {
        operation: `purchase-order.receive.${String(req.params.id)}`,
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: req.header('idempotency-key') ?? '',
      }, async () => {
        const received = await purchaseOrders.receive(String(req.params.id), req.context!);
        return { success: true, data: received };
      });
      res.json(result);
  }));

  app.get('/api/v2/purchase-orders/:id/items', wrapAsync(async (req, res) => {
      res.json({ success: true, data: purchaseOrders.items(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/processing-orders', writeLimiter, wrapAsync(async (req, res) => {
      res.status(201).json({
        success: true,
        data: await processingOrders.create(req.body ?? {}, req.context!, typeof req.body?.requestId === 'string' ? req.body.requestId : undefined),
      });
  }));

  app.patch('/api/v2/processing-orders/:id/status', writeLimiter, wrapAsync(async (req, res) => {
      const result = withIdempotency(deps.db, {
        operation: `processing-order.status.${String(req.params.id)}`,
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: req.header('idempotency-key') ?? '',
      }, () => ({
        success: true,
        data: processingOrders.transition(String(req.params.id), String(req.body?.status ?? ''), req.context!),
      }));
      res.json(result);
  }));

  app.post('/api/v2/patients/:id/risk', writeLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: patientRisk.calculate(String(req.params.id), req.context!) });
  }));

  app.get('/api/v2/prescriptions/:id/safety', wrapAsync(async (req, res) => {
      res.json({ success: true, data: prescriptionSafety.check(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/cephalometric/:id/analyze', writeLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: cephalometric.compute(String(req.params.id), req.context!) });
  }));

  app.get('/api/v2/treatment-plans/:id/progress', wrapAsync(async (req, res) => {
      res.json({ success: true, data: treatmentProgress.summary(String(req.params.id), req.context!) });
  }));

  app.post('/api/v2/bulk-import/:resource', batchLimiter, wrapAsync(async (req, res) => {
      const result = await withIdempotency(deps.db, {
        operation: `bulk-import.${String(req.params.resource)}`,
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: typeof req.body?.requestId === 'string' ? req.body.requestId : '',
      }, async () => ({
        success: true,
        data: await bulkImport.importRows(
          String(req.params.resource),
          req.body?.rows ?? [],
          req.context!,
          Number(req.body?.chunkSize ?? 100),
        ),
      }));
      res.json(result);
  }));

  app.patch('/api/v2/debts/:id/pay', writeLimiter, wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: await debts.pay(
          String(req.params.id),
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
  }));

  app.get('/api/v2/notifications', wrapAsync(async (req, res) => {
      const { page, pageSize } = parsePagination(req);
      res.json({ success: true, data: notifications.list(req.context!.userId, req.context!.clinicId, { page, pageSize }) });
  }));

  app.patch('/api/v2/notifications/:id/read', wrapAsync(async (req, res) => {
      res.json({ success: true, data: notifications.markRead(String(req.params.id), req.context!.userId, req.context!.clinicId) });
  }));

  app.post('/api/v2/inventory/transactions', writeLimiter, wrapAsync(async (req, res) => {
      const result = await inventory.createTransaction(
        req.body,
        req.context!,
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
      );
      res.status(201).json({ success: true, data: result });
  }));

  app.get('/api/v2/inventory/low-stock', wrapAsync(async (req, res) => {
      res.json({ success: true, data: inventory.lowStock(req.context!) });
  }));

  app.get('/api/v2/inventory/expiring', wrapAsync(async (req, res) => {
      const days = Number(req.query.days ?? 30);
      // 上限 1..3650：超大值会造成无效的全表范围扫描
      const clamped = Number.isFinite(days) ? Math.min(Math.max(Math.floor(days), 1), 3650) : 30;
      res.json({ success: true, data: inventory.expiringSoon(clamped, req.context!) });
  }));

  app.get('/api/v2/follow-ups/reminders', wrapAsync(async (req, res) => {
      const { page, pageSize } = parsePagination(req, { defaultPageSize: 100 });
      const rawScope = typeof req.query.scope === 'string' && req.query.scope !== '' ? req.query.scope : undefined;
      if (rawScope !== undefined && !['overdue', 'today', 'upcoming', 'all'].includes(rawScope)) {
        throw new ValidationError('Follow-up scope must be overdue, today, upcoming, or all');
      }
      res.json({
        success: true,
        data: followUps.reminders(req.context!, {
          page,
          pageSize,
          scope: rawScope as 'overdue' | 'today' | 'upcoming' | 'all' | undefined,
        }),
      });
  }));

  app.get('/api/v2/follow-ups/reminders/summary', wrapAsync(async (req, res) => {
      res.json({ success: true, data: followUps.summary(req.context!) });
  }));

  app.get('/api/v2/follow-ups/reminders/export', wrapAsync(async (req, res) => {
      const scope = String(req.query.scope ?? 'overdue');
      res
        .setHeader('content-type', 'text/csv; charset=utf-8')
        .setHeader('content-disposition', `attachment; filename="follow-ups-${scope}.csv"`)
        .send(followUps.remindersCsv(scope, req.context!));
  }));

  app.post('/api/v2/follow-ups/batch-complete', writeLimiter, wrapAsync(async (req, res) => {
      const result = withIdempotency(deps.db, {
        operation: 'follow-ups.batch-complete',
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: req.header('idempotency-key') ?? '',
      }, () => ({
        success: true,
        data: followUps.batchComplete(
          Array.isArray(req.body?.ids) ? req.body.ids : [],
          req.context!,
          typeof req.body?.result === 'string' ? req.body.result : null,
        ),
      }));
      res.json(result);
  }));

  app.patch('/api/v2/follow-ups/:id/complete', writeLimiter, wrapAsync(async (req, res) => {
      const result = withIdempotency(deps.db, {
        operation: `follow-up.complete.${String(req.params.id)}`,
        userId: req.context!.userId,
        clinicId: req.context!.clinicId,
        requestId: req.header('idempotency-key') ?? '',
      }, () => ({
        success: true,
        data: followUps.complete(
          String(req.params.id),
          req.context!,
          typeof req.body?.result === 'string' ? req.body.result : null,
        ),
      }));
      res.json(result);
  }));

  app.get('/api/v2/follow-ups/adherence', wrapAsync(async (req, res) => {
      res.json({ success: true, data: followUps.adherence(req.context!) });
  }));

  app.post('/api/v2/follow-ups/batch-generate', batchLimiter, wrapAsync(async (req, res) => {
      const result = await followUps.batchGenerate(Number(req.body?.limit ?? 50), req.context!);
      res.json({ success: true, data: result });
  }));
}
