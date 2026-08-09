import type { Express } from 'express';

import { wrapAsync } from '../middleware';
import { RoleModulePermissionService } from '../../application/service-modules/permissions';
import type { RouteDependencies } from './deps';

export function registerRolePermissionRoutes(
  app: Express,
  deps: RouteDependencies,
): void {
  const service = new RoleModulePermissionService(deps.db);

  app.get('/api/v2/role-permissions/:role', wrapAsync((req, res) => {
    res.json({
      success: true,
      data: service.listForRole(String(req.params.role), req.context!),
    });
  }));

  app.put('/api/v2/role-permissions/:role', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const permissions = Array.isArray(body.permissions) ? (body.permissions as unknown[]) : [];
    res.json({
      success: true,
      data: service.setForRole(
        String(req.params.role),
        permissions as Array<{ resource: string; allowed: boolean }>,
        req.context!,
      ),
    });
  }));
}
