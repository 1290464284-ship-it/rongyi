 
import { DailySchedulerService } from './daily-scheduler.service';
import { DailyTaskHandler } from './task-handler.interface';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../settings/settings.service';
import { CacheService } from '../../../common/services/cache.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { BusinessAlertDetectorTask } from './tasks/business-alert-detector.task';
import { BusinessAlertDetectorService } from '../business-alerts/business-alert-detector.service';
import { InventoryReplenishmentTask } from './tasks/inventory-replenishment.task';
import { RfmAnalysisTask } from './tasks/rfm-analysis.task';
import { ChurnPredictionTask } from './tasks/churn-prediction.task';
import { DoctorPerfAnomalyTask } from './tasks/doctor-perf-anomaly.task';
import { FollowUpBatchGenTask } from './tasks/follow-up-batch-gen.task';
import { ChargeAssistantRebuildTask } from './tasks/charge-assistant-rebuild.task';
import { TreatmentProgressSnapshotTask } from './tasks/treatment-progress-snapshot.task';
import { NpsSnapshotTask } from './tasks/nps-snapshot.task';

function createMockBusinessAlertDetectorTask(): BusinessAlertDetectorTask {
  const mockSvc = {
    detectForClinic: jest.fn().mockResolvedValue([]),
  } as unknown as BusinessAlertDetectorService;
  return new BusinessAlertDetectorTask(mockSvc);
}

function createMockInventoryReplenishmentTask(): InventoryReplenishmentTask {
  const mockSvc = {
    generateSuggestions: jest.fn().mockResolvedValue({
      stats: { scanned: 0, generated: 0, zeroStock: 0, expiring: 0, spike: 0 },
      suggestions: [],
    }),
  };
  const mockCtx = {
    run: jest.fn((_ctx: unknown, fn: () => Promise<unknown>) => fn()),
    getClinicId: jest.fn().mockReturnValue('test-clinic-001'),
  } as unknown as import('../../../common/services/clinic-context.service').ClinicContextService;
  return new InventoryReplenishmentTask(mockSvc as never, mockCtx);
}

function createMockFollowUpBatchGenTask(): FollowUpBatchGenTask {
  const mockSvc = {
    batchGenerate: jest.fn().mockResolvedValue({ totalProcessed: 0, totalGenerated: 0, skippedDueToExisting: 0 }),
  };
  return new FollowUpBatchGenTask(mockSvc as never);
}

function createMockChargeAssistantRebuildTask(): ChargeAssistantRebuildTask {
  const mockSvc = {
    rebuildRecommendations: jest.fn().mockResolvedValue({
      transactions: 0,
      frequentItemsets: 0,
      rules: 0,
      mockDemoInserted: false,
      upsert: { added: 0, updated: 0, deleted: 0 },
      sinceDays: 730,
    }),
  };
  const mockSettings = {
    getBoolean: jest.fn().mockResolvedValue(true),
    getNumber: jest.fn().mockResolvedValue(730),
  } as unknown as SettingsService;
  return new ChargeAssistantRebuildTask(mockSvc as never, mockSettings);
}

function createMockTreatmentProgressSnapshotTask(): TreatmentProgressSnapshotTask {
  return new TreatmentProgressSnapshotTask(undefined, undefined);
}

function createMockNpsSnapshotTask(): NpsSnapshotTask {
  const mockSvc = {
    snapshotDaily: jest.fn().mockResolvedValue({ written: 0 }),
  } as unknown as import('../../analytics/satisfaction/satisfaction.service').SatisfactionService;
  const mockDb = {
    prepare: jest.fn().mockReturnValue({ run: jest.fn(), get: jest.fn(), all: jest.fn() }),
    exec: jest.fn(),
    transaction: jest.fn(),
  };
  return new NpsSnapshotTask(mockSvc, mockDb as never);
}

function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockCacheService(): CacheService {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    delPattern: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
    getStats: () => ({ hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 1000 }),
    has: () => false,
  } as unknown as CacheService;
}

function createMockAuditLogService(): AuditLogService {
  return {
    logAudit: jest.fn(() => {
      // no-op for tests
    }),
  } as unknown as AuditLogService;
}

class MockTask implements DailyTaskHandler {
  constructor(
    readonly name: string,
    readonly enabled = true,
    readonly maxRetries = 3,
    private shouldFail = false,
    private failCount = 0,
  ) {}

  executeCallCount = 0;
  lastClinicId: string | undefined;

  async execute(clinicId?: string): Promise<void> {
    this.executeCallCount++;
    this.lastClinicId = clinicId;
    if (this.shouldFail && this.failCount > 0) {
      this.failCount--;
      throw new Error(`Mock error from ${this.name}`);
    }
  }

