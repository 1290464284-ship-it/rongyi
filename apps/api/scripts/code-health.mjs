import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

function color(text, colorName) {
  return colors[colorName] + text + colors.reset;
}

function formatNumber(num) {
  return num.toLocaleString('zh-CN');
}

function formatPercent(num, total) {
  if (total === 0) return '0.00%';
  return ((num / total) * 100).toFixed(2) + '%';
}

async function walkDir(dir, options = {}) {
  const { exclude = ['node_modules', 'dist', 'coverage', '.git', '.code-health', 'bundle'], extensions = null } = options;
  const results = [];

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(projectRoot, fullPath);

    if (exclude.some(ex => entry.name === ex || relativePath.startsWith(ex))) {
      continue;
    }

    if (entry.isDirectory()) {
      const subResults = await walkDir(fullPath, options);
      results.push(...subResults);
    } else if (entry.isFile()) {
      if (extensions === null || extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

async function countLines(filePath) {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;

  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      blankLines++;
      continue;
    }

    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith('//')) {
      commentLines++;
      continue;
    }

    if (trimmed.startsWith('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }

    codeLines++;
  }

  return {
    total: lines.length,
    code: codeLines,
    comment: commentLines,
    blank: blankLines,
  };
}

async function analyzeLineCounts() {
  const tsFiles = await walkDir(projectRoot, { extensions: ['.ts', '.tsx'] });
  const testFiles = tsFiles.filter(f => f.endsWith('.spec.ts') || f.endsWith('.test.ts') || f.includes(path.sep + 'test' + path.sep) || f.includes(path.sep + '__tests__' + path.sep));
  const sourceFiles = tsFiles.filter(f => !testFiles.includes(f));

  let totalStats = { total: 0, code: 0, comment: 0, blank: 0 };
  let testStats = { total: 0, code: 0, comment: 0, blank: 0 };
  const moduleStats = {};

  for (const file of sourceFiles) {
    const stats = await countLines(file);
    totalStats.total += stats.total;
    totalStats.code += stats.code;
    totalStats.comment += stats.comment;
    totalStats.blank += stats.blank;

    const relativePath = path.relative(projectRoot, file);
    const parts = relativePath.split(path.sep);
    let moduleName = 'root';

    if (parts[0] === 'src') {
      if (parts[1] === 'modules' && parts[2]) {
        moduleName = 'modules/' + parts[2];
      } else if (parts[1] === 'common') {
        moduleName = 'common';
      } else if (parts[1] === 'db') {
        moduleName = 'db';
      } else if (parts[1]) {
        moduleName = parts[1];
      }
    }

    if (!moduleStats[moduleName]) {
      moduleStats[moduleName] = { files: 0, lines: 0, code: 0 };
    }
    moduleStats[moduleName].files++;
    moduleStats[moduleName].lines += stats.total;
    moduleStats[moduleName].code += stats.code;
  }

  for (const file of testFiles) {
    const stats = await countLines(file);
    testStats.total += stats.total;
    testStats.code += stats.code;
    testStats.comment += stats.comment;
    testStats.blank += stats.blank;
  }

  return {
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.length,
    total: totalStats,
    test: testStats,
    testRatio: totalStats.code > 0 ? (testStats.code / totalStats.code) : 0,
    modules: moduleStats,
  };
}

async function analyzeTechDebt() {
  const tsFiles = await walkDir(projectRoot, { extensions: ['.ts', '.tsx'] });

  const todoPatterns = {
    FIXME: /FIXME/gi,
    TODO: /TODO(?!\s*\()/gi,
    HACK: /HACK/gi,
    XXX: /XXX/gi,
    REVIEW: /REVIEW/gi,
  };

  const debtCounts = {
    FIXME: 0,
    TODO: 0,
    HACK: 0,
    XXX: 0,
    REVIEW: 0,
  };

  const anyTypeCount = {
    annotation: 0,
    assertion: 0,
    total: 0,
  };

  const fileDebt = [];

  for (const file of tsFiles) {
    const content = await fs.promises.readFile(file, 'utf-8');
    const relativePath = path.relative(projectRoot, file);

    let fileTodoCount = 0;
    for (const [type, pattern] of Object.entries(todoPatterns)) {
      const matches = content.match(pattern);
      if (matches) {
        debtCounts[type] += matches.length;
        fileTodoCount += matches.length;
      }
    }

    const anyAnnotations = content.match(/:\s*any\b/g) || [];
    const anyAssertions = content.match(/\bas\s+any\b/g) || [];
    anyTypeCount.annotation += anyAnnotations.length;
    anyTypeCount.assertion += anyAssertions.length;
    anyTypeCount.total += anyAnnotations.length + anyAssertions.length;

    if (fileTodoCount > 0) {
      fileDebt.push({ file: relativePath, todos: fileTodoCount });
    }
  }

  fileDebt.sort((a, b) => b.todos - a.todos);

  return {
    todos: debtCounts,
    totalTodos: Object.values(debtCounts).reduce((a, b) => a + b, 0),
    anyType: anyTypeCount,
    topFiles: fileDebt.slice(0, 10),
  };
}

function estimateDuplication(content) {
  const lines = content.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 20 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('import ') && !l.startsWith('export '));

  const lineMap = new Map();
  let duplicateLines = 0;

  for (const line of lines) {
    const count = lineMap.get(line) || 0;
    if (count === 1) {
      duplicateLines++;
    }
    lineMap.set(line, count + 1);
  }

  return duplicateLines;
}

async function analyzeDuplication() {
  const tsFiles = await walkDir(path.join(projectRoot, 'src'), { extensions: ['.ts'] });
  let totalDuplicateLines = 0;
  let totalLines = 0;

  for (const file of tsFiles) {
    const content = await fs.promises.readFile(file, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    totalLines += lines.length;
    totalDuplicateLines += estimateDuplication(content);
  }

  return {
    duplicateLines: totalDuplicateLines,
    totalLines,
    ratio: totalLines > 0 ? totalDuplicateLines / totalLines : 0,
  };
}

async function runEslint() {
  const eslintConfigPath = path.join(projectRoot, 'eslint.config.js');
  if (!fs.existsSync(eslintConfigPath)) {
    return { available: false, errors: 0, warnings: 0 };
  }

  try {
    const { execSync } = await import('node:child_process');
    const result = execSync('npx eslint "src/**/*.ts" --format json', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const reports = JSON.parse(result);
    let errors = 0;
    let warnings = 0;

    for (const report of reports) {
      errors += report.errorCount;
      warnings += report.warningCount;
    }

    return { available: true, errors, warnings };
  } catch (error) {
    if (error.stdout) {
      try {
        const reports = JSON.parse(error.stdout);
        let errors = 0;
        let warnings = 0;
        for (const report of reports) {
          errors += report.errorCount;
          warnings += report.warningCount;
        }
        return { available: true, errors, warnings };
      } catch {
        return { available: false, errors: 0, warnings: 0 };
      }
    }
    return { available: false, errors: 0, warnings: 0 };
  }
}

async function readCoverage() {
  const coveragePath = path.join(projectRoot, 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(coveragePath)) {
    return { available: false };
  }

  try {
    const content = await fs.promises.readFile(coveragePath, 'utf-8');
    const data = JSON.parse(content);
    const total = data.total;

    return {
      available: true,
      statements: total.statements.pct,
      branches: total.branches.pct,
      functions: total.functions.pct,
      lines: total.lines.pct,
    };
  } catch {
    return { available: false };
  }
}

async function countTests() {
  const specFiles = await walkDir(projectRoot, { extensions: ['.spec.ts', '.test.ts'] });
  let totalTests = 0;
  const testSuites = specFiles.length;

  for (const file of specFiles) {
    const content = await fs.promises.readFile(file, 'utf-8');
    const itMatches = content.match(/\bit\s*\(|\btest\s*\(/g);
    if (itMatches) {
      totalTests += itMatches.length;
    }
  }

  return {
    testSuites,
    totalTests,
  };
}

function printSection(title) {
  console.log('');
  console.log(color('═'.repeat(60), 'dim'));
  console.log(color('  ' + title, 'bright', 'cyan'));
  console.log(color('═'.repeat(60), 'dim'));
}

function printBar(value, max, width = 30) {
  const ratio = Math.min(value / max, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  let barColor = 'green';
  if (ratio < 0.5) barColor = 'red';
  else if (ratio < 0.8) barColor = 'yellow';

  return color('█'.repeat(filled), barColor) + color('░'.repeat(empty), 'dim');
}

async function loadLastReport() {
  const reportPath = path.join(projectRoot, '.code-health', 'latest.json');
  if (!fs.existsSync(reportPath)) return null;
  try {
    const content = await fs.promises.readFile(reportPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function compareValue(current, previous, label, isBetterHigher = true) {
  if (previous === undefined || previous === null) return null;
  const diff = current - previous;
  if (diff === 0) return null;

  const percent = previous !== 0 ? ((diff / previous) * 100).toFixed(1) : '∞';
  const sign = diff > 0 ? '+' : '';

  let indicator;
  if (isBetterHigher) {
    indicator = diff > 0 ? color('↑', 'green') : color('↓', 'red');
  } else {
    indicator = diff > 0 ? color('↑', 'red') : color('↓', 'green');
  }

  return `${indicator} ${sign}${percent}% (${sign}${diff})`;
}

async function main() {
  console.log('');
  console.log(color('╔══════════════════════════════════════════════════════════╗', 'cyan'));
  console.log(color('║              代码健康度检查报告                          ║', 'bright', 'cyan'));
  console.log(color('╚══════════════════════════════════════════════════════════╝', 'cyan'));
  console.log(color('  生成时间: ' + new Date().toLocaleString('zh-CN'), 'dim'));

  const lastReport = await loadLastReport();
  if (lastReport) {
    console.log(color('  上次报告: ' + new Date(lastReport.timestamp).toLocaleString('zh-CN'), 'dim'));
  }

  const lineStats = await analyzeLineCounts();
  const techDebt = await analyzeTechDebt();
  const duplication = await analyzeDuplication();
  const testStats = await countTests();
  const coverage = await readCoverage();
  const eslintResult = await runEslint();

  printSection('📊 代码行数统计');

  console.log('');
  console.log(`  源码文件数:      ${color(formatNumber(lineStats.sourceFiles), 'bright')}`);
  console.log(`  测试文件数:      ${color(formatNumber(lineStats.testFiles), 'bright')}`);
  console.log('');
  console.log(`  总代码行数:      ${color(formatNumber(lineStats.total.code), 'green', 'bright')}`);
  console.log(`  测试代码行数:    ${color(formatNumber(lineStats.test.code), 'blue', 'bright')}`);
  console.log(`  测试代码占比:    ${color(formatPercent(lineStats.test.code, lineStats.total.code), 'yellow', 'bright')}`);
  console.log(`  ${printBar(lineStats.testRatio, 0.5, 40)}`);
  console.log('');
  console.log('  注释行数:        ' + formatNumber(lineStats.total.comment));
  console.log('  空行数:          ' + formatNumber(lineStats.total.blank));
  console.log('  总行数:          ' + formatNumber(lineStats.total.total));

  console.log('');
  console.log(color('  按模块统计:', 'bright'));
  const sortedModules = Object.entries(lineStats.modules)
    .sort((a, b) => b[1].code - a[1].code);

  const maxModuleLines = Math.max(...sortedModules.map(([, m]) => m.code), 1);

  for (const [name, stats] of sortedModules) {
    const bar = printBar(stats.code, maxModuleLines, 25);
    console.log(`    ${name.padEnd(20)} ${bar} ${color(formatNumber(stats.code) + ' 行', 'dim')} (${stats.files} 文件)`);
  }

  printSection('🔧 技术债务指标');

  console.log('');
  console.log(color('  TODO/FIXME/HACK 统计:', 'bright'));
  console.log('');

  const todoTypes = [
    { name: 'FIXME', label: 'FIXME (需修复)', severity: 'high' },
    { name: 'HACK', label: 'HACK (黑科技)', severity: 'medium' },
    { name: 'XXX', label: 'XXX (需注意)', severity: 'medium' },
    { name: 'TODO', label: 'TODO (待办)', severity: 'low' },
    { name: 'REVIEW', label: 'REVIEW (待审核)', severity: 'low' },
  ];

  for (const type of todoTypes) {
    const count = techDebt.todos[type.name] || 0;
    let countColor = 'green';
    if (count > 10) countColor = 'yellow';
    if (count > 30) countColor = 'red';

    const prevCount = lastReport?.techDebt?.todos?.[type.name];
    const diff = compareValue(count, prevCount, type.name, false);

    console.log(`    ${type.label.padEnd(20)} ${color(formatNumber(count).padStart(5), countColor, 'bright')}${diff ? '  ' + diff : ''}`);
  }

  console.log('');
  console.log(`  总计: ${color(formatNumber(techDebt.totalTodos), 'yellow', 'bright')} 个技术债务标记`);

  console.log('');
  console.log(color('  any 类型使用:', 'bright'));
  console.log('');

  const anyPrev = lastReport?.techDebt?.anyType?.total;
  const anyDiff = compareValue(techDebt.anyType.total, anyPrev, 'any', false);

  console.log(`    类型注解 (: any)    ${color(formatNumber(techDebt.anyType.annotation), 'yellow')}`);
  console.log(`    类型断言 (as any)   ${color(formatNumber(techDebt.anyType.assertion), 'yellow')}`);
  console.log(`    总计                ${color(formatNumber(techDebt.anyType.total), 'red', 'bright')}${anyDiff ? '  ' + anyDiff : ''}`);

  console.log('');
  console.log(color('  重复代码估算:', 'bright'));
  console.log('');

  const dupPrev = lastReport?.duplication?.ratio;
  let dupDiff = null;
  if (dupPrev !== undefined) {
    const diff = duplication.ratio - dupPrev;
    const percent = ((diff / dupPrev) * 100).toFixed(1);
    const sign = diff > 0 ? '+' : '';
    const indicator = diff > 0 ? color('↑', 'red') : color('↓', 'green');
    dupDiff = `${indicator} ${sign}${percent}%`;
  }

  console.log(`    重复行数估算:    ${color(formatNumber(duplication.duplicateLines), 'yellow')}`);
  console.log(`    重复率估算:      ${color((duplication.ratio * 100).toFixed(2) + '%', duplication.ratio > 0.1 ? 'red' : 'yellow', 'bright')}${dupDiff ? '  ' + dupDiff : ''}`);
  console.log(color('    (基于相同行的简单估算，仅供参考)', 'dim'));

  if (eslintResult.available) {
    console.log('');
    console.log(color('  ESLint 检查:', 'bright'));
    console.log('');

    const eslintPrev = lastReport?.eslint;
    const errDiff = compareValue(eslintResult.errors, eslintPrev?.errors, 'errors', false);
    const warnDiff = compareValue(eslintResult.warnings, eslintPrev?.warnings, 'warnings', false);

    console.log(`    错误 (Errors):   ${color(formatNumber(eslintResult.errors), eslintResult.errors > 0 ? 'red' : 'green', 'bright')}${errDiff ? '  ' + errDiff : ''}`);
    console.log(`    警告 (Warnings): ${color(formatNumber(eslintResult.warnings), eslintResult.warnings > 0 ? 'yellow' : 'green', 'bright')}${warnDiff ? '  ' + warnDiff : ''}`);
  }

  if (techDebt.topFiles.length > 0) {
    console.log('');
    console.log(color('  技术债务最多的文件 (Top 10):', 'bright'));
    console.log('');
    for (let i = 0; i < techDebt.topFiles.length && i < 10; i++) {
      const item = techDebt.topFiles[i];
      const rank = String(i + 1).padStart(2);
      console.log(`    ${color(rank + '.', 'dim')} ${item.file.padEnd(50)} ${color(item.todos + ' 个', 'yellow')}`);
    }
  }

  printSection('🧪 测试健康度');

  console.log('');
  console.log(`  测试套件数:      ${color(formatNumber(testStats.testSuites), 'bright')}`);
  console.log(`  测试用例数:      ${color(formatNumber(testStats.totalTests), 'green', 'bright')}`);

  if (coverage.available) {
    console.log('');
    console.log(color('  代码覆盖率:', 'bright'));
    console.log('');

    const coverageItems = [
      { name: '语句覆盖率 (Statements)', value: coverage.statements },
      { name: '分支覆盖率 (Branches)', value: coverage.branches },
      { name: '函数覆盖率 (Functions)', value: coverage.functions },
      { name: '行覆盖率 (Lines)', value: coverage.lines },
    ];

    for (const item of coverageItems) {
      const value = item.value;
      let valueColor = 'red';
      if (value >= 80) valueColor = 'green';
      else if (value >= 50) valueColor = 'yellow';

      const prevVal = lastReport?.coverage?.[item.name.split(' ')[0].toLowerCase()];
      let diffStr = '';
      if (prevVal !== undefined) {
        const diff = value - prevVal;
        if (Math.abs(diff) >= 0.1) {
          const sign = diff > 0 ? '+' : '';
          const indicator = diff > 0 ? color('↑', 'green') : color('↓', 'red');
          diffStr = `  ${indicator} ${sign}${diff.toFixed(1)}%`;
        }
      }

      console.log(`    ${item.name.padEnd(25)} ${color(value.toFixed(1) + '%', valueColor, 'bright')} ${printBar(value / 100, 1, 20)}${diffStr}`);
    }
  } else {
    console.log('');
    console.log(color('  提示: 运行 npm run test:cov 生成覆盖率报告', 'dim'));
    console.log(color('        之后再次运行此脚本可查看覆盖率数据', 'dim'));
  }

  printSection('📈 健康度总览');

  let healthScore = 100;
  const issues = [];

  if (techDebt.totalTodos > 50) {
    healthScore -= 15;
    issues.push('技术债务标记过多 (>50)');
  } else if (techDebt.totalTodos > 20) {
    healthScore -= 8;
  }

  if (techDebt.anyType.total > 50) {
    healthScore -= 15;
    issues.push('any 类型使用过多 (>50)');
  } else if (techDebt.anyType.total > 20) {
    healthScore -= 8;
  }

  if (lineStats.testRatio < 0.1) {
    healthScore -= 20;
    issues.push('测试代码占比过低 (<10%)');
  } else if (lineStats.testRatio < 0.2) {
    healthScore -= 10;
  }

  if (duplication.ratio > 0.15) {
    healthScore -= 10;
    issues.push('重复率较高 (>15%)');
  } else if (duplication.ratio > 0.1) {
    healthScore -= 5;
  }

  if (eslintResult.available && eslintResult.errors > 0) {
    healthScore -= Math.min(eslintResult.errors * 2, 20);
    issues.push(`ESLint 错误 (${eslintResult.errors})`);
  }

  healthScore = Math.max(0, Math.min(100, healthScore));

  let scoreColor = 'green';
  let scoreLabel = '优秀';
  if (healthScore < 60) {
    scoreColor = 'red';
    scoreLabel = '需要关注';
  } else if (healthScore < 80) {
    scoreColor = 'yellow';
    scoreLabel = '良好';
  }

  console.log('');
  console.log(`  综合健康评分:  ${color(healthScore.toFixed(0) + ' / 100', scoreColor, 'bright')}  -  ${color(scoreLabel, scoreColor)}`);
  console.log(`  ${printBar(healthScore / 100, 1, 50)}`);

  if (issues.length > 0) {
    console.log('');
    console.log(color('  主要问题:', 'red', 'bright'));
    for (const issue of issues) {
      console.log(`    ⚠  ${issue}`);
    }
  }

  console.log('');
  console.log(color('═'.repeat(60), 'dim'));
  console.log('');

  const report = {
    timestamp: Date.now(),
    lineStats,
    techDebt,
    duplication,
    testStats,
    coverage,
    eslint: eslintResult,
    healthScore,
  };

  const healthDir = path.join(projectRoot, '.code-health');
  if (!fs.existsSync(healthDir)) {
    await fs.promises.mkdir(healthDir, { recursive: true });
  }

  await fs.promises.writeFile(
    path.join(healthDir, 'latest.json'),
    JSON.stringify(report, null, 2),
    'utf-8'
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  const reportFile = path.join(healthDir, `report-${dateStr}.json`);
  if (!fs.existsSync(reportFile)) {
    await fs.promises.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');
  }

  console.log(color('  💾 报告已保存到 .code-health/latest.json', 'dim'));
  console.log(color('  📊 使用 npm run tech-debt 查看趋势报告', 'dim'));
  console.log('');
}

main().catch(error => {
  console.error(color('运行出错:', 'red'), error);
  process.exit(1);
});
