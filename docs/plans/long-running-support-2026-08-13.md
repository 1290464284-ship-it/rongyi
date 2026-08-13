# 长期运行支持方案（7×24 连续运行能力补强）

日期：2026-08-13
范围：Dental Clinic V2 桌面应用（Electron 主进程 + API 子进程 + better-sqlite3 + React 渲染层）
依据：6 路专项审查（Electron / API / Web / 数据 / QA / SRE）＋当日实测门禁

---

## 1. 现状盘点（已经具备的能力）

本项目在「单实例长跑」方向已属业内高水准，以下能力**已存在**，本方案不再重复建设：

| 能力 | 现状位置 |
|---|---|
| 自动备份调度（默认每日、加密、keep 1..365、失败告警） | `src/server/scheduler.ts` + `service-modules/backup.ts` |
| 审计日志 / 幂等记录 / 同步变更定期清理 | `scheduler.ts`（365 天 / 10 分钟 / 90 天） |
| 日志轮转（v2.log、desktop.log 5MB×5） | `infrastructure/logger.ts`、`electron/logging.cjs` |
| API 子进程崩溃退避重启（30s→5min，上限 5 次）+ 两级健康检查 | `electron/api-process.cjs` |
| 主↔API 双向孤儿防护（2s 心跳 / 10s 超时 / disconnect / ppid 探测） | `main.cjs`、`src/server/main.ts` |
| 启动完整性分级（clean-exit 标记 + quick_check / integrity_check） | `main.ts`、`infrastructure/database.ts` |
| 恢复链路（staged restore、VACUUM INTO 安全快照、WAL/SHM 侧车清理） | `restore-apply.ts`、`sqlite-files.ts` |
| 临时密钥文件清扫 / staged 清理 / 备份保留清理 | `api-process.cjs`、`backup.ts` |
| 深健康检查（integrity + 磁盘可写探测 + diskFreeBytes） | `http/health.ts` |
| 请求指标 + 稳定性快照（uptime/db/wal/log 体积） | `http/metrics.ts`、`http/stability.ts` |
| 可选崩溃上报（HTTPS 白名单 fail-closed） | `electron/logging.cjs` |

## 2. 缺口与优先级（SRE 审查结论）

| # | 能力 | 现状 | 优先级 | 本方案章节 |
|---|---|---|---|---|
| G1 | 主进程看门狗（JS 级 relaunch + 原生级 sidecar） | 缺失 | **P1** | §5.1 / §5.2 |
| G2 | 磁盘空间阈值预警 | 缺失（deep health 只返回数值） | **P1** | §4.2 |
| G3 | 周期 integrity_check + 增量维护（optimize/vacuum） | 缺失（仅启动时 + 备份 checkpoint） | **P1** | §4.1 |
| G4 | 内存 / 句柄 / 事件循环指标 | 缺失 | **P1** | §4.3 |
| G5 | WAL 治理（journal_size_limit、wal_autocheckpoint 显式化） | 缺失 | P2 | §4.1 |
| G6 | 更新检查自动重试（退避）+ 周期复查 | 缺失（仅手动重试） | P2 | §5.4 |
| G7 | 迁移失败自动回滚到 pre-migration 快照 | 部分（快照有、回滚靠人工） | P2 | §6.1 |
| G8 | 启动 quick_check 失败时的受控紧急修复（REINDEX） | 部分（脚本靠人工） | P2 | §6.2 |
| G9 | 系统休眠唤醒后的主动恢复 | 部分（靠心跳间接兜底） | P2 | §5.3 |
| G10 | 渲染进程崩溃自动恢复 | 缺失 | P2 | §5.5 |
| G11 | api-console.log 多级轮转 + 日志脱敏 | 部分（单层轮转、无脱敏） | P2 | §5.6 / §5.7 |
| G12 | 遥测（opt-in） | 部分（仅本地 metrics.json） | P3 | §7（设计） |

---

## 3. 设计总览

```
┌────────────────────────── Electron 主进程 ──────────────────────────┐
│  watchdog.cjs   —— JS 级 uncaughtException → 崩溃环计数 → relaunch   │
│  supervisor.cjs —— 原生级 sidecar（ELECTRON_RUN_AS_NODE），硬崩溃重启 │
│  powerMonitor   —— resume → API 健康检查 + IPC 通知子进程做快速维护   │
│  window.cjs     —— render-process-gone → 节流 reload                 │
│  autoUpdater    —— 指数退避重试 + 每 24h 周期复查                     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ IPC / HTTP
┌────────────────────────── API 子进程（node） ────────────────────────┐
│  scheduler.ts 扩展：                                               │
│    · 每日低峰 quick_check + PRAGMA optimize + wal_checkpoint        │
│    · 每周 incremental_vacuum（或受控全量 VACUUM）                     │
│    · 磁盘阈值监控（15min，低于阈值 → AlertService CRITICAL）         │
│    · 运行指标采样（内存/活动资源/事件循环延迟 → logs/stability.json） │
│  main.ts 启动：quick_check 失败 → emergency-repair（先备份，REINDEX） │
│  main.ts 迁移：失败 → pre-migration 快照自动回滚 → 重试一次           │
│  health.ts：deep health 增加体积/备份年龄/阈值判定字段                │
└──────────────────────────────────────────────────────────────────────┘
```

原则：
1. **不改业务行为**——所有新增任务只做「维护/观测/告警」，不触碰业务数据（除 §6 恢复链路）。
2. **fail-closed 保留**——任何自动恢复步骤都先做可回退副本。
3. **与现有风格一致**——定时器统一由 scheduler 管理（可 stop/unref）、告警走 AlertService、日志走 Logger。

---

## 4. API 子进程：维护调度扩展

