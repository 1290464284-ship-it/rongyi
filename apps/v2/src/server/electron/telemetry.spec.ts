import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface TelemetryModule {
  startTelemetry(): void;
  stopTelemetry(): void;
}

describe('electron telemetry', () => {
  let tempDir: string;
  let sent: Array<{ url: string; body: string }>;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.V2_TELEMETRY_URL;
    delete process.env.V2_ALLOWED_CRASH_REPORT_HOSTS;
    delete process.env.V2_TELEMETRY_INTERVAL_HOURS;
    vi.useRealTimers();
  });

  function loadTelemetry(requestMock: ReturnType<typeof vi.fn>) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-telemetry-'));
    return loadElectronModule<TelemetryModule>('../../../electron/telemetry.cjs', {
      electron: { app: { getPath: () => tempDir, getVersion: () => '2.2.0' } },
      'node:https': { request: requestMock },
    });
  }

  it('is disabled by default and fails closed for non-allowlisted hosts', () => {
    const requestMock = vi.fn();
    const mod = loadTelemetry(requestMock);
    mod.startTelemetry(); // 未配置 URL → no-op
    mod.stopTelemetry();
    process.env.V2_TELEMETRY_URL = 'https://evil.example/telemetry';
    mod.startTelemetry(); // 主机不在白名单 → no-op
    mod.stopTelemetry();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('uploads an aggregate payload without PII fields when configured', () => {
    sent = [];
    const requestMock = vi.fn((url: string, _options: unknown, callback: unknown) => {
      const req = {
        on: vi.fn(() => req),
        end: vi.fn((body: string) => {
          sent.push({ url, body });
          (callback as (response: { resume(): void }) => void)({ resume: vi.fn() });
        }),
        destroy: vi.fn(),
      };
      return req;
    });
    process.env.V2_TELEMETRY_URL = 'https://metrics.example/telemetry';
    process.env.V2_ALLOWED_CRASH_REPORT_HOSTS = 'metrics.example';
    const mod = loadTelemetry(requestMock);
    mod.startTelemetry();
    mod.stopTelemetry();

    expect(sent).toHaveLength(1);
    const payload = JSON.parse(sent[0].body) as Record<string, unknown>;
    expect(payload.appVersion).toBe('2.2.0');
    expect(payload.platform).toBe(process.platform);
    const stability = payload.stability as Record<string, unknown>;
    // 载荷只含聚合计数/体积，绝无患者/人员字段
    expect(Object.keys(payload)).toEqual(['appVersion', 'platform', 'arch', 'sampledAt', 'stability']);
    expect(Object.keys(stability).sort()).toEqual(
      ['backupCount', 'dbSizeBytes', 'logBytes', 'uptimeSeconds', 'walSizeBytes'].sort(),
    );
  });
});
