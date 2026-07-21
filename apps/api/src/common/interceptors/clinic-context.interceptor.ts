import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ClinicContextService } from '../services/clinic-context.service';

/**
 * P3: 多诊所扩展 — 诊所上下文拦截器
 * 在每个请求开始时，从 request.user 中提取 clinicId 并设置到 AsyncLocalStorage。
 * 必须在 TraceIdInterceptor 之后、GlobalOperationLogInterceptor 之前执行。
 *
 * 对于 @Public() 路由（如 login），request.user 不存在，clinicId 为 null。
 */
@Injectable()
export class ClinicContextInterceptor implements NestInterceptor {
  constructor(private clinicContext: ClinicContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const clinicId = user?.clinicId ?? null;
    const userId = user?.id ?? null;
    const role = user?.role ?? null;

    return new Observable<unknown>((subscriber) => {
      this.clinicContext.run({ clinicId, userId, role }, () => {
        next.handle().subscribe({
          next: (val) => subscriber.next(val),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
