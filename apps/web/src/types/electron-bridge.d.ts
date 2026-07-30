/**
 * window.dentalBridge 类型声明（由 electron/preload.ts 通过 contextBridge 注入）。
 *
 * 渲染进程代码可直接使用 `window.dentalBridge.platform` 等，无需额外导入。
 */
export interface DentalBridge {
  /** 运行平台（nodejs process.platform 返回值） */
  readonly platform: NodeJS.Platform;
  /** CPU 架构 */
  readonly arch: string;
  /** 应用版本号（来自 package.json） */
  readonly appVersion: string;
  /** 是否打包后的生产版本 */
  readonly isPackaged: boolean;
  /** 诊所固定时区 IANA 名（当前为 'Asia/Shanghai'） */
  readonly clinicTimezone: string;
}

declare global {
  interface Window {
    dentalBridge?: DentalBridge;
  }
}
