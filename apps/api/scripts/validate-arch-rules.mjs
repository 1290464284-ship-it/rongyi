/**
 * 架构规则验证脚本
 *
 * 为无法通过 ESLint 静态检测的架构约束提供机械验证。
 * 检查项：
 *   1. SQL 参数化 — 检测 SQL 模板字面量中的危险变量插值
 *   2. 软删除强制 — 检测物理删除语句（DELETE FROM / TRUNCATE / DROP TABLE），
 *      并对 service 文件中缺失 deletedAt 过滤的 SELECT 语句发出告警
 *      （可在语句所在行或上一行添加 soft-delete-exempt: <原因> 注释显式豁免）
 *   3. NestJS 模块边界 — 检测跨模块直接 import 内部文件
 *   4. DB Schema 保护 — 检测 schema.ts 是否被修改
 *   5. pnpm-lock 保护 — 检测 pnpm-lock.yaml 是否被手动修改
 *
 * 用法: node scripts/validate-arch-rules.mjs
 * 退出码: 0 = 通过, 1 = 有违规
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let violations = 0;
let warnings = 0;

// ──────────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────────

/**
 * 递归遍历目录，返回所有匹配扩展名的文件
 */
function walkDir(dir, extensions, excludes = []) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(apiRoot, fullPath);

    if (excludes.some(ex => relativePath.includes(ex) || entry.name === ex)) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, extensions, excludes));
    } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

function reportViolation(rule, file, line, message) {
  const relativePath = path.relative(apiRoot, file);
  console.log(`  ${RED}✗${RESET} [${rule}] ${relativePath}:${line} — ${message}`);
  violations++;
}

function reportWarning(rule, file, message) {
  const relativePath = path.relative(apiRoot, file);
  console.log(`  ${YELLOW}⚠${RESET} [${rule}] ${relativePath} — ${message}`);
  warnings++;
}

/**
 * 文件级违规上报（无具体行号，计入 violations 并影响退出码）
 */
function reportFileViolation(rule, file, message) {
  const relativePath = path.relative(apiRoot, file);
  console.log(`  ${RED}✗${RESET} [${rule}] ${relativePath} — ${message}`);
  violations++;
}

// ──────────────────────────────────────────────────────────────
// 1. SQL 参数化检查 (.qoder/rules/sql-parameterization.md)
// ──────────────────────────────────────────────────────────────

/**
 * 已知安全的插值变量名后缀（SQL 构建片段，非用户输入）
 */
const SAFE_INTERPOLATION_SUFFIXES = [
  'Clause', 'Sql', 'Filter', 'Expr', 'Limit', 'Offset',
  'Ph', 'Fields', 'Columns', 'Placeholders', 'Sort', 'Order',
];

/**
 * 已知安全的插值变量名关键词
 */
const SAFE_INTERPOLATION_KEYWORDS = [
  'tableName', 'table', 'column', 'field', 'foreignKey',
  'clause', 'dateFilter', 'sortBy', 'validSortOrder',
  'groupExpr', 'whereSql', 'whereClause', 'whereClinic',
  'limitSql', 'offsetSql', 'placeholders', 'conditions',
  'updates', 'columns', 'setClause', 'orderBy', 'orderClause',
  'limitClause', 'offsetClause', 'valuesClause', 'insertSql',
  'selectColumns', 'joinClause', 'groupBy', 'havingClause',
  'clinicClause', 'clinicFilter', 'checkPh', 'targetTable',
  'idColumn', 'ownerField',
];

/**
 * 危险的简单变量名（常见用户输入字段）
 */
const DANGEROUS_VAR_NAMES = [
  'phone', 'email', 'password', 'token', 'secret',
  'query', 'search', 'keyword', 'input', 'value',
  'body', 'param', 'req',
];

/**
 * 判断 ${} 插值表达式是否安全
 *
 * 安全条件（满足任一即安全）：
 *   1. 包含函数调用（如 .join(), .map()）
 *   2. 包含成员访问（如 this.tableName, config.resourceType）
 *   3. 全大写常量（如 TABLE_NAME, MAX_PAGE_SIZE）
 *   4. 匹配已知安全后缀（如 *Clause, *Sql, *Filter）
 *   5. 匹配已知安全关键词（如 tableName, clause, dateFilter）
 */
