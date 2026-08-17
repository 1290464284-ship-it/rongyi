import { spawnSync } from 'node:child_process';
import net from 'node:net';

/** pnpm 可执行文件名（Windows 需要 .cmd 才能经 shell 解析）。 */
function pnpmBin() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

/**
 * 拒绝包含空白/引号/元字符的参数：Windows 下 smoke 使用 shell 拼接命令，
 * 参数必须是固定字面量，避免脆弱转义变成注入面。
 */
function assertSafeArgs(args) {
  for (const part of args) {
    if (/[\s"'&|$`<>;()]/.test(part)) throw new Error(`unsafe smoke argument: ${part}`);
  }
}

/** 生成 `pnpm --filter @dental/v2 <args>` 的 shell 命令行。 */
export function pnpmCommand(args) {
  assertSafeArgs(args);
  return [pnpmBin(), '--filter', '@dental/v2', ...args].join(' ');
}

/** 探测端口是否空闲。 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** 在 [min, max] 区间内探测一个空闲端口；全部占用时抛错（避免静默复用被占端口造成假红）。 */
export async function pickFreePort(min, max, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = min + Math.floor(Math.random() * (max - min + 1));
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in range ${min}-${max}`);
}

/** 结束进程树（Windows taskkill /T /F，POSIX 按负 PID 组发 SIGTERM）。 */
export function stopProcessTree(pid) {
  if (!pid || typeof pid !== 'number') return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 进程已退出
    }
  }
}
