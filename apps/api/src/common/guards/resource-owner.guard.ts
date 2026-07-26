import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RESOURCE_OWNER_KEY, ResourceOwnerConfig } from '../decorators/resource-owner.decorator';
import { Role } from '@dental/shared';
import { DbService } from '../../db/db.service';
import { validateColumnName, validateTableName } from '../utils/db/validate-name';

interface RequestUser {
  id: string;
  role: Role;
}

@Injectable()
export class ResourceOwnerGuard implements CanActivate {
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

    if (user.role !== Role.DOCTOR) {
      return true;
    }

    const idParam = config.idParam || 'id';
    const resourceId = request.params[idParam];

    if (!resourceId) {
      return true;
    }

    const resource = this.dbService
      .prepare(`SELECT ${ownerField} FROM ${config.resourceType} WHERE id = ? AND deletedAt IS NULL`)
      .get(resourceId) as Record<string, unknown> | undefined;

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
