import { Module, NestModule, MiddlewareConsumer, RequestMethod, OnModuleDestroy, Logger } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { CommonModule } from './common/common.module';
import { CacheModule } from './common/services/cache.module';
import { getEnvPath } from './db/database';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { ClinicalModule } from './modules/clinical/clinical.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { FinancialModule } from './modules/financial/financial.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ContentModule } from './modules/content/content.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { SystemModule } from './modules/system/system.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RolesGuard } from './common/guards/roles.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { GlobalOperationLogInterceptor } from './modules/system/operation-logs/global-operation-log.interceptor';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor';
import { ClinicContextInterceptor } from './common/interceptors/clinic-context.interceptor';
import { shutdownLogger } from './common/services/logger.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: getEnvPath() }),
    DbModule,
    CommonModule,
    CacheModule,
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ClinicContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: GlobalOperationLogInterceptor },
  ],
})
export class AppModule implements NestModule, OnModuleDestroy {
  private readonly logger = new Logger(AppModule.name);

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'api/health', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }

  onModuleDestroy() {
    this.logger.log('正在关闭应用，执行清理操作...');
    try {
      shutdownLogger();
      this.logger.log('日志缓冲已刷新');
    } catch (err: unknown) {
      this.logger.error('关闭过程中出错', err instanceof Error ? err : undefined);
    }
    this.logger.log('应用清理完成');
  }
}
