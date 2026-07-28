/**
 * 客户端离线同步服务
 *
 * 功能：
 * 1. 检测网络状态（在线/离线）
 * 2. 离线时将写操作记录到本地队列（localStorage）
 * 3. 恢复在线时自动推送本地变更到服务器
 * 4. 拉取其他设备的变更到本地
 *
 * 同步策略：基于时间戳的增量同步，冲突时"最后写入胜出"
 */

import { api } from '../api/api';

const SYNC_STORAGE_KEY = 'dental_sync';
const DEVICE_ID_KEY = 'dental_device_id';
const LAST_SYNC_KEY = 'dental_last_sync';

interface PendingChange {
  id: string;
  tableName: string;
  recordId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  data?: Record<string, unknown>;
  updatedAt: string;
}

interface SyncState {
  lastSyncTime: string;
  pendingChanges: PendingChange[];
  isOnline: boolean;
}

/** 互斥锁，防止并发 sync() */
let syncInProgress = false;

/** 生成唯一设备 ID（首次使用时生成并持久化） */
function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/** 加载同步状态 */
function loadSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as SyncState;
    }
  } catch {
    // ignore parse errors
  }
  return {
    lastSyncTime: new Date(0).toISOString(),
    pendingChanges: [],
    isOnline: navigator.onLine,
  };
}

/** 保存同步状态 */
function saveSyncState(state: SyncState): void {
  localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(state));
}

/** 获取上次同步时间 */
export function getLastSyncTime(): string {
  return localStorage.getItem(LAST_SYNC_KEY) || new Date(0).toISOString();
}

/** 设置上次同步时间 */
function setLastSyncTime(time: string): void {
  localStorage.setItem(LAST_SYNC_KEY, time);
}

/**
 * 记录一条本地变更（离线时调用）
 * @deprecated 当前无生产调用者，保留作为未来离线优先支持的基础设施。如确认不再需要可安全移除。
 */
export function recordLocalChange(
  tableName: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  data?: Record<string, unknown>,
): void {
  const state = loadSyncState();
  const change: PendingChange = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tableName,
    recordId,
    operation,
    data,
    updatedAt: new Date().toISOString(),
  };
  state.pendingChanges.push(change);
  saveSyncState(state);
}

/** 获取待同步的变更数量 */
export function getPendingChangeCount(): number {
  return loadSyncState().pendingChanges.length;
}

/** 当前是否在线 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * 推送本地变更到服务器
 */
export async function pushChanges(): Promise<{ accepted: number; conflicts: number }> {
  const state = loadSyncState();
  if (state.pendingChanges.length === 0) {
    return { accepted: 0, conflicts: 0 };
  }

  // 快照本次要发送的变更 ID，避免 await 期间新产生的变更被误清
  const sentIds = new Set(state.pendingChanges.map(c => c.id));

  try {
    const response = await api.post('/sync/push', {
      deviceId: getDeviceId(),
      changes: state.pendingChanges,
    });

    // 推送成功后只清除已发送的变更，保留 await 期间新增的变更
    const currentState = loadSyncState();
    currentState.pendingChanges = currentState.pendingChanges.filter(c => !sentIds.has(c.id));
    saveSyncState(currentState);

    return response.data as { accepted: number; conflicts: number };
  } catch (err) {
    // 推送失败，保留变更等待下次重试
    console.warn('[Sync] 推送变更失败:', err);
    throw err;
  }
}

/**
 * 从服务器拉取变更
 */
export async function pullChanges(): Promise<{ changes: unknown[]; serverTime: string }> {
  const since = getLastSyncTime();
  const deviceId = getDeviceId();

  const response = await api.get('/sync/pull', {
    params: { since, deviceId },
  });

  const result = response.data as { changes: unknown[]; serverTime: string };

  // 更新上次同步时间
  setLastSyncTime(result.serverTime);

  return result;
}

/**
 * 执行一次完整同步（先推后拉）
 * 内置互斥锁，防止多个触发源并发执行
 */
export async function sync(): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  if (!navigator.onLine) {
    return { pushed: 0, pulled: 0, conflicts: 0 };
  }

  // 互斥锁：如果已有同步在进行，直接返回
  if (syncInProgress) {
    return { pushed: 0, pulled: 0, conflicts: 0 };
  }

  syncInProgress = true;
  try {
    // 先推送本地变更
    const pushResult = await pushChanges();

    // 再拉取远端变更
    const pullResult = await pullChanges();

    return {
      pushed: pushResult.accepted,
      pulled: pullResult.changes.length,
      conflicts: pushResult.conflicts,
    };
  } finally {
    syncInProgress = false;
  }
}

/**
 * 初始化同步服务（在应用启动时调用）
 *
 * 1. 监听网络状态变化
 * 2. 恢复在线时自动触发同步
 * 3. 设置定期同步定时器
 *
 * @returns cleanup 函数，在应用卸载或 HMR 重载时调用，清理所有监听器和定时器
 *          防止内存泄漏（多次 initSyncService 调用会导致监听器累积）
 */
export function initSyncService(): () => void {
  // P0 修复：保存所有定时器和监听器引用，返回 cleanup 函数清理
  const timers: ReturnType<typeof setTimeout>[] = [];
  const intervals: ReturnType<typeof setInterval>[] = [];

  const onlineHandler = () => {
    // 延迟 2 秒后同步（等待网络稳定）
    timers.push(
      setTimeout(() => {
        sync().catch(() => {});
      }, 2000),
    );
  };

  const offlineHandler = () => {
    // 网络断开，进入离线模式
  };

  window.addEventListener('online', onlineHandler);
  window.addEventListener('offline', offlineHandler);

  // 定期同步（每 5 分钟）
  const intervalId = setInterval(() => {
    if (navigator.onLine) {
      sync().catch(() => {});
    }
  }, 5 * 60 * 1000);
  intervals.push(intervalId);

  // 启动时如果在线，立即同步一次
  if (navigator.onLine) {
    timers.push(
      setTimeout(() => {
        sync().catch(() => {});
      }, 3000),
    );
  }

  // 返回 cleanup 函数
  return () => {
    window.removeEventListener('online', onlineHandler);
    window.removeEventListener('offline', offlineHandler);
    intervals.forEach((id) => clearInterval(id));
    timers.forEach((id) => clearTimeout(id));
  };
}
