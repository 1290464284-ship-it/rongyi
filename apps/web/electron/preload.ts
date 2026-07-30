/**
 * Electron preload 脚本。
 *
 * 在渲染进程（webContents）加载前执行，通过 contextBridge 暴露只读安全 API
 * 给渲染进程（`window.dentalBridge`）。
 *
 * 安全要点：
 * - 仅暴露"只读信息"，不暴露 IPC/数据库/文件系统
 * - 所有暴露值均由主进程硬编码或从 app 模块读取，渲染进程无法反向调用
 * - 不暴露 `electron` 模块本身（避免渲染进程获得 nodeIntegration 等价能力）
 *
 * 当前暴露：
 * - platform: 'win32' | 'darwin' | 'linux'
 * - arch: 'x64' | 'arm64' | ...
 * - appVersion: 应用版本号（来自 package.json）
 * - isPackaged: 是否打包后的生产版本
 * - clinicTimezone: 诊所固定时区 IANA 名（与 shared 包 CLINIC_TIMEZONE 一致）
 *
 * 后续扩展（按需）：
 * - 安全 IPC 通道（contextBridge.invoke 包装，限制 channel 白名单）
 * - 主题/语言偏好读取
 */
import { contextBridge, app } from 'electron';
import { platform, arch } from 'os';

const CLINIC_TIMEZONE = 'Asia/Shanghai';

const bridge = {
  platform: platform(),
  arch: arch(),
  get appVersion(): string {
    return app.getVersion();
  },
  get isPackaged(): boolean {
    return app.isPackaged;
  },
  clinicTimezone: CLINIC_TIMEZONE,
} as const;

try {
  contextBridge.exposeInMainWorld('dentalBridge', bridge);
} catch (err) {
  // 测试环境或 contextBridge 不可用时降级（不阻塞主进程启动）
  console.error('[preload] contextBridge 暴露失败:', (err as Error).message);
}
