import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { OperationLogSink, OPERATION_LOG_SINK } from '../../../common/services/operation-log-sink.interface';
import { AppLogger } from '../../../common/services/logger.service';
import { OPERATION_LOG_RESOURCE_KEY } from '../../../common/decorators/operation-log-resource.decorator';
// P2 修复（日志脱敏有三套实现，敏感字段列表不一致）：统一引用共享常量
import { isSensitiveField } from '../../../common/utils/security/sensitive-fields';

interface RequestUser {
  id?: string;
  userId?: string;
  username?: string;
  name?: string;
}

interface RequestRoute {
  path?: string;
}

interface OperationLogRequest {
  method: string;
  route?: RequestRoute;
  url: string;
  user?: RequestUser;
  ip?: string;
  body?: unknown;
}

const ACTION_MAP: Record<string, string> = {
  POST: '创建',
  PATCH: '更新',
  PUT: '更新',
  DELETE: '删除',
};

const SKIP_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/health',
  '/operation-logs/batch',
];

function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (isSensitiveField(key)) {
      result[key] = '***';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeBody(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function extractResourceName(context: ExecutionContext, fallback: string): string {
  const controller = context.getClass();
  const explicitResource = Reflect.getMetadata(OPERATION_LOG_RESOURCE_KEY, controller) as string | undefined;
  if (typeof explicitResource === 'string' && explicitResource.length > 0) {
    return explicitResource;
  }
  const tags = Reflect.getMetadata('swagger/apiTags', controller) as string[] | undefined;
  if (Array.isArray(tags) && tags.length > 0 && typeof tags[0] === 'string') {
    return tags[0];
  }
  return fallback;
}

function extractActionName(context: ExecutionContext, path: string, method: string): string {
  const methodAction = ACTION_MAP[method] || method;
  const pathParts = path.split('/').filter(Boolean);
  const resource = pathParts.length > 0 ? pathParts[0] : 'unknown';
  const resourceName = extractResourceName(context, resource);
  return `${methodAction}${resourceName}`;
}

@Injectable()
export class GlobalOperationLogInterceptor implements NestInterceptor {
  private readonly logger = new AppLogger(GlobalOperationLogInterceptor.name);
  private operationLogSink: OperationLogSink | null = null;

  constructor(private moduleRef: ModuleRef) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<OperationLogRequest>();
    const method = request.method;

    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const path = request.route?.path || request.url;
    if (SKIP_PATHS.some(p => path.includes(p))) {
      return next.handle();
    }

    if (!this.operationLogSink) {
      try {
        this.operationLogSink = this.moduleRef.get<OperationLogSink>(OPERATION_LOG_SINK, { strict: false });
      } catch {
        return next.handle();
      }
    }

    const user = request.user;
    const action = extractActionName(context, path, method);
    const target = path;
    const ip = request.ip;

    let bodySnapshot: string;
    try {
      bodySnapshot = JSON.stringify(sanitizeBody(request.body));
      if (bodySnapshot.length > 2000) {
        bodySnapshot = bodySnapshot.slice(0, 2000) + '...';
      }
    } catch {
      bodySnapshot = '无法序列化';
    }

    return next.handle().pipe(
      tap({
        next: (result) => {
          if (!this.operationLogSink) return;
          const resultInfo = (result as { id?: string })?.id ? ` ID: ${(result as { id?: string }).id}` : '';
          this.operationLogSink.create({
            userId: user?.id || user?.userId,
            userName: user?.username || user?.name || user?.userId || 'unknown',
            action,
            target,
            detail: bodySnapshot + resultInfo,
            ip,
          }).catch((err: unknown) => {
            this.logger.warn('Failed to create operation log', err instanceof Error ? err.message : String(err));
          });
        },
        error: (error) => {
          if (!this.operationLogSink) return;
          this.operationLogSink.create({
            userId: user?.id || user?.userId,
            userName: user?.username || user?.name || user?.userId || 'unknown',
            action: `${action} [失败]`,
            target,
            detail: `错误: ${error instanceof Error ? error.message : String(error)} | 请求: ${bodySnapshot}`,
            ip,
          }).catch((err: unknown) => {
            this.logger.warn('Failed to create operation log for failure', err instanceof Error ? err.message : String(err));
          });
        },
      }),
    );
  }
}
