import type { Express } from 'express';
import { createRateLimit } from '../rate-limit';
import type { RouteDependencies } from './deps';

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
  const writeLimiter = createRateLimit({ windowMs: 60_000, max: 120 });
  const batchLimiter = createRateLimit({ windowMs: 60_000, max: 60 });

  app.post('/api/v2/appointments', writeLimiter, async (req, res, next) => {
    try {
      const result = await appointments.create(req.body, req.context!);
      res.status(201).json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/appointments/:id/status', async (req, res, next) => {
    try {
      const result = await appointments.transition(req.params.id, String(req.body?.status ?? ''), req.context!);
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/registrations/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.registrationStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/visits/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.visitStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/first-exams/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.firstExamStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/treatments/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.treatmentStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/medical-records/:id/lock', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.lockMedicalRecord(req.params.id, req.body?.locked !== false, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/inventory/replenishment/generate', writeLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: replenishment.generate(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/inventory/replenishment/apply', writeLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: replenishment.applyToPurchaseOrder(req.body?.ids ?? [], req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/wechat/:id/send', writeLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: wechat.send(String(req.params.id), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/wechat/send-batch', batchLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: wechat.sendBatch(req.body?.ids ?? [], req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/charges', writeLimiter, async (req, res, next) => {
    try {
      const result = await charges.create(req.body, req.context!);
      res.status(201).json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/charges/:id/pay', writeLimiter, async (req, res, next) => {
    try {
      const result = await charges.pay(
        String(req.params.id),
        Number(req.body?.amount ?? 0),
        String(req.body?.method ?? 'CASH'),
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        req.context!,
      );
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/charges/:id/refund', writeLimiter, async (req, res, next) => {
    try {
      const result = await charges.refund(
        String(req.params.id),
        Number(req.body?.amount ?? 0),
        String(req.body?.reason ?? ''),
        req.context!,
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
      );
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/member-cards', writeLimiter, async (req, res, next) => {
    try {
      res.status(201).json({ success: true, data: memberCards.create(req.body ?? {}, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/member-cards/:id/recharge', writeLimiter, async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.recharge(
          String(req.params.id),
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/member-cards/:id/consume', writeLimiter, async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.consume(
          String(req.params.id),
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/member-cards/:id/points', writeLimiter, async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.addPoints(
          String(req.params.id),
          Number(req.body?.points ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/purchase-orders/:id/receive', writeLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: await purchaseOrders.receive(String(req.params.id), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/purchase-orders/:id/items', async (req, res, next) => {
    try {
      res.json({ success: true, data: purchaseOrders.items(String(req.params.id), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/processing-orders/:id/status', writeLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: processingOrders.transition(String(req.params.id), String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/patients/:id/risk', writeLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: patientRisk.calculate(String(req.params.id), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/prescriptions/:id/safety', async (req, res, next) => {
    try {
      res.json({ success: true, data: prescriptionSafety.check(String(req.params.id), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/cephalometric/:id/analyze', writeLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: cephalometric.compute(String(req.params.id), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/treatment-plans/:id/progress', async (req, res, next) => {
    try {
      res.json({ success: true, data: treatmentProgress.summary(String(req.params.id), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/bulk-import/:resource', batchLimiter, async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await bulkImport.importRows(
          String(req.params.resource),
          req.body?.rows ?? [],
          req.context!,
          Number(req.body?.chunkSize ?? 100),
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/debts/:id/pay', writeLimiter, async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await debts.pay(
          String(req.params.id),
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/notifications', async (req, res, next) => {
    try {
      res.json({ success: true, data: notifications.list(req.context!.userId) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/notifications/:id/read', async (req, res, next) => {
    try {
      res.json({ success: true, data: notifications.markRead(req.params.id, req.context!.userId) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/inventory/transactions', writeLimiter, async (req, res, next) => {
    try {
      const result = await inventory.createTransaction(
        req.body,
        req.context!,
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
      );
      res.status(201).json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/inventory/low-stock', async (req, res, next) => {
    try {
      res.json({ success: true, data: inventory.lowStock(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/inventory/expiring', async (req, res, next) => {
    try {
      const days = Number(req.query.days ?? 30);
      res.json({ success: true, data: inventory.expiringSoon(Number.isFinite(days) ? days : 30, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/follow-ups/reminders', async (req, res, next) => {
    try {
      res.json({ success: true, data: followUps.reminders(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/follow-ups/reminders/summary', async (req, res, next) => {
    try {
      res.json({ success: true, data: followUps.summary(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/follow-ups/reminders/export', async (req, res, next) => {
    try {
      const scope = String(req.query.scope ?? 'overdue');
      res
        .setHeader('content-type', 'text/csv; charset=utf-8')
        .setHeader('content-disposition', `attachment; filename="follow-ups-${scope}.csv"`)
        .send(followUps.remindersCsv(scope, req.context!));
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/follow-ups/batch-complete', writeLimiter, async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: followUps.batchComplete(
          Array.isArray(req.body?.ids) ? req.body.ids : [],
          req.context!,
          typeof req.body?.result === 'string' ? req.body.result : null,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/follow-ups/:id/complete', writeLimiter, async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: followUps.complete(
          String(req.params.id),
          req.context!,
          typeof req.body?.result === 'string' ? req.body.result : null,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/follow-ups/adherence', async (req, res, next) => {
    try {
      res.json({ success: true, data: followUps.adherence(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/follow-ups/batch-generate', batchLimiter, async (req, res, next) => {
    try {
      const result = await followUps.batchGenerate(Number(req.body?.limit ?? 50), req.context!);
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });
}
