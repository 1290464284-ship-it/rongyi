/**
 * 缓存失效监听器
 *
 * 监听领域事件，自动失效相关缓存。
 * 替代原来各 Service 手动调用 statsService.invalidate() 的分散逻辑。
 *
 * 新增业务缓存失效规则时，只需在此文件添加新的 @OnEvent 方法。
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CacheService } from '../services/cache.service';
import { CACHE_PREFIXES } from '@dental/shared';
import {
  ChargeCreatedEvent,
  ChargePaidEvent,
  ChargeRefundedEvent,
  PatientCreatedEvent,
  PatientUpdatedEvent,
  AppointmentCreatedEvent,
  AppointmentCancelledEvent,
  InventoryStockChangedEvent,
} from './domain-events';

@Injectable()
export class CacheInvalidationListener {
  private readonly logger = new Logger(CacheInvalidationListener.name);

  constructor(private readonly cacheService: CacheService) {}

  @OnEvent('charge.created')
  handleChargeCreated(event: ChargeCreatedEvent) {
    this.invalidateStats(event.clinicId);
    this.logger.debug(`[Cache] charge.created → 失效统计缓存 clinicId=${event.clinicId}`);
  }

  @OnEvent('charge.paid')
  handleChargePaid(event: ChargePaidEvent) {
    this.invalidateStats(event.clinicId);
    this.cacheService.delPattern(`${CACHE_PREFIXES.PATIENT}${event.patientId}`);
    this.logger.debug(`[Cache] charge.paid → 失效统计+患者缓存`);
  }

  @OnEvent('charge.refunded')
  handleChargeRefunded(event: ChargeRefundedEvent) {
    this.invalidateStats(event.clinicId);
    this.cacheService.delPattern(`${CACHE_PREFIXES.PATIENT}${event.patientId}`);
    this.logger.debug(`[Cache] charge.refunded → 失效统计+患者缓存`);
  }

  @OnEvent('patient.created')
  handlePatientCreated(event: PatientCreatedEvent) {
    this.invalidateStats(event.clinicId);
    this.cacheService.delPattern(CACHE_PREFIXES.SEARCH);
    this.logger.debug(`[Cache] patient.created → 失效统计+搜索缓存`);
  }

  @OnEvent('patient.updated')
  handlePatientUpdated(event: PatientUpdatedEvent) {
    this.cacheService.delPattern(`${CACHE_PREFIXES.PATIENT}${event.patientId}`);
    this.cacheService.delPattern(CACHE_PREFIXES.SEARCH);
    this.logger.debug(`[Cache] patient.updated → 失效患者+搜索缓存`);
  }

  @OnEvent('appointment.created')
  handleAppointmentCreated(event: AppointmentCreatedEvent) {
    this.invalidateStats(event.clinicId);
    this.cacheService.delPattern(CACHE_PREFIXES.APPOINTMENT);
    this.logger.debug(`[Cache] appointment.created → 失效统计+预约缓存`);
  }

  @OnEvent('appointment.cancelled')
  handleAppointmentCancelled(event: AppointmentCancelledEvent) {
    this.invalidateStats(event.clinicId);
    this.cacheService.delPattern(CACHE_PREFIXES.APPOINTMENT);
    this.logger.debug(`[Cache] appointment.cancelled → 失效统计+预约缓存`);
  }

  @OnEvent('inventory.stock-changed')
  handleInventoryStockChanged(event: InventoryStockChangedEvent) {
    this.invalidateStats(event.clinicId);
    this.cacheService.delPattern(CACHE_PREFIXES.DICTIONARY);
    this.logger.debug(`[Cache] inventory.stock-changed → 失效统计+字典缓存`);
  }

  /**
   * 失效统计类缓存（dashboard / revenue / patient 等）
   */
  private invalidateStats(clinicId: string | null) {
    if (clinicId) {
      this.cacheService.delPattern(`${CACHE_PREFIXES.STATS}`);
    }
  }
}
