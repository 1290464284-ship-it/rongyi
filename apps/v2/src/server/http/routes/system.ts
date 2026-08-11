import type { Express } from 'express';
import { createResourceRouter } from '../router';
import { wrapAsync } from '../middleware';
import { parsePagination } from '../pagination';
import { createRateLimit } from '../rate-limit';
import { ValidationError } from '../../infrastructure/errors';
import type { RouteDependencies } from './deps';

export function registerSystemRoutes(app: Express, deps: RouteDependencies): void {
  const { alerts, audit, backups, db, hr, sync } = deps;
  const syncLimiter = createRateLimit({ windowMs: 60_000, max: 120 }, deps.rateLimitStore);
  const backupLimiter = createRateLimit({ windowMs: 60_000, max: 60 }, deps.rateLimitStore);

  app.get('/api/v2/sync/pull', syncLimiter, wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: sync.pull(
          String(req.query.since ?? new Date(0).toISOString()),
          String(req.query.deviceId ?? 'desktop'),
          // S-L3：设备令牌优先从 X-Device-Token 头读取（避免 token 出现在 URL
          // query string 而泄漏进访问日志/历史记录）；query 参数仅作旧客户端兼容回退。
          String(req.header('x-device-token') ?? req.query.deviceToken ?? ''),
          req.context!,
        ),
      });
  }));

  app.get('/api/v2/sync/full', syncLimiter, wrapAsync(async (req, res) => {
      const table = typeof req.query.table === 'string' && req.query.table !== '' ? req.query.table : undefined;
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined;
      const data = sync.fullSnapshot(req.context!, { table, limit, offset });
      deps.logger.info('sync full snapshot', {
        action: 'sync-full-snapshot',
        clinicId: req.context!.clinicId,
        table,
        offset: data.offset,
        limit: data.limit,
        total: data.total,
        rows: data.rows?.length,
      });
      res.json({ success: true, data });
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
      const payload = { ...(req.body ?? {}) };
      // S-L3：设备令牌优先从 X-Device-Token 头读取；body 字段仅作旧客户端兼容回退。
      if (!payload.deviceToken && req.header('x-device-token')) {
        payload.deviceToken = req.header('x-device-token');
      }
      res.json({ success: true, data: await sync.push(payload, req.context!) });
  }));

  app.post('/api/v2/sync/cleanup', syncLimiter, wrapAsync(async (req, res) => {
      const before = typeof req.body?.before === 'string' ? req.body.before : undefined;
      res.json({ success: true, data: sync.cleanup(before, req.context!) });
  }));

  app.get('/api/v2/sync/conflicts', syncLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: sync.listConflicts(req.context!) });
  }));

  app.post('/api/v2/sync/conflicts/:id/resolve', syncLimiter, wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: await sync.resolveConflict(
          String(req.params.id),
          String(req.body?.resolution ?? ''),
          req.context!,
        ),
      });
  }));

  app.get('/api/v2/hr/attendance', wrapAsync(async (req, res) => {
      const { page, pageSize } = parsePagination(req, { defaultPageSize: 200 });
      res.json({
        success: true,
        data: hr.attendance(
          typeof req.query.workDate === 'string' ? req.query.workDate : undefined,
          req.context!,
          { page, pageSize },
        ),
      });
  }));

  app.patch('/api/v2/hr/leaves/:id/approve', wrapAsync(async (req, res) => {
      const approved = req.body?.approved !== false;
      res.json({ success: true, data: hr.approveLeave(String(req.params.id), req.context!.userId, approved, req.context!) });
  }));

  app.get('/api/v2/system/business-alerts', wrapAsync(async (req, res) => {
      const { page, pageSize } = parsePagination(req, { defaultPageSize: 100 });
      res.json({ success: true, data: alerts.open(req.context!, { page, pageSize }) });
  }));

  app.patch('/api/v2/system/business-alerts/:id/status', wrapAsync(async (req, res) => {
      const status = String(req.body?.status ?? 'ACKNOWLEDGED') as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
      res.json({ success: true, data: alerts.setStatus(String(req.params.id), status, req.context!.userId, req.context!) });
  }));

  app.post('/api/v2/system/audit/cleanup', wrapAsync(async (req, res) => {
      const retentionDays = Number(req.body?.retentionDays ?? 365);
      if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650) {
        throw new ValidationError('retentionDays must be between 30 and 3650');
      }
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const deleted = audit.cleanup(cutoff);
      res.json({ success: true, data: { deleted, retentionDays } });
  }));

  app.get('/api/v2/backups', backupLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: backups.list(req.context!.clinicId) });
  }));

  app.post('/api/v2/backups', backupLimiter, wrapAsync(async (req, res) => {
      res.status(201).json({ success: true, data: await backups.create({ clinicId: req.context!.clinicId }) });
  }));

  app.post('/api/v2/backups/cleanup', backupLimiter, wrapAsync(async (req, res) => {
      const maxKeep = Number(req.body?.maxKeep ?? 30);
      if (!Number.isFinite(maxKeep) || maxKeep < 1 || maxKeep > 365) {
        throw new ValidationError('maxKeep must be between 1 and 365');
      }
      res.json({ success: true, data: backups.cleanup(maxKeep, req.context!.clinicId) });
  }));

  app.post('/api/v2/backups/:filename/restore', backupLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: await backups.stageRestore(String(req.params.filename), req.context!.clinicId) });
  }));

  app.get('/api/v2/backups/:filename/verify', backupLimiter, wrapAsync(async (req, res) => {
      res.json({ success: true, data: await backups.verify(String(req.params.filename), req.context!.clinicId) });
  }));

  app.use('/api/v2/resources', createRateLimit({ windowMs: 60_000, max: 300 }, deps.rateLimitStore), createResourceRouter(db));
}
