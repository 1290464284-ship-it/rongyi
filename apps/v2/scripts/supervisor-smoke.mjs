// supervisor smoke：验证原生级看门狗 sidecar 的拉起/放弃语义。
// 场景 1：父进程存活 → 不拉起
// 场景 2：父进程死亡且无停止标记 → 退避后拉起“应用”
// 场景 3：存在停止标记 → 不拉起（优雅退出语义）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supervisorPath = path.join(appRoot, 'electron', 'supervisor.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-supervisor-smoke-'));
const stopMarker = path.join(temp, '.supervisor-stop');
const relaunchMarker = path.join(temp, 'relaunched.txt');

// 假“应用”：由 node 运行、被拉起时写标记文件。Windows 下 spawn 不能直接执行
// .cjs/.cmd，故 appExe 用 node 本体，脚本路径经 relaunchArgs 传入。
const appExe = process.execPath;
const appScript = path.join(temp, 'fake-app.cjs');
fs.writeFileSync(
  appScript,
  `require('node:fs').writeFileSync(${JSON.stringify(relaunchMarker)}, String(Date.now()));`,
);
const relaunchArgs = JSON.stringify([appScript]);

const children = [];
let failed = false;

function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed = true;
}

function spawnParent() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function spawnSupervisor(parentPid) {
  const child = spawn(
    process.execPath,
    [supervisorPath, appExe, String(parentPid), stopMarker, relaunchArgs],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  children.push(child);
  return child;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(file)) return true;
    await wait(200);
  }
  return false;
}

async function main() {
  // 场景 1：父进程存活 → 不拉起
  const parent1 = spawnParent();
  const supervisor1 = spawnSupervisor(parent1.pid);
  await wait(4000);
  check('alive parent does not trigger relaunch', !fs.existsSync(relaunchMarker));
  parent1.kill();
  supervisor1.kill();

  // 场景 2：父进程死亡（无停止标记）→ 拉起
  fs.rmSync(relaunchMarker, { force: true });
  const parent2 = spawnParent();
  const supervisor2 = spawnSupervisor(parent2.pid);
  await wait(500); // 等 supervisor 进入轮询
  parent2.kill();
  check('dead parent relaunches the app', await waitForFile(relaunchMarker, 15_000));
  supervisor2.kill();

  // 场景 3：存在停止标记 → 不拉起
  fs.rmSync(relaunchMarker, { force: true });
  fs.rmSync(stopMarker, { force: true });
  const parent3 = spawnParent();
  const supervisor3 = spawnSupervisor(parent3.pid);
  fs.writeFileSync(stopMarker, String(Date.now()));
  parent3.kill();
  await wait(4000);
  check('stop marker suppresses relaunch', !fs.existsSync(relaunchMarker));
  supervisor3.kill();

  for (const child of children) {
    try {
      child.kill();
    } catch {
      // already dead
    }
  }
  fs.rmSync(temp, { recursive: true, force: true });

  if (failed) {
    console.error('supervisor smoke failed');
    process.exit(1);
  }
  console.log('supervisor smoke passed');
}

void main();
