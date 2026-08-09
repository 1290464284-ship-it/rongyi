import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { UserPermissionService } from '../../application/service-modules/permissions';
import type { RouteDependencies } from './deps';

export function registerUserPermissionRoutes(
  app: Express,
  deps: RouteDependencies,
): void {
  const service = new UserPermissionService(deps.db);

  app.get('/api/v2/user-permissions/:userId', wrapAsync((req, res) => {
    res.json({
      success: true,
      data: service.listForUser(String(req.params.userId), req.context!),
    });
  }));

  app.put('/api/v2/user-permissions/:userId', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const permissions = Array.isArray(body.permissions) ? (body.permissions as unknown[]) : [];
    res.json({
      success: true,
      data: service.setPermissions(
        String(req.params.userId),
        permissions as Array<{ permission: string; allowed: boolean }>,
        req.context!,
      ),
    });
  }));
}
