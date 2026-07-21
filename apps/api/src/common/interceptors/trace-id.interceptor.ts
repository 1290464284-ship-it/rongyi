import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, finalize } from 'rxjs/operators';
import { runWithContext, generateTraceId, RequestContext } from '../utils/async-context';
import { AppLogger } from '../services/logger.service';

const logger = new AppLogger('TraceIdInterceptor');

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
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Extract or generate traceId
    const traceId = request.headers['x-request-id'] || generateTraceId();

    // Extract user info if authenticated
    const user = request.user;
    const userId = user?.id || user?.userId;

    // Build request context
    const requestContext: RequestContext = {
      traceId,
      userId,
      requestStart: new Date().toISOString(),
    };

    // Set response header for client correlation
    response.setHeader('X-Trace-Id', traceId);

    const startTime = Date.now();

    // Run within context and log request duration
    return runWithContext(requestContext, () => {
      return next.handle().pipe(
        tap({
          next: () => {
            const duration = Date.now() - startTime;
            logger.logRequest(
              traceId,
              request.method,
              request.url,
              response.statusCode,
              duration,
            );
          },
          error: (error) => {
            const duration = Date.now() - startTime;
            logger.logError(
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