function isSafeInterpolation(expr) {
  const trimmed = expr.trim();

  // 1. 包含函数调用 → 安全（如 ids.map(() => '?').join(', ')）
  if (trimmed.includes('(') && trimmed.includes(')')) {
    return true;
  }

  // 2. 包含成员访问（.）→ 安全（如 this.tableName, config.resourceType, ctx.tableName）
  if (trimmed.includes('.')) {
    return true;
  }

  // 3. 全大写常量（如 TABLE_NAME, MAX_PAGE_SIZE, STATS_DEFAULT_LIMIT）
  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
    return true;
  }

  // 4. 匹配已知安全后缀
  if (SAFE_INTERPOLATION_SUFFIXES.some(suffix =>
    trimmed.endsWith(suffix) || trimmed.endsWith(suffix.toLowerCase())
  )) {
    return true;
  }

  // 5. 匹配已知安全关键词
  if (SAFE_INTERPOLATION_KEYWORDS.some(kw =>
    trimmed.toLowerCase() === kw.toLowerCase() ||
    trimmed.toLowerCase().includes(kw.toLowerCase())
  )) {
    return true;
  }

  return false;
}

/**
 * 判断 ${} 插值表达式是否为已知的危险用户输入变量
 */
function isDangerousInterpolation(expr) {
  const trimmed = expr.trim();

  // 仅检测简单标识符（无点号、无括号、非全大写）
  if (trimmed.includes('.') || trimmed.includes('(')) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) return false;

  return DANGEROUS_VAR_NAMES.some(name =>
    trimmed.toLowerCase() === name.toLowerCase()
  );
}

/**
 * 检测字符串是否包含 SQL 关键字
 */
function looksLikeSql(str) {
  const upper = str.toUpperCase();
  const sqlKeywords = ['SELECT ', 'INSERT INTO', 'UPDATE ', 'DELETE FROM', 'FROM '];
  return sqlKeywords.some(kw => upper.includes(kw));
}

