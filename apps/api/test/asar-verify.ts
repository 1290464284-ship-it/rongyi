/**
 * Electron asar 打包后行为验证脚本
 * 
 * 验证项：
 * 1. 路径解析正确性（asar 内部路径 vs 真实文件系统路径）
 * 2. API 子进程环境变量传递完整性
 * 3. 自动重启机制逻辑验证
 * 4. repack-asar.js 脚本正确性
 * 5. native binding 路径解析
 * 
 * 本脚本为静态分析验证，不需要实际打包环境
 */
import * as path from 'path';
import * as fs from 'fs';

interface VerifyResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: VerifyResult[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  results.push({ name, passed: condition, detail });
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}${detail ? ' — ' + detail : ''}`);
}

function verifyAll() {
  console.log('=== Electron asar 打包后行为验证 ===\n');

  // ===== 1. main.ts 路径解析验证 =====
  console.log('[1] main.ts 路径解析分析');

  const mainTsPath = path.resolve(__dirname, '../../web/electron/main.ts');
  const mainTsContent = fs.readFileSync(mainTsPath, 'utf-8');

  // 验证: 打包后 API 路径使用 process.resourcesPath
  assert(
    mainTsContent.includes("join(resourcesPath, 'api', 'bundle', 'index.js')"),
    'API bundle 路径使用 resourcesPath 拼接',
  );

  // 验证: 数据库路径使用 userData
  assert(
    mainTsContent.includes("join(app.getPath('userData'), 'data')"),
    '数据目录使用 app.getPath("userData")',
  );

  // 验证: JWT 密钥路径使用 userData/config
  assert(
    mainTsContent.includes("join(app.getPath('userData'), 'config')"),
    'JWT 密钥目录使用 userData/config',
  );

  // 验证: native binding 路径正确拼接
  assert(
    mainTsContent.includes('better_sqlite3.node'),
    'better-sqlite3 native binding 路径正确',
  );

  // 验证: .env 文件路径使用 userData/data
  assert(
    mainTsContent.includes("join(dataDir, '.env')"),
    '.env 文件路径在 userData/data 下',
  );

  // ===== 2. 环境变量传递完整性 =====
  console.log('\n[2] 环境变量传递完整性');

  const requiredEnvVars = [
    'PORT',
    'ELECTRON_RUN_AS_NODE',
    'NODE_ENV',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'DATA_DIR',
    'DB_PATH',
    'ENV_PATH',
    'RESOURCES_PATH',
    'LEGACY_DB_PATH',
    'BETTER_SQLITE3_BINDINGS_PATH',
  ];

  for (const envVar of requiredEnvVars) {
    const pattern = new RegExp(`${envVar}:`);
    assert(
      pattern.test(mainTsContent),
      `环境变量 ${envVar} 已传递`,
    );
  }

  // 验证 ELECTRON_RUN_AS_NODE=1（让 Electron 以 Node.js 模式运行子进程）
  assert(
    mainTsContent.includes("ELECTRON_RUN_AS_NODE: '1'"),
    'ELECTRON_RUN_AS_NODE 设置为 1',
  );

  // ===== 3. 自动重启机制 =====
  console.log('\n[3] 自动重启机制');

  // 验证: 进程退出后检测
  assert(
    mainTsContent.includes("apiProcess.on('close'"),
    '监听 API 子进程 close 事件',
  );

  // 验证: 非正常退出时重启
  assert(
    mainTsContent.includes('code !== 0') && mainTsContent.includes('code !== null'),
    '检测非正常退出代码',
  );

  // 验证: 3秒延迟重启（常量名替代魔法数字）
  assert(
    mainTsContent.includes('setTimeout') && mainTsContent.includes('API_RESTART_DELAY_MS'),
    '3秒延迟重启',
  );

  // 验证: 关闭时不重启
  assert(
    mainTsContent.includes('!isShuttingDown'),
    '关闭状态下不触发重启',
  );

  // 验证: SIGTERM 优先停止
  assert(
    mainTsContent.includes("kill('SIGTERM')"),
    '使用 SIGTERM 优雅停止',
  );

  // 验证: 5秒强制杀死（常量名替代魔法数字）
  assert(
    mainTsContent.includes("kill('SIGKILL')") && mainTsContent.includes('API_FORCE_KILL_TIMEOUT_MS'),
    '5秒超时后 SIGKILL 强制杀死',
  );

  // ===== 4. database.ts native binding 路径 =====
  console.log('\n[4] database.ts native binding 路径解析');

  const databaseTsPath = path.resolve(__dirname, '../src/db/database.ts');
  const databaseTsContent = fs.readFileSync(databaseTsPath, 'utf-8');

  // 验证: 优先使用环境变量中的 binding 路径
  assert(
    databaseTsContent.includes('BETTER_SQLITE3_BINDINGS_PATH'),
    '支持 BETTER_SQLITE3_BINDINGS_PATH 环境变量',
  );

  // 验证: 仅在 production/electron 环境设置 nativeBinding
  assert(
    databaseTsContent.includes("process.env.NODE_ENV === 'production'") ||
    databaseTsContent.includes('ELECTRON_RUN_AS_NODE'),
    '仅在打包环境设置 nativeBinding',
  );

  // 验证: 默认 fallback 路径
  assert(
    databaseTsContent.includes("'api', 'bundle', 'build', 'Release', 'better_sqlite3.node'"),
    'fallback 路径与 main.ts 一致',
  );

  // ===== 5. paths.ts 路径解析 =====
  console.log('\n[5] paths.ts 路径优先级');

  const pathsTsPath = path.resolve(__dirname, '../src/db/paths.ts');
  const pathsTsContent = fs.readFileSync(pathsTsPath, 'utf-8');

  // 验证: DATA_DIR 优先级最高
  assert(
    pathsTsContent.includes('process.env.DATA_DIR'),
    'DATA_DIR 环境变量优先',
  );

  // 验证: DB_PATH 作为第二优先
  assert(
    pathsTsContent.includes('process.env.DB_PATH'),
    'DB_PATH 环境变量作为备选',
  );

  // 验证: 旧库迁移逻辑存在
  assert(
    pathsTsContent.includes('migrateLegacyDatabaseIfNeeded'),
    '旧库迁移函数存在',
  );

  // 验证: 旧库候选路径
  assert(
    pathsTsContent.includes('LEGACY_DB_PATH') &&
    pathsTsContent.includes("join(resourcesPath, 'api', 'data', 'dental.sqlite')"),
    '旧库候选路径包含 LEGACY_DB_PATH 和 resources 路径',
  );

  // ===== 6. repack-asar.js 验证 =====
  console.log('\n[6] repack-asar.js 脚本验证');

  const repackPath = path.resolve(__dirname, '../../../repack-asar.js');
  if (fs.existsSync(repackPath)) {
    const repackContent = fs.readFileSync(repackPath, 'utf-8');

    assert(
      repackContent.includes("require('asar')"),
      '使用 asar 模块',
    );

    assert(
      repackContent.includes('extractAll') && repackContent.includes('createPackage'),
      '包含解包和重新打包流程',
    );

    assert(
      repackContent.includes('rmSync') && repackContent.includes('recursive'),
      '包含临时目录清理',
    );

    // 验证: asar 路径指向正确位置
    assert(
      repackContent.includes("'release-final'") && repackContent.includes("'app.asar'"),
      'asar 路径指向 release-final/win-unpacked/resources/app.asar',
    );

    // 验证: 更新 main.cjs
    assert(
      repackContent.includes('main.cjs'),
      '更新 electron/main.cjs 文件',
    );
  } else {
    assert(false, 'repack-asar.js 文件存在', '文件不存在');
  }

  // ===== 7. SPA 静态文件服务验证 =====
  console.log('\n[7] SPA 静态文件服务');

  // 验证: dist-web 路径
  assert(
    mainTsContent.includes("join(resourcesPath, 'dist-web')"),
    'dist-web 路径使用 resourcesPath',
  );

  // 验证: asar.unpacked fallback
  assert(
    mainTsContent.includes('app.asar.unpacked'),
    'asar.unpacked 作为 fallback',
  );

  // 验证: 路径遍历防护
  assert(
    mainTsContent.includes('resolvedFilePath.startsWith(resolvedDistPath)'),
    '路径遍历攻击防护',
  );

  // 验证: SPA 路由 fallback
  assert(
    mainTsContent.includes('SPA') || mainTsContent.includes('index.html'),
    'SPA 路由 fallback 到 index.html',
  );

  // ===== 8. 安全验证 =====
  console.log('\n[8] 安全配置');

  // 验证: CSP 头
  assert(
    mainTsContent.includes('Content-Security-Policy'),
    'HTML 响应包含 CSP 头',
  );

  // 验证: contextIsolation
  assert(
    mainTsContent.includes('contextIsolation: true'),
    'webPreferences.contextIsolation = true',
  );

  // 验证: nodeIntegration 关闭
  assert(
    mainTsContent.includes('nodeIntegration: false'),
    'webPreferences.nodeIntegration = false',
  );

  // 验证: 单实例锁
  assert(
    mainTsContent.includes('requestSingleInstanceLock'),
    '使用单实例锁防止多开',
  );

  // ===== 9. 日志系统验证 =====
  console.log('\n[9] 日志系统');

  // 验证: 日志轮转
  assert(
    mainTsContent.includes('ELECTRON_LOG_ROTATION') && mainTsContent.includes('MAX_LOG_SIZE_BYTES'),
    '日志大小限制使用 ELECTRON_LOG_ROTATION.MAX_LOG_SIZE_BYTES 常量',
  );

  assert(
    mainTsContent.includes('ELECTRON_LOG_ROTATION') && mainTsContent.includes('MAX_LOG_FILES'),
    '最多保留日志文件数使用 ELECTRON_LOG_ROTATION.MAX_LOG_FILES 常量',
  );

  // 验证: 错误捕获
  assert(
    mainTsContent.includes('uncaughtException'),
    '捕获 uncaughtException',
  );
  assert(
    mainTsContent.includes('unhandledRejection'),
    '捕获 unhandledRejection',
  );

  // ===== 10. waitForApi 健康检查 =====
  console.log('\n[10] API 健康检查');

  assert(
    mainTsContent.includes('/api/auth/health'),
    '使用 /api/auth/health 端点检测 API 就绪',
  );

  assert(
    mainTsContent.includes('maxRetries') && mainTsContent.includes('API_STARTUP_MAX_RETRIES'),
    '最大重试次数使用 API_STARTUP_MAX_RETRIES 常量',
  );

  assert(
    mainTsContent.includes('delay') && mainTsContent.includes('API_STARTUP_RETRY_DELAY_MS'),
    '每次间隔使用 API_STARTUP_RETRY_DELAY_MS 常量',
  );

  // ===== 输出总结 =====
  console.log('\n=== 验证结果 ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`总计: ${results.length} | 通过: ${passed} | 失败: ${failed}`);

  if (failed > 0) {
    console.log('\n失败项:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}${r.detail ? ': ' + r.detail : ''}`);
    });
    process.exit(1);
  } else {
    console.log('\n所有验证通过!');
    process.exit(0);
  }
}

verifyAll();
