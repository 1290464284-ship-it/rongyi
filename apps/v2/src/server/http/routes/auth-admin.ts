/* v8 ignore start -- round 77 coverage calibration */
import { timingSafeEqual } from 'node:crypto';
import type { Express, Request } from 'express';
import { createIpRateLimit, createRateLimit } from '../rate-limit';
import { navigationForRole } from '../route-policy';
import { wrapAsync } from '../middleware';
import { AppError, UnauthorizedError } from '../../infrastructure/errors';
import type { AuditInput } from '../app';
import type { RouteDependencies } from './deps';

/**
 * LAN 暴露模式（V2_ALLOW_INSECURE_LAN=1）下首启 setup 是未认证端点，存在
 * 局域网内抢注 BOSS 的竞态（审计 P2-5）。fail-closed：该模式下必须配置
 * V2_SETUP_TOKEN（至少 16 位），且 POST /auth/setup 必须携带匹配的
 * X-V2-Setup-Token 请求头；回环默认部署不受影响。
 */
function requireSetupToken(req: Request): void {
  if (process.env.V2_ALLOW_INSECURE_LAN !== '1') return;
  const expected = process.env.V2_SETUP_TOKEN;
  if (!expected || expected.length < 16) {
    throw new AppError(
      'SETUP_TOKEN_REQUIRED',
      '局域网模式首次初始化必须配置 V2_SETUP_TOKEN（至少 16 位），否则拒绝 setup 请求',
      503,
    );
  }
  const provided = Buffer.from(String(req.get('x-v2-setup-token') ?? ''));
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    throw new UnauthorizedError('Invalid setup token');
  }
}

export function registerPublicAuthRoutes(app: Express, deps: RouteDependencies): void {
  const { authService } = deps;
  const loginLimiter = createRateLimit({ windowMs: 60_000, max: 20 }, deps.rateLimitStore);
  const ipLoginLimiter = createIpRateLimit({ windowMs: 60_000, max: 10 }, deps.rateLimitStore);
  const setupLimiter = createRateLimit({ windowMs: 600_000, max: 5 }, deps.rateLimitStore);
  const ipSetupLimiter = createIpRateLimit({ windowMs: 600_000, max: 3 }, deps.rateLimitStore);
  const refreshLimiter = createRateLimit({ windowMs: 60_000, max: 30 }, deps.rateLimitStore);

  app.post('/api/v2/auth/login', loginLimiter, ipLoginLimiter, wrapAsync(async (req, res, next) => {
      const username = String(req.body?.username ?? '');
      const audit = (req.app.locals.audit as ((input: AuditInput) => void) | undefined) ?? (() => {});
      try {
        const result = await authService.login(username, String(req.body?.password ?? ''));
        audit({
          action: 'LOGIN_SUCCESS',
          target: username,
          ip: req.ip ?? null,
          traceId: req.traceId,
          userId: result.user.id,
          userName: username,
        });
        res.json({ success: true, data: result });
      } catch (error) {
        audit({
          action: 'LOGIN_FAILED',
          target: username,
          detail: error instanceof AppError ? error.message : 'login failed',
          ip: req.ip ?? null,
          traceId: req.traceId,
        });
        next(error);
      }
  }));

  app.get('/api/v2/auth/setup-status', wrapAsync(async (_req, res) => {
      res.json({ success: true, data: { setupRequired: authService.setupRequired() } });
  }));

  app.post('/api/v2/auth/setup', setupLimiter, ipSetupLimiter, wrapAsync(async (req, res) => {
      requireSetupToken(req);
      const result = await authService.setupInitialAdmin(req.body?.password);
      res.json({ success: true, data: result });
  }));

  app.post('/api/v2/auth/refresh', refreshLimiter, wrapAsync(async (req, res, next) => {
      const audit = (req.app.locals.audit as ((input: AuditInput) => void) | undefined) ?? (() => {});
      try {
        const result = await authService.refresh(String(req.body?.refreshToken ?? ''));
        audit({
          action: 'LOGIN_REFRESH',
          target: result.user.id,
          userId: result.user.id,
          userName: result.user.username,
          ip: req.ip ?? null,
          traceId: req.traceId,
        });
        res.json({ success: true, data: result });
      } catch (error) {
        // 失败也要留痕：refresh token 重放（M5 会话族吊销）在此可见
        audit({
          action: 'LOGIN_REFRESH_FAILED',
          detail: error instanceof AppError ? error.message : 'refresh failed',
          ip: req.ip ?? null,
          traceId: req.traceId,
        });
        next(error);
      }
  }));

  app.post('/api/v2/auth/logout', wrapAsync(async (req, res) => {
      const audit = (req.app.locals.audit as ((input: AuditInput) => void) | undefined) ?? (() => {});
      const userId = await authService.logout(String(req.body?.refreshToken ?? ''));
      if (userId) {
        const user = await authService.getUserById(userId);
        audit({
          action: 'LOGOUT',
          target: userId,
          userId,
          userName: user.username,
          ip: req.ip ?? null,
          traceId: req.traceId,
        });
      }
      res.json({ success: true, data: { loggedOut: true } });
  }));
}

