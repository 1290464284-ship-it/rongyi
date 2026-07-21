import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { getEnvPath } from './db/database';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
// scheduling group
import { AppointmentsModule } from './modules/scheduling/appointments/appointments.module';
import { ChairsModule } from './modules/scheduling/chairs/chairs.module';
// clinical group
import { OralExaminationsModule } from './modules/clinical/oral-examinations/oral-examinations.module';
import { FirstExamsModule } from './modules/clinical/first-exams/first-exams.module';
import { PeriodontalRecordsModule } from './modules/clinical/periodontal-records/periodontal-records.module';
import { MedicalRecordsModule } from './modules/clinical/medical-records/medical-records.module';
import { RegistrationsModule } from './modules/clinical/registrations/registrations.module';
import { TreatmentsModule } from './modules/clinical/treatments/treatments.module';
import { TreatmentPlansModule } from './modules/clinical/treatment-plans/treatment-plans.module';
import { VisitsModule } from './modules/clinical/visits/visits.module';
// inventory group
import { InventoryModule } from './modules/inventory/inventory/inventory.module';
import { SuppliersModule } from './modules/inventory/suppliers/suppliers.module';
import { PurchaseOrdersModule } from './modules/inventory/purchase-orders/purchase-orders.module';
import { ProcessingOrdersModule } from './modules/inventory/processing-orders/processing-orders.module';
// financial group
import { RefundsModule } from './modules/financial/refunds/refunds.module';
import { MemberCardsModule } from './modules/financial/member-cards/member-cards.module';
import { ChargeV2Module } from './modules/financial/charge-v2/charge-v2.module';
// content group
import { ToothRecordsModule } from './modules/content/tooth-records/tooth-records.module';
import { PrescriptionsModule } from './modules/content/prescriptions/prescriptions.module';
import { ImagingModule } from './modules/content/imaging/imaging.module';
// communication group
import { FollowUpsV2Module } from './modules/communication/follow-ups-v2/follow-ups-v2.module';
import { WechatModule } from './modules/communication/wechat/wechat.module';
// system group
import { BackupsModule } from './modules/system/backups/backups.module';
import { OperationLogsModule } from './modules/system/operation-logs/operation-logs.module';
import { HealthController } from './modules/system/health/health.controller';
import { SearchModule } from './modules/system/search/search.module';
import { StatsModule } from './modules/system/stats/stats.module';
import { SettingsModule } from './modules/system/settings/settings.module';
import { ClinicsModule } from './modules/system/clinics/clinics.module';
import { RolesGuard } from './common/guards/roles.guard';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { GlobalOperationLogInterceptor } from './common/interceptors/global-operation-log.interceptor';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor';
import { ClinicContextInterceptor } from './common/interceptors/clinic-context.interceptor';
import { ClinicContextService } from './common/services/clinic-context.service';
import { ConfigValidationService } from './common/services/config-validation.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: getEnvPath() }),
    DbModule,
    AuthModule,
    PatientsModule,
    AppointmentsModule,
    VisitsModule,
    TreatmentsModule,
    TreatmentPlansModule,
    SettingsModule,
    ChairsModule,
    RegistrationsModule,
    EquipmentModule,
    // clinical
    OralExaminationsModule,
    FirstExamsModule,
    PeriodontalRecordsModule,
    // inventory
    InventoryModule,
    SuppliersModule,
    PurchaseOrdersModule,
    ProcessingOrdersModule,
    // financial
    ChargeV2Module,
    RefundsModule,
    MemberCardsModule,
    // content
    ToothRecordsModule,
    PrescriptionsModule,
    ImagingModule,
    MedicalRecordsModule,
    // communication
    FollowUpsV2Module,
    WechatModule,
    // system
    BackupsModule,
    OperationLogsModule,
    SearchModule,
    StatsModule,
    ClinicsModule,
  ],
  controllers: [HealthController],
  providers: [
    ConfigValidationService,
    ClinicContextService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // TraceIdInterceptor must run FIRST to set up AsyncLocalStorage context
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    // P3: 诊所上下文拦截器 — 在业务逻辑之前设置 clinicId
    { provide: APP_INTERCEPTOR, useClass: ClinicContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: GlobalOperationLogInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'api/health', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}
