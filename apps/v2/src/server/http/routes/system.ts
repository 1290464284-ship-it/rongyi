import type { Express } from 'express';
import { createResourceRouter } from '../router';
import { wrapAsync } from '../middleware';
import { createRateLimit } from '../rate-limit';
import type { RouteDependencies } from './deps';

export function registerSystemRoutes(app: Express, deps: RouteDependencies): void {
  const { alerts, audit, backups, db, hr, sync } = deps;
  const syncLimiter = createRateLimit({ windowMs: 60_000, max: 120 });
  const backupLimiter = createRateLimit({ windowMs: 60_000, max: 60 });

  app.get('/api/v2/sync/pull', syncLimiter, wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: sync.pull(
          String(req.query.since ?? new Date(0).toISOString()),
          String(req.query.deviceId ?? 'desktop'),
          String(req.query.deviceToken ?? ''),
          req.context!,
        ),
      });
  }));

  app.post('/api/v2/sync/devices', syncLimiter, wrapAsync(async (req, res) => {
      res.status(201).json({
        success: true,
        data: sync.registerDevice(
          String(req.body?.deviceId ?? ''),
          String(req.body?.name ?? 'desktop'),
          req.context!,
        ),
      });
  }));

  app.post('/api/v2/sync/push', syncLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: await sync.push(req.body, req.context!) });
  }));

  app.post('/api/v2/sync/cleanup', syncLimiter, wrapAsync(async (req, res) => {
      const before = typeof req.body?.before === 'string' ? req.body.before : undefined;
      res.json({ success: true, data: sync.cleanup(before, req.context!) });
  }));

  app.get('/api/v2/hr/attendance', wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: hr.attendance(typeof req.query.workDate === 'string' ? req.query.workDate : undefined, req.context!),
      });
  }));

  app.patch('/api/v2/hr/leaves/:id/approve', wrapAsync(async (req, res) => {
      const approved = req.body?.approved !== false;
      res.json({ success: true, data: hr.approveLeave(String(req.params.id), req.context!.userId, approved, req.context!) });
  }));

  app.get('/api/v2/system/business-alerts', wrapAsync(async (req, res) => {
      res.json({ success: true, data: alerts.open(req.context!) });
  }));

  app.patch('/api/v2/system/business-alerts/:id/status', wrapAsync(async (req, res) => {
      const status = String(req.body?.status ?? 'ACKNOWLEDGED') as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
      res.json({ success: true, data: alerts.setStatus(String(req.params.id), status, req.context!.userId, req.context!) });
  }));

  app.post('/api/v2/system/audit/cleanup', wrapAsync(async (req, res) => {
      const retentionDays = Number(req.body?.retentionDays ?? 365);
      if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650) {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'retentionDays must be between 30 and 3650' });
        return;
      }
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const deleted = audit.cleanup(cutoff);
      res.json({ success: true, data: { deleted, retentionDays } });
  }));

  app.get('/api/v2/backups', backupLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: backups.list() });
  }));

  app.post('/api/v2/backups', backupLimiter, wrapAsync(async (req, res) => {
      res.status(201).json({ success: true, data: await backups.create() });
  }));

  app.post('/api/v2/backups/cleanup', backupLimiter, wrapAsync(async (req, res) => {
      const maxKeep = Number(req.body?.maxKeep ?? 30);
      if (!Number.isFinite(maxKeep) || maxKeep < 1 || maxKeep > 365) {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'maxKeep must be between 1 and 365' });
        return;
      }
      res.json({ success: true, data: backups.cleanup(maxKeep) });
  }));

  app.post('/api/v2/backups/:filename/restore', backupLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: await backups.stageRestore(String(req.params.filename)) });
  }));

  app.get('/api/v2/backups/:filename/verify', backupLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: await backups.verify(String(req.params.filename)) });
  }));

  app.use('/api/v2/resources', createRateLimit({ windowMs: 60_000, max: 300 }), createResourceRouter(db));
}
