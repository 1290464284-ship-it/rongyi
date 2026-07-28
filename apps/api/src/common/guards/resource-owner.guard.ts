import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RESOURCE_OWNER_KEY, ResourceOwnerConfig } from '../decorators/resource-owner.decorator';
import { Role } from '@dental/shared';
import { DbService } from '../../db/db.service';
import { validateColumnName, validateTableName } from '../utils/db/validate-name';

interface RequestUser {
  id: string;
  role: Role;
  clinicId?: string;
}

@Injectable()
export class ResourceOwnerGuard implements CanActivate {
  private readonly logger = new Logger(ResourceOwnerGuard.name);

  constructor(
    private reflector: Reflector,
    private dbService: DbService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.getAllAndOverride<ResourceOwnerConfig>(RESOURCE_OWNER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!config) {
      return true;
    }

    const ownerField = config.ownerField || 'doctorId';
    if (!validateColumnName(ownerField)) {
      throw new ForbiddenException('无效的资源所有者字段');
    }
    if (!validateTableName(config.resourceType)) {
      throw new ForbiddenException('无效的资源类型');
    }

    const request = context.switchToHttp().getRequest<{ user?: RequestUser; params: Record<string, string> }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('未登录');
    }

    if (user.role === Role.BOSS || user.role === Role.RECEPTIONIST) {
      return true;
    }

    // P1 安全修复：fail-closed —— 未知角色默认拒绝，而非放行
    // 原先未知角色 return true 会导致权限绕过
    if (user.role !== Role.DOCTOR) {
      this.logger.warn(`未知角色 ${user.role} 尝试访问资源 ${config.resourceType}/${request.params[config.idParam || 'id']}，已拒绝`);
      throw new ForbiddenException('无权访问该资源');
    }

    const idParam = config.idParam || 'id';
    const resourceId = request.params[idParam];

    if (!resourceId) {
      return true;
    }

    let sql = `SELECT ${ownerField} FROM ${config.resourceType} WHERE id = ? AND deletedAt IS NULL`;
    const params: unknown[] = [resourceId];

    if (user.clinicId) {
      sql += ' AND clinicId = ?';
      params.push(user.clinicId);
    }

    const resource = this.dbService
      .prepare(sql)
      .get(...params) as Record<string, unknown> | undefined;

    if (!resource) {
      return true;
    }

    const ownerId = resource[ownerField];

    if (ownerId && ownerId !== user.id) {
      throw new ForbiddenException('无权访问该资源');
    }

    return true;
  }
}