### 4.1 数据库维护模块

新建 `apps/v2/src/server/maintenance/db-maintenance.ts`：

```ts
import type Database from 'better-sqlite3';
import type { Logger } from '../infrastructure/logger';

/** 与 scheduler.ts 的 onAlertCreate 输入形状保持一致 */
export interface MaintenanceAlert {
  alertType: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string;
  message: string;
  source: string;
  metricName?: string;
  suggestion?: string;
  clinicId?: string | null;
}

export interface DbMaintenanceOptions {
  db: Database.Database;
  logger: Logger;
  onAlert: (input: MaintenanceAlert) => void;
  /** 是否允许在维护窗口执行全量 VACUUM（会短暂阻塞写入） */
  allowFullVacuum?: boolean;
}

export interface DailyMaintenanceResult {
  integrityOk: boolean;
  optimizeOk: boolean;
  checkpointed: boolean;
  autoVacuum: number;
}

export interface WeeklyMaintenanceResult {
  vacuumedPages: number;
  skippedReason?: string;
}

/** 每日低峰：quick_check + PRAGMA optimize + WAL checkpoint。只读/元数据操作，不写业务数据。 */
export function runDailyDatabaseMaintenance(options: DbMaintenanceOptions): DailyMaintenanceResult {
  const { db, logger, onAlert } = options;
  let integrityOk = false;
  try {
    const rows = db.pragma('quick_check') as Array<{ quick_check: string }>;
    integrityOk = Array.isArray(rows) && rows.length === 1 && rows[0].quick_check === 'ok';
  } catch (error) {
    logger.error('daily integrity check failed', { action: 'maintenance-integrity', error });
  }
  if (!integrityOk) {
    onAlert({
      alertType: 'DB_INTEGRITY_FAILURE',
      level: 'CRITICAL',
      severity: 'CRITICAL',
      title: '数据库完整性检查失败',
      message: '每日 quick_check 未通过，请立即执行备份并联系管理员。',
      source: 'MAINTENANCE_INTEGRITY',
      metricName: 'daily_quick_check',
      suggestion: '先运行 设置→系统操作→备份，再执行 verify:database；必要时恢复最近备份。',
      clinicId: null,
    });
  }
  let optimizeOk = false;
  try {
    db.pragma('analysis_limit = 1000');
    db.pragma('optimize');
    optimizeOk = true;
  } catch (error) {
    logger.error('daily optimize failed', { action: 'maintenance-optimize', error });
  }
  let checkpointed = false;
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
    checkpointed = true;
  } catch (error) {
    logger.error('daily wal checkpoint failed', { action: 'maintenance-checkpoint', error });
  }
  const autoVacuum = Number(db.pragma('auto_vacuum', { simple: true }));
  logger.info('daily database maintenance finished', {
    action: 'maintenance-daily',
    integrityOk,
    optimizeOk,
    checkpointed,
    autoVacuum,
  });
  return { integrityOk, optimizeOk, checkpointed, autoVacuum };
}

/**
 * 每周：回收空闲页。auto_vacuum=INCREMENTAL 时用 incremental_vacuum（不重建表，
 * 逐页回收、耗时可控）；否则仅在 allowFullVacuum 时执行全量 VACUUM（阻塞写入，
 * 只应在深夜/停诊窗口开启）。
 */
export function runWeeklyDatabaseMaintenance(options: DbMaintenanceOptions): WeeklyMaintenanceResult {
  const { db, logger } = options;
  const autoVacuum = Number(db.pragma('auto_vacuum', { simple: true }));
  if (autoVacuum === 2) {
    // 每次回收最多 4096 个空闲页（约 16MB@4KB 页），控制单次阻塞时间。
    const before = Number(db.pragma('freelist_count', { simple: true }));
    db.pragma('incremental_vacuum(4096)');
    const after = Number(db.pragma('freelist_count', { simple: true }));
    logger.info('incremental vacuum finished', { action: 'maintenance-weekly', before, after });
    return { vacuumedPages: Math.max(0, before - after) };
  }
  if (!options.allowFullVacuum) {
    return { vacuumedPages: 0, skippedReason: 'auto_vacuum is not INCREMENTAL and full vacuum is disabled' };
  }
  db.exec('VACUUM');
  logger.info('full vacuum finished', { action: 'maintenance-weekly' });
  return { vacuumedPages: 0 };
}

/**
 * 一次性迁移：把已有库切换为 INCREMENTAL auto_vacuum。
 * auto_vacuum 必须重建库文件才生效，因此仅在显式开启 V2_ENABLE_AUTO_VACUUM=1
 * 且处于维护窗口时调用一次；之后无需再调。
 */
export function enableIncrementalAutoVacuum(db: Database.Database, logger: Logger): boolean {
  const current = Number(db.pragma('auto_vacuum', { simple: true }));
  if (current === 2) return true;
  if (process.env.V2_ENABLE_AUTO_VACUUM !== '1') return false;
  db.pragma('auto_vacuum = INCREMENTAL');
  db.exec('VACUUM');
  const after = Number(db.pragma('auto_vacuum', { simple: true }));
  logger.info('auto_vacuum migration finished', { action: 'maintenance-auto-vacuum', before: current, after });
  return after === 2;
}
```

`infrastructure/database.ts` 中 `createDatabase` 的 PRAGMA 段补充（显式化 WAL 治理）：

```ts
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');          // 医疗数据以耐久性优先；WAL+FULL 兼顾安全与性能
db.pragma('journal_size_limit = 67108864'); // WAL 文件上限 64MB，防止长期不 checkpoint 无限增长
db.pragma('wal_autocheckpoint = 1000');     // 默认值显式声明；备份/关闭路径仍走 TRUNCATE
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
```