function checkSqlParameterization(files) {
  console.log(`\n${CYAN}━━━ 1. SQL 参数化检查${RESET} ${DIM}(.qoder/rules/sql-parameterization.md)${RESET}`);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // 检测字符串加号拼接 SQL（高置信度违规）
      // 模式: 'SELECT/INSERT/UPDATE/DELETE ... ' + variable
      const concatMatch = line.match(/['"`](?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b[^'"]*['"`]\s*\+\s*(?!['"`])(\w+)/i);
      if (concatMatch) {
        const concatVar = concatMatch[1];
        // 跳过已知安全 SQL 片段变量（如 clinicClause, whereSql 等）
        if (!isSafeInterpolation(concatVar)) {
          reportViolation(
            'sql-parameterization',
            file,
            idx + 1,
            `SQL 字符串拼接检测到使用 + 运算符 (${concatVar}) — 必须使用 ? 占位符参数化查询`,
          );
        }
      }

      // 检测模板字面量中的 ${} 插值
      const templateMatch = line.match(/`([^`]*?)`/g);
      if (!templateMatch) return;

      for (const tmpl of templateMatch) {
        if (!looksLikeSql(tmpl)) continue;

        // 提取所有 ${...} 表达式
        const interpolationRegex = /\$\{([^}]+)\}/g;
        let match;
        while ((match = interpolationRegex.exec(tmpl)) !== null) {
          const expr = match[1];

          // 安全插值 → 跳过
          if (isSafeInterpolation(expr)) continue;

          // 危险的用户输入变量名 → 违规
          if (isDangerousInterpolation(expr)) {
            reportViolation(
              'sql-parameterization',
              file,
              idx + 1,
              `SQL 模板中检测到用户输入变量插值: \${${expr}} — 必须使用 ? 占位符参数化查询`,
            );
          }
          // 其他未知插值 → 跳过（避免误报，由 code review 把关）
        }
      }
    });
  }
}

// ──────────────────────────────────────────────────────────────
// 2. 软删除强制检查 (.qoder/rules/soft-delete-enforcement.md)
// ──────────────────────────────────────────────────────────────

/**
 * 非业务实体表，允许物理删除（这些表无 deletedAt 列或为日志/清理类表）
 */
const PHYSICAL_DELETE_ALLOWED_TABLES = [
  'UsedRefreshToken',
  'ClinicInfo',
  'IdempotencyRecord',
  'BackupRecord',
  'SystemAlert',      // 系统告警表，无 deletedAt 列
  'SyncChangeLog',    // 同步变更日志表，无 deletedAt 列
  'OperationLog',     // 操作日志表，无 deletedAt 列
  'InventoryTransaction', // 库存交易日志表
];

/**
 * SELECT 缺失 deletedAt 过滤的显式豁免注释标记。
 * 用法：在 SELECT 语句所在行或其上一行添加注释，如：
 *   // soft-delete-exempt: 编号生成需包含已软删除记录，避免编号复用
 */
const SOFT_DELETE_EXEMPT_MARKER = 'soft-delete-exempt';

/**
 * 从 src/db/schema/*.tables.ts 解析出包含 deletedAt 列的软删除表集合。
 * 只有这些表的 SELECT 语句才要求 deletedAt 过滤（日志/配置类表无此列）。
 */
function loadSoftDeleteTables() {
  const schemaDir = path.join(apiRoot, 'src', 'db', 'schema');
  const tables = new Set();
  if (!fs.existsSync(schemaDir)) return tables;

  for (const name of fs.readdirSync(schemaDir)) {
    if (!name.endsWith('.ts')) continue;
    const content = fs.readFileSync(path.join(schemaDir, name), 'utf8');
    const createTableRegex = /CREATE TABLE IF NOT EXISTS (\w+)([\s\S]*?)(?=CREATE TABLE IF NOT EXISTS|$)/g;
    let m;
    while ((m = createTableRegex.exec(content)) !== null) {
      if (/\bdeletedAt\b/.test(m[2])) tables.add(m[1]);
    }
  }
  return tables;
}

function checkSoftDelete(files) {
  console.log(`\n${CYAN}━━━ 2. 软删除强制检查${RESET} ${DIM}(.qoder/rules/soft-delete-enforcement.md)${RESET}`);

  const softDeleteTables = loadSoftDeleteTables();

  for (const file of files) {
    // 排除 SQL 注入检测中间件（它包含 DROP TABLE / TRUNCATE 关键字用于模式匹配，不执行 SQL）
    const relativePath = path.relative(apiRoot, file);
    if (relativePath.includes('sql-injection.middleware.ts')) continue;

    const isServiceFile = file.endsWith('.service.ts');
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // 检测 DELETE FROM
      const deleteMatch = line.match(/DELETE\s+FROM\s+(\w+)/i);
      if (deleteMatch) {
        const tableName = deleteMatch[1];
        if (!PHYSICAL_DELETE_ALLOWED_TABLES.includes(tableName)) {
          reportViolation(
            'soft-delete-enforcement',
            file,
            idx + 1,
            `检测到物理删除: DELETE FROM ${tableName} — 必须使用软删除（UPDATE SET deletedAt = datetime('now')）`,
          );
        }
      }

      // 检测 TRUNCATE TABLE（排除 wal_checkpoint(TRUNCATE) pragma）
      if (/\bTRUNCATE\s+TABLE\b/i.test(line)) {
        reportViolation(
          'soft-delete-enforcement',
          file,
          idx + 1,
          '检测到 TRUNCATE TABLE — 禁止使用，必须使用软删除',
        );
      }

      // 检测 DROP TABLE（非 migration 文件中）
      if (/\bDROP\s+TABLE\b/i.test(line) && !relativePath.startsWith(path.join('src', 'db', 'migrations'))) {
        reportViolation(
          'soft-delete-enforcement',
          file,
          idx + 1,
          '检测到 DROP TABLE — 禁止在非 migration 文件中使用',
        );
      }

      // 告警扫描：service 文件中软删除表的 SELECT 语句缺失 deletedAt 过滤
      if (isServiceFile) {
        const selectMatch = line.match(/\bSELECT\b[\s\S]*?\bFROM\s+(\w+)/i);
        if (selectMatch) {
          const tableName = selectMatch[1];
          // 仅检查包含 deletedAt 列的软删除表
          if (softDeleteTables.has(tableName)) {
            // 已有 deletedAt IS [NOT] NULL 过滤 → 通过（仅列出 deletedAt 列不算过滤）
            const hasFilter = /deletedAt\s+IS\s+(NOT\s+)?NULL/i.test(line);
            // WHERE 子句由变量动态拼接（如 ${whereClause}、${dateFilter}）→ 无法静态判断，跳过
            const hasDynamicWhere =
              /\$\{[^}]*(?:where|filter|conditions)[^}]*\}/i.test(line) ||
              new RegExp(`FROM\\s+${tableName}\\s*\\$\\{`, 'i').test(line);
            // 显式豁免注释（本行或上一行）
            const isExempt =
              line.includes(SOFT_DELETE_EXEMPT_MARKER) ||
              (idx > 0 && lines[idx - 1].includes(SOFT_DELETE_EXEMPT_MARKER));

            if (!hasFilter && !hasDynamicWhere && !isExempt) {
              reportWarning(
                'soft-delete-enforcement',
                file,
                `L${idx + 1}: SELECT ... FROM ${tableName} 缺少 deletedAt IS NULL 过滤 — 请补充过滤条件，或在本行/上一行添加 \`${SOFT_DELETE_EXEMPT_MARKER}: <原因>\` 注释显式豁免`,
              );
            }
          }
        }
      }
    });
  }
}