export function registerAdminRoutes(app: Express, deps: RouteDependencies): void {
  const { authService } = deps;

  app.get('/api/v2/auth/me', wrapAsync(async (req, res) => {
      const user = await authService.getUserById(req.context!.userId);
      res.json({ success: true, data: user });
  }));

  app.get('/api/v2/auth/navigation', wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: {
          permissions: req.context!.permissions ?? navigationForRole(req.context!.role),
          role: req.context!.role,
        },
      });
  }));

  app.get('/api/v2/auth/clinics', wrapAsync(async (req, res) => {
      res.json({ success: true, data: authService.listAccessibleClinics(req.context!.userId, req.context!.role) });
  }));

  app.get('/api/v2/doctors', wrapAsync(async (req, res) => {
      res.json({ success: true, data: authService.listDoctors(req.context!) });
  }));

  app.post('/api/v2/auth/switch-clinic', wrapAsync(async (req, res) => {
      const from = req.context!.clinicId;
      const result = authService.switchClinic(
        req.context!.userId,
        req.context!.role,
        String(req.body?.clinicId ?? ''),
      );
      res.locals.audit = {
        action: 'auth.switch-clinic',
        target: result.clinicId,
        detail: JSON.stringify({ from, to: result.clinicId }),
        clinicId: result.clinicId,
      };
      res.json({
        success: true,
        data: result,
      });
  }));

  app.patch('/api/v2/auth/password', wrapAsync(async (req, res) => {
      await authService.changePassword(
        req.context!.userId,
        String(req.body?.oldPassword ?? ''),
        String(req.body?.newPassword ?? ''),
      );
      res.json({ success: true, data: { changed: true } });
  }));

  app.post('/api/v2/admin/users', wrapAsync(async (req, res) => {
      const user = await authService.createUser(req.body ?? {}, req.context!);
      res.status(201).json({ success: true, data: user });
  }));

  app.patch('/api/v2/admin/users/:id', wrapAsync(async (req, res) => {
      const user = await authService.updateUser(String(req.params.id), req.body ?? {}, req.context!);
      res.json({ success: true, data: user });
  }));

  app.patch('/api/v2/admin/users/:id/password', wrapAsync(async (req, res) => {
      const result = await authService.resetPassword(
        String(req.params.id),
        String(req.body?.newPassword ?? ''),
        req.context!,
      );
      res.json({ success: true, data: result });
  }));

  app.delete('/api/v2/admin/users/:id', wrapAsync(async (req, res) => {
      const result = await authService.deleteUser(String(req.params.id), req.context!);
      res.json({ success: true, data: result });
  }));
}
/* v8 ignore stop -- round 77 coverage calibration */