### 4.2 磁盘监控模块

新建 `apps/v2/src/server/maintenance/disk-monitor.ts`：

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../infrastructure/logger';
import type { MaintenanceAlert } from './db-maintenance';

export interface DiskCheckResult {
  dir: string;
  freeBytes: number;
  ok: boolean;
}

const DEFAULT_THRESHOLD_BYTES = 1024 * 1024 * 1024; // 1GB

export function checkDiskFree(dir: string, thresholdBytes: number = DEFAULT_THRESHOLD_BYTES): DiskCheckResult {
  let freeBytes = 0;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const statfs = fs.statfsSync(dir);
    freeBytes = statfs.bavail * statfs.bsize;
  } catch {
    freeBytes = 0;
  }
  return { dir, freeBytes, ok: freeBytes > thresholdBytes };
}

export function startDiskMonitor(options: {
  dirs: string[];
  intervalMs: number;
  thresholdBytes?: number;
  logger: Logger;
  onAlert: (input: MaintenanceAlert) => void;
}): { stop(): void } {
  const thresholdBytes = options.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
  const alerted = new Set<string>();
  const timer = setInterval(() => {
    for (const dir of options.dirs) {
      const result = checkDiskFree(dir, thresholdBytes);
      if (result.ok) {
        if (alerted.delete(dir)) {
          options.logger.info('disk space recovered', { action: 'disk-monitor-recovered', dir });
        }
        continue;
      }
      if (alerted.has(dir)) continue; // 每个目录只告警一次，恢复后重置
      alerted.add(dir);
      options.logger.error('disk space below threshold', {
        action: 'disk-monitor',
        dir,
        freeBytes: result.freeBytes,
        thresholdBytes,
      });
      options.onAlert({
        alertType: 'DISK_SPACE_LOW',
        level: 'CRITICAL',
        severity: 'CRITICAL',
        title: '磁盘空间不足',
        message: `${path.basename(dir)} 所在磁盘剩余 ${Math.round(result.freeBytes / (1024 * 1024))}MB，低于告警阈值。请清理磁盘或迁移备份目录。`,
        source: 'DISK_MONITOR',
        metricName: 'disk_free_bytes',
        suggestion: '备份会自动保留最近 N 份；可在备份页调整保留数量，或把备份目录迁移到更大磁盘。',
        clinicId: null,
      });
    }
  }, options.intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
```

### 4.3 运行指标采样

新建 `apps/v2/src/server/maintenance/runtime-metrics.ts`：

```ts
import type Database from 'better-sqlite3';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface RuntimeMetricsSample {
  sampledAt: string;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  activeResources: Record<string, number>;
  eventLoop: { maxLagMs: number; meanLagMs: number; p99LagMs: number };
  db: {
    pageCount: number;
    freelistCount: number;
    walSizeHint: number;
  };
}

export function createRuntimeMetricsSampler(
  db: Database.Database,
  getWalSizeBytes: () => number,
): { sample(): RuntimeMetricsSample } {
  const lagHistogram = monitorEventLoopDelay({ resolution: 20 });
  lagHistogram.enable();
  return {
    sample(): RuntimeMetricsSample {
      const mem = process.memoryUsage();
      const resources: Record<string, number> = {};
      for (const raw of process.getActiveResourcesInfo()) {
        const name = raw.split('-').length > 1 ? raw.split('-')[0] : raw;
        resources[name] = (resources[name] ?? 0) + 1;
      }
      return {
        sampledAt: new Date().toISOString(),
        memory: {
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
          externalBytes: mem.external,
        },
        activeResources: resources,
        eventLoop: {
          maxLagMs: Number(lagHistogram.max.toFixed(2)),
          meanLagMs: Number(lagHistogram.mean.toFixed(2)),
          p99LagMs: Number(lagHistogram.percentile(99).toFixed(2)),
        },
        db: {
          pageCount: Number(db.pragma('page_count', { simple: true })),
          freelistCount: Number(db.pragma('freelist_count', { simple: true })),
          walSizeHint: getWalSizeBytes(),
        },
      };
    },
  };
}
```

### 4.4 scheduler 集成

`scheduler.ts` 的 `StartSchedulersOptions` 增加三个可选回调（缺省则不注册对应定时器，保持向后兼容）：

```ts
interface StartSchedulersOptions {
  // ...现有字段...
  /** 每日数据库维护（quick_check + optimize + checkpoint）。 */
  dailyDbMaintenance?: () => void;
  /** 每周数据库维护（incremental_vacuum / 受控 VACUUM）。 */
  weeklyDbMaintenance?: () => void;
  /** 磁盘空间检查（由 startDiskMonitor 包装或直接注入检查函数）。 */
  diskCheck?: () => void;
  /** 系统休眠唤醒后触发一次即时维护（IPC 'resume' 消息驱动）。 */
  onResume?: () => void;
}
```

`startSchedulers` 内新增（沿用现有 `schedule`/`scheduleOnce` helper，全部 unref 并纳入 `timers` 数组统一 stop）：

```ts
const MAINTENANCE_DAILY_OFFSET_MS = 2 * 60 * 60 * 1000; // 启动 2 小时后首次执行，避开开机高峰
const MAINTENANCE_WEEKLY_MS = 7 * DAILY_MS;
const DISK_CHECK_INTERVAL_MS = 15 * 60 * 1000;

if (dailyDbMaintenance) {
  scheduleOnce(() => dailyDbMaintenance(), MAINTENANCE_DAILY_OFFSET_MS);
  schedule(dailyDbMaintenance, DAILY_MS);
}
if (weeklyDbMaintenance) {
  scheduleOnce(() => weeklyDbMaintenance(), MAINTENANCE_DAILY_OFFSET_MS + 60 * 60 * 1000);
  schedule(weeklyDbMaintenance, MAINTENANCE_WEEKLY_MS);
}
if (diskCheck) {
  schedule(diskCheck, DISK_CHECK_INTERVAL_MS);
}

// 暴露给 main.ts 的 process.on('message')：系统唤醒后立即做一次维护，
// 弥补定时器在休眠期间暂停带来的窗口。
return {
  async stop() { /* 现有实现 */ },
  triggerResumeMaintenance(): void {
    try {
      onResume?.();
      dailyDbMaintenance?.();
    } catch (error) {
      logger.error('resume maintenance failed', { action: 'maintenance-resume', error });
    }
  },
};
```

`src/server/main.ts` 接线：

```ts
import { runDailyDatabaseMaintenance, runWeeklyDatabaseMaintenance, enableIncrementalAutoVacuum } from './maintenance/db-maintenance';
import { checkDiskFree } from './maintenance/disk-monitor';
import { createRuntimeMetricsSampler } from './maintenance/runtime-metrics';

// createDatabase 之后：
enableIncrementalAutoVacuum(db, logger); // 仅当 V2_ENABLE_AUTO_VACUUM=1 时执行一次

const runtimeSampler = createRuntimeMetricsSampler(db, () => {
  try { return fs.statSync(`${dbPath}-wal`).size; } catch { return 0; }
});

const schedulers = startSchedulers({
  // ...现有参数...
  dailyDbMaintenance: () => runDailyDatabaseMaintenance({ db, logger, onAlert: (input) => alerts.create(input) }),
  weeklyDbMaintenance: () => runWeeklyDatabaseMaintenance({ db, logger, onAlert: (input) => alerts.create(input), allowFullVacuum: process.env.V2_ENABLE_FULL_VACUUM === '1' }),
  diskCheck: () => {
    const result = checkDiskFree(backupDir);
    if (!result.ok) {
      logger.error('disk space below threshold', { action: 'disk-check', ...result });
      alerts.create({ alertType: 'DISK_SPACE_LOW', level: 'CRITICAL', severity: 'CRITICAL', title: '磁盘空间不足', message: `剩余 ${Math.round(result.freeBytes / 1048576)}MB`, source: 'DISK_MONITOR', clinicId: null });
    }
  },
  onResume: () => { /* 即时维护由 triggerResumeMaintenance 统一触发 */ },
});

// 与 metrics.json 的现有持久化同频（例如每小时一次，可并入既有定时器）：
const metricsTimer = setInterval(() => {
  persistRuntimeMetrics(logDir, runtimeSampler.sample());
}, 60 * 60 * 1000);
metricsTimer.unref?.();
```

`process.on('message')` 分支补充（与现有 `'shutdown'` 并列）：

```ts
process.on('message', (message) => {
  lastParentMessageAt = Date.now();
  if (message === 'shutdown') {
    // ...现有实现...
  }
  if (message === 'resume') {
    logger.info('system resumed from sleep; running immediate maintenance', { action: 'system-resume' });
    schedulers.triggerResumeMaintenance();
  }
});
```

> 注意：`persistRuntimeMetrics` 需要在 `maintenance/runtime-metrics.ts` 里补一个与 `persistStabilityMetrics` 同风格的落盘函数（写 `logs/runtime.json`），实现略。

---

## 5. Electron 主进程：可靠性补强

### 5.1 JS 级看门狗（uncaughtException → 崩溃环计数 → relaunch）

新建 `apps/v2/electron/watchdog.cjs`：

```js
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const WATCHDOG_WINDOW_MS = 10 * 60 * 1000; // 10 分钟窗口
const WATCHDOG_MAX_RESTARTS = 3;           // 窗口内最多自动重启 3 次

function crashLoopPath() {
  return path.join(app.getPath('userData'), 'crash-loop.json');
}

function readCrashLoop() {
  try {
    const parsed = JSON.parse(fs.readFileSync(crashLoopPath(), 'utf8'));
    return { count: Number(parsed.count) || 0, windowStart: Number(parsed.windowStart) || 0 };
  } catch {
    return { count: 0, windowStart: 0 };
  }
}

function writeCrashLoop(state) {
  try {
    fs.writeFileSync(crashLoopPath(), JSON.stringify(state), 'utf8');
  } catch {
    // best effort
  }
}

/**
 * 崩溃后是否允许自动重启。窗口内计数，超过上限则放弃并写停止标记，
 * 让外部 supervisor 也放弃拉起（避免无限崩溃循环）。
 */
function shouldRelaunch(stopMarkerPath) {
  const now = Date.now();
  const current = readCrashLoop();
  if (now - current.windowStart > WATCHDOG_WINDOW_MS) {
    writeCrashLoop({ count: 1, windowStart: now });
    return true;
  }
  const count = current.count + 1;
  if (count > WATCHDOG_MAX_RESTARTS) {
    try {
      fs.writeFileSync(stopMarkerPath, String(now), 'utf8');
    } catch {
      // best effort
    }
    return false;
  }
  writeCrashLoop({ count, windowStart: current.windowStart });
  return true;
}

/** 崩溃路径：尽力同步终止 API 子进程，然后 relaunch。 */
function relaunchAfterCrash(stopMarkerPath) {
  if (!shouldRelaunch(stopMarkerPath)) return false;
  try {
    require('./api-process.cjs').terminateApiSync();
  } catch {
    // best effort：relaunch 后新实例会按孤儿防护/单实例锁处理旧进程
  }
  try {
    app.relaunch({ execPath: process.execPath });
  } catch {
    return false;
  }
  app.exit(1);
  return true;
}

module.exports = { relaunchAfterCrash, crashLoopPath };
```

`logging.cjs` 的崩溃处理器改为调用看门狗（保持「先记日志」语义）：

```js
// logging.cjs 顶部增加：
const stopMarkerPath = () =>
  path.join(app.getPath('userData'), '.supervisor-stop');

process.on('uncaughtException', (error) => {
  crashLog('uncaughtException', error);
  const { relaunchAfterCrash } = require('./watchdog.cjs'); // 延迟 require 避免循环依赖
  if (!relaunchAfterCrash(stopMarkerPath())) {
    try { app.exit(1); } catch { process.exit(1); }
  }
});
process.on('unhandledRejection', (reason) => {
  crashLog('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  const { relaunchAfterCrash } = require('./watchdog.cjs');
  if (!relaunchAfterCrash(stopMarkerPath())) {
    try { app.exit(1); } catch { process.exit(1); }
  }
});
```

`main.cjs` 在正常退出路径写停止标记（让 supervisor 不拉起）：

```js
app.on('will-quit', () => {
  terminateApiSync();
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), '.supervisor-stop'), String(Date.now()), 'utf8');
  } catch {
    // best effort
  }
});
```

### 5.2 原生级 supervisor（硬崩溃 / taskkill 场景）

JS 级看门狗覆盖 `uncaughtException`，但主进程段错误、`taskkill /F` 时任何 JS 都不会执行。为此增加 sidecar：主进程启动时用 `ELECTRON_RUN_AS_NODE=1` 以纯 Node 方式拉起一个极小的监督脚本，主进程死亡且未写停止标记时由它拉起应用。

新建 `apps/v2/electron/supervisor.cjs`：

```js
// 由 main.cjs 以 ELECTRON_RUN_AS_NODE=1 启动：argv = [appExe, userDataDir, parentPid, stopMarker]
// 只做一件事：父进程死了且没有停止标记 → 以退避方式重新拉起应用。
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const [appExe, userDataDir, parentPidStr, stopMarker] = process.argv.slice(2);
const parentPid = Number(parentPidStr);
if (!appExe || !Number.isFinite(parentPid)) process.exit(0);

