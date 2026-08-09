import { describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface TrayModule {
  setupTray(): void;
}

interface TrayInstance {
  setToolTip: ReturnType<typeof vi.fn>;
  setContextMenu: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

describe('electron tray', () => {
  it('creates the tray menu and wires show/quit actions', async () => {
    let trayInstance: TrayInstance | null = null;
    let menuTemplate: Array<Record<string, unknown>> = [];
    const quit = vi.fn();
    const ensureApiServerRunning = vi.fn().mockResolvedValue(123);
    const createWindow = vi.fn();
    const electron = {
      app: { getPath: () => 'userData', isPackaged: false, quit },
      Tray: class {
        constructor() {
          const instance: TrayInstance = {
            setToolTip: vi.fn(),
            setContextMenu: vi.fn(),
            on: vi.fn(),
          };
          trayInstance = instance;
          return instance;
        }
      },
      Menu: {
        buildFromTemplate: vi.fn((template: Array<Record<string, unknown>>) => {
          menuTemplate = template;
          return template;
        }),
      },
      nativeImage: {
        createFromPath: vi.fn(() => ({ isEmpty: () => false, resize: () => ({}) })),
        createFromDataURL: vi.fn(() => ({})),
      },
      BrowserWindow: { getAllWindows: () => [] },
      Notification: { isSupported: () => false },
    };
    const mod = loadElectronModule<TrayModule>('../../../electron/tray.cjs', {
      electron,
      './api-process.cjs': { ensureApiServerRunning },
      './window.cjs': { createWindow },
    });
    mod.setupTray();
    expect(trayInstance).not.toBeNull();
    expect(trayInstance!.setToolTip).toHaveBeenCalled();
    expect(trayInstance!.setContextMenu).toHaveBeenCalled();
    expect(menuTemplate).toHaveLength(3);

    await (menuTemplate[0].click as () => Promise<void>)();
    expect(ensureApiServerRunning).toHaveBeenCalled();
    expect(createWindow).toHaveBeenCalled();

    (menuTemplate[2].click as () => void)();
    expect(quit).toHaveBeenCalled();
  });
});
