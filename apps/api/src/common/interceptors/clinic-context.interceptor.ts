import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ClinicContextService } from '../services/clinic-context.service';
import { setClinicId } from '../utils/context/async-context';

interface RequestUser {
  clinicId?: string;
  id?: string;
  role?: string;
}

/**
 * P3: 多诊所扩展 — 诊所上下文拦截器
 * 在每个请求开始时，从 request.user 中提取 clinicId 并设置到 AsyncLocalStorage。
 * 必须在 TraceIdInterceptor 之后、modules/system/operation-logs 的 GlobalOperationLogInterceptor 之前执行。
 *
 * 对于 @Public() 路由（如 login），request.user 不存在，clinicId 为 null。
 */
@Injectable()
export class ClinicContextInterceptor implements NestInterceptor {
  constructor(private clinicContext: ClinicContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: RequestUser; headers: Record<string, string | string[] | undefined> }>();
    const user = request.user;

    const clinicId = user?.clinicId ?? null;
    const userId = user?.id ?? null;
    const role = user?.role ?? null;
    const userAgent = (request.headers['user-agent'] as string) ?? null;
    const source = userAgent?.includes('Electron') ? 'electron' : 'web';

    if (clinicId) {
      setClinicId(clinicId);
    }

    return new Observable<unknown>((subscriber) => {
      this.clinicContext.run({ clinicId, userId, role, userAgent, source }, () => {
        next.handle().subscribe({
          next: (val) => subscriber.next(val),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
