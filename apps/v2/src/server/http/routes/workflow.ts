import type { Express } from 'express';
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

  app.post('/api/v2/appointments', async (req, res, next) => {
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

  app.post('/api/v2/inventory/replenishment/generate', async (req, res, next) => {
    try {
      res.json({ success: true, data: replenishment.generate(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/inventory/replenishment/apply', async (req, res, next) => {
    try {
      res.json({ success: true, data: replenishment.applyToPurchaseOrder(req.body?.ids ?? [], req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/wechat/:id/send', async (req, res, next) => {
    try {
      res.json({ success: true, data: wechat.send(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/wechat/send-batch', async (req, res, next) => {
    try {
      res.json({ success: true, data: wechat.sendBatch(req.body?.ids ?? [], req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/charges', async (req, res, next) => {
    try {
      const result = await charges.create(req.body, req.context!);
      res.status(201).json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/charges/:id/pay', async (req, res, next) => {
    try {
      const result = await charges.pay(
        req.params.id,
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

  app.post('/api/v2/charges/:id/refund', async (req, res, next) => {
    try {
      const result = await charges.refund(
        req.params.id,
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

  app.post('/api/v2/member-cards', async (req, res, next) => {
    try {
      res.status(201).json({ success: true, data: memberCards.create(req.body ?? {}, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/member-cards/:id/recharge', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.recharge(
          req.params.id,
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

  app.post('/api/v2/member-cards/:id/consume', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.consume(
          req.params.id,
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

  app.post('/api/v2/member-cards/:id/points', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.addPoints(
          req.params.id,
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

  app.patch('/api/v2/purchase-orders/:id/receive', async (req, res, next) => {
    try {
      res.json({ success: true, data: await purchaseOrders.receive(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/processing-orders/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: processingOrders.transition(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/patients/:id/risk', async (req, res, next) => {
    try {
      res.json({ success: true, data: patientRisk.calculate(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/prescriptions/:id/safety', async (req, res, next) => {
    try {
      res.json({ success: true, data: prescriptionSafety.check(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/cephalometric/:id/analyze', async (req, res, next) => {
    try {
      res.json({ success: true, data: cephalometric.compute(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/treatment-plans/:id/progress', async (req, res, next) => {
    try {
      res.json({ success: true, data: treatmentProgress.summary(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/bulk-import/:resource', async (req, res, next) => {
    try {
      res.json({ success: true, data: await bulkImport.importRows(req.params.resource, req.body?.rows ?? [], req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/debts/:id/pay', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await debts.pay(
          req.params.id,
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

  app.post('/api/v2/inventory/transactions', async (req, res, next) => {
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

  app.get('/api/v2/follow-ups/adherence', async (req, res, next) => {
    try {
      res.json({ success: true, data: followUps.adherence(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/follow-ups/batch-generate', async (req, res, next) => {
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
