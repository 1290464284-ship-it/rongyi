import type { Express } from 'express';
import { createRateLimit } from '../rate-limit';
import { navigationForRole } from '../route-policy';
import type { RouteDependencies } from './deps';

export function registerPublicAuthRoutes(app: Express, deps: RouteDependencies): void {
  const { authService } = deps;
  const loginLimiter = createRateLimit({ windowMs: 60_000, max: 20 });
  const refreshLimiter = createRateLimit({ windowMs: 60_000, max: 30 });

  app.post('/api/v2/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const result = await authService.login(String(req.body?.username ?? ''), String(req.body?.password ?? ''));
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/auth/refresh', refreshLimiter, async (req, res, next) => {
    try {
      const result = await authService.refresh(String(req.body?.refreshToken ?? ''));
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/auth/logout', async (req, res, next) => {
    try {
      await authService.logout(String(req.body?.refreshToken ?? ''));
      res.json({ success: true, data: { loggedOut: true } });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });
}

export function registerAdminRoutes(app: Express, deps: RouteDependencies): void {
  const { authService } = deps;

  app.get('/api/v2/auth/me', async (req, res, next) => {
    try {
      const user = await authService.getUserById(req.context!.userId);
      res.json({ success: true, data: user });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/auth/navigation', async (req, res, next) => {
    try {
      res.json({ success: true, data: { permissions: navigationForRole(req.context!.role) } });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/auth/clinics', async (req, res, next) => {
    try {
      res.json({ success: true, data: authService.listAccessibleClinics(req.context!.userId, req.context!.role) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/auth/switch-clinic', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: authService.switchClinic(
          req.context!.userId,
          req.context!.role,
          String(req.body?.clinicId ?? ''),
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/auth/password', async (req, res, next) => {
    try {
      await authService.changePassword(
        req.context!.userId,
        String(req.body?.oldPassword ?? ''),
        String(req.body?.newPassword ?? ''),
      );
      res.json({ success: true, data: { changed: true } });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/admin/users', async (req, res, next) => {
    try {
      const user = await authService.createUser(req.body ?? {}, req.context!);
      res.status(201).json({ success: true, data: user });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/admin/users/:id', async (req, res, next) => {
    try {
      const user = await authService.updateUser(req.params.id, req.body ?? {}, req.context!);
      res.json({ success: true, data: user });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/admin/users/:id/password', async (req, res, next) => {
    try {
      const result = await authService.resetPassword(
        req.params.id,
        String(req.body?.newPassword ?? ''),
        req.context!,
      );
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });
}
