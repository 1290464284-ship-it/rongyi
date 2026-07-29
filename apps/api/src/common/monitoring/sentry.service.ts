import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Scope, SeverityLevel } from '@sentry/node';
import { ClinicContextService } from '../services/clinic-context.service';
import { isSensitiveField } from '../utils/security/sensitive-fields';

export type SentrySeverityLevel = SeverityLevel;

@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private initialized = false;

  constructor(private clinicContext: ClinicContextService) {}

  init(dsn: string, environment: string, release?: string): void {
    if (this.initialized) {
      return;
    }

    if (!dsn) {
      this.logger.log('Sentry DSN 未配置，错误监控已禁用');
      return;
    }

    try {
      Sentry.init({
        dsn,
        environment,
        release,
        tracesSampleRate: 0.1,
        beforeSend: (event) => {
          this.sanitizeEvent(event);
          return event;
        },
      });
      this.initialized = true;
      this.logger.log(`Sentry 错误监控已启用 (env: ${environment})`);
    } catch (err: unknown) {
      this.logger.error(`Sentry 初始化失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  isEnabled(): boolean {
    return this.initialized;
  }

  captureException(error: unknown, context?: Record<string, unknown>): string | undefined {
    if (!this.initialized) return undefined;

    try {
      return Sentry.captureException(error, (scope) => {
        this.populateScopeWithContext(scope);
        if (context) {
          Object.entries(context).forEach(([key, value]) => {
            scope.setExtra(key, value);
          });
        }
        return scope;
      });
    } catch (err: unknown) {
      this.logger.warn(`Sentry captureException 失败: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  captureMessage(message: string, level: SentrySeverityLevel = 'info', context?: Record<string, unknown>): string | undefined {
    if (!this.initialized) return undefined;

    try {
      return Sentry.captureMessage(message, context ? { level, extra: context } : { level });
    } catch (err: unknown) {
      this.logger.warn(`Sentry captureMessage 失败: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  setTag(key: string, value: string): void {
    if (!this.initialized) return;
    Sentry.setTag(key, value);
  }

  withScope(callback: (scope: Scope) => void): void {
    if (!this.initialized) return;
    Sentry.withScope((scope) => {
      callback(scope);
      return scope;
    });
  }

  private populateScopeWithContext(scope: Scope): void {
    const clinicId = this.clinicContext.getClinicId();
    const userId = this.clinicContext.getUserId();
    const role = this.clinicContext.getRole();
    const source = this.clinicContext.getSource();

    if (clinicId) {
      scope.setTag('clinicId', clinicId);
      scope.setExtra('clinicId', clinicId);
    }
    if (userId) {
      scope.setUser({ id: userId });
      scope.setTag('userId', userId);
    }
    if (role) {
      scope.setTag('role', role);
    }
    if (source) {
      scope.setTag('source', source);
    }
  }

  private sanitizeEvent(event: Sentry.Event): Sentry.Event {
    if (event.request?.headers) {
      const headers = event.request.headers as Record<string, unknown>;
      event.request.headers = sanitizeObject(headers) as Record<string, string>;
    }
    if (event.request?.data) {
      event.request.data = sanitizeValue(event.request.data);
    }
    if (event.extra) {
      event.extra = sanitizeObject(event.extra);
    }
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
        ...crumb,
        data: crumb.data ? sanitizeValue(crumb.data) : undefined,
      })) as typeof event.breadcrumbs;
    }
    return event;
  }
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveField(key)) {
      result[key] = '[Filtered]';
    } else {
      result[key] = sanitizeValue(value);
    }
  }
  return result;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return String(value);
}
