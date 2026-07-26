import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const healthDir = path.join(projectRoot, '.code-health');
const historyFile = path.join(healthDir, 'history.json');

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
};

function color(text, colorName) {
  return colors[colorName] + text + colors.reset;
}

function formatNumber(num) {
  return num.toLocaleString('zh-CN');
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadHistory() {
  if (!fs.existsSync(historyFile)) {
    return [];
  }
  try {
    const content = await fs.promises.readFile(historyFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveHistory(history) {
  if (!fs.existsSync(healthDir)) {
    await fs.promises.mkdir(healthDir, { recursive: true });
  }
  await fs.promises.writeFile(historyFile, JSON.stringify(history, null, 2), 'utf-8');
}

async function collectCurrentData() {
  const latestFile = path.join(healthDir, 'latest.json');
  if (!fs.existsSync(latestFile)) {
    return null;
  }
  try {
    const content = await fs.promises.readFile(latestFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function extractMetrics(report) {
  return {
    timestamp: report.timestamp,
    codeLines: report.lineStats?.total?.code || 0,
    testLines: report.lineStats?.test?.code || 0,
    testRatio: report.lineStats?.testRatio || 0,
    totalTodos: report.techDebt?.totalTodos || 0,
    fixmeCount: report.techDebt?.todos?.FIXME || 0,
    todoCount: report.techDebt?.todos?.TODO || 0,
    hackCount: report.techDebt?.todos?.HACK || 0,
    anyTypeCount: report.techDebt?.anyType?.total || 0,
    duplicationRatio: report.duplication?.ratio || 0,
    eslintErrors: report.eslint?.errors || 0,
    eslintWarnings: report.eslint?.warnings || 0,
    totalTests: report.testStats?.totalTests || 0,
    testSuites: report.testStats?.testSuites || 0,
    coverageLines: report.coverage?.lines || 0,
    healthScore: report.healthScore || 0,
  };
}

async function addToHistory() {
  const current = await collectCurrentData();
  if (!current) {
    console.log(color('未找到最新报告，请先运行 npm run health', 'yellow'));
    return;
  }

  const history = await loadHistory();
  const metrics = extractMetrics(current);

  const lastEntry = history[history.length - 1];
  const today = new Date(metrics.timestamp).toDateString();

  if (lastEntry && new Date(lastEntry.timestamp).toDateString() === today) {
    history[history.length - 1] = metrics;
    console.log(color('今日数据已更新', 'green'));
  } else {
    history.push(metrics);
    console.log(color('新数据已添加到历史记录', 'green'));
  }

  if (history.length > 365) {
    history.splice(0, history.length - 365);
  }

  await saveHistory(history);
  console.log(color(`历史记录总数: ${history.length} 条`, 'dim'));
}

function drawSparkline(values, width = 40) {
  if (values.length < 2) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const step = values.length / width;
  const samples = [];

  for (let i = 0; i < width; i++) {
    const idx = Math.min(Math.floor(i * step), values.length - 1);
    samples.push(values[idx]);
  }

  const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  let sparkline = '';

  for (const val of samples) {
    const normalized = (val - min) / range;
    const level = Math.min(Math.floor(normalized * 7), 7);
    sparkline += bars[level];
  }

  return sparkline;
}

function printTrend(name, current, previous, isBetterHigher = true) {
  if (previous === undefined || previous === null) {
    return `${color(formatNumber(current), 'bright')}  ${color('(首次记录)', 'dim')}`;
  }

  const diff = current - previous;
  if (diff === 0) {
    return `${color(formatNumber(current), 'bright')}  ${color('→ 无变化', 'dim')}`;
  }

  const percent = previous !== 0 ? ((diff / previous) * 100).toFixed(1) : '∞';
  const sign = diff > 0 ? '+' : '';

  let trendColor;
  let arrow;
  if (isBetterHigher) {
    trendColor = diff > 0 ? 'green' : 'red';
    arrow = diff > 0 ? '↑' : '↓';
  } else {
    trendColor = diff > 0 ? 'red' : 'green';
    arrow = diff > 0 ? '↑' : '↓';
  }

  return `${color(formatNumber(current), 'bright')}  ${color(`${arrow} ${sign}${percent}%`, trendColor)}`;
}

async function showTrend() {
  const history = await loadHistory();

  if (history.length === 0) {
    console.log('');
    console.log(color('暂无历史数据', 'yellow'));
    console.log(color('请先运行 npm run health 生成报告，然后运行 npm run tech-debt record 记录数据', 'dim'));
    console.log('');
    return;
  }

  console.log('');
  console.log(color('╔══════════════════════════════════════════════════════════╗', 'cyan'));
  console.log(color('║              技术债务趋势报告                            ║', 'bright', 'cyan'));
  console.log(color('╚══════════════════════════════════════════════════════════╝', 'cyan'));
  console.log(color(`  数据点数: ${history.length} 条记录`, 'dim'));
  console.log(color(`  时间范围: ${formatDate(history[0].timestamp)} ~ ${formatDate(history[history.length - 1].timestamp)}`, 'dim'));

  const current = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const first = history[0];

  console.log('');
  console.log(color('━'.repeat(60), 'dim'));
  console.log(color('  📊 关键指标趋势', 'bright'));
  console.log(color('━'.repeat(60), 'dim'));
  console.log('');

  const metrics = [
    { name: '健康评分', key: 'healthScore', unit: '', isBetter: true, format: v => v.toFixed(0) },
    { name: '代码行数', key: 'codeLines', unit: '', isBetter: true, format: v => formatNumber(v) },
    { name: '测试代码占比', key: 'testRatio', unit: '%', isBetter: true, format: v => (v * 100).toFixed(1) + '%' },
    { name: '技术债务标记', key: 'totalTodos', unit: '个', isBetter: false, format: v => formatNumber(v) },
    { name: '  - FIXME', key: 'fixmeCount', unit: '个', isBetter: false, format: v => formatNumber(v) },
    { name: '  - TODO', key: 'todoCount', unit: '个', isBetter: false, format: v => formatNumber(v) },
    { name: '  - HACK', key: 'hackCount', unit: '个', isBetter: false, format: v => formatNumber(v) },
    { name: 'any 类型', key: 'anyTypeCount', unit: '个', isBetter: false, format: v => formatNumber(v) },
    { name: '重复率', key: 'duplicationRatio', unit: '%', isBetter: false, format: v => (v * 100).toFixed(2) + '%' },
    { name: 'ESLint 错误', key: 'eslintErrors', unit: '个', isBetter: false, format: v => formatNumber(v) },
    { name: 'ESLint 警告', key: 'eslintWarnings', unit: '个', isBetter: false, format: v => formatNumber(v) },
    { name: '测试用例数', key: 'totalTests', unit: '个', isBetter: true, format: v => formatNumber(v) },
    { name: '行覆盖率', key: 'coverageLines', unit: '%', isBetter: true, format: v => v.toFixed(1) + '%' },
  ];

  console.log('  ' + '指标'.padEnd(18) + '当前值'.padStart(15) + '较上次'.padStart(15) + '累计变化'.padStart(15));
  console.log('  ' + color('─'.repeat(65), 'dim'));

  for (const metric of metrics) {
    const currentVal = current[metric.key] || 0;
    const prevVal = previous ? previous[metric.key] : undefined;
    const firstVal = first ? first[metric.key] : undefined;

    let currentStr = metric.format(currentVal);

    let prevDiff = '';
    if (prevVal !== undefined) {
      const diff = currentVal - prevVal;
      if (diff === 0) {
        prevDiff = color('— 持平', 'dim');
      } else {
        const percent = prevVal !== 0 ? ((diff / prevVal) * 100).toFixed(1) : '∞';
        const sign = diff > 0 ? '+' : '';
        const trendColor = metric.isBetter ? (diff > 0 ? 'green' : 'red') : (diff > 0 ? 'red' : 'green');
        const arrow = diff > 0 ? '↑' : '↓';
        prevDiff = color(`${arrow} ${sign}${percent}%`, trendColor);
      }
    }

    let totalDiff = '';
    if (firstVal !== undefined && history.length > 1) {
      const diff = currentVal - firstVal;
      if (diff === 0) {
        totalDiff = color('— 持平', 'dim');
      } else {
        const percent = firstVal !== 0 ? ((diff / firstVal) * 100).toFixed(1) : '∞';
        const sign = diff > 0 ? '+' : '';
        const trendColor = metric.isBetter ? (diff > 0 ? 'green' : 'red') : (diff > 0 ? 'red' : 'green');
        const arrow = diff > 0 ? '↑' : '↓';
        totalDiff = color(`${arrow} ${sign}${percent}%`, trendColor);
      }
    }

    console.log(`  ${metric.name.padEnd(18)} ${color(currentStr, 'bright').padStart(20)} ${prevDiff.padStart(18)} ${totalDiff.padStart(18)}`);
  }

  console.log('');
  console.log(color('━'.repeat(60), 'dim'));
  console.log(color('  📈 趋势图 (最近 30 天)', 'bright'));
  console.log(color('━'.repeat(60), 'dim'));
  console.log('');

  const recentHistory = history.slice(-30);

  const sparklineMetrics = [
    { name: '健康评分', key: 'healthScore', isBetter: true },
    { name: '技术债务', key: 'totalTodos', isBetter: false },
    { name: '测试占比', key: 'testRatio', isBetter: true, multiplier: 100 },
    { name: 'any 类型', key: 'anyTypeCount', isBetter: false },
  ];

  for (const metric of sparklineMetrics) {
    const values = recentHistory.map(h => {
      const val = h[metric.key] || 0;
      return metric.multiplier ? val * metric.multiplier : val;
    });

    const sparkline = drawSparkline(values, 45);
    const currentVal = metric.multiplier
      ? (current[metric.key] * metric.multiplier).toFixed(1) + (metric.key === 'testRatio' ? '%' : '')
      : formatNumber(current[metric.key]);

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    let lineColor = 'cyan';
    if (!metric.isBetter) {
      const first = values[0];
      const last = values[values.length - 1];
      lineColor = last > first ? 'red' : 'green';
    } else {
      const first = values[0];
      const last = values[values.length - 1];
      lineColor = last >= first ? 'green' : 'red';
    }

    console.log(`  ${metric.name.padEnd(10)} ${color(sparkline, lineColor)}  ${color(currentVal, 'bright')}`);
    console.log(`            ${color('min: ' + (metric.key === 'testRatio' ? minVal.toFixed(1) + '%' : formatNumber(Math.round(minVal))), 'dim')}  ${color('max: ' + (metric.key === 'testRatio' ? maxVal.toFixed(1) + '%' : formatNumber(Math.round(maxVal))), 'dim')}`);
    console.log('');
  }

  if (history.length >= 7) {
    console.log(color('━'.repeat(60), 'dim'));
    console.log(color('  📅 近 7 天详情', 'bright'));
    console.log(color('━'.repeat(60), 'dim'));
    console.log('');

    const last7 = history.slice(-7);
    console.log('  ' + '日期'.padEnd(12) + '评分'.padStart(8) + '债务'.padStart(8) + 'any'.padStart(8) + '测试占比'.padStart(10) + '覆盖率'.padStart(10));
    console.log('  ' + color('─'.repeat(60), 'dim'));

    for (const entry of last7) {
      const date = formatDate(entry.timestamp);
      const score = entry.healthScore.toFixed(0);
      const todos = formatNumber(entry.totalTodos);
      const anyCount = formatNumber(entry.anyTypeCount);
      const testRatio = (entry.testRatio * 100).toFixed(1) + '%';
      const coverage = entry.coverageLines ? entry.coverageLines.toFixed(1) + '%' : 'N/A';

      let scoreColor = 'green';
      if (entry.healthScore < 60) scoreColor = 'red';
      else if (entry.healthScore < 80) scoreColor = 'yellow';

      console.log(`  ${date.padEnd(12)} ${color(score.padStart(6), scoreColor)} ${color(todos.padStart(8), 'yellow')} ${color(anyCount.padStart(8), 'red')} ${testRatio.padStart(10)} ${coverage.padStart(10)}`);
    }
  }

  console.log('');
  console.log(color('━'.repeat(60), 'dim'));
  console.log('');
  console.log(color('  💡 提示:', 'dim'));
  console.log(color('     • 运行 npm run health 生成最新报告', 'dim'));
  console.log(color('     • 运行 npm run tech-debt record 记录到历史', 'dim'));
  console.log(color('     • 定期运行可观察技术债务变化趋势', 'dim'));
  console.log('');
}

async function showHelp() {
  console.log('');
  console.log(color('技术债务追踪工具', 'bright', 'cyan'));
  console.log('');
  console.log('用法:');
  console.log('  node scripts/tech-debt-tracker.mjs [命令]');
  console.log('');
  console.log('命令:');
  console.log('  show      显示趋势报告 (默认)');
  console.log('  record    记录当前数据到历史');
  console.log('  help      显示帮助信息');
  console.log('');
  console.log('示例:');
  console.log('  npm run tech-debt              查看趋势报告');
  console.log('  npm run tech-debt record       记录当前数据');
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'show';

  switch (command) {
    case 'record':
    case 'add':
      await addToHistory();
      break;
    case 'show':
    case 'trend':
    case 'list':
      await showTrend();
      break;
    case 'help':
    case '--help':
    case '-h':
      await showHelp();
      break;
    default:
      console.log(color(`未知命令: ${command}`, 'red'));
      await showHelp();
      process.exit(1);
  }
}

main().catch(error => {
  console.error(color('运行出错:', 'red'), error);
  process.exit(1);
});
