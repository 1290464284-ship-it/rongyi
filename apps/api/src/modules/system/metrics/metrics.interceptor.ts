import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

interface RequestWithRoute extends Request {
  route: { path?: string };
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithRoute>();
    const method = request.method;
    const path = request.route?.path || request.originalUrl || request.url;

    const startTime = process.hrtime.bigint();

    this.metricsService.incrementActiveRequests();

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(context, method, path, startTime);
        },
        error: () => {
          this.recordMetrics(context, method, path, startTime);
        },
      }),
    );
  }

  private recordMetrics(context: ExecutionContext, method: string, path: string, startTime: bigint) {
    const response = context.switchToHttp().getResponse<Response>();
    const statusCode = response.statusCode;

    const durationNs = process.hrtime.bigint() - startTime;
    const durationMs = Number(durationNs) / 1e6;

    this.metricsService.incrementRequest(method, path, statusCode);
    this.metricsService.observeRequestDuration(method, path, durationMs);
    this.metricsService.decrementActiveRequests();
  }
}
