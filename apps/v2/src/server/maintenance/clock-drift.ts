import fs from 'node:fs';

/**
 * A-P3.3：系统时钟漂移检测。
 *
 * 上次启动时间戳若落在未来（超过 maxDriftMs 偏差），说明系统时钟被回拨或
 * 错误设置——登录令牌过期、备份时间戳错乱类故障的最常见根因。检测只读
 * 标记文件并返回结果，由调用方决定告警；所有异常路径视为无漂移（可观测
 * 性检查不能拖垮启动）。
 */
export interface ClockDriftResult {
  drifted: boolean;
  lastStartedAt: string | null;
  driftMs: number;
}

export function checkClockDrift(markerPath: string, maxDriftMs: number): ClockDriftResult {
  try {
    if (!fs.existsSync(markerPath)) {
      return { drifted: false, lastStartedAt: null, driftMs: 0 };
    }
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { startedAt?: unknown };
    if (typeof parsed.startedAt !== 'string') {
      return { drifted: false, lastStartedAt: null, driftMs: 0 };
    }
    const driftMs = Date.now() - new Date(parsed.startedAt).getTime();
    return {
      drifted: Number.isFinite(driftMs) && driftMs < -maxDriftMs,
      lastStartedAt: parsed.startedAt,
      driftMs: Number.isFinite(driftMs) ? driftMs : 0,
    };
  } catch {
    return { drifted: false, lastStartedAt: null, driftMs: 0 };
  }
}

/** 记录本次启动时间戳；失败静默（标记写失败不影响启动）。 */
export function writeClockMarker(markerPath: string, dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({ startedAt: new Date().toISOString() }), 'utf8');
  } catch {
    // best effort
  }
}
