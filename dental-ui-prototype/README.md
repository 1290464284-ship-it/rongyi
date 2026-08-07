# 蓉易口腔诊所 · UI 独立设计方案（高保真原型）

> 医疗洁净风 · 青蓝 × 薄荷 · 纯静态原型（无构建、无后端，双击即可预览）

本目录是一套**独立 UI 设计方案**：先以风格指南 + 高保真原型站的形式呈现完整设计语言，供预览与迭代确认；认可后作为现有系统（`source/` 仓库 v2 版本）改版的设计基线，再进入落地实施。

## 如何预览

方式一（最简单）：**双击 `index.html`**，从页面底部"原型页面"入口卡进入各页面。

方式二（本地服务器，推荐体验完整路径）：
```bash
cd dental-ui-prototype
npx http-server . -p 8000
# 浏览器打开 http://localhost:8000/index.html
```

登录页预填演示账号：`admin` / `ry0801`（任意提交即进入工作台）。

## 页面清单（8 页）

| 页面 | 文件 | 说明 |
| --- | --- | --- |
| 风格指南 | `index.html` | 设计 token（色板 14 色 / 字体层级 / 圆角 / 阴影 / 动效）+ 全部组件示例 + 7 页入口 |
| 登录 | `login.html` | 左品牌区 + 右登录卡，诊所品牌展示 |
| 工作台 | `dashboard.html` | 今日概览：4 统计卡 + 接下来 1 小时预约时间线 + 今日提醒 + 新建预约 |
| 患者列表 | `patients.html` | 搜索筛选 + 表格 + 新建患者弹窗（必填与手机号校验、行追加） |
| 预约排班 | `schedule.html` | 按医生分栏 08:00–18:00 时间轴，预约块状态色左缘，日/周切换 |
| 收费工作台 | `billing.html` | 待缴费列表 + 收费详情 + 收款方式四选一 + 收费确认联动 |
| 治疗计划 | `treatment-plan.html` | 患者信息卡 + 明细行增删 + 合计实时重算 + 发起收费 |
| 影像查看 | `imaging.html` | 分组缩略图 + 大图查看区 + 缩放/旋转等控件 |

## 设计 Token 摘要

| Token | 值 | 用途 |
| --- | --- | --- |
| `--primary` | `#0E8A8A` 青蓝 | 主按钮 / 链接 / 导航选中 / 品牌 |
| `--accent` / `--accent-strong` | `#3CC89A` / `#28A87E` 薄荷 | 点缀 / 治疗中徽章 |
| `--bg` / `--surface` / `--border` | `#F5F9F8` / `#FFFFFF` / `#DCE9E6` | 页面底 / 卡片 / 边框 |
| `--text` / `--muted` | `#16303A` / `#5E7580` | 主文字 / 次要文字 |
| `--success` / `--warning` / `--danger` | `#1D8A55` / `#D9822B` / `#C94A4A` | 已完成 / 待缴费 / 删除（克制红） |
| 圆角 | 卡片 10px · 按钮 8px · 徽章 5px | — |
| 阴影 | 单层浅影，hover 加深 | 禁止重阴影/彩色阴影 |
| 字体 | `Segoe UI` / `Microsoft YaHei` 系统栈 | 标题 18px/700 · 正文 13px · 数字 tabular-nums |
| 动效 | 120–250ms，`cubic-bezier(.2,.6,.25,1)` | 弹窗对称开合 · 按钮按压 scale(.97) · hover 过渡 |

## 与 v2 系统的关系

- 本方案为**独立设计交付**（B 方案）：不直接改动 `source/` 仓库。
- 用户确认设计后，以本目录为基线落地到 v2（`source/`），落地时再按真实组件库/框架适配（原型为纯 HTML/CSS/JS，动效用 CSS 过渡；v2 如需拖拽/手势再引入 spring 类动画库）。
- 规格全文见外层仓库 `docs/superpowers/specs/2026-08-06-dental-ui-design.md`，实现计划见 `docs/plans/2026-08-06-dental-ui-prototype.md`。

## 截图目录

`screenshots/` 下每页一张全页截图（Playwright 本地生成），用于快速预览与对比迭代前后差异。

## 技术说明

- 纯静态：`assets/css/styles.css`（设计 token 全站唯一来源）+ `assets/js/data.js`（演示假数据）+ `assets/js/app.js`（弹窗/确认/Toast/Tab/导航高亮通用行为）。
- 页面间普通 `<a>` 链接导航，`file://` 双击即可运行。
- `scripts/verify.js` 为本地验证脚本（Playwright，非交付物）：`node scripts/verify.js <页面> '<JSON 检查项>' [截图名]`。
