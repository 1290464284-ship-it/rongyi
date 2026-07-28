import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '@/lib/api/api';
import {
  getLastSyncTime,
  recordLocalChange,
  getPendingChangeCount,
  isOnline,
  pushChanges,
  pullChanges,
  sync,
  initSyncService,
} from '@/lib/sync/sync-service';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

const setOnline = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
};

describe('sync-service 离线同步', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getLastSyncTime 无记录时返回 epoch 时间', () => {
    expect(getLastSyncTime()).toBe(new Date(0).toISOString());
  });

  it('recordLocalChange 追加变更并被 getPendingChangeCount 统计', () => {
    expect(getPendingChangeCount()).toBe(0);
    recordLocalChange('patients', 'p1', 'INSERT', { name: '张三' });
    recordLocalChange('patients', 'p1', 'UPDATE', { name: '李四' });
    expect(getPendingChangeCount()).toBe(2);
  });

  it('isOnline 反映 navigator.onLine', () => {
    expect(isOnline()).toBe(true);
    setOnline(false);
    expect(isOnline()).toBe(false);
  });

  it('pushChanges 无待同步变更时直接返回零结果', async () => {
    const result = await pushChanges();
    expect(result).toEqual({ accepted: 0, conflicts: 0 });
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('pushChanges 提交变更并在成功后清空队列', async () => {
    recordLocalChange('patients', 'p1', 'INSERT', { name: '张三' });
    mockedApi.post.mockResolvedValue({ data: { accepted: 1, conflicts: 0 } });

    const result = await pushChanges();

    expect(mockedApi.post).toHaveBeenCalledWith('/sync/push', {
      deviceId: expect.stringMatching(/^device_/),
      changes: [
        expect.objectContaining({ tableName: 'patients', recordId: 'p1', operation: 'INSERT' }),
      ],
    });
    expect(result).toEqual({ accepted: 1, conflicts: 0 });
    expect(getPendingChangeCount()).toBe(0);
  });

  it('pushChanges 失败时保留变更并抛出错误', async () => {
    recordLocalChange('patients', 'p1', 'DELETE');
    mockedApi.post.mockRejectedValue(new Error('network down'));

    await expect(pushChanges()).rejects.toThrow('network down');
    expect(getPendingChangeCount()).toBe(1);
  });

  it('设备 ID 首次生成后持久化复用', async () => {
    recordLocalChange('patients', 'p1', 'INSERT');
    mockedApi.post.mockResolvedValue({ data: { accepted: 1, conflicts: 0 } });
    await pushChanges();

    recordLocalChange('patients', 'p2', 'INSERT');
    await pushChanges();

    const [firstCall, secondCall] = mockedApi.post.mock.calls as [
      [string, { deviceId: string }],
      [string, { deviceId: string }],
    ];
    expect(firstCall[1].deviceId).toBe(secondCall[1].deviceId);
  });

  it('pullChanges 携带 since 与 deviceId 并更新上次同步时间', async () => {
    mockedApi.get.mockResolvedValue({
      data: { changes: [{ id: 'c1' }], serverTime: '2026-07-28T10:00:00.000Z' },
    });

    const result = await pullChanges();

    expect(mockedApi.get).toHaveBeenCalledWith('/sync/pull', {
      params: {
        since: new Date(0).toISOString(),
        deviceId: expect.stringMatching(/^device_/),
      },
    });
    expect(result.changes).toHaveLength(1);
    expect(getLastSyncTime()).toBe('2026-07-28T10:00:00.000Z');
  });

  it('sync 离线时直接返回零结果', async () => {
    setOnline(false);
    const result = await sync();
    expect(result).toEqual({ pushed: 0, pulled: 0, conflicts: 0 });
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('sync 先推后拉并汇总结果', async () => {
    recordLocalChange('patients', 'p1', 'UPDATE', { name: '王五' });
    mockedApi.post.mockResolvedValue({ data: { accepted: 1, conflicts: 2 } });
    mockedApi.get.mockResolvedValue({
      data: { changes: [{ id: 'c1' }, { id: 'c2' }], serverTime: '2026-07-28T11:00:00.000Z' },
    });

    const result = await sync();
    expect(result).toEqual({ pushed: 1, pulled: 2, conflicts: 2 });
  });

  it('sync 互斥锁：并发调用时第二次直接返回零结果', async () => {
    recordLocalChange('patients', 'p1', 'UPDATE');
    let resolvePush!: (value: { data: { accepted: number; conflicts: number } }) => void;
    mockedApi.post.mockReturnValue(new Promise((resolve) => { resolvePush = resolve; }));
    mockedApi.get.mockResolvedValue({ data: { changes: [], serverTime: '2026-07-28T12:00:00.000Z' } });

    const first = sync();
    const second = await sync();
    expect(second).toEqual({ pushed: 0, pulled: 0, conflicts: 0 });

    resolvePush({ data: { accepted: 1, conflicts: 0 } });
    const firstResult = await first;
    expect(firstResult.pushed).toBe(1);
  });

  it('initSyncService 监听 online 事件延迟触发同步，cleanup 后不再触发', async () => {
    vi.useFakeTimers();
    mockedApi.get.mockResolvedValue({ data: { changes: [], serverTime: '2026-07-28T13:00:00.000Z' } });

    const cleanup = initSyncService();
    // 启动时在线：3 秒后触发一次同步（无待推变更，只有 pull）
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockedApi.get).toHaveBeenCalledTimes(1);

    // online 事件：2 秒后再次同步
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockedApi.get).toHaveBeenCalledTimes(2);

    // cleanup 后 online 事件不再触发同步
    cleanup();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedApi.get).toHaveBeenCalledTimes(2);
  });
});
