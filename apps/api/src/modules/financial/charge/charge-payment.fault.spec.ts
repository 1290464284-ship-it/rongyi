import { ChargePaymentService } from './charge-payment.service';
import { ChargeService } from './charge.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { EventBusService } from '../../../common/events/event-bus.service';
import { ChargeRepository } from './repositories/charge.repository';
import { FaultInjector, createDbBusyFault, createDbLockedFault } from '../../../common/test-helpers/fault-injection';
import { FaultyMockDbService } from '../../../common/test-helpers/mock-db-factory';
import { MockDbRow } from '../../../db/__mocks__/db-service.mock';

function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockIdempotency(db: FaultyMockDbService): IdempotencyService {
  return {
    executeInTransaction: <T>(_options: unknown, handler: (db: unknown) => T) =>
      db.transaction((txDb: unknown) => handler(txDb)),
    execute: async <T>(_options: unknown, handler: () => Promise<T> | T) => handler(),
  } as unknown as IdempotencyService;
}

function createMockEventBus(): jest.Mocked<EventBusService> {
  return {
    emit: jest.fn(),
    on: jest.fn(),
    onAll: jest.fn(),
  } as unknown as jest.Mocked<EventBusService>;
}

describe('ChargePaymentService - 故障注入测试', () => {
  let service: ChargePaymentService;
  let db: FaultyMockDbService;
  let chargeService: ChargeService;
  let faultInjector: FaultInjector;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(() => {
    faultInjector = new FaultInjector();
    faultInjector.enable();
    db = new FaultyMockDbService(faultInjector);
    eventBus = createMockEventBus();
    chargeService = new ChargeService(db as any, createMockClinicContext(), eventBus, new ChargeRepository(), createMockIdempotency(db));
    service = new ChargePaymentService(
      db as any,
      createMockClinicContext(),
      createMockIdempotency(db),
      chargeService,
      {} as any,
      eventBus,
    );
  });

  afterEach(() => {
    faultInjector.reset();
    db.clearFaultRules();
    db.clear();
  });

  function seedCharge(overrides: Record<string, unknown> = {}): MockDbRow {
    const id = overrides.id || 'charge-001';
    const charge: MockDbRow = {
      id,
      patientId: 'patient-001',
      number: '202607230001',
      totalAmount: 30000,
      paidAmount: 0,
      refundedAmount: 0,
      discount: 0,
      status: 'UNPAID',
      clinicId: 'test-clinic-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      ...overrides,
    };
    db.seed('Charge', [charge]);
    return charge;
  }

  function getChargeFromDb(id: string): MockDbRow | undefined {
    return db.getTableData('Charge').find(c => c.id === id);
  }

  function getAuditLogCount(): number {
    return db.getTableData('AuditLog').length;
  }

  describe('数据库繁忙故障 (SQLITE_BUSY)', () => {
    it('支付过程中 UPDATE Charge 时数据库繁忙，事务应回滚，状态不变', async () => {
      seedCharge();

      faultInjector.setFault('charge-update-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^UPDATE\s+Charge\b/i,
        faultName: 'charge-update-busy',
        method: 'run',
      });

      await expect(service.payCharge('charge-001', {
        amount: 100,
        payMethod: 'CASH',
      })).rejects.toThrow('SQLITE_BUSY');

      const charge = getChargeFromDb('charge-001');
      expect(charge).toBeDefined();
      expect(charge?.status).toBe('UNPAID');
      expect(charge?.paidAmount).toBe(0);

      expect(getAuditLogCount()).toBe(0);
    });

    it('支付过程中 INSERT AuditLog 时数据库繁忙，事务应回滚', async () => {
      seedCharge();

      faultInjector.setFault('auditlog-insert-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^INSERT\s+INTO\s+AuditLog\b/i,
        faultName: 'auditlog-insert-busy',
        method: 'run',
      });

      await expect(service.payCharge('charge-001', {
        amount: 100,
        payMethod: 'CASH',
      })).rejects.toThrow('SQLITE_BUSY');

      const charge = getChargeFromDb('charge-001');
      expect(charge).toBeDefined();
      expect(charge?.status).toBe('UNPAID');
      expect(charge?.paidAmount).toBe(0);
    });

    it('数据库繁忙故障只触发指定次数', async () => {
      seedCharge();

      faultInjector.setFault('charge-update-busy', {
        ...createDbBusyFault(),
        maxTriggers: 1,
      });
      db.addFaultRule({
        match: /^UPDATE\s+Charge\b/i,
        faultName: 'charge-update-busy',
        method: 'run',
      });

      await expect(service.payCharge('charge-001', {
        amount: 100,
        payMethod: 'CASH',
      })).rejects.toThrow('SQLITE_BUSY');

      expect(faultInjector.getTriggerCount('charge-update-busy')).toBe(1);

      const chargeBefore = getChargeFromDb('charge-001');
      expect(chargeBefore?.status).toBe('UNPAID');
      expect(chargeBefore?.paidAmount).toBe(0);
    });
  });

  describe('数据库锁定故障 (SQLITE_LOCKED)', () => {
    it('支付过程中 SELECT 查询时数据库锁定，应抛出异常且状态不变', async () => {
      seedCharge();

      faultInjector.setFault('charge-select-locked', createDbLockedFault());
      db.addFaultRule({
        match: /^SELECT\s+.*\s+FROM\s+Charge\b/i,
        faultName: 'charge-select-locked',
        method: 'get',
      });

      await expect(service.payCharge('charge-001', {
        amount: 100,
        payMethod: 'CASH',
      })).rejects.toThrow('SQLITE_LOCKED');

      const charge = getChargeFromDb('charge-001');
      expect(charge).toBeDefined();
      expect(charge?.status).toBe('UNPAID');
      expect(charge?.paidAmount).toBe(0);
    });
  });

  describe('故障注入禁用时正常工作', () => {
    it('禁用故障注入后，支付应正常完成', async () => {
      seedCharge();

      faultInjector.setFault('charge-update-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^UPDATE\s+Charge\b/i,
        faultName: 'charge-update-busy',
        method: 'run',
      });

      faultInjector.disable();

      const result = await service.payCharge('charge-001', {
        amount: 300,
        payMethod: 'CASH',
      });

      expect(result.status).toBe('PAID');
      expect(result.paidAmount).toBe(300);
    });

    it('清除故障后，支付应正常完成', async () => {
      seedCharge();

      faultInjector.setFault('charge-update-busy', createDbBusyFault());
      db.addFaultRule({
        match: /^UPDATE\s+Charge\b/i,
        faultName: 'charge-update-busy',
        method: 'run',
      });

      faultInjector.clearFault('charge-update-busy');

      const result = await service.payCharge('charge-001', {
        amount: 300,
        payMethod: 'CASH',
      });

      expect(result.status).toBe('PAID');
    });
  });

  describe('概率性故障', () => {
    it('概率为 0 时，故障永远不触发', async () => {
      seedCharge();

      faultInjector.setFault('random-failure', {
        enabled: true,
        error: new Error('Random failure'),
        probability: 0,
      });
      db.addFaultRule({
        match: /^UPDATE\s+Charge\b/i,
        faultName: 'random-failure',
        method: 'run',
      });

      for (let i = 0; i < 10; i++) {
        seedCharge({ id: `charge-${i}`, totalAmount: 30000, paidAmount: 0 });
      }

      for (let i = 0; i < 10; i++) {
        const result = await service.payCharge(`charge-${i}`, {
          amount: 300,
          payMethod: 'CASH',
        });
        expect(result.status).toBe('PAID');
      }
    });

    it('概率为 1 时，故障总是触发', async () => {
      seedCharge();

      faultInjector.setFault('always-fail', {
        enabled: true,
        error: new Error('Always fail'),
        probability: 1,
      });
      db.addFaultRule({
        match: /^UPDATE\s+Charge\b/i,
        faultName: 'always-fail',
        method: 'run',
      });

      await expect(service.payCharge('charge-001', {
        amount: 100,
        payMethod: 'CASH',
      })).rejects.toThrow('Always fail');

      const charge = getChargeFromDb('charge-001');
      expect(charge?.status).toBe('UNPAID');
      expect(charge?.paidAmount).toBe(0);
    });
  });

  describe('多阶段故障', () => {
    it('第一次查询成功，第二次更新失败，事务应完整回滚', async () => {
      seedCharge();

      let selectCount = 0;
      const originalPrepare = db.prepare.bind(db);
      jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/^SELECT\s+.*\s+FROM\s+Charge\b/i.test(sql)) {
          return {
            get: (...params: unknown[]) => {
              selectCount++;
              return stmt.get(...params);
            },
            all: stmt.all.bind(stmt),
            run: stmt.run.bind(stmt),
          };
        }
        return stmt;
      });

      faultInjector.setFault('update-fail', createDbBusyFault());
      db.addFaultRule({
        match: /^UPDATE\s+Charge\b/i,
        faultName: 'update-fail',
        method: 'run',
      });

      await expect(service.payCharge('charge-001', {
        amount: 100,
        payMethod: 'CASH',
      })).rejects.toThrow('SQLITE_BUSY');

      expect(selectCount).toBeGreaterThan(0);

      const charge = getChargeFromDb('charge-001');
      expect(charge?.status).toBe('UNPAID');
      expect(charge?.paidAmount).toBe(0);

      expect(getAuditLogCount()).toBe(0);
    });
  });

  describe('故障后系统恢复', () => {
    it('故障清除后，同一收费单可以正常支付', async () => {
      seedCharge();

      faultInjector.setFault('temp-failure', createDbBusyFault());
      db.addFaultRule({
        match: /^UPDATE\s+Charge\b/i,
        faultName: 'temp-failure',
        method: 'run',
      });

      try {
        await service.payCharge('charge-001', {
          amount: 100,
          payMethod: 'CASH',
        });
      } catch (e) {
        expect(e).toBeDefined();
      }

      const chargeBefore = getChargeFromDb('charge-001');
      expect(chargeBefore?.status).toBe('UNPAID');

      faultInjector.clearFault('temp-failure');

      const result = await service.payCharge('charge-001', {
        amount: 300,
        payMethod: 'CASH',
      });

      expect(result.status).toBe('PAID');
      expect(result.paidAmount).toBe(300);
    });
  });
});
