// corrupt-boot drill：验证启动完整性 fail-closed 契约。
// 损坏的 v2.sqlite → 尝试受控紧急修复（备份→REINDEX）→ 修复失败 →
// 拒绝启动（非零退出 + 恢复指引），且原文件逐字节不变。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
if (!fs.existsSync(serverScript)) {
  console.error('dist-electron/server.cjs not found; run pnpm --filter @dental/v2 electron:compile first');
  process.exit(1);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-corrupt-boot-'));
const dataDir = path.join(temp, 'data');
const logDir = path.join(temp, 'logs');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
const dbPath = path.join(dataDir, 'v2.sqlite');

const Database = require('better-sqlite3');
const db = new Database(dbPath);
db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('ok');");
db.close();
// 损坏文件（保留页头可被打开，破坏其后全部内容 → quick_check 失败且 REINDEX 无法修复）
const buffer = fs.readFileSync(dbPath);
buffer.fill(0xab, 512);
fs.writeFileSync(dbPath, buffer);
const hashBefore = fs.readFileSync(dbPath).toString('base64');

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  const port = await freePort();
  const outFile = path.join(temp, 'server.out.log');
  const errFile = path.join(temp, 'server.err.log');
  const outFd = fs.openSync(outFile, 'w');
  const errFd = fs.openSync(errFile, 'w');
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      V2_DATA_DIR: dataDir,
      V2_LOG_DIR: logDir,
      V2_BACKUP_DIR: path.join(dataDir, 'backups'),
      V2_PORT: String(port),
      V2_HOST: '127.0.0.1',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', outFd, errFd],
    windowsHide: true,
  });
  const exit = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ timedOut: true, code: null }), 30_000);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ timedOut: false, code });
    });
  });
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  const output = fs.readFileSync(errFile, 'utf8') + '\n' + fs.readFileSync(outFile, 'utf8');

  const failures = [];
  function check(name, ok) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) failures.push(name);
  }

  check('corrupt boot exits non-zero', !exit.timedOut && exit.code !== 0);
  check('error output contains restore guidance', output.includes('请从备份恢复'));
  check('original corrupt file left byte-identical', fs.readFileSync(dbPath).toString('base64') === hashBefore);

  fs.rmSync(temp, { recursive: true, force: true });
  if (failures.length > 0) {
    console.error('corrupt-boot drill failed:', failures.join(', '));
    process.exit(1);
  }
  console.log('corrupt-boot drill passed');
}

void main();
