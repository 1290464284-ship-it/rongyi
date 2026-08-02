export interface WindowActions {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  getIsMaximized(): Promise<boolean>;
  closeOrHideToTray(opts?: { minimizeOnClose?: boolean }): Promise<void>;
  hideToTray(): Promise<void>;
}

export interface TrayBridge {
  setAutoLaunch(enable: boolean): Promise<{ success: boolean }>;
  getAutoLaunch(): Promise<boolean>;
}

export interface SystemInfo {
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly appVersion: string;
}

export interface DentalBridge {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly appVersion: string;
  readonly isPackaged: boolean;
  readonly clinicTimezone: string;
  readonly windowActions: WindowActions;
  readonly tray: TrayBridge;
  readonly system: SystemInfo;
}

declare global {
  interface Window {
    dentalBridge?: DentalBridge;
  }
}
