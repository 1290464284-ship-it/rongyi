import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface ApiProcessModule {
  terminateApiSync(): void;
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
});