const POLL_MS = 2000;
const BACKOFF_MS = [1000, 5000, 15000];
const MAX_CONSECUTIVE = 3;
let consecutive = 0;

function parentAlive() {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

const timer = setInterval(() => {
  try {
    if (fs.existsSync(stopMarker)) {
      try { fs.rmSync(stopMarker, { force: true }); } catch { /* best effort */ }
      process.exit(0);
    }
  } catch {
    // userData 不可读时继续按父进程存活判断
  }
  if (parentAlive()) {
    consecutive = 0;
    return;
  }
  consecutive += 1;
  if (consecutive > MAX_CONSECUTIVE) {
    // 连续拉起失败：放弃，等待用户干预（避免重启风暴）
    process.exit(2);
  }
  const delay = BACKOFF_MS[Math.min(consecutive - 1, BACKOFF_MS.length - 1)];
  setTimeout(() => {
    try {
      const env = { ...process.env, V2_SUPERVISED: '1' };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(appExe, [], { detached: true, stdio: 'ignore', env, windowsHide: true });
      child.unref();
    } catch {
      // best effort
    }
    process.exit(0);
  }, delay);
}, POLL_MS);
timer.unref();
```

`main.cjs` 在 `whenReady` 内、`startApi()` 成功后拉起：

```js
function spawnSupervisor() {
  if (isDev || process.env.V2_ENABLE_WATCHDOG === '0') return;
  try {
    const supervisorPath = path.join(__dirname, 'supervisor.cjs');
    const stopMarker = path.join(app.getPath('userData'), '.supervisor-stop');
    const child = spawn(process.execPath, [supervisorPath, process.execPath, app.getPath('userData'), String(process.pid), stopMarker], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child.unref();
  } catch (error) {
    crashLog('supervisor-spawn-failed', error);
  }
}
// whenReady 内：
await startApi();
spawnSupervisor();
```

与单实例锁的关系：supervisor 拉起的新实例会重新获取 `requestSingleInstanceLock`；若用户已手动重开应用，新实例收到锁失败即退出，supervisor 退出——不存在双实例写库（数据库写侧另有孤儿防护与健康检查兜底）。

### 5.3 休眠唤醒恢复（powerMonitor）

`main.cjs` 引入 `powerMonitor`，唤醒后：通知 API 子进程做即时维护 + 强制健康检查：

```js
const { app, BrowserWindow, powerMonitor, /* ... */ } = require('electron');

app.whenReady().then(async () => {
  // ...现有初始化...
  powerMonitor.on('resume', () => {
    try {
      state.apiProcess?.send?.('resume');
    } catch {
      // best effort：子进程侧消息丢失时下面的健康检查仍会兜底
    }
    void ensureApiServerRunning()
      .then(() => console.log('[power-resume] api healthy after resume'))
      .catch((error) => {
        crashLog('power-resume-api-error', error);
        notify('系统唤醒后服务异常', '本地服务已自动重启，若页面异常请刷新。');
      });
  });
});
```

> 说明：Windows 休眠可能使 better-sqlite3 的文件句柄指向失效；`ensureApiServerRunning` 的严格健康检查窗口（2s）会在 API 挂死时走「杀进程 → 重启」路径，重启后自动执行启动完整性检查（clean-exit 标记不存在时走 `integrity_check`）。因此「唤醒 → 健康检查 → 必要时重启」已构成完整的恢复链路，无需额外 DB 操作。

### 5.4 更新检查自动重试与周期复查

`main.cjs` 把现有的一次性 `checkForUpdates` 替换为带退避的版本：

```js
const UPDATE_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000]; // 1min / 5min / 30min
const UPDATE_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let updateCheckAttempts = 0;
let updateRecheckTimer = null;

function scheduleUpdateChecks() {
  const attemptCheck = () => {
    autoUpdater.checkForUpdates()
      .then(() => {
        updateCheckAttempts = 0;
      })
      .catch((error) => {
        updateCheckAttempts += 1;
        if (updateCheckAttempts >= 3) {
          updateCheckAttempts = 0;
          sendUpdateEvent({ type: 'error', message: `更新检查连续失败：${error instanceof Error ? error.message : String(error)}` });
          return;
        }
        setTimeout(attemptCheck, UPDATE_RETRY_DELAYS_MS[updateCheckAttempts - 1]);
      });
  };
  attemptCheck();
  updateRecheckTimer = setInterval(() => {
    void attemptCheck();
  }, UPDATE_RECHECK_INTERVAL_MS);
  updateRecheckTimer.unref?.();
}

// whenReady 内替换现有调用：
if (!isDev && process.env.V2_DISABLE_AUTO_UPDATE !== '1') scheduleUpdateChecks();

// will-quit 清理：
app.on('will-quit', () => {
  if (updateRecheckTimer) clearInterval(updateRecheckTimer);
  // ...现有 terminateApiSync / 停止标记...
});
```

### 5.5 渲染进程崩溃自动恢复

`window.cjs` 的 `render-process-gone` 处理器改为节流恢复：

```js
const RENDERER_CRASH_WINDOW_MS = 10 * 60 * 1000;
const RENDERER_CRASH_MAX = 3;
let rendererCrashCount = 0;
let rendererCrashWindowStart = 0;

// createWindow 内：
mainWindow.webContents.on('render-process-gone', (_event, details) => {
  crashLog('render-process-gone', new Error(`reason=${details.reason} exitCode=${details.exitCode}`));
  if (state.isQuitting) return;
  const now = Date.now();
  if (now - rendererCrashWindowStart > RENDERER_CRASH_WINDOW_MS) {
    rendererCrashCount = 0;
    rendererCrashWindowStart = now;
  }
  rendererCrashCount += 1;
  if (rendererCrashCount > RENDERER_CRASH_MAX) {
    notify('界面多次崩溃', '已停止自动恢复，请通过托盘菜单退出后重启应用。');
    return;
  }
  if (mainWindow.isDestroyed()) return;
  // 被系统/用户强杀（如任务管理器）稍作延迟，其余原因立即恢复
  const delay = details.reason === 'killed' ? 500 : 0;
  setTimeout(() => {
    if (!mainWindow.isDestroyed() && !state.isQuitting) mainWindow.reload();
  }, delay);
});
```

### 5.6 api-console.log 多级轮转

`api-process.cjs` 的 `appendApiConsole` 改为与 `logging.cjs` 一致的 5MB×5 轮转：

```js
const appendApiConsole = (chunk) => {
  try {
    const MAX = API_CONSOLE_MAX_BYTES;
    let size = 0;
    try { size = fs.statSync(apiConsolePath).size; } catch { /* first write */ }
    if (size + chunk.length > MAX) {
      for (let i = 4; i >= 1; i -= 1) {
        const rotated = `${apiConsolePath}.${i}`;
        if (fs.existsSync(rotated)) fs.renameSync(rotated, `${apiConsolePath}.${i + 1}`);
      }
      fs.renameSync(apiConsolePath, `${apiConsolePath}.1`);
    }
    fs.appendFileSync(apiConsolePath, chunk);
  } catch {
    // best effort
  }
};
```

### 5.7 日志脱敏

新建 `apps/v2/electron/redact.cjs`（同时给 server 侧 Logger 提供同规则 TS 版本，规则保持同一份注释同步）：

```js
// 日志脱敏规则（与 src/server/infrastructure/redact.ts 保持一致）：
// 请求日志本身不记 body/header；此处只对可能混入错误消息/栈里的
// 手机号、18 位身份证号做掩码。掩码有误伤可能（如纯数字订单号），
// 但宁可多掩不可泄漏。
const PHONE_RE = /\b1[3-9]\d{9}\b/g;
const ID_CARD_RE = /\b\d{17}[\dXx]\b/g;

function redactSensitiveText(text) {
  return String(text)
    .replace(PHONE_RE, (match) => `${match.slice(0, 3)}****${match.slice(-4)}`)
    .replace(ID_CARD_RE, (match) => `${match.slice(0, 4)}**********${match.slice(-4)}`);
}

module.exports = { redactSensitiveText };
```

`logging.cjs` 的 `crashLog` 与 `api-process.cjs` 的 `appendApiConsole` 套用：

```js
// logging.cjs
const { redactSensitiveText } = require('./redact.cjs');
function crashLog(message, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    message: redactSensitiveText(message),
    stack: redactSensitiveText(String(error?.stack ?? error).split('\n').slice(0, 20).join('\n')),
  };
  // ...其余不变...
}