// ──────────────────────────────────────────────────────────────
// 3. NestJS 模块边界检查 (.qoder/rules/nestjs-module-boundary.md)
// ──────────────────────────────────────────────────────────────

/**
 * 业务模块目录列表
 */
const MODULE_DIRS = [
  'auth', 'clinical', 'communication', 'content', 'equipment',
  'financial', 'inventory', 'notifications', 'patients', 'scheduling',
  'sync', 'system',
];

/**
 * 公共目录（可被任何模块导入）
 */
const PUBLIC_DIRS = ['common', 'db'];

function getModuleFromPath(filePath) {
  const relativePath = path.relative(path.join(apiRoot, 'src'), filePath);
  const parts = relativePath.split(path.sep);

  if (parts[0] === 'modules' && parts.length > 1) {
    return parts[1]; // 如 'patients', 'financial'
  }
  return null;
}

function checkModuleBoundary(files) {
  console.log(`\n${CYAN}━━━ 3. NestJS 模块边界检查${RESET} ${DIM}(.qoder/rules/nestjs-module-boundary.md)${RESET}`);

  const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;

  for (const file of files) {
    const currentModule = getModuleFromPath(file);
    if (!currentModule) continue;

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      let match;
      importRegex.lastIndex = 0;
      while ((match = importRegex.exec(line)) !== null) {
        const importPath = match[1];

        // 只检查相对路径导入
        if (!importPath.startsWith('.')) continue;

        // 解析导入路径
        const resolvedPath = path.resolve(path.dirname(file), importPath);
        const relativeToSrc = path.relative(path.join(apiRoot, 'src'), resolvedPath);

        // 检查是否从公共目录导入（允许）
        if (PUBLIC_DIRS.some(dir => relativeToSrc.startsWith(dir))) continue;

        // 检查是否从其他业务模块导入
        const parts = relativeToSrc.split(path.sep);
        if (parts[0] === 'modules' && parts.length > 1) {
          const targetModule = parts[1];

          // 同模块导入（允许）
          if (targetModule === currentModule) continue;

          // 导入 *.module.ts（允许）
          if (parts[parts.length - 1].endsWith('.module.ts') || parts[parts.length - 1].endsWith('.module')) continue;

          // 导入 .service.ts / .controller.ts / 非 module 文件（违规）
          const targetFile = parts[parts.length - 1];
          if (targetFile.endsWith('.service.ts') || targetFile.endsWith('.service') ||
              targetFile.endsWith('.controller.ts') || targetFile.endsWith('.controller') ||
              !targetFile.endsWith('.module.ts')) {
            reportViolation(
              'nestjs-module-boundary',
              file,
              idx + 1,
              `跨模块直接 import 内部文件: '${importPath}' (模块 ${currentModule} → ${targetModule}) — 必须通过 *.module.ts 的 imports 声明依赖`,
            );
          }
        }
      }
    });
  }
}

// ──────────────────────────────────────────────────────────────
// 4. DB Schema 保护检查 (.qoder/rules/db-schema-protection.md)
// ──────────────────────────────────────────────────────────────

