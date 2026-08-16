import fs from 'node:fs';
import path from 'node:path';

// 桌面端完整同步核验：对 dist-web 与打包 asar 同时做正向/负向标记探针。
// 正向 = 全部轮次关键改动的唯一字符串必须存在；负向 = 已删除/回退的旧代码必须不存在。
const appRoot = path.resolve(import.meta.dirname, '..');

const distWebFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.css') || entry.name.endsWith('.html')) distWebFiles.push(full);
  }
})(path.join(appRoot, 'dist-web'));

const asarPath = path.join(appRoot, 'release-v2', 'win-unpacked', 'resources', 'app.asar');

const positive = [
  // 第二轮
  ['A1 pageRise 去 fill-mode（压缩形 .2s）', 'animation:pageRise .2s var(--ease)'],
  ['A2 --on-primary', '--on-primary'],
  ['A6 .ceph-compare-options', 'ceph-compare-options'],
  ['A6 .imaging-compare-toolbar', 'imaging-compare-toolbar'],
  ['A6 .relation-load-cap', 'relation-load-cap'],
  ['A6 .report-truncated', 'report-truncated'],
  ['A12 --barcode-ink', '--barcode-ink'],
  ['A18 .modal-close', 'modal-close'],
  ['B1 工作台错误态', '今日预约加载失败'],
  ['B4 状态刷新失败提示', '状态刷新失败'],
  ['B5 对比选项查询键', 'cephalometric-options'],
  ['C2 报表加载', '报表加载中'],
  ['C7 图表 aria 标签', '患者增长：'],
  ['D1 对比选项错误态', '对比选项加载失败'],
  ['D2 影像分类错误态', '影像分类加载失败'],
  // 二期批次1
  ['A17 hub-tabs 中文还原', '多门店经营概览'],
  ['C 级 busy 文案(备份)', '创建中...'],
  ['C1 .backup-comparison', 'backup-comparison'],
  ['C10 退款汇总错误', '退款状态汇总加载失败'],
  ['C10 分类错误', '分类列表加载失败'],
  ['C13 导出中', '导出中...'],
  ['B3 医生列表错误(10处)', '医生列表加载失败'],
  // 二期批次2
  ['A7 --fs-2xl', '--fs-2xl'],
  ['A3 --control-h-sm', '--control-h-sm'],
  ['A8 --card-pad-compact', '--card-pad-compact'],
  ['A10 --z-skip', '--z-skip'],
  ['A11 --radius-pill', '--radius-pill'],
  ['A9 stat-cards 统一', 'stat-cards'],
  // 二期批次3+4
  ['A5 看板合并 KanbanBoard', 'ui-kanban-card'],
  ['B2/A5 aria-live 播报', '卡片「'],
  ['A15 虚拟化 spacer', 'spacer-top'],
  ['B6 全部医生下拉', '医生列表加载失败'],
  // 阶段5 + 收尾
  ['滚动条 webkit', '::-webkit-scrollbar'],
  ['滚动条 firefox', 'scrollbar-width'],
  ['QuickCharge formatMoney', '快捷收费单价'],
];

const negative = [
  // 已删除的孤儿 CSS 类（A5 清理；以规则开头形式检测，排除 modal-a11y 的防御性选择器字符串）
  ['孤儿 .ui-switch', '.ui-switch {'],
  ['孤儿 .ui-segmented', '.ui-segmented {'],
  ['孤儿 .ui-drawer', '.ui-drawer-layer {'],
  ['孤儿 .ui-multiselect', '.ui-multiselect {'],
  ['孤儿 .ui-date-range', '.ui-date-range {'],
  ['孤儿 .ui-chip', '.ui-chip {'],
  // 已删除的旧看板/时间线体系（A5 合并）
  ['旧 .board-column', '.board-column'],
  ['旧 .timeline-item', '.timeline-item'],
  // A1 回退形式不得存在
  ['pageRise fill both', 'pageRise .2s var(--ease) both'],
  // A17 转义形式不得存在
  ['hub-tabs \\uXXXX 转义', '\\u591a\\u95e8\\u5e97'],
  // 历史已移除的原生弹窗（调用形式，注释/依赖中的裸词不算）
  ['window.prompt(', 'window.prompt('],
  ['window.confirm(', 'window.confirm('],
];

function scanBuffers(buffers, label) {
  const report = [];
  for (const [name, needle] of positive) {
    const bytes = Buffer.from(needle, 'utf8');
    const hit = buffers.some((buf) => buf.includes(bytes));
    report.push({ kind: 'positive', label, name, ok: hit });
  }
  for (const [name, needle] of negative) {
    const bytes = Buffer.from(needle, 'utf8');
    const hit = buffers.some((buf) => buf.includes(bytes));
    report.push({ kind: 'negative', label, name, ok: !hit, found: hit });
  }
  return report;
}

const distBuffers = distWebFiles.map((f) => fs.readFileSync(f));
const asarBuffer = fs.readFileSync(asarPath);

const distReport = scanBuffers(distBuffers, 'dist-web');
const asarReport = scanBuffers([asarBuffer], 'asar');

console.log('== dist-web ==');
for (const r of distReport) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.kind}] ${r.name}${r.found ? ' (found)' : r.ok ? '' : ' (missing)'}`);
}
console.log('\n== app.asar（桌面包） ==');
for (const r of asarReport) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.kind}] ${r.name}${r.found ? ' (found)' : r.ok ? '' : ' (missing)'}`);
}

const distFail = distReport.filter((r) => !r.ok).length;
const asarFail = asarReport.filter((r) => !r.ok).length;
console.log(`\nsummary: dist-web ${distReport.length - distFail}/${distReport.length} passed; asar ${asarReport.length - asarFail}/${asarReport.length} passed`);
if (distFail > 0 || asarFail > 0) process.exitCode = 1;