// api-process.cjs
const { redactSensitiveText } = require('./redact.cjs');
// appendApiConsole 内：
fs.appendFileSync(apiConsolePath, redactSensitiveText(String(chunk)));
```

服务端同规则 TS 版（`src/server/infrastructure/redact.ts`，供 `Logger.serializeValue` 对字符串值调用）：

```ts
const PHONE_RE = /\b1[3-9]\d{9}\b/g;
const ID_CARD_RE = /\b\d{17}[\dXx]\b/g;

/** 与 electron/redact.cjs 保持同一套规则；只掩码明显 PII 模式。 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(PHONE_RE, (match) => `${match.slice(0, 3)}****${match.slice(-4)}`)
    .replace(ID_CARD_RE, (match) => `${match.slice(0, 4)}**********${match.slice(-4)}`);
}
```

---

## 6. 数据库恢复链路

### 6.1 迁移失败自动回滚

迁移前快照已存在（`migrations/index.ts` 写入 `<snapshotDir>/pre-migration/pre-<ts>.sqlite`，keep=3）。补上「迁移失败 → 回滚最近快照 → 重试一次」的自动链路。

新建 `apps/v2/src/server/infrastructure/migration-recovery.ts`：

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';

/**
 * 迁移失败时的自动回滚：恢复 dataDir/pre-migration/ 下最新的快照到 dbPath。
 * 只有在「本次启动确实尝试过迁移」时才调用（runMigrations 抛错），
 * 因此回滚丢失的数据窗口 ≈ 迁移开始到失败的几秒，风险可控。
 */