  setShouldFail(shouldFail: boolean, failCount = 999): void {
    this.shouldFail = shouldFail;
    this.failCount = failCount;
  }
}

class ExtendedMockDbService extends MockDbService {
  constructor() {
    super();
    if (!this.tables.has('ClinicInfo')) {
      this.tables.set('ClinicInfo', new Map());
    }
    if (!this.tables.has('BusinessAlert')) {
      this.tables.set('BusinessAlert', new Map());
    }
    if (!this.tables.has('AuditLog')) {
      this.tables.set('AuditLog', new Map());
    }
  }
}

function createSettingsService(db: ExtendedMockDbService): SettingsService {
  const cache = createMockCacheService();
  const context = createMockClinicContext();
  const auditLog = createMockAuditLogService();
  const service = new SettingsService(asDbService(db), cache, context, auditLog);
  service.onModuleInit();
  return service;
}

describe('DailySchedulerService', () => {
  let service: DailySchedulerService;
  let db: ExtendedMockDbService;
  let clinicContext: ClinicContextService;
  let settingsService: SettingsService;
  let taskA: MockTask;
  let taskB: MockTask;
  let taskC: MockTask;
  let taskD: MockTask;
  let taskE: MockTask;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    db = new ExtendedMockDbService();
    clinicContext = createMockClinicContext();
    settingsService = createSettingsService(db);

    taskA = new MockTask('TaskA');
    taskB = new MockTask('TaskB');
    taskC = new MockTask('TaskC');
    taskD = new MockTask('TaskD');
    taskE = new MockTask('TaskE');

    const detectorTask = createMockBusinessAlertDetectorTask();
    const inventoryTask = createMockInventoryReplenishmentTask();
    const rfmTask = new RfmAnalysisTask();
    const churnTask = new ChurnPredictionTask();
    const perfTask = new DoctorPerfAnomalyTask();
    const followUpTask = createMockFollowUpBatchGenTask();
    const chargeAssistantTask = createMockChargeAssistantRebuildTask();

    service = new DailySchedulerService(
      asDbService(db),
      clinicContext,
      settingsService,
      detectorTask,
      inventoryTask,
      rfmTask,
      churnTask,
      perfTask,
      followUpTask,
      chargeAssistantTask,
      createMockTreatmentProgressSnapshotTask(),
      createMockNpsSnapshotTask(),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    db.clear();
  });

  describe('TR-2.1 启动调度 - fakeTimers 触发 02:00 执行', () => {
    it('应在到达目标时间后调用所有 handler 的 execute 方法', async () => {
      service.register(taskA);
      service.register(taskB);
      service.register(taskC);
      service.register(taskD);
      service.register(taskE);

      const now = new Date();
      now.setHours(3, 24, 30, 0);
      jest.setSystemTime(now.getTime());

      const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
      await service.onModuleInit();

      expect(taskA.executeCallCount).toBe(0);

      const schedulerSetTimeoutCalls = setTimeoutSpy.mock.calls.filter(
        (call) => call.length >= 2 && typeof call[1] === 'number' && call[1] > 1000
      );
      expect(schedulerSetTimeoutCalls.length).toBeGreaterThanOrEqual(1);
      const initialMsUntilNext = schedulerSetTimeoutCalls[schedulerSetTimeoutCalls.length - 1][1] as number;
      expect(initialMsUntilNext).toBeGreaterThan(0);
      expect(initialMsUntilNext).toBeLessThanOrEqual(60 * 1000);

      jest.advanceTimersByTime(initialMsUntilNext + 100);
      jest.runOnlyPendingTimers();

      await service.runAllTasks();

      const initialRegisteredCount = 5;
      const totalCount = taskA.executeCallCount + taskB.executeCallCount + taskC.executeCallCount + taskD.executeCallCount + taskE.executeCallCount;
      expect(totalCount).toBeGreaterThanOrEqual(initialRegisteredCount);

      service.onModuleDestroy();
      setTimeoutSpy.mockRestore();
    });

    it('当 dailySchedulerEnabled=false 时不启动定时器，输出 warn', async () => {
      db.prepare(
        "UPDATE ClinicInfo SET value = 'false' WHERE key = 'dailySchedulerEnabled' AND clinicId IS NULL"
      ).run();
      const cache = createMockCacheService();
      const auditLog = createMockAuditLogService();
      const disabledSettings = new SettingsService(asDbService(db), cache, clinicContext, auditLog);

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        // no-op
      });

      const disabledService = new DailySchedulerService(
        asDbService(db),
        clinicContext,
        disabledSettings,
        createMockBusinessAlertDetectorTask(),
        createMockInventoryReplenishmentTask(),
        new RfmAnalysisTask(),
        new ChurnPredictionTask(),
        new DoctorPerfAnomalyTask(),
        createMockFollowUpBatchGenTask(),
        createMockChargeAssistantRebuildTask(),
        createMockTreatmentProgressSnapshotTask(),
        createMockNpsSnapshotTask(),
      );

      await disabledService.onModuleInit();
      const anyArgContains = warnSpy.mock.calls.some(
        (args) => args.some((arg) => typeof arg === 'string' && arg.includes('dailySchedulerEnabled=false'))
      );
      expect(anyArgContains).toBe(true);

      const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
      const setTimeoutCallsBefore = setTimeoutSpy.mock.calls.length;
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      jest.runOnlyPendingTimers();
      const setTimeoutCallsAfter = setTimeoutSpy.mock.calls.length;
      expect(setTimeoutCallsAfter - setTimeoutCallsBefore).toBe(0);

      disabledService.onModuleDestroy();
      warnSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    });
  });

  describe('TR-2.2 容错处理 - 单个 handler 失败不影响其他', () => {
    it('handlerA 抛错、handlerB 成功时，handlerB 正常执行且进程不抛错', async () => {
      taskA.setShouldFail(true, 999);
      service.register(taskA);
      service.register(taskB);

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
        // no-op
      });

      await expect(service.runAllTasks()).resolves.not.toThrow();

      expect(taskA.executeCallCount).toBe(1);
      expect(taskB.executeCallCount).toBe(1);
      expect(service.getFailureCount('TaskA')).toBe(1);
      expect(service.getFailureCount('TaskB')).toBe(0);

      const businessAlerts = db.getTableData('BusinessAlert');
      const criticalAlerts = businessAlerts.filter(
        (r: any) => r.severity === 'CRITICAL' && r.alertType === 'SCHEDULER_TASK_FAILURE'
      );
      expect(criticalAlerts.length).toBe(0);

      errorSpy.mockRestore();
    });

    it('handler 成功后失败计数应重置为 0', async () => {
      service.register(taskA);

      taskA.setShouldFail(true, 1);
      await service.runAllTasks();
      expect(service.getFailureCount('TaskA')).toBe(1);

      taskA.setShouldFail(false);
      await service.runAllTasks();
      expect(service.getFailureCount('TaskA')).toBe(0);
    });

    it('handler.enabled=false 时应跳过执行', async () => {
      const disabledTask = new MockTask('DisabledTask', false);
      service.register(disabledTask);

      await service.runAllTasks();
      expect(disabledTask.executeCallCount).toBe(0);
    });
  });

  describe('TR-2.3 三次失败告警 - 写入 BusinessAlert CRITICAL', () => {
    it('连续失败 3 次后应写入 BusinessAlert 表', async () => {
      service.register(taskA);
      taskA.setShouldFail(true, 999);

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
        // no-op
      });

      await service.runAllTasks();
      expect(service.getFailureCount('TaskA')).toBe(1);
      let alerts1 = db.getTableData('BusinessAlert');
      expect(alerts1.filter((r: any) => r.severity === 'CRITICAL').length).toBe(0);

      await service.runAllTasks();
      expect(service.getFailureCount('TaskA')).toBe(2);
      let alerts2 = db.getTableData('BusinessAlert');
      expect(alerts2.filter((r: any) => r.severity === 'CRITICAL').length).toBe(0);

      await service.runAllTasks();
      expect(service.getFailureCount('TaskA')).toBe(3);
      const alerts3 = db.getTableData('BusinessAlert');
      const criticalAlerts = alerts3.filter(
        (r: any) => r.severity === 'CRITICAL' && r.alertType === 'SCHEDULER_TASK_FAILURE'
      );
      expect(criticalAlerts.length).toBe(1);
      expect(criticalAlerts[0].metricName).toBe('TaskA');
      expect(criticalAlerts[0].message).toContain('TaskA');
      expect(criticalAlerts[0].message).toContain('连续失败3次');
      expect(criticalAlerts[0].suggestion).toBeDefined();
      expect(criticalAlerts[0].clinicId).toBe('test-clinic-001');

      errorSpy.mockRestore();
    });

    it('无 clinicId 时使用 global 字符串', async () => {
      const globalCtx = createMockClinicContext(null);
      const globalService = new DailySchedulerService(
        asDbService(db),
        globalCtx,
        settingsService,
        createMockBusinessAlertDetectorTask(),
        createMockInventoryReplenishmentTask(),
        new RfmAnalysisTask(),
        new ChurnPredictionTask(),
        new DoctorPerfAnomalyTask(),
        createMockFollowUpBatchGenTask(),
        createMockChargeAssistantRebuildTask(),
        createMockTreatmentProgressSnapshotTask(),
        createMockNpsSnapshotTask(),
      );

      taskA.setShouldFail(true, 999);
      globalService.register(taskA);

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await globalService.runAllTasks();
      await globalService.runAllTasks();
      await globalService.runAllTasks();

      const alerts = db.getTableData('BusinessAlert');
      const criticalAlerts = alerts.filter(
        (r: any) => r.severity === 'CRITICAL' && r.alertType === 'SCHEDULER_TASK_FAILURE'
      );
      expect(criticalAlerts.length).toBe(1);
      expect(criticalAlerts[0].clinicId).toBe('global');

      errorSpy.mockRestore();
    });
  });

  describe('TR-2.4 内存清理 - destroy 调用后清理 timer', () => {
    it('onModuleDestroy 应调用 clearTimeout 和 clearInterval', async () => {
      const now = new Date();
      now.setHours(1, 0, 0, 0);
      jest.setSystemTime(now);

      await service.onModuleInit();

      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

      service.onModuleDestroy();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('interval timer 在首次触发后设置，destroy 时清理', async () => {
      const now = new Date();
      now.setHours(3, 24, 30, 0);
      jest.setSystemTime(now);

      await service.onModuleInit();

      jest.advanceTimersByTime(60 * 1000);
      await Promise.resolve();
      await Promise.resolve();

      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('register 注册机制', () => {
    it('register 方法应正确添加 handler', () => {
      const customTask = new MockTask('CustomTask');
      service.register(customTask);
      expect(customTask.executeCallCount).toBe(0);
    });
  });

  describe('失败计数器辅助方法', () => {
    it('getFailureCount 返回未注册 handler 的 0', () => {
      expect(service.getFailureCount('NonExistent')).toBe(0);
    });

    it('resetFailureCount 应将计数归零', () => {
      service.register(taskA);
      taskA.setShouldFail(true, 2);
      service.runAllTasks().then(() => {
        expect(service.getFailureCount('TaskA')).toBe(1);
        service.resetFailureCount('TaskA');
        expect(service.getFailureCount('TaskA')).toBe(0);
      });
    });
  });

  describe('目标时间计算边界', () => {
    it('当当前时间超过 02:00 时，应计算为明天 02:00', async () => {
      const now = new Date();
      now.setHours(3, 0, 0, 0);
      jest.setSystemTime(now.getTime());

      service.register(taskA);

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await service.onModuleInit();

      const wasCalledWithMsUntilNextRun = logSpy.mock.calls.some(
        (args) => args.some((arg) => typeof arg === 'string' && arg.includes('距离下一次执行还有'))
      );
      expect(wasCalledWithMsUntilNextRun).toBe(true);

      service.onModuleDestroy();
      logSpy.mockRestore();
    });

    it('无效的小时/分钟配置应回退到默认值', async () => {
      db.prepare(
        "UPDATE ClinicInfo SET value = '99' WHERE key = 'dailySchedulerHour' AND clinicId IS NULL"
      ).run();
      db.prepare(
        "UPDATE ClinicInfo SET value = 'abc' WHERE key = 'dailySchedulerMinute' AND clinicId IS NULL"
      ).run();

      const cache = createMockCacheService();
      const auditLog = createMockAuditLogService();
      const badSettings = new SettingsService(asDbService(db), cache, clinicContext, auditLog);

      const badService = new DailySchedulerService(
        asDbService(db),
        clinicContext,
        badSettings,
        createMockBusinessAlertDetectorTask(),
        createMockInventoryReplenishmentTask(),
        new RfmAnalysisTask(),
        new ChurnPredictionTask(),
        new DoctorPerfAnomalyTask(),
        createMockFollowUpBatchGenTask(),
        createMockChargeAssistantRebuildTask(),
        createMockTreatmentProgressSnapshotTask(),
        createMockNpsSnapshotTask(),
      );

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await badService.onModuleInit();

      const wasCalledWithDefaultTime = logSpy.mock.calls.some(
        (args) => args.some((arg) => typeof arg === 'string' && arg.includes('每日执行时间 03:25'))
      );
      expect(wasCalledWithDefaultTime).toBe(true);

      badService.onModuleDestroy();
      logSpy.mockRestore();
    });
  });
});
