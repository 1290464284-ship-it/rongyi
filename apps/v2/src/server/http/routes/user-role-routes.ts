/**
 * 多岗位（一人多角色）路由。
 *
 * UserRole 表无 id 列，无法走通用资源 CRUD（/api/v2/resources/userRoles），
 * 故提供专用路由；注册与 route-policy 挂载由调用方在 app.ts 集成时完成。
 */
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { wrapAsync } from '../middleware';
import { UserRoleService } from '../../application/service-modules/multi-role';

export function registerUserRoleRoutes(
  app: Express,
  db: Database.Database,
): void {
  const service = new UserRoleService(db);

  app.get('/api/v2/user-roles', wrapAsync((req, res) => {
    res.json({
      success: true,
      data: { items: service.listAll(req.context!) },
    });
  }));

  app.put('/api/v2/user-roles/:userId', wrapAsync((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const roles = Array.isArray(body.roles) ? (body.roles as unknown[]) : [];
    res.json({
      success: true,
      data: {
        roles: service.setRoles(
          String(req.params.userId),
          roles.map((role) => String(role)),
          req.context!,
        ),
      },
    });
  }));
}
