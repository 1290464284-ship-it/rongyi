import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { runWithContext, generateTraceId, RequestContext } from '../utils/context/async-context';
import { AppLogger } from '../services/logger.service';
import { TRACE_ID_HEADER } from '../middleware/trace.middleware';
import { SLOW_REQUEST_THRESHOLD_MS } from '../../config/constants';
import { Request, Response } from 'express';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestUser {
  id?: string;
  userId?: string;
}

/**
 * Interceptor that injects a traceId into the AsyncLocalStorage context.
 *
 * The traceId is:
 * 1. Extracted from X-Request-Id header if present (for distributed tracing)
 * 2. Generated as a new UUID if not present
 * 3. Available throughout the request lifecycle via getTraceId()
 * 4. Automatically included in all log entries
 */
@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  private readonly logger = new AppLogger(TraceIdInterceptor.name);
  private readonly slowThreshold = Number(process.env.SLOW_REQUEST_THRESHOLD_MS) || SLOW_REQUEST_THRESHOLD_MS;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const response = context.switchToHttp().getResponse<Response>();

    const rawTraceId = request.headers['x-request-id'] as string | undefined;
    const traceId = rawTraceId && UUID_RE.test(rawTraceId) ? rawTraceId : generateTraceId();

    // Extract user info if authenticated
    const user = request.user;
    const userId = user?.id || user?.userId;

    // Build request context
    const requestContext: RequestContext = {
      traceId,
      userId,
      requestStart: new Date().toISOString(),
    };

    response.setHeader(TRACE_ID_HEADER, traceId);

    const startTime = Date.now();

    // Run within context and log request duration
    return runWithContext(requestContext, () => {
      return next.handle().pipe(
        tap({
          next: () => {
            const duration = Date.now() - startTime;
            if (duration >= this.slowThreshold) {
              this.logger.warn(
                `慢请求告警: ${request.method} ${request.url} 耗时 ${duration}ms (阈值 ${this.slowThreshold}ms)`,
              );
            }
            this.logger.logRequest(
              traceId,
              request.method,
              request.url,
              response.statusCode,
              duration,
            );
          },
          error: (error: Error) => {
            this.logger.logError(
              traceId,
              `${request.method} ${request.url} failed: ${error.message}`,
              error,
            );
          },
        }),
      );
    });
  }
}