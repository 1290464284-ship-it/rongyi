import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ClinicContextData {
  clinicId: string | null;
  userId: string | null;
  role: string | null;
  userAgent: string | null;
  source: string | null;
}

/**
 * P2 修复：诊所上下文服务。
 *
 * - 移除了 static instance 和全局 getCurrentClinicId()，通过 DI 注入使用。
 * - 保持单例作用域（非 request-scoped），因为 AsyncLocalStorage 天然提供
 *   每请求/每异步上下文的隔离。
 * - 注意：不能注入 @Inject(REQUEST)，因为 NestJS 会将注入 REQUEST 的 provider
 *   及其所有依赖方自动标记为 request-scoped，导致 28+ 服务全部变为
 *   request-scoped，带来性能开销并使 module.get() 在测试中不可用。
 * - 拦截器（ClinicContextInterceptor）通过 run() 设置上下文；
 *   业务代码通过 getClinicId() 等方法读取。
 */
@Injectable()
export class ClinicContextService {
  private readonly storage = new AsyncLocalStorage<ClinicContextData>();

  /**
   * 在诊所上下文中执行函数。
   */
  run<T>(context: ClinicContextData, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * 获取当前诊所 ID（从 AsyncLocalStorage 读取）。
   */
  getClinicId(): string | null {
    return this.storage.getStore()?.clinicId ?? null;
  }

  /**
   * 获取当前用户 ID。
   */
  getUserId(): string | null {
    return this.storage.getStore()?.userId ?? null;
  }

  /**
   * 获取当前用户角色。
   */
  getRole(): string | null {
    return this.storage.getStore()?.role ?? null;
  }

  /**
   * 获取当前请求的 User-Agent。
   */
  getUserAgent(): string | null {
    return this.storage.getStore()?.userAgent ?? null;
  }

  /**
   * 获取当前请求来源（web/electron）。
   */
  getSource(): string | null {
    return this.storage.getStore()?.source ?? null;
  }

  /**
   * 是否已设置诊所上下文（通过 run() 显式设置过）。
   */
  isInitialized(): boolean {
    return this.storage.getStore() !== undefined;
  }
}
