import 'reflect-metadata';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';
import { DbModule } from './db/db.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { ClinicalModule } from './modules/clinical/clinical.module';
import { SystemModule } from './modules/system/system.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { FinancialModule } from './modules/financial/financial.module';
import { ContentModule } from './modules/content/content.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RolesGuard } from './common/guards/roles.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor';
import { ClinicContextInterceptor } from './common/interceptors/clinic-context.interceptor';
import { GlobalOperationLogInterceptor } from './modules/system/operation-logs/global-operation-log.interceptor';

interface ClassProvider {
  provide: unknown;
  useClass: unknown;
}

function isClassProvider(p: unknown): p is ClassProvider {
  return (
    typeof p === 'object' &&
    p !== null &&
    'provide' in p &&
    'useClass' in p
  );
}

describe('AppModule 全局接线', () => {
  const moduleImports = Reflect.getMetadata('imports', AppModule) as unknown[];
  const moduleProviders = Reflect.getMetadata('providers', AppModule) as unknown[];

  describe('领域模块注册', () => {
    const expectedDomainModules = [
      DbModule,
      AuthModule,
      PatientsModule,
      SchedulingModule,
      ClinicalModule,
      SystemModule,
      EquipmentModule,
      InventoryModule,
      FinancialModule,
      ContentModule,
      CommunicationModule,
      NotificationsModule,
    ];

    it('应注册全部 12 个领域模块', () => {
      expect(expectedDomainModules).toHaveLength(12);
      expectedDomainModules.forEach((mod) => {
        expect(moduleImports).toContain(mod);
      });
    });
  });

  describe('全局守卫注册（APP_GUARD）', () => {
    const guardProviders = moduleProviders
      .filter(isClassProvider)
      .filter((p) => p.provide === APP_GUARD);

    it('应注册恰好 3 个 APP_GUARD 守卫', () => {
      expect(guardProviders).toHaveLength(3);
    });

    it('应注册 JwtAuthGuard', () => {
      expect(guardProviders.some((g) => g.useClass === JwtAuthGuard)).toBe(true);
    });

    it('应注册 RolesGuard', () => {
      expect(guardProviders.some((g) => g.useClass === RolesGuard)).toBe(true);
    });

    it('应注册 RateLimitGuard', () => {
      expect(guardProviders.some((g) => g.useClass === RateLimitGuard)).toBe(true);
    });
  });

  describe('全局拦截器注册（APP_INTERCEPTOR）', () => {
    const interceptorProviders = moduleProviders
      .filter(isClassProvider)
      .filter((p) => p.provide === APP_INTERCEPTOR);

    it('应注册恰好 3 个 APP_INTERCEPTOR 拦截器', () => {
      expect(interceptorProviders).toHaveLength(3);
    });

    it('应注册 TraceIdInterceptor', () => {
      expect(interceptorProviders.some((i) => i.useClass === TraceIdInterceptor)).toBe(true);
    });

    it('应注册 ClinicContextInterceptor', () => {
      expect(interceptorProviders.some((i) => i.useClass === ClinicContextInterceptor)).toBe(true);
    });

    it('应注册 GlobalOperationLogInterceptor', () => {
      expect(interceptorProviders.some((i) => i.useClass === GlobalOperationLogInterceptor)).toBe(true);
    });
  });

  describe('速率限制中间件配置', () => {
    let applyMock: jest.Mock;
    let excludeMock: jest.Mock;
    let forRoutesMock: jest.Mock;
    let consumer: MiddlewareConsumer;

    beforeEach(() => {
      forRoutesMock = jest.fn();
      excludeMock = jest.fn().mockReturnValue({ forRoutes: forRoutesMock });
      applyMock = jest.fn().mockReturnValue({ exclude: excludeMock });
      consumer = { apply: applyMock } as unknown as MiddlewareConsumer;
    });

    it('应应用 RateLimitMiddleware', () => {
      const appModule = new AppModule();
      appModule.configure(consumer);
      expect(applyMock).toHaveBeenCalledWith(RateLimitMiddleware);
    });

    it('应排除 health 和 api/health 的 GET 请求', () => {
      const appModule = new AppModule();
      appModule.configure(consumer);
      expect(excludeMock).toHaveBeenCalledWith(
        { path: 'health', method: RequestMethod.GET },
        { path: 'api/health', method: RequestMethod.GET },
      );
    });

    it('应对所有路由（"*"）应用中间件', () => {
      const appModule = new AppModule();
      appModule.configure(consumer);
      expect(forRoutesMock).toHaveBeenCalledWith('*');
    });
  });
});
