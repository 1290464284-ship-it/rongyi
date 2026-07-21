import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface ClinicContextData {
  clinicId: string | null;
  userId: string | null;
  role: string | null;
}

/**
 * P3: 多诊所扩展 — 诊所上下文服务
 * 使用 AsyncLocalStorage 在整个请求生命周期中传递 clinicId，
 * 避免在每个 service 方法中显式传递 clinicId 参数。
 *
 * 用法：
 * 1. ClinicContextInterceptor 在请求开始时调用 run() 设置上下文
 * 2. BaseService 等通过 getClinicId() 获取当前诊所 ID
 * 3. 请求结束后上下文自动清理
 *
 * 使用单例模式而非依赖注入，避免修改所有 BaseService 子类构造函数。
 */
@Injectable()
export class ClinicContextService {
  private static instance: ClinicContextService;
  private readonly storage = new AsyncLocalStorage<ClinicContextData>();

  constructor() {
    ClinicContextService.instance = this;
  }

  /**
   * 获取全局单例（供 BaseService 等非 DI 场景使用）
   */
  static getInstance(): ClinicContextService {
    return ClinicContextService.instance;
  }

  /**
   * 在诊所上下文中执行函数
   */
  run<T>(context: ClinicContextData, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * 获取当前诊所 ID
   */
  getClinicId(): string | null {
    return this.storage.getStore()?.clinicId ?? null;
  }

  /**
   * 获取当前用户 ID
   */
  getUserId(): string | null {
    return this.storage.getStore()?.userId ?? null;
  }

  /**
   * 获取当前用户角色
   */
  getRole(): string | null {
    return this.storage.getStore()?.role ?? null;
  }

  /**
   * 是否已设置诊所上下文
   */
  isInitialized(): boolean {
    return this.storage.getStore() !== undefined;
  }
}

/**
 * 便捷函数：获取当前诊所 ID（从单例获取）
 */
export function getCurrentClinicId(): string | null {
  return ClinicContextService.getInstance()?.getClinicId() ?? null;
}
