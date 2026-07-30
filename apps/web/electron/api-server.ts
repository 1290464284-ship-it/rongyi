import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { platform } from 'os';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_API_PORT,
  API_STARTUP_MAX_RETRIES,
  API_STARTUP_RETRY_DELAY_MS,
  API_RESTART_DELAY_MS,
  API_FORCE_KILL_TIMEOUT_MS,
} from '../src/config/constants';
import { log, loadOrCreateSecrets, isDev } from './electron-core';

const apiPort = DEFAULT_API_PORT;

let apiProcess: ChildProcess | null = null;
let isShuttingDown = false;
let isRestarting = false;

const waitForApi = async (): Promise<void> => {
  const maxRetries = API_STARTUP_MAX_RETRIES;
  const delay = API_STARTUP_RETRY_DELAY_MS;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${apiPort}/api/v1/health`);
      const data = await response.json() as { status?: string; message?: string };
      if (data.status === 'ok') {
        log('API 服务启动成功，数据库已连接');
        return;
      } else {
        log(`API 服务未就绪: ${data.message ?? data.status}`);
      }
    } catch {
      // 服务尚未启动
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error(`API 服务启动超时，端口 ${apiPort}`);
};

const startApi = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    let apiPath: string;
    let args: string[];
    let cwd: string;

    let resourcesPath = '';

    // 诊所数据永远写在 userData，避免安装目录升级覆盖
    const dataDir = join(app.getPath('userData'), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      log(`创建数据目录: ${dataDir}`);
    }

    if (isDev) {
      const pnpmPath = platform() === 'win32' ? 'pnpm.cmd' : 'pnpm';
      apiPath = pnpmPath;
      args = ['--filter', '@dental/api', 'dev'];
      cwd = join(__dirname, '../../..');
    } else {
      resourcesPath = process.resourcesPath;

      apiPath = process.execPath;
      args = [join(resourcesPath, 'api', 'bundle', 'index.js')];
      cwd = join(resourcesPath, 'api');
      log(`API 路径: ${args[0]}`);
      log(`API 工作目录: ${cwd}`);
      log(`Node 路径: ${apiPath}`);
    }

    const dbFile = join(dataDir, 'dental.sqlite');
    log(`数据库路径: ${dbFile}`);
    log(`数据库文件存在: ${existsSync(dbFile)}`);
    log(`启动 API: ${apiPath} ${args.join(' ')}`);

    const { jwtSecret, encryptionKey } = loadOrCreateSecrets();
    const legacyDbPath = !isDev
      ? join(process.resourcesPath, 'api', 'data', 'dental.sqlite')
      : '';

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: apiPort.toString(),
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: isDev ? 'development' : 'production',
      JWT_SECRET: jwtSecret,
      ACCESS_TOKEN_EXPIRES_IN: '30m',
      ENCRYPTION_KEY: encryptionKey,
      DATA_DIR: dataDir,
      DB_PATH: dbFile,
      ENV_PATH: join(dataDir, '.env'),
      RESOURCES_PATH: resourcesPath || process.resourcesPath || '',
      LEGACY_DB_PATH: legacyDbPath,
      BETTER_SQLITE3_BINDINGS_PATH: join(
        resourcesPath || process.resourcesPath || '',
        'api',
        'bundle',
        'build',
        'Release',
        'better_sqlite3.node',
      ),
    };

    apiProcess = spawn(apiPath, args, {
      cwd,
      stdio: 'pipe',
      env,
    });

    apiProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      log(`[API] ${output}`);
    });

    apiProcess.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      log(`[API ERROR] ${output}`);
    });

    apiProcess.on('error', (err) => {
      const nodeErr = err as NodeJS.ErrnoException;
      const errorMsg = `启动 API 服务失败: ${err.message}, code: ${nodeErr.code}, path: ${nodeErr.path}`;
      log(errorMsg);
      reject(new Error(errorMsg));
    });

    apiProcess.on('close', (code) => {
      log(`API 服务退出，代码: ${code}`);
      if (code !== 0 && code !== null) {
        log(`API 服务异常退出，代码: ${code}`);
        // 自动重启 API 服务（防止竞态）
        if (!isShuttingDown && !isRestarting) {
          isRestarting = true;
          log('API 服务异常退出，3秒后自动重启...');
          setTimeout(async () => {
            if (!isShuttingDown) {
              try {
                await startApiInternal();
                log('API 服务重启成功');
              } catch (err) {
                log(`API 服务重启失败: ${(err as Error).message}`);
              }
            }
            isRestarting = false;
          }, API_RESTART_DELAY_MS);
        }
      }
    });

    waitForApi().then(resolve).catch(reject);
  });
};

// 内部启动方法，用于重启
const startApiInternal = (): Promise<void> => {
  return startApi();
};

export const stopApi = (): void => {
  isShuttingDown = true;
  if (apiProcess) {
    log('正在停止 API 服务...');
    apiProcess.kill('SIGTERM');

    const forceKillTimer = setTimeout(() => {
      if (apiProcess) {
        log('API 服务未在5秒内退出，强制杀死');
        apiProcess.kill('SIGKILL');
        apiProcess = null;
      }
    }, API_FORCE_KILL_TIMEOUT_MS);

    apiProcess.on('exit', () => {
      clearTimeout(forceKillTimer);
      apiProcess = null;
      log('API 服务已停止');
    });
  }
};

export const startApiServer = (): Promise<void> => {
  return startApi();
};