function checkDbSchemaProtection() {
  console.log(`\n${CYAN}━━━ 4. DB Schema 保护检查${RESET} ${DIM}(.qoder/rules/db-schema-protection.md)${RESET}`);

  const schemaPath = path.join(apiRoot, 'src', 'db', 'schema.ts');
  if (!fs.existsSync(schemaPath)) return;

  try {
    // 检查 git 中 schema.ts 是否有未提交的修改
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: apiRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const unstaged = execFileSync('git', ['diff', '--name-only'], {
      cwd: apiRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const changedFiles = [...staged.split('\n'), ...unstaged.split('\n')].filter(Boolean);
    const schemaChanged = changedFiles.some(f => f.includes('schema.ts'));
    const migrationChanged = changedFiles.some(f => f.includes('migrations.ts'));

    if (schemaChanged && !migrationChanged) {
      reportFileViolation(
        'db-schema-protection',
        schemaPath,
        'schema.ts 被修改但 migrations.ts 未同步修改 — 直接修改 schema.ts 是禁止的，需通过 migration 流程变更',
      );
    }
  } catch {
    // 非 git 仓库或无变更，跳过
    console.log(`  ${DIM}（未检测到 git 仓库或无未提交变更，跳过）${RESET}`);
  }
}

// ──────────────────────────────────────────────────────────────
// 5. pnpm-lock 保护检查 (.qoder/rules/pnpm-lock-protection.md)
// ──────────────────────────────────────────────────────────────

function checkPnpmLockProtection() {
  console.log(`\n${CYAN}━━━ 5. pnpm-lock 保护检查${RESET} ${DIM}(.qoder/rules/pnpm-lock-protection.md)${RESET}`);

  const lockPath = path.resolve(apiRoot, '..', '..', 'pnpm-lock.yaml');
  if (!fs.existsSync(lockPath)) return;

  try {
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: apiRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const unstaged = execFileSync('git', ['diff', '--name-only'], {
      cwd: apiRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const changedFiles = [...staged.split('\n'), ...unstaged.split('\n')].filter(Boolean);
    const lockChanged = changedFiles.some(f => f.includes('pnpm-lock.yaml'));
    const packageJsonChanged = changedFiles.some(f => f.endsWith('package.json'));

    if (lockChanged && !packageJsonChanged) {
      reportFileViolation(
        'pnpm-lock-protection',
        lockPath,
        'pnpm-lock.yaml 被修改但 package.json 未修改 — 禁止手动编辑 lock 文件，请使用 pnpm add/remove/update 管理依赖',
      );
    }
  } catch {
    // 非 git 仓库或无变更，跳过
    console.log(`  ${DIM}（未检测到 git 仓库或无未提交变更，跳过）${RESET}`);
  }
}

// ──────────────────────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────────────────────

function main() {
  console.log(`${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  架构规则验证脚本${RESET} ${DIM}— validate-arch-rules.mjs${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);

  // 源文件（排除测试、种子、迁移文件）
  const srcExcludes = [
    'node_modules', 'dist', 'coverage', '.code-health', 'bundle',
    '__tests__', '.spec.ts', '.concurrent.spec.ts', '.fault.spec.ts',
    '.e2e-spec.ts', '.smoke.spec.ts', '.integration.spec.ts',
    'seed', 'test-helpers', 'test-helpers.ts',
  ];

  const srcFiles = walkDir(
    path.join(apiRoot, 'src'),
    ['.ts'],
    srcExcludes,
  ).filter(f => {
    const rel = path.relative(apiRoot, f);
    // 排除 migrations 目录（migration 文件有自己的规则）
    const migPrefix = path.join('src', 'db', 'migrations');
    const migPrefixAlt = path.join('db', 'migrations');
    if (rel.startsWith(migPrefix) || rel.startsWith(migPrefixAlt)) return false;
    // 排除 schema.ts（单独检查）
    if (rel.endsWith('schema.ts')) return false;
    // 排除 db/ 目录下的非 service 文件
    if (rel.startsWith('src/db/') && !rel.includes('db.service.ts')) return false;
    return true;
  });

  // 1. SQL 参数化检查
  checkSqlParameterization(srcFiles);

  // 2. 软删除强制检查
  checkSoftDelete(srcFiles);

  // 3. NestJS 模块边界检查（仅扫描 modules/ 目录）
  const moduleFiles = srcFiles.filter(f =>
    path.relative(apiRoot, f).startsWith('src/modules')
  );
  checkModuleBoundary(moduleFiles);

  // 4. DB Schema 保护检查
  checkDbSchemaProtection();

  // 5. pnpm-lock 保护检查
  checkPnpmLockProtection();

  // 汇总
  console.log(`\n${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);
  if (violations === 0 && warnings === 0) {
    console.log(`  ${GREEN}✓ 所有架构规则检查通过${RESET}`);
    process.exit(0);
  } else {
    if (violations > 0) {
      console.log(`  ${RED}✗ ${violations} 个违规${RESET}`);
    }
    if (warnings > 0) {
      console.log(`  ${YELLOW}⚠ ${warnings} 个警告${RESET}`);
    }
    console.log(`\n  ${DIM}注意: no-manual-migration 规则为操作约束，无法通过代码检测。${RESET}`);
    console.log(`  ${DIM}      no-typescript-any 规则已由 ESLint @typescript-eslint/no-explicit-any 执行。${RESET}`);
    process.exit(violations > 0 ? 1 : 0);
  }
}

main();

