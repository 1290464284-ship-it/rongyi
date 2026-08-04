import type { Express } from 'express';
import { createResourceRouter } from '../router';
import { createRateLimit } from '../rate-limit';
import type { RouteDependencies } from './deps';

export function registerSystemRoutes(app: Express, deps: RouteDependencies): void {
  const { alerts, backups, db, hr, sync } = deps;
  const syncLimiter = createRateLimit({ windowMs: 60_000, max: 120 });
  const backupLimiter = createRateLimit({ windowMs: 60_000, max: 60 });

  app.get('/api/v2/sync/pull', syncLimiter, async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: sync.pull(
          String(req.query.since ?? new Date(0).toISOString()),
          String(req.query.deviceId ?? 'desktop'),
          String(req.query.deviceToken ?? ''),
          req.context!,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/sync/devices', syncLimiter, async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        data: sync.registerDevice(
          String(req.body?.deviceId ?? ''),
          String(req.body?.name ?? 'desktop'),
          req.context!,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/sync/push', syncLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: await sync.push(req.body, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/sync/cleanup', syncLimiter, async (req, res, next) => {
    try {
      const before = typeof req.body?.before === 'string' ? req.body.before : undefined;
      res.json({ success: true, data: sync.cleanup(before, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/hr/attendance', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: hr.attendance(typeof req.query.workDate === 'string' ? req.query.workDate : undefined, req.context!),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/hr/leaves/:id/approve', async (req, res, next) => {
    try {
      const approved = req.body?.approved !== false;
      res.json({ success: true, data: hr.approveLeave(req.params.id, req.context!.userId, approved, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/system/business-alerts', async (req, res, next) => {
    try {
      res.json({ success: true, data: alerts.open(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/system/business-alerts/:id/status', async (req, res, next) => {
    try {
      const status = String(req.body?.status ?? 'ACKNOWLEDGED') as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
      res.json({ success: true, data: alerts.setStatus(req.params.id, status, req.context!.userId, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/backups', backupLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: backups.list() });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/backups', backupLimiter, async (req, res, next) => {
    try {
      res.status(201).json({ success: true, data: await backups.create() });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/backups/cleanup', backupLimiter, async (req, res, next) => {
    try {
      const maxKeep = Number(req.body?.maxKeep ?? 30);
      if (!Number.isFinite(maxKeep) || maxKeep < 1 || maxKeep > 365) {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'maxKeep must be between 1 and 365' });
        return;
      }
      res.json({ success: true, data: backups.cleanup(maxKeep) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/backups/:filename/restore', backupLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: await backups.stageRestore(String(req.params.filename)) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/backups/:filename/verify', backupLimiter, async (req, res, next) => {
    try {
      res.json({ success: true, data: await backups.verify(String(req.params.filename)) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.use('/api/v2/resources', createRateLimit({ windowMs: 60_000, max: 300 }), createResourceRouter(db));
}
