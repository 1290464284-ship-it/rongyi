// 一次性有序替换脚本：styles.css 二期 token 化（A3/A7/A8/A10/A11）。
// 幂等（已替换的不再匹配）；每步替换前断言命中次数，防止静默失配。
import fs from 'node:fs';

const file = new URL('./../src/web/styles.css', import.meta.url);
let css = fs.readFileSync(file, 'utf8');

function count(re) {
  const global = new RegExp(re.source, 'g');
  const m = css.match(global);
  return m ? m.length : 0;
}

function step(name, re, replacement, expected) {
  const before = count(re);
  if (before !== expected) {
    throw new Error(`${name}: expected ${expected} matches, got ${before}`);
  }
  css = css.replace(re, replacement);
  console.log(`${name}: ${before} replaced`);
}

// 1. 新增 token（插到 --barcode-ink 之后）
step('insert-tokens', /(--barcode-ink: #16303A;\n)/, `$1
  /* 二期：刻度 token（A3/A7/A8/A10/A11 收敛） */
  /* 间距 4px 基 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  /* 字号七档（11/12/13/14/16/18/24，消灭 10.5/11.5/12.5/15/19/22 孤值） */
  --fs-xs: 11px;
  --fs-sm: 12px;
  --fs-base: 13px;
  --fs-md: 14px;
  --fs-lg: 16px;
  --fs-xl: 18px;
  --fs-2xl: 24px;
  /* 控件高度三档（32/38/40） */
  --control-h-sm: 32px;
  --control-h-md: 38px;
  --control-h-lg: 40px;
  /* 卡片内边距三档（card 18 / panel 16 / compact 12） */
  --card-pad: 18px;
  --card-pad-panel: 16px;
  --card-pad-compact: 12px;
  /* z-index 阶梯（A10） */
  --z-sidebar: 5;
  --z-topbar: 20;
  --z-modal: 20;
  --z-toast: 40;
  --z-tooltip: 60;
  --z-skip: 1200;
  /* 胶囊圆角（A11） */
  --radius-pill: 999px;
  /* 语义色底上的文字（暗色用深青保证对比度） */
  --on-semantic: #FFFFFF;
`, 1);

// 2. 暗色块补 --on-semantic（插到暗色 --on-primary 之后）
step('insert-dark-on-semantic', /(    --on-primary: #0C171A;\n)/, `$1    --on-semantic: #0C171A;\n`, 1);

// 3. 字号孤值收敛（先特殊后常规）
step('fs-10.5', /font-size: 10\.5px;/g, 'font-size: var(--fs-xs);', 2);
step('fs-11.5', /font-size: 11\.5px;/g, 'font-size: var(--fs-sm);', 1);
step('fs-12.5', /font-size: 12\.5px;/g, 'font-size: var(--fs-sm);', 1);
step('fs-15', /font-size: 15px;/g, 'font-size: var(--fs-lg);', 2);
step('fs-19', /font-size: 19px;/g, 'font-size: var(--fs-xl);', 1);
step('fs-22', /font-size: 22px;/g, 'font-size: var(--fs-2xl);', 1);
step('fs-11', /font-size: 11px;/g, 'font-size: var(--fs-xs);', 10);
step('fs-12', /font-size: 12px;/g, 'font-size: var(--fs-sm);', 31);
step('fs-13', /font-size: 13px;/g, 'font-size: var(--fs-base);', 25);
step('fs-14', /font-size: 14px;/g, 'font-size: var(--fs-md);', 4);
step('fs-16', /font-size: 16px;/g, 'font-size: var(--fs-lg);', 1);
step('fs-18', /font-size: 18px;/g, 'font-size: var(--fs-xl);', 3);
step('fs-24', /font-size: 24px;/g, 'font-size: var(--fs-2xl);', 3);

// 4. z-index token 化（按上下文逐个）
step('z-sidebar', /position: relative;\n  z-index: 5;/, 'position: relative;\n  z-index: var(--z-sidebar);', 1);
step('z-modal', /place-items: center;\n  z-index: 20;/, 'place-items: center;\n  z-index: var(--z-modal);', 1);
step('z-topbar', /position: sticky;\n  top: 0;\n  z-index: 20;/, 'position: sticky;\n  top: 0;\n  z-index: var(--z-topbar);', 1);
step('z-toast', /z-index: 40;/g, 'z-index: var(--z-toast);', 1);
step('z-tooltip', /z-index: 60;/g, 'z-index: var(--z-tooltip);', 1);
step('z-skip', /z-index: 1200;/g, 'z-index: var(--z-skip);', 1);

// 5. 胶囊圆角 + skeleton 6px
step('radius-pill', /border-radius: 999px;/g, 'border-radius: var(--radius-pill);', 3);
step('skeleton-radius', /  border-radius: 6px;\n  background: linear-gradient/, '  border-radius: var(--radius-xs);\n  background: linear-gradient', 1);

// 6. toast 文字色走 token
step('toast-color', /  padding: 12px 14px;\n  color: white;/, '  padding: 12px 14px;\n  color: var(--on-semantic);', 1);

// 7. 控件高度三档
step('control-h-sm', /  width: 280px;\n  height: 32px;/, '  width: 280px;\n  height: var(--control-h-sm);', 1);
step('control-h-md', /  width: 100%;\n  height: 38px;\n  padding: 0 12px 0 34px;/, '  width: 100%;\n  height: var(--control-h-md);\n  padding: 0 12px 0 34px;', 1);
step('control-h-lg', /  width: 100%;\n  height: 40px;\n  border: 0;\n  border-radius: var\(--radius-sm\);\n  background: var\(--primary\);\n  color: var\(--on-primary\);/, '  width: 100%;\n  height: var(--control-h-lg);\n  border: 0;\n  border-radius: var(--radius-sm);\n  background: var(--primary);\n  color: var(--on-primary);', 1);

// 8. 卡片内边距三档
step('card-pad', /  padding: 18px;\n  display: grid;\n  gap: 8px;\n  transition: box-shadow/, '  padding: var(--card-pad);\n  display: grid;\n  gap: 8px;\n  transition: box-shadow', 1);
step('panel-analytics', /  box-shadow: var\(--shadow\);\n  padding: 16px;\n  min-width: 0;\n  transition/, '  box-shadow: var(--shadow);\n  padding: var(--card-pad-panel);\n  min-width: 0;\n  transition', 1);
step('panel-today', /  box-shadow: var\(--shadow\);\n  padding: 16px;\n  margin-bottom: 16px;\n  display: grid;\n  gap: 12px;/, '  box-shadow: var(--shadow);\n  padding: var(--card-pad-panel);\n  margin-bottom: 16px;\n  display: grid;\n  gap: 12px;', 1);
step('panel-print', /  box-shadow: var\(--shadow\);\n  padding: 16px;\n  display: grid;\n  gap: 8px;\n\}/, '  box-shadow: var(--shadow);\n  padding: var(--card-pad-panel);\n  display: grid;\n  gap: 8px;\n}', 1);
step('panel-barcode', /  justify-items: center;\n  padding: 16px;\n  background: #fff;/, '  justify-items: center;\n  padding: var(--card-pad-panel);\n  background: #fff;', 1);
step('panel-triage', /  box-shadow: var\(--shadow\);\n  padding: 16px;\n  margin-top: 16px;\n  display: grid;\n  gap: 12px;/, '  box-shadow: var(--shadow);\n  padding: var(--card-pad-panel);\n  margin-top: 16px;\n  display: grid;\n  gap: 12px;', 1);
step('stat-card-pad', /  box-shadow: var\(--shadow\);\n  padding: 14px 16px;\n  display: grid;\n  gap: 4px;/, '  box-shadow: var(--shadow);\n  padding: var(--card-pad-panel);\n  display: grid;\n  gap: 4px;', 1);
step('timeline-item-pad', /  border-left: 4px solid var\(--primary\);\n  border-radius: var\(--radius\);\n  box-shadow: var\(--shadow\);\n  padding: 14px 16px;/, '  border-left: 4px solid var(--primary);\n  border-radius: var(--radius);\n  box-shadow: var(--shadow);\n  padding: var(--card-pad-panel);', 1);
step('reminder-wechat-card-pad', /  border-radius: var\(--radius-sm\);\n  padding: 12px 14px;\n  background: var\(--surface\);\n  box-shadow: var\(--shadow\);/, '  border-radius: var(--radius-sm);\n  padding: var(--card-pad-compact);\n  background: var(--surface);\n  box-shadow: var(--shadow);', 2);
step('board-column-pad', /  box-shadow: var\(--shadow\);\n  padding: 12px;\n  min-width: 0;/, '  box-shadow: var(--shadow);\n  padding: var(--card-pad-compact);\n  min-width: 0;', 1);
step('charge-tree-pad', /  box-shadow: var\(--shadow\);\n  padding: 12px;\n}\n\n\.charge-tree {/, '  box-shadow: var(--shadow);\n  padding: var(--card-pad-compact);\n}\n\n.charge-tree {', 1);
step('kanban-card-pad', /padding: 10px 12px; cursor: grab; \}/, 'padding: var(--card-pad-compact); cursor: grab; }', 1);
step('kanban-col-pad', /  padding: 10px;\n  background: var\(--surface\);\n  border: 1px solid var\(--border\);\n  border-radius: var\(--radius-sm\);\n  transition: border-color/, '  padding: var(--card-pad-compact);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  transition: border-color', 1);
step('board-card-pad', /  border-radius: var\(--radius-sm\);\n  padding: 10px;\n  display: grid;\n  gap: 6px;/, '  border-radius: var(--radius-sm);\n  padding: var(--card-pad-compact);\n  display: grid;\n  gap: 6px;', 1);
step('settle-summary-pad', /  box-shadow: var\(--shadow\);\n  padding: 10px 14px;/, '  box-shadow: var(--shadow);\n  padding: var(--card-pad-compact);', 2);
step('upload-item-pad', /padding: 8px 10px; \}/, 'padding: var(--card-pad-compact); }', 1);

// 9. 间距刻度应用于新增类（A3 落地示例）
step('backup-comparison-gap', /\.backup-comparison \{\n  display: grid;\n  grid-template-columns: repeat\(auto-fit, minmax\(280px, 1fr\)\);\n  gap: 16px;\n  margin-bottom: 16px;\n\}/, `.backup-comparison {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}`, 1);

fs.writeFileSync(file, css, 'utf8');
console.log('done');