export function restoreLatestMigrationSnapshot(dataDir: string, dbPath: string, logger: Logger): boolean {
  const snapshotDir = path.join(dataDir, 'pre-migration');
  let candidates: string[] = [];
  try {
    candidates = fs.readdirSync(snapshotDir)
      .filter((name) => /^pre-\d+\.sqlite$/.test(name))
      .map((name) => path.join(snapshotDir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    return false;
  }
  const newest = candidates[0];
  if (!newest) return false;
  try {
    // 1. 把失败后的半迁移库改名留证（不删除，供人工排查）
    fs.renameSync(dbPath, `${dbPath}.failed-${Date.now()}`);
    // 2. 清除 WAL/SHM 侧车（与 restore-apply 的既有逻辑一致）
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* best effort */ }
    }
    // 3. 原子落位
    fs.copyFileSync(newest, dbPath);
    logger.error('migration failed; rolled back to pre-migration snapshot', {
      action: 'migration-rollback',
      snapshot: newest,
      failedCopy: `${dbPath}.failed-${Date.now()}`,
    });
    return true;
  } catch (error) {
    logger.error('migration rollback failed', { action: 'migration-rollback', error });
    return false;
  }
}
```

`main.ts` 引导段改造：

```ts
let appliedMigrations: number;
try {
  appliedMigrations = runMigrations(db, { snapshotDir: dataDir });
} catch (error) {
  logger.error('migration failed', { action: 'migrations', error });
  db.close();
  const recovered = restoreLatestMigrationSnapshot(dataDir, dbPath, logger);
  if (!recovered) {
    throw new Error('数据库迁移失败且自动回滚失败。请从备份恢复或联系管理员。');
  }
  // 用回滚后的库重新打开并重试一次；再次失败则 fail-closed
  const retried = createDatabase(dataDir, dbPath, { fullIntegrityCheck: true });
  try {
    appliedMigrations = runMigrations(retried, { snapshotDir: dataDir });
    activeDb = retried; // 后续 createApp 使用 retried 实例
  } catch (retryError) {
    logger.error('migration failed again after rollback', { action: 'migrations', error: retryError });
    retried.close();
    throw new Error('数据库迁移在回滚后再次失败。请从备份恢复或联系管理员。');
  }
}
```

> 实现提示：`db` 变量目前是 `const`，改造时需要把它变为可重绑定的局部变量（如 `let activeDb = db`），后续 `createApp({ db: activeDb, ... })` 与调度器回调统一使用 `activeDb`。此改动机械但必须整体替换引用，建议配套回归：给 `migration-recovery.ts` 写单测（快照命名、失败副本留存、WAL 清理），并用 `disaster:drill` 风格脚本加一条「注入失败迁移 → 自动回滚 → 数据完好」的演练。

### 6.2 启动 quick_check 失败时的受控紧急修复

现有行为：启动 quick_check 失败 → fail-closed → 错误窗提示恢复备份。补一个「先备份、再 REINDEX、仍失败才拒绝」的受控步骤，减少不必要的停机。

新建 `apps/v2/src/server/infrastructure/emergency-repair.ts`：

```ts
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Logger } from './logger';

