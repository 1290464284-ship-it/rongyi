import { CacheInvalidationListener } from './cache-invalidation.listener';
import { CacheService } from '../services/cache.service';
import { CACHE_PREFIXES } from '@dental/shared';
import {
  ChargeCreatedEvent,
  ChargePaidEvent,
  ChargeRefundedEvent,
  PatientCreatedEvent,
  PatientUpdatedEvent,
  AppointmentCreatedEvent,
  AppointmentUpdatedEvent,
  AppointmentCancelledEvent,
  AppointmentDeletedEvent,
  InventoryStockChangedEvent,
} from './domain-events';

describe('CacheInvalidationListener 缓存失效监听器', () => {
  let listener: CacheInvalidationListener;
  let cacheService: { delPattern: jest.Mock };

  beforeEach(() => {
    cacheService = { delPattern: jest.fn() };
    listener = new CacheInvalidationListener(cacheService as unknown as CacheService);
  });

  // ==================== charge 事件 ====================

  describe('handleChargeCreated', () => {
    it('应失效统计缓存', () => {
      const event = new ChargeCreatedEvent('c-1', 'p-1', 1000, 'clinic-1');
      listener.handleChargeCreated(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
    });

    it('clinicId 为 null 时不应失效统计缓存', () => {
      const event = new ChargeCreatedEvent('c-1', 'p-1', 1000);
      listener.handleChargeCreated(event);
      expect(cacheService.delPattern).not.toHaveBeenCalled();
    });

    it('delPattern 抛错时应捕获并记录日志', () => {
      cacheService.delPattern.mockImplementation(() => { throw new Error('cache error'); });
      const event = new ChargeCreatedEvent('c-1', 'p-1', 1000, 'clinic-1');
      expect(() => listener.handleChargeCreated(event)).not.toThrow();
    });
  });

  describe('handleChargePaid', () => {
    it('应失效统计缓存和患者缓存', () => {
      const event = new ChargePaidEvent('c-1', 'p-1', 500, 'clinic-1');
      listener.handleChargePaid(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(`${CACHE_PREFIXES.PATIENT}p-1`);
    });

    it('clinicId 为 null 时只失效患者缓存', () => {
      const event = new ChargePaidEvent('c-1', 'p-1', 500);
      listener.handleChargePaid(event);
      expect(cacheService.delPattern).not.toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(`${CACHE_PREFIXES.PATIENT}p-1`);
    });
  });

  describe('handleChargeRefunded', () => {
    it('应失效统计缓存和患者缓存', () => {
      const event = new ChargeRefundedEvent('c-1', 'p-1', 200, 'clinic-1');
      listener.handleChargeRefunded(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(`${CACHE_PREFIXES.PATIENT}p-1`);
    });
  });

  // ==================== patient 事件 ====================

  describe('handlePatientCreated', () => {
    it('应失效统计缓存和搜索缓存', () => {
      const event = new PatientCreatedEvent('p-1', 'clinic-1');
      listener.handlePatientCreated(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.SEARCH);
    });
  });

  describe('handlePatientUpdated', () => {
    it('应失效患者缓存和搜索缓存', () => {
      const event = new PatientUpdatedEvent('p-1', 'clinic-1');
      listener.handlePatientUpdated(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(`${CACHE_PREFIXES.PATIENT}p-1`);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.SEARCH);
    });

    it('不应失效统计缓存', () => {
      const event = new PatientUpdatedEvent('p-1', 'clinic-1');
      listener.handlePatientUpdated(event);
      expect(cacheService.delPattern).not.toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
    });
  });

  // ==================== appointment 事件 ====================

  describe('handleAppointmentCreated', () => {
    it('应失效统计缓存和预约缓存', () => {
      const event = new AppointmentCreatedEvent('a-1', 'p-1', 'd-1', 'clinic-1');
      listener.handleAppointmentCreated(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.APPOINTMENT);
    });
  });

  describe('handleAppointmentUpdated', () => {
    it('应失效统计缓存和预约缓存', () => {
      const event = new AppointmentUpdatedEvent('a-1', 'p-1', 'd-1', 'clinic-1');
      listener.handleAppointmentUpdated(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.APPOINTMENT);
    });
  });

  describe('handleAppointmentCancelled', () => {
    it('应失效统计缓存和预约缓存', () => {
      const event = new AppointmentCancelledEvent('a-1', 'clinic-1');
      listener.handleAppointmentCancelled(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.APPOINTMENT);
    });
  });

  describe('handleAppointmentDeleted', () => {
    it('应失效统计缓存和预约缓存', () => {
      const event = new AppointmentDeletedEvent('a-1', 'p-1', 'd-1', 'clinic-1');
      listener.handleAppointmentDeleted(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.APPOINTMENT);
    });
  });

  // ==================== inventory 事件 ====================

  describe('handleInventoryStockChanged', () => {
    it('应失效统计缓存和字典缓存', () => {
      const event = new InventoryStockChangedEvent('item-1', 'IN', 10, 'clinic-1');
      listener.handleInventoryStockChanged(event);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.STATS);
      expect(cacheService.delPattern).toHaveBeenCalledWith(CACHE_PREFIXES.DICTIONARY);
    });
  });

  // ==================== 错误处理 ====================

  describe('错误处理', () => {
    it('所有 handler 在 delPattern 抛错时均不应抛出', () => {
      cacheService.delPattern.mockImplementation(() => { throw new Error('boom'); });

      const handlers = [
        () => listener.handleChargeCreated(new ChargeCreatedEvent('c', 'p', 1, 'cl')),
        () => listener.handleChargePaid(new ChargePaidEvent('c', 'p', 1, 'cl')),
        () => listener.handleChargeRefunded(new ChargeRefundedEvent('c', 'p', 1, 'cl')),
        () => listener.handlePatientCreated(new PatientCreatedEvent('p', 'cl')),
        () => listener.handlePatientUpdated(new PatientUpdatedEvent('p', 'cl')),
        () => listener.handleAppointmentCreated(new AppointmentCreatedEvent('a', 'p', 'd', 'cl')),
        () => listener.handleAppointmentUpdated(new AppointmentUpdatedEvent('a', 'p', 'd', 'cl')),
        () => listener.handleAppointmentCancelled(new AppointmentCancelledEvent('a', 'cl')),
        () => listener.handleAppointmentDeleted(new AppointmentDeletedEvent('a', 'p', 'd', 'cl')),
        () => listener.handleInventoryStockChanged(new InventoryStockChangedEvent('i', 'IN', 1, 'cl')),
      ];

      handlers.forEach(fn => expect(fn).not.toThrow());
    });
  });
});
