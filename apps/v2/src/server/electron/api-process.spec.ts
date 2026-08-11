import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface ApiProcessModule {
  terminateApiSync(): void;
}

interface ApiEnvModule {
  buildApiChildEnv(options: {
    userDataDir: string;
    legacyBase: string;
    secretFilePath: string;
    apiPort: number;
    isPackaged: boolean;
  }): Record<string, string | undefined>;
}

interface ElectronState {
  apiProcess: { pid: number; killed: boolean; kill: ReturnType<typeof vi.fn> } | null;
  apiHeartbeatTimer: ReturnType<typeof setInterval> | null;
}

describe('electron api process', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops the API child and clears its heartbeat timer', () => {
    const kill = vi.fn().mockReturnValue(true);
    const electron = {
      app: { getPath: () => 'userData', isPackaged: false },
      BrowserWindow: { getAllWindows: () => [] },
      Notification: { isSupported: () => false },
    };
    const state = loadElectronModule<ElectronState>('../../../electron/state.cjs', {});
    const api = loadElectronModule<ApiProcessModule>('../../../electron/api-process.cjs', {
      electron,
      './state.cjs': state,
    });
    state.apiProcess = { pid: 42, killed: false, kill };
    state.apiHeartbeatTimer = setInterval(() => {}, 1000);
    api.terminateApiSync();
    expect(kill).toHaveBeenCalled();
    expect(state.apiHeartbeatTimer).toBeNull();
    clearInterval(state.apiHeartbeatTimer ?? undefined);
  });

  it('is a no-op when no API process exists', () => {
    const electron = {
      app: { getPath: () => 'userData', isPackaged: false },
      BrowserWindow: { getAllWindows: () => [] },
      Notification: { isSupported: () => false },
    };
    const state = loadElectronModule<ElectronState>('../../../electron/state.cjs', {});
    const api = loadElectronModule<ApiProcessModule>('../../../electron/api-process.cjs', { electron });
    state.apiProcess = null;
    expect(() => api.terminateApiSync()).not.toThrow();
  });

  it('drops an inherited V2_DB_PATH so runtime data stays under userData', () => {
    const previousDbPath = process.env.V2_DB_PATH;
    const previousJwtSecret = process.env.V2_JWT_SECRET;
    const previousBackupKey = process.env.V2_BACKUP_KEY;
    const previousAllowPlaintext = process.env.V2_ALLOW_PLAINTEXT_BACKUP;
    const previousAllowInsecureLan = process.env.V2_ALLOW_INSECURE_LAN;
    const previousHost = process.env.V2_HOST;
    const previousCrashReportUrl = process.env.V2_CRASH_REPORT_URL;
    const previousFutureConfig = process.env.V2_FUTURE_CONFIG;
    const previousWechatUrl = process.env.V2_WECHAT_API_URL;
    const previousWechatSecret = process.env.V2_WECHAT_APP_SECRET;
    const previousAdminPassword = process.env.V2_ADMIN_PASSWORD;
    process.env.V2_DB_PATH = 'C:\\should-not-leak\\v2.sqlite';
    process.env.V2_JWT_SECRET = 'should-not-leak-jwt';
    process.env.V2_BACKUP_KEY = 'should-not-leak-backup';
    process.env.V2_ALLOW_PLAINTEXT_BACKUP = '1';
    process.env.V2_ALLOW_INSECURE_LAN = '1';
    process.env.V2_HOST = '0.0.0.0';
    process.env.V2_CRASH_REPORT_URL = 'https://should-not-leak.example/crash';
    process.env.V2_FUTURE_CONFIG = 'should-not-leak';
    process.env.V2_WECHAT_API_URL = 'https://wechat-gateway.example/send';
    process.env.V2_WECHAT_APP_SECRET = 'should-not-leak-wechat-secret';
    process.env.V2_ADMIN_PASSWORD = 'should-not-leak-admin';
    try {
      const electron = {
        app: { getPath: () => 'userData', isPackaged: false },
        BrowserWindow: { getAllWindows: () => [] },
        Notification: { isSupported: () => false },
      };
      const apiEnv = loadElectronModule<ApiEnvModule>('../../../electron/api-env.cjs', { electron });
      const env = apiEnv.buildApiChildEnv({
        userDataDir: 'C:\\user-data',
        legacyBase: 'C:\\legacy',
        secretFilePath: 'C:\\tmp\\secrets.json',
        apiPort: 3180,
        isPackaged: true,
      });
      expect(env.V2_DB_PATH).toBeUndefined();
      expect(env.V2_JWT_SECRET).toBeUndefined();
      expect(env.V2_BACKUP_KEY).toBeUndefined();
      expect(env.V2_ALLOW_PLAINTEXT_BACKUP).toBeUndefined();
      expect(env.V2_ALLOW_INSECURE_LAN).toBeUndefined();
      expect(env.V2_CRASH_REPORT_URL).toBeUndefined();
      expect(env.V2_FUTURE_CONFIG).toBeUndefined();
      expect(env.V2_WECHAT_API_URL).toBe('https://wechat-gateway.example/send');
      expect(env.V2_WECHAT_APP_SECRET).toBeUndefined();
      expect(env.V2_ADMIN_PASSWORD).toBeUndefined();
      expect(env.V2_HOST).toBe('127.0.0.1');
      expect(env.V2_DATA_DIR).toBe('C:\\user-data\\data');
      expect(env.V2_PORT).toBe('3180');
      expect(env.NODE_ENV).toBe('production');
      expect(env.V2_ELECTRON_RENDERER).toBe('1');

      const devEnv = apiEnv.buildApiChildEnv({
        userDataDir: 'C:\\user-data',
        legacyBase: 'C:\\legacy',
        secretFilePath: 'C:\\tmp\\secrets.json',
        apiPort: 3180,
        isPackaged: false,
      });
      expect(devEnv.V2_ADMIN_PASSWORD).toBe('should-not-leak-admin');
      expect(devEnv.V2_WECHAT_APP_SECRET).toBeUndefined();
    } finally {
      if (previousDbPath === undefined) delete process.env.V2_DB_PATH;
      else process.env.V2_DB_PATH = previousDbPath;
      if (previousJwtSecret === undefined) delete process.env.V2_JWT_SECRET;
      else process.env.V2_JWT_SECRET = previousJwtSecret;
      if (previousBackupKey === undefined) delete process.env.V2_BACKUP_KEY;
      else process.env.V2_BACKUP_KEY = previousBackupKey;
      if (previousAllowPlaintext === undefined) delete process.env.V2_ALLOW_PLAINTEXT_BACKUP;
      else process.env.V2_ALLOW_PLAINTEXT_BACKUP = previousAllowPlaintext;
      if (previousAllowInsecureLan === undefined) delete process.env.V2_ALLOW_INSECURE_LAN;
      else process.env.V2_ALLOW_INSECURE_LAN = previousAllowInsecureLan;
      if (previousHost === undefined) delete process.env.V2_HOST;
      else process.env.V2_HOST = previousHost;
      if (previousCrashReportUrl === undefined) delete process.env.V2_CRASH_REPORT_URL;
      else process.env.V2_CRASH_REPORT_URL = previousCrashReportUrl;
      if (previousFutureConfig === undefined) delete process.env.V2_FUTURE_CONFIG;
      else process.env.V2_FUTURE_CONFIG = previousFutureConfig;
      if (previousWechatUrl === undefined) delete process.env.V2_WECHAT_API_URL;
      else process.env.V2_WECHAT_API_URL = previousWechatUrl;
      if (previousWechatSecret === undefined) delete process.env.V2_WECHAT_APP_SECRET;
      else process.env.V2_WECHAT_APP_SECRET = previousWechatSecret;
      if (previousAdminPassword === undefined) delete process.env.V2_ADMIN_PASSWORD;
      else process.env.V2_ADMIN_PASSWORD = previousAdminPassword;
    }
  });
});