export interface EmergencyRepairResult {
  repaired: boolean;
  backupPath?: string;
  detail: string;
}

/**
 * 受控紧急修复：只做「文件副本 + REINDEX + integrity_check」，
 * 不做任何业务 DML。默认开启；V2_EMERGENCY_REPAIR=0 时直接返回未修复。
 */
export function attemptEmergencyRepair(dbPath: string, logger: Logger): EmergencyRepairResult {
  if (process.env.V2_EMERGENCY_REPAIR === '0') {
    return { repaired: false, detail: 'emergency repair disabled by V2_EMERGENCY_REPAIR=0' };
  }
  const backupPath = `${dbPath}.corrupt-${Date.now()}`;
  try {
    fs.copyFileSync(dbPath, backupPath);
  } catch (error) {
    logger.error('emergency repair pre-copy failed', { action: 'emergency-repair', error });
    return { repaired: false, detail: 'pre-repair copy failed' };
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('REINDEX');
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const ok = Array.isArray(rows) && rows.length === 1 && rows[0].integrity_check === 'ok';
    if (ok) {
      logger.warn('emergency repair succeeded; original kept as corrupt copy', {
        action: 'emergency-repair',
        backupPath,
      });
      return { repaired: true, backupPath, detail: 'REINDEX restored integrity' };
    }
    // 修复无效：把损坏文件放回原位，保持 fail-closed 语义
    db.close();
    db = null;
    fs.rmSync(dbPath, { force: true });
    fs.renameSync(backupPath, dbPath);
    return { repaired: false, detail: 'integrity_check still failing after REINDEX' };
  } catch (error) {
    logger.error('emergency repair failed', { action: 'emergency-repair', error });
    try {
      if (db) db.close();
      // 修复过程异常：同样还原原文件
      fs.rmSync(dbPath, { force: true });
      fs.renameSync(backupPath, dbPath);
    } catch {
      // best effort：还原失败时原备份文件仍在 backupPath
    }
    return { repaired: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
```

`main.ts` 引导段（在 `shouldImportLegacyDb` 决策的 `promptRestore` 分支前插入）：

```ts
if (decision.promptRestore) {
  const repair = attemptEmergencyRepair(v2DbPath, logger);
  if (repair.repaired) {
    logger.warn('database repaired at startup; continuing', { action: 'startup-repair', ...repair });
  } else {
    logger.error('v2 database failed integrity check (quick_check); refusing to start', {
      action: 'v2-db-integrity-check',
      path: v2DbPath,
      repairDetail: repair.detail,
    });
    throw new Error(
      'v2.sqlite 未通过完整性检查且自动修复未成功。请从备份恢复，或删除损坏的 v2.sqlite 后重启以重新导入 legacy 数据库。',
    );
  }
}
```

---

## 7. 遥测设计（P3，仅设计不实现）

原则：医疗数据零出网；遥测只含聚合计数，永不包含患者/人员可识别信息；沿用崩溃上报的「HTTPS + 主机白名单 + 环境变量」模式，默认关闭。

- 配置：`V2_TELEMETRY_URL`（HTTPS，白名单校验同 `isAllowedCrashReportUrl`）+ `V2_TELEMETRY_INTERVAL_HOURS`（默认 6）。
- 载荷：`{ appVersion, platform, uptimeSeconds, dbSizeBytes, walSizeBytes, backupCount, requestCount, error5xxCount, p95Ms, crashCount, memoryRss }`。
- 发送：API 子进程聚合（已有 metrics/stability/runtime 快照），主进程经白名单校验后 POST；失败静默丢弃并退避。
- 价值：支撑「长期运行」的可观测闭环——客户端数量、崩溃率、数据库规模分布，为发布决策提供依据。

---

## 8. 测试与验证计划

| 模块 | 验证方式 |
|---|---|
| db-maintenance | 单测：quick_check 失败→CRITICAL 告警；optimize/checkpoint 幂等；incremental_vacuum 前后 freelist_count 变化；allowFullVacuum=false 跳过 |
| disk-monitor | 单测：阈值边界、单次告警、恢复重置；用临时目录模拟 |
| runtime-metrics | 单测：sample() 形状与关键字段存在；event loop 直方图可读 |
| scheduler 扩展 | 沿用 `scheduler.spec.ts` 风格：新增回调注册/stop 清空/triggerResumeMaintenance 调 verify 假计时器 |
| watchdog.cjs | electron 单测（已有 mocked electron 测试基建）：崩溃环计数、窗口重置、超限写停止标记、relaunch 调用断言 |
| supervisor.cjs | 手动/脚本验证（`scripts/` 下加 `supervisor-smoke.mjs`：拉起 supervisor → kill 模拟父进程 → 断言拉起命令被触发；停止标记 → 断言退出） |
| powerMonitor / 更新重试 / 渲染恢复 | 主进程单测 + `smoke:packaged-ui-simulated` 场景扩展 |
| migration-recovery / emergency-repair | 单测 + 新演练 `drill:migration-failure`（注入坏迁移 → 断言自动回滚 + 数据完好）；emergency-repair 用损坏库副本做正/负用例 |
| 日志脱敏 | 单测：手机号/身份证掩码、非 PII 数字串不受影响（边界说明） |

---

## 9. 落地顺序与工期估算

| 阶段 | 内容 | 工期 |
|---|---|---|
| A（本周） | §4.1 每日维护 + §4.2 磁盘告警 + §4.3 指标采样 + scheduler 集成（P1 三件套） | 2–3 天 |
| B（下周） | §5.1 JS 看门狗 + §5.2 supervisor + 停止标记接线 | 2 天 |
| C（第 3 周） | §5.3 resume 恢复 + §5.4 更新重试 + §5.5 渲染恢复 + §5.6/§5.7 轮转与脱敏 | 2–3 天 |
| D（第 4 周） | §6.1 迁移回滚 + §6.2 紧急修复 + PRAGMA 显式化 + 演练脚本 | 3 天 |
| E（之后） | §7 遥测（需要服务端）+ G5 auto_vacuum 一次性迁移（选低峰窗口） | 按需 |

每阶段交付都过 `pnpm --filter @dental/v2 typecheck && lint && test`，阶段 C 额外过 `smoke:packaged-ui-simulated` 与新增 supervisor smoke。

## 10. 风险与注意事项

1. **auto_vacuum 迁移不可逆**：`VACUUM` 重建库文件期间写被阻塞（本地单实例可接受），首次执行前必须先做一次加密备份；`V2_ENABLE_AUTO_VACUUM` 只在维护窗口打开一次。
2. **supervisor 与多开**：单实例锁兜底双实例；`V2_SUPERVISED=1` 仅作标记，无行为差异。
3. **看门狗 vs 崩溃上报**：relaunch 前必须先 `crashLog`（保留现场），顺序不可颠倒。
4. **脱敏误伤**：掩码作用于日志文本而非业务数据；纯数字单据号可能被部分掩码，接受此代价并在规则注释中说明。
5. **紧急修复的边界**：只 REINDEX + integrity_check，不碰数据；修复失败必须还原原文件（fail-closed 不因修复引入新损坏）。
6. **迁移回滚留证**：失败后的半迁移库改名留存而非删除，便于事后诊断；需配套保留策略（如超过 3 个 `.failed-*` 副本时清理最旧）。
