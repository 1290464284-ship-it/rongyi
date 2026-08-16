# UI 翻新与统一 — 不一致清单、设计方向与第二轮实施记录

> 状态：**第二轮已完成**（阶段 2 设计方向 + 阶段 3 token 方案 + 本轮范围实施 + 阶段 7 截图验证 + R14 视觉回归护栏建立）。
> 改前基线：`apps/v2/test-results/ui-baseline/before/`；改后基线：`apps/v2/test-results/ui-baseline/after/`（亮/暗各 10 页 + A1 目验截图与探针 JSON）。
> 方法：7 路并行静态审计（52 个生产页面 + 全局共享组件）+ 机械化扫描（CSS 类失配全量比对、硬编码样式计数、历史问题逐条复核）。全程只读，未修改任何代码。
> 审计日期：2026-08（工作区 HEAD）。范围：`apps/v2/src/web/pages`（52 页）+ `src/web/components`（21 组件）+ 专属子组件目录（charges/、cephalometric/、treatment-plans/、dispense/、clinical-workflow/、processing-orders/、prescriptions/、first-exams/、imaging/、purchase-orders/、schedules/、follow-ups/、medical-records/）+ `styles.css`（3146 行）。

---

## 一、审计基线（先读结论）

1. **页面层 token 纪律极好**：52 页 .tsx 层 **0 处硬编码 hex、0 处 rgba、仅 8 处内联 style 对象**（多为动态功能性值，如网格列宽、SVG 字号）；子组件目录同样近零野生样式。历史「OutlineSvg/CompareResultView 硬编码 #f8fafc」已修（现走 `var(--chart-grid/bg/muted)`）。
2. **历史问题绝大多数已修**（附录 A 逐条复核）：第 7 轮 27 项中 C1/C2/C3/L2/L3/L6/M12/M13/P3/H1/H3 等全部闭环；缺陷台账 0 OPEN。**未修残留仅 2 项历史项**：处方「状态已刷新」假成功 toast（R7-M8）、Cephalometric/Imaging 同端点双请求（R7-H2）。
3. **不一致的根子集中在三层**（而非页面散乱）：
   - **styles.css 系统层**：700 处 px 手写、无间距/字号/控件尺寸 token；同一模式多套并存（看板 `.board-*` vs `.ui-kanban-*`、时间线 `.timeline-*` vs `.ui-timeline-*`、表格 DataTable vs ResourcePage 手写 `<table>`、树 Tree 组件 vs ChargeTreePanel 独立实现）。
   - **组件层**：PRIMITIVES.md 声明的 8 个「公共原语」（Switch/Segmented/Steps/Drawer/Dropdown/MultiSelect/DateRange/BatchBar）**实际不存在组件文件、零调用方**，但 `.ui-*` 对应 CSS 约 150 行仍留在样式表。
   - **页面细节层**：8 处「用了没样式」的类、若干 loading/error 态缺口、busy 文案缺口。

---

## 二、不一致清单（按影响面排序）

> 排序规则（提示词约定）：全局高频组件 > 高频页面 > 低频页面 > 特殊页面。

### A 级：全局高频组件 / 设计系统层（影响所有页面，最优先）

| # | 不一致 | 证据 |
|---|---|---|
| A1 | **弹窗遮罩层级冲突（全局模态层叠缺陷，待运行时目验）**：`.content > *` 的 `pageRise` 动画使用 `animation-fill-mode: both`，终态 `translateY(0)` 矩阵值残留 → `.page/.hub` 永久成为 stacking context；`modal-backdrop`（z-20）渲染在页面内部被「关进」该上下文，而 `.topbar`（z-20）是 `.content` 的兄弟、位于根上下文——按层叠规则**弹窗打开时顶栏可能画在遮罩之上、仍可交互**。同样被困的还有 tooltip（z-60）。需阶段 7 截图目验确认 | styles.css:545-558（pageRise + both）、767（modal-backdrop z-20）、446（topbar z-20）、2774（tooltip z-60） |
| A2 | **暗色主题主按钮白字对比度不达标**：暗色 `--primary #14A0A0` 上白字（裸 `button { color:white }`、`.btn-login { color:#fff }`）实测对比度 ≈ **3.19:1**（< WCAG AA 4.5:1，仅过 3:1 大字号线）；styles.css:97 注释声称暗色主色「保证文字/按钮达 AA」实际未达。第 4 轮修复提亮了暗色主色（解决文字色对比），反向恶化了按钮白字对比。亮色 `#0D8282` 白字 4.63:1 达标。影响全站所有主按钮与白字 on primary 组合（.ui-tree-action、toast.info 等） | styles.css:98、1608、1700；WCAG 计算 1.05/(0.2787+0.05)=3.19 |
| A3 | **控件尺寸零 token、多档并存**：按钮内边距 17 种规格（垂直 3/4/6/7/8/10/12px 七档 × 水平 8/9/10/12/14px 五档：全局 button 10px 12px、.tab 8px 14px、.ui-dropdown-trigger 8px 12px、.kanban-actions 4px 8px、.ui-tree-action 4px 10px、.sidebar-card-btn 4px 8px、.ui-badge 3px 9px 等）；输入/按钮高度 4 档：32px（.topbar-search）/≈37px（基础控件）/38px（.input-wrap input、.ui-multiselect-input）/40px（.btn-login）；无 `--space-*`/`--control-*` token | styles.css:1653、699、3025、3007、2966、425、3132、500、1563、3107、1604 |
| A4 | **「取消/次级」按钮视觉契约分裂**：CrudPage（154）、ResourcePage（467）、HelpDialogs（28-29、40）、FollowUpExecutionDialog（83）、QuerySection 重试（status.tsx:115）、SearchableSelect 加载更多（searchable-select.tsx:130）均用裸 `button` 渲染成主色实心；而 ConfirmDialog/PromptDialog 的取消统一用 `btn-secondary`（dialog.tsx:175、244）。每个弹窗都有的「取消」出现两种视觉语义；FollowUpExecutionDialog 因此呈现双主色按钮 | 各文件行号；styles.css:1698-1703、1720-1728 |
| A5 | **组件双体系 / 原语库空转**：① 8 个「公共原语」组件文件不存在、零调用方（PRIMITIVES.md 声明与实际脱节），对应 `.ui-switch/.ui-segmented/.ui-steps/.ui-drawer/.ui-dropdown/.ui-multiselect/.ui-date-range/.ui-accordion/.ui-chip/.ui-radio` 约 150 行 CSS 为孤儿样式；② 看板双套：AppointmentBoardPage 手写 `.board-*`（styles.css:1305-1393）vs KanbanBoard 组件 `.ui-kanban-*`（2972-3010）；③ 时间线双套：`.timeline-*`（1385-1413，疑似已无调用方）vs Timeline 组件 `.ui-timeline-*`（2894-2930）；④ 表格双套：ResourcePage 手写 `<table>`（397-443）vs DataTable；⑤ Tree 组件（.ui-tree-*）零业务调用方，收费树走 charges/ChargeTreePanel 独立实现；⑥ SearchableSelect 与 FormBuilder 各自实现「加载更多+上限提示」 | PRIMITIVES.md:1-15；components/ glob 与 import grep；各文件行号 |
| A6 | **「用了没样式」的 CSS 类 8 处**（机械扫描确认，第 2/3 轮同款问题的残留）：`.arrived`（工作台状态徽章无底色无语义色，高频可见）、`.report-truncated`（库存报表截断提示裸文本）、`.relation-load-cap`（FormBuilder 关联加载提示）、`.ui-tree-node`（Tree 节点包裹）、`.ceph-compare-options`（头影对比选项容器）、`.imaging-compare-toolbar`（影像对比工具栏）、`.sidebar-group-wrap`（侧栏分组包裹，无视觉影响）、`.upper`（牙位图 no-op 修饰，lower 有定义 upper 无，不对称） | DashboardPage.tsx:124；InventoryReportPanel.tsx:53；FormBuilder.tsx:156；Tree.tsx:55；CephalometricPage.tsx:228；ImagingPage.tsx:312；Layout.tsx:245；DentalChart.tsx:24 |
| A7 | **字号 13 档无刻度 token**：10.5/11/11.5/12/12.5/13/14/15/16/18/19/22/24px，含 11.5（仅 .login-sub）、12.5（仅 .topbar-user）两个孤值；正文 13/表头 12/区块标题 14/页标题 18/顶栏 19/统计值 24 为约定俗成，无成文档位 | styles.css 全文件 font-size 统计 |
| A8 | **卡片内边距 12+ 档无规则**：`.login-d-card` 32px > `.modal` 20px > `.card` 18px > `.analytics-panel/.today-overview/.print-preview` 16px > `.stat-card/.timeline-item` 14px 16px > `.reminder-card/.wechat-template-card` 12px 14px > `.board-column/.charge-tree-panel` 12px > `.board-card` 10px > `.ui-upload-item` 8px 10px；且紧凑卡（.reminder-card/.wechat-template-card）radius 8px、无 hover 抬升，游离于 `.card`（radius 10px、hover 抬升）体系之外 | styles.css:1468、813、1108、1130、906、1926、1318、1338、3013、1990-1996、1103-1116 |
| A9 | **同一组经营数据三种统计卡视觉**：工作台 `.stat-card`（24px 数字+11px 标签）／经营分析 `.cards>.card`（strong+span 平铺）／多门店 `.stat-row`（纯文本）——数据相同、层级三种 | DashboardPage vs AnalyticsDashboardPage.tsx:207-210 vs ClinicOverviewPage.tsx:61-64 |
| A10 | **z-index 9 处硬编码无阶梯 token**：5（.sidebar-brand）/20（topbar、modal-backdrop 同级）/40（toast）/50（dropdown、multiselect 菜单）/60（tooltip）/120（drawer）/1200（skip-link）；同级 20 的冲突即 A1 | styles.css:235、446、767、1773、3027、3116、2774、2599、569 |
| A11 | **硬编码色值残留**：#fff/white 9 处（7 处非 token：.barcode-svg 590、.barcode-print 598、.btn-login 1608、裸 button 1700、.toast 1782、.ui-switch span 2710、.ui-tree-action 2964，其中 1608/2964/1700 受 A2 暗色对比度问题波及）；999px 胶囊圆角 5 处无 `--radius-pill`（2695、3114、3126、3127、3132）；6px 圆角 3 处偏离 `--radius-xs=5px` 体系（.skeleton-line 846、.ui-tooth 3045/3046） | styles.css 各行 |
| A12 | **暗色下条码不可见（真实视觉缺陷）**：`.barcode-svg`/`.barcode-print` 硬编码 `background:#fff` 且无暗色覆盖；条码条 `fill="currentColor"`=var(--text)（暗色 #E6F4F1 近白）→ 白底浅条。波及库存卡片条码与条码打印对话框 | styles.css:590、598；BarcodeView.tsx:17；InventoryPage.tsx:367、473-479 |
| A13 | **加载态两套并存**：骨架屏 LoadingState（页面主流）vs 裸文本「加载中...」（Layout.tsx:167/176、ReportDialog:89、TeethMarkDialog:91、HistoryDialog:21）；TriageQueuePanel loading 时直接 `return null`（无任何占位） | 各文件行号 |
| A14 | **表格无障碍语义缺失**：DataTable 无 `<caption>`/aria-label/`th scope`/排序语义（data-table.tsx:44-67）；ResourcePage 手写表格同样（397-443）。第 29 轮已确认的 a11y 基线之外的新缺口 | data-table.tsx |
| A15 | **DataTable 500 行硬截断（非真虚拟化）**：>500 行 slice 截断+提示；500 行内全部渲染、滚动增量 100 行/次。千行级列表仍有大量 DOM（历史 R7-M2 部分修） | data-table.tsx:32-37、70-74 |
| A16 | **`.tag` 样式双份拷贝漂移**：`.reminder-head .tag` padding `2px 10px` vs `.wechat-template-head .tag` `2px 8px`；同视觉语义两套数值、无全局基类 | styles.css:1939-1945、2007-2013 |
| A17 | **Hub 导航中文全量 `\uXXXX` 转义（66 处）**：渲染正确但可维护性差（历史多维度评分点名，未修） | hub-tabs.tsx:85-175 |
| A18 | **弹窗无显式关闭按钮**：Dialog 头部只有 `<h2>`，关闭仅靠 Esc/遮罩/取消按钮；Drawer 设计了 `.ui-drawer-close` 但 Drawer 组件不存在——模态关闭惯例不对称 | dialog.tsx:115-117；styles.css:2665-2675 |
| A19 | **Tree 缩进双倍**：`.ui-tree-children` margin-left 16px + 每层内联 `paddingLeft: depth*16+8` → 每层实际缩进 ≈32px；`depth*16` 硬编码且无 token | Tree.tsx:58；styles.css:2933 |

### B 级：高频页面（日常使用频繁触达）

| # | 页面 | 不一致 | 证据 |
|---|---|---|---|
| B1 | 工作台 DashboardPage | ① 今日预约状态徽章 `.arrived` 无样式（裸文本，见 A6）；② `workbench.error` 从未消费——今日预约接口失败被渲染成「今日暂无预约」，**错误伪装成空态**；③ `.appointment-row` 无 hover 态 | DashboardPage.tsx:34-46、124 |
| B2 | 预约看板 AppointmentBoardPage | ① 看板体系与 KanbanBoard 组件双套（见 A5）；② 拖拽纯鼠标：无键盘替代、列 `<section>` 无 aria-label、卡片移动后无焦点/live region 跟随（有行内 status select 键盘兜底，判部分修）；③ 卡片 `<time>` 渲 ISO 原文，与 AppointmentsPage `toLocaleString('zh-CN')` 不一致 | AppointmentBoardPage.tsx:98-158、140；appointments/columns.tsx:48 |
| B3 | 全局搜索 GlobalSearchPage | ① 资源筛选 `.tab` 按钮无 `.tabs` 容器（无底色胶囊，观感悬浮按钮；PermissionsPage 同款用 `.tabs` 容器）；② 结果表 resource 列显示英文键（patients/inventoryItems），RESOURCE_LABELS 中文映射只用于筛选按钮 | GlobalSearchPage.tsx:65-77、23、53-57、95-102 |
| B4 | 处方 PrescriptionsPage | **历史 R7-M8 未修**：「状态已刷新」toast 先于请求结果（`void refresh()` 未 await 即弹成功 toast）；refresh 失败无提示且产生 unhandled rejection——每次刷新状态都可能是「假成功」 | prescriptions/status-dialog.tsx:57-63、25-28 |
| B5 | 头颅侧位/影像 双页 | **历史 R7-H2 未修**：对比选项查询与 CrudPage 列表同 URL 不同 queryKey（`['cephalometric']` vs `['cephalometric-options']`、`['imaging']` vs `['imaging-options']`）→ 初始态每页多发 1 条完全相同的 GET | CephalometricPage.tsx:29-34；ImagingPage.tsx:35-40 |
| B6 | 医生下拉跨 6 处静默失败 | PrescriptionForm 已修（错误态+重试+MissingSelectOption），但 VisitsPage.VisitForm、TreatmentsPage.TreatmentFormFields、FirstExamsPage.FirstExamFormFields、PlanFormFields、ImagingFormFields、RecordDialog 仍静默空列表（加载中仅一个空 option、失败无提示） | 各表单字段文件行号；PrescriptionForm.tsx:23-39（已修范式） |
| B7 | 库存 InventoryPage | `batches`/`expiringBatches` 两查询无 loading/error 态：加载中空表、失败静默（页面级 loadError 不覆盖） | InventoryPage.tsx:68-77、80 |
| B8 | 加工单 ProcessingOrdersPage | 流程统计 DataTable 无 loading/error 态：加载中显示「暂无流程统计数据」（误导）、失败静默；settle 汇总条 `stats.data &&` 首载空白 | ProcessingOrdersPage.tsx:299-304、173 |
| B9 | 收费 ChargesPage | 主文件仍 422 行（历史拆分仅部分落地）；`payMethodQuery` 失败静默回退内置支付方式（注释称有意）；QuickChargeDialog 单价 `(price/100).toString()` 裸显示未走 formatMoney（显示 `12.5` 而非 `¥12.50`） | ChargesPage.tsx:84-96；QuickChargeDialog.tsx:32 |
| B10 | 随访 FollowUpsPage / FollowUpExecutionDialog | ① 完成随访 PromptDialog 未传 `pending={completing}`：提交中按钮仅换文案不 disabled；② 执行弹窗取消按钮未加 btn-secondary（并入 A4） | FollowUpsPage.tsx:315-324；FollowUpExecutionDialog.tsx:83 |
| B11 | 治疗计划 TreatmentPlansPage | 「打印」按钮无 busy 守卫：双击可重复 POST 打印、printCount 双增（有实际成本）；`.charge-item-row` 5 列网格被 PlanFormFields 8 格内容复用 → 自动换行列错位（该网格本为 DispenseCreateForm 设计） | TreatmentPlansPage.tsx:187、240-254；PlanFormFields.tsx:116-126；styles.css:1901-1906 |

### C 级：低频页面 / 细节

| # | 页面 | 不一致 | 证据 |
|---|---|---|---|
| C1 | 备份 BackupsPage | 唯一内联布局样式 `style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:'1rem', marginBottom:'1rem' }}`；busy 期间「创建备份/校验/暂存恢复」不 disabled、无忙碌文案（仅 JS 守卫） | BackupsPage.tsx:164-179 |
| C2 | 库存报表 InventoryReportPanel | 无 placeholderData：焦点重取时整表被 LoadingState 替换（闪烁）；`.report-truncated` 无样式（见 A6） | InventoryReportPanel.tsx:13-24、38、53 |
| C3 | 到诊率 FollowUpReportPage | 错误态无重试按钮（QueryBoundary 错误分支只出文字，其余页均有重试）；导出按钮无 busy 守卫 | FollowUpReportPage.tsx:29-33；status.tsx:28-47 |
| C4 | 患者时间线 PatientTimelinePage | `saveCustomFields` 无 busy 守卫（双击双 PUT）；时间轴 time 渲 ISO 原文；`board-summary/.summary-item` 看板类复用于时间线统计（语义错位、样式正常） | PatientTimelinePage.tsx:171-193、127-149、210-228 |
| C5 | 系统操作 SystemOperationsPage | 页内全局搜索无结果静默（GlobalSearchPage 有空态，同能力两呈现）；`key={row.id ?? index}`（历史 L5 部分修） | SystemOperationsPage.tsx:150、156-157 |
| C6 | 桌面设置 DesktopSettingsPage | 主渲染分支漏 `.page-head`（!desktop 分支有，全站统一时漏改）；忙碌按钮无文案变化 | DesktopSettingsPage.tsx:176 vs 94 |
| C7 | 经营分析 AnalyticsDashboardPage | `exportCsv`/`applyDates` 无 busy 守卫（幂等低风险）；统计卡与工作台三套并存（见 A9）；首图 `role="img"`+aria-label 已加、compact 小图缺 | AnalyticsDashboardPage.tsx:63-131、207-210、224-226 vs 257 |
| C8 | 微信提醒设置 WechatReminderSettings | 无 `<form>` 包裹：数字输入按 Enter 不触发保存；保存按钮在 grid 中占最小单元格、布局略松 | WechatReminderSettings.tsx:86-133 |
| C9 | 修改密码 ChangeOwnPasswordForm | 提交中无忙碌文案（仅 disabled） | ChangeOwnPasswordForm.tsx:46 |
| C10 | 退款/提成 RefundsPage、CommissionPage | summary 查询失败静默隐藏状态 chips（RefundsPage:97）；doctors/categories 数据源失败静默（select 只剩默认项，CommissionPage:248/284） | 各文件行号 |
| C11 | 会员卡 MemberCardsPage | 渲染期写 `staleRef.current`（M9 同类反模式残留，benign）；ReloadSync 在 rowActions 内每行实例化一次（100 行 → 100 个空组件+effect）；试算结果金额无 tabular-nums | MemberCardsPage.tsx:122、123、247-258；MemberCardQuoteDialog.tsx:52-56 |
| C12 | 前台工作台 FrontDeskWorkflowPage | 过渡进行中「划价/分诊/回访」按钮仍可点（仅状态按钮被禁）；stale 期间已打开弹窗被条件卸载 | FrontDeskWorkflowPage.tsx:78-82、93-101 |
| C13 | 导出/复制类按钮统一缺口 | 导出逾期（FollowUpsPage:215）、导出明细（FollowUpReportPage:33）、复制模板（WechatTemplateLibrary:88）、复制话术（CommunicationWorkflowPage:151）均无 busy 守卫（幂等低风险，但与「写请求全守卫」基调不一致） | 各页行号 |
| C14 | 初诊 FirstExamsPage | 「历史」按钮缺 `disabled={ctx.stale}`（其余行按钮都有）；TrackingOverviewBar 无 loading/error 处理——加载中与失败都渲染全 0 芯片 | FirstExamsPage.tsx:120、21-24；first-exams/TrackingOverviewBar.tsx:5-11 |

### D 级：特殊页面（定制密集、用户量低）

| # | 页面 | 不一致 | 证据 |
|---|---|---|---|
| D1 | 头颅侧位 CephalometricPage | ① `.ceph-compare-options` 无样式定义（见 A6）；② SVG 描边常量色 constants.ts 15 个 hex 为亮色 --chart-* 的重复值、**暗色不切换调色板**（底/边框已 token 化；轮廓/折线为用户可配置色属豁免，COMPARE_COLORS 固定调色板不豁免）；③ 内联 `fontSize:10/12` 偏离字号体系（10px < 全站最小 11px）；④ 对比选项列表无 loading/error 态——加载中/失败一律渲染「暂无测量病例可选」；⑤ ReportDialog 报告加载失败静默回退 DEFAULT_REPORT_JSON；⑥ 加载态为裸 `<p>加载中...</p>` | OutlineSvg.tsx:22、25、42；CompareResultView.tsx:23、26；constants.ts:4-26；CephalometricPage.tsx:224-225；ReportDialog.tsx:32-33、88-89 |
| D2 | 影像 ImagingPage | ① `.imaging-compare-toolbar` 无样式定义（styles.css 只有 `.imaging-compare-controls`，见 A6）；② `categories` 查询无 loading/error——加载中显示「暂无影像分类」空表、失败静默；③ 对比选项查询无 loading/error——加载中两个 select 为空；④ 分类「新增/保存」按钮无 busy 文案（仅 ref 防重）；⑤ 同端点双请求（见 B5） | ImagingPage.tsx:31-40、249、285、312、334-354；styles.css:2544 |
| D3 | 牙位图 DentalChart | `.upper` 修饰类无定义（见 A6）；牙位按钮有 aria-label 但 selected/issue 状态无 `aria-pressed`/状态语义播报 | DentalChart.tsx:12-24 |
| D4 | 微信模板库 WechatTemplateLibrary | 唯一内联视觉常量 `<Copy size={14}/>`（图标尺寸非 CSS 体系）；紧凑卡游离于 .card 体系（见 A8） | WechatTemplateLibrary.tsx:89 |
| D5 | 登录 LoginPage | 专属档位与全站多档并存（输入 38px/按钮 40px/标签 11px/checkbox 14px，见 A3/A7）；`.field` 无基类（仅 `.login-card .field > label` 后代选择器，脱离 .login-card 即无样式）；改版后 spec 只测行为、**无视觉回归快照护栏** | styles.css:1535-1599；LoginPage.spec.tsx |
| D6 | 工作台 ClinicalWorkflowPage | RecordDialog 医生下拉静默失败（并入 B6）；TriageQueuePanel loading 时 `return null`（无骨架）、科室查询失败静默；startVisit 无 in-flight 禁用（上层 transition ref 兜底） | ClinicalWorkflowPage.tsx:147-202；clinical-workflow/TriageQueuePanel.tsx:10-21、64-66 |

---

## 三、影响面排序总表（Top 级，供阶段 2 定优先级）

| 排名 | 项 | 影响档 | 类型 |
|---|---|---|---|
| 1 | A1 弹窗遮罩层级冲突（顶栏压遮罩/模态期间可点） | 全局高频 | 层级/交互 |
| 2 | A2 暗色主按钮白字 3.19:1 不达 AA | 全局高频 | 对比度/a11y |
| 3 | A3 控件尺寸/间距零 token、17 种按钮内边距、4 档高度 | 全局高频 | 刻度体系 |
| 4 | A4 取消/次级按钮视觉契约分裂（6 处裸主色按钮） | 全局高频 | 语义一致性 |
| 5 | A5 组件双体系 + 原语库空转（约 150 行孤儿 CSS） | 全局高频 | 体系层 |
| 6 | A6 CSS 类失配 8 处（.arrived 等） | 全局（1 处高频可见） | 失配 |
| 7 | A12 暗色条码白底浅条不可见 | 高频（库存）+打印 | 暗色缺陷 |
| 8 | A8 卡片内边距 12+ 档/三族卡片 | 全局 | 刻度体系 |
| 9 | A7 字号 13 档无 token（11.5/12.5 孤值） | 全局 | 刻度体系 |
| 10 | A9 同一经营数据三种统计卡 | 高频 | 语义一致性 |
| 11 | B1 工作台错误伪装空态 + .arrived 徽章 | 高频页面 | 状态/失配 |
| 12 | B4 处方状态刷新假成功 toast（历史 M8） | 高频页面 | 历史未修 |
| 13 | B6 医生下拉 6 处静默失败 | 高频表单 | 错误态一致性 |
| 14 | B2 预约看板键盘拖拽/aria 缺口 + 双看板体系 | 高频页面 | a11y/体系 |
| 15 | B3 全局搜索 tab 容器缺失 + 英文列名 | 高频页面 | 一致性/文案 |
| 16 | A13 加载态两套（骨架 vs 裸文本/return null） | 全局 | 状态一致性 |
| 17 | B5 同端点双请求（历史 H2） | 中频 | 历史未修 |
| 18 | B7/B8 库存/加工统计区 loading/error 缺口 | 高频页面 | 状态 |
| 19 | A10/A11 z-index 与硬编码色值（#fff×7、999px×5、6px×3） | 全局 | token 化 |
| 20 | A14/A15 表格 a11y 语义 + 500 行硬截断 | 全局 | a11y/性能 |
| 21 | B10 随访完成 pending 未接线 / 执行弹窗双主色 | 高频页面 | 交互态 |
| 22 | B11 治疗计划打印无 busy + 明细网格错位 | 中频页面 | 交互态/布局 |
| 23 | C1-C14 低频页面细节（备份内联样式、报表闪烁、时间线 ISO、busy 文案缺口等） | 低频 | 细节 |
| 24 | D1-D6 特殊页面（头影 SVG 暗色常量色、影像 loading/error、牙位 aria、登录档位） | 特殊 | 定制区 |
| 25 | A16-A19 小项（tag 双拷贝、Unicode 转义、弹窗无 X 钮、Tree 双缩进） | 全局（低） | 细节 |

---

## 四、52 页逐页结论表（阶段 1 逐页记录汇总）

> 列说明：Token/野生样式 = 该页 .tsx 是否用 token、有无硬编码；间距圆角字号 = 是否偏离体系；交互态 = 缺失项；暗色 = 问题；档 = 影响档。

| 模块 | 页面 | Token/野生样式 | 间距/圆角/字号 | 交互态 | 暗色 | 主要问题 | 档 |
|---|---|---|---|---|---|---|---|
| auth | LoginPage | 100% token，0 野生 | 专属档位（38/40px、11px、14px） | 齐全 | 双套 --login-* 完备 | .field 无基类；无视觉回归护栏 | 特殊 |
| appointments | AppointmentsPage | 100%，0 野生 | 无偏离 | 齐全（busy/stale） | 正常 | 无 | 高频 |
| appointments | AppointmentBoardPage | 100%，0 野生 | 无偏离 | 拖拽无键盘；select 兜底 | 正常 | 双看板体系；ISO 时间；列无 aria-label | 高频 |
| appointments | SchedulesPage | 100%，0 野生 | 无偏离 | 齐全（查询错误态已修） | 正常 | 无 | 低频 |
| appointments | AppointmentPurposePanel | 100%，唯一 hex 为数据默认色 | 无偏离 | 齐全 | 正常 | 复用 .analytics-panel（语义错位） | 低频 |
| clinical | MedicalRecordsPage | 100%，0 野生 | 无偏离 | 审核按钮无忙碌文案 | 正常 | 无重大项 | 低频 |
| clinical | VisitsPage | 100%，0 野生 | 无偏离 | M12 已修 | 正常 | 医生下拉静默失败 | 高频 |
| clinical | TreatmentsPage | 100%，0 野生 | 无偏离 | M12 已修 | 正常 | 医生下拉静默失败；与 VisitsPage 同构需双改 | 高频 |
| clinical | PrescriptionsPage | 100%，0 野生 | 无偏离 | 处理按钮 busy 已修 | 正常 | **M8 假成功 toast 未修** | 高频 |
| clinical | FirstExamsPage | 100%，0 野生 | 无偏离 | 「历史」按钮缺 stale 禁用 | 正常 | 追踪概览无 loading/error（全 0 芯片） | 中频 |
| clinical | TreatmentPlansPage | 100%，0 野生 | .charge-item-row 5 列被 8 格撑爆 | 打印无 busy | 正常 | 打印双 POST 风险；医生下拉静默 | 中频 |
| clinical | CephalometricPage | 0 野生（SVG 常量色在子组件） | 内联 fontSize 10/12 | 对比选项无 loading/error | **描边 15 常量色不随暗色切换** | 同端点双请求（H2）；.ceph-compare-options 无样式 | 特殊 |
| clinical | ImagingPage | 100%，0 野生 | 无偏离 | 分类/对比无 loading/error | 缩略图/对比视图 token 化 ✓ | 同端点双请求；.imaging-compare-toolbar 无样式 | 特殊 |
| clinical | ClinicalWorkflowPage | 100%，0 野生 | 无偏离 | H1 分区已修；startVisit 靠上层兜底 | 正常 | TriageQueuePanel loading 返回 null；RecordDialog 医生下拉静默 | 高频 |
| finance | ChargesPage | 100%，0 野生 | 无偏离 | 齐全（actionBusy 双守卫） | 受 A2 按钮对比度波及 | 仍 422 行；payMethod 静默回退；QuickCharge 单价裸显示 | 高频 |
| finance | RefundsPage | 100%，0 野生 | 无偏离 | H3 已修 | 正常 | summary 失败静默隐藏 chips | 高频 |
| finance | MemberCardsPage | 100%，0 野生 | 无偏离 | 齐全 | 正常 | 渲染期写 ref 残留；ReloadSync 每行实例化 | 高频 |
| finance | MemberCardPlanDialog | 100%，0 野生 | 无偏离 | 齐全 | 正常 | 无 | 低频 |
| finance | MemberCardQuoteDialog | 100%，0 野生 | 无偏离 | 齐全 | 正常 | 金额无 tabular-nums | 低频 |
| finance | FinanceWorkflowPage | 100%，0 野生 | 无偏离 | H1/H3 已修 | 正常 | 无重大项 | 高频 |
| inventory | InventoryPage | 100%，0 野生 | 无偏离 | M13 已修 | **条码白底浅条（A12）** | batches/expiringBatches 无 loading/error | 高频 |
| inventory | InventoryReportPanel | 100%，0 野生 | 无偏离 | 切换加载态已修 | 正常 | refetch 闪烁；.report-truncated 无样式 | 中频 |
| inventory | PurchaseOrdersPage | 100%，0 野生 | 无偏离 | C1/L2/L3 已修 | 正常 | 无重大项 | 高频 |
| inventory | ProcessingOrdersPage | 100%，0 野生 | 无偏离 | 齐全 | 正常 | 流程统计无 loading/error；settle 汇总无占位 | 高频 |
| inventory | ProcessingFlowDialog | 100%，0 野生 | 无偏离 | 齐全 | 正常 | 空步骤无空态文案 | 低频 |
| inventory | ProcessingSettleDialog | 100%，0 野生 | 无偏离 | M11 已修 | 正常 | 无 | 中频 |
| inventory | DispenseWorkbenchPage | 100%，0 野生 | 无偏离 | 子面板三态齐全 | 正常 | 无（薄壳） | 高频 |
| inventory | InventoryWorkflowPage | 100%，0 野生 | 无偏离 | H3/M12 已修 | 正常 | 无重大项 | 中频 |
| patients | PatientsPage | 100%，0 野生 | 无偏离 | M4 已修、游标分页启用 | 正常 | 无 | 高频 |
| patients | PatientTimelinePage | 100%，0 野生 | 无偏离 | saveCustomFields 无 busy | 正常 | C2 已修；ISO 时间；看板类语义错位 | 中频 |
| patients | PatientWorkflowPage | 100%，0 野生 | 无偏离 | H1 已修、计算 busy | 正常 | 无 | 低频 |
| communication | FollowUpsPage | 100%，0 野生 | 无偏离 | H3 已修；PromptDialog pending 未接 | 正常 | 导出无 busy；面板缺 tab-panel 类 | 高频 |
| communication | FollowUpReportPage | 100%，0 野生 | 无偏离 | 无重试按钮；导出无 busy | 正常 | 错误态断点 | 低频 |
| communication | FollowUpExecutionDialog | 100%，0 野生 | 无偏离 | busy 齐全 | 正常 | 取消按钮未用 btn-secondary（双主色） | 高频 |
| communication | WechatTemplateLibrary | 仅 Copy size={14} | 无偏离 | 复制无 busy | 正常 | 紧凑卡游离 .card 体系 | 低频 |
| communication | WechatReminderSettings | 100%，0 野生 | 无偏离 | 校验已修 | 正常 | 无 form；Enter 不保存 | 低频 |
| communication | CommunicationWorkflowPage | 100%，0 野生 | 无偏离 | H1/H3 已修 | tag 三态 token 化 ✓ | 复制话术无 busy | 高频 |
| analytics | DashboardPage | 100%，0 野生 | 无偏离 | workbench 错误未消费 | 正常 | **错误伪装空态；.arrived 无样式** | 高频 |
| analytics | AnalyticsDashboardPage | 5 处内联为动态 width | 无偏离 | 导出/日期无 busy | 图表走 --chart-* ✓ | 统计卡第二套视觉；compact 图缺 aria | 低频 |
| analytics | ClinicOverviewPage | 100%，0 野生 | 无偏离 | QueryBoundary 提供 | 正常 | 统计第三套视觉（纯文本） | 低频 |
| system | UsersPage | 100%，0 野生 | 无偏离 | 齐全 | 正常 | 无 | 高频 |
| system | PermissionsPage | 100%，0 野生 | 无偏离 | tabs 完整 ARIA | 正常 | 无 | 低频 |
| system | CustomFieldsPage | 100%，0 野生 | 无偏离 | 齐全 | 正常 | 无 | 低频 |
| system | BackupsPage | **1 处内联 grid 样式** | 280px/1rem 硬编码 | busy 无禁用/文案 | 正常 | L6 已修；内联样式残留 | 低频 |
| system | SystemOperationsPage | 100%，0 野生 | 无偏离 | 3 按钮 busy 齐全 | 正常 | 页内搜索无空态；L5 部分修 | 低频 |
| system | SyncConflictsPage | 100%，0 野生 | 无偏离 | 齐全 | 正常 | 无 | 低频 |
| system | GlobalSearchPage | 100%，0 野生 | 无偏离 | 齐全 | 正常 | tab 无容器；resource 列英文键 | 高频 |
| system | ChangeOwnPasswordForm | 100%，0 野生 | 无偏离 | 无忙碌文案 | 正常 | 轻微 | 低频 |
| system | DesktopSettingsPage | 100%，0 野生 | 无偏离 | busy 禁用无文案 | 正常 | 主分支漏 .page-head | 低频 |
| hr | CommissionPage | 100%，0 野生 | 无偏离 | 三处双守卫 | 正常 | doctors/categories 静默失败 | 中频 |
| hr | HrWorkflowPage | 100%，0 野生 | 无偏离 | H3 已修 | 正常 | 无 | 高频 |
| front-desk | FrontDeskWorkflowPage | 100%，0 野生 | 无偏离 | H1 已修 | 正常 | 过渡中划价/分诊按钮可点 | 高频 |

---

## 附录 A：历史已知问题并入与复核表（阶段 0 产物）

> 来源：docs/audits 下第 2/3/4/7/14/29/43 轮审计、优化报告两批、多维度评分三份、缺陷台账。表中「现状」为本次阶段 1 实测核对结果。

| 来源 | 问题 | 现状 | 证据 |
|---|---|---|---|
| R2 | 35+ CSS 类「用了没样式」 | 已修；本轮复现新 8 处失配（A6） | 机械扫描 287 定义/237 使用/8 缺失 |
| R3-M1 | 暗色对比度不足 | 已修但失衡：第 4 轮提亮主色后文字达标，按钮白字降为 3.19:1（A2） | styles.css:98 + WCAG 计算 |
| R3-M2/M3/L1 | Dialog 关闭出口/动画/条件渲染 | 已修 | dialog.tsx:57-69 统一出口 + closeEpoch；CrudPage key 重挂载 |
| R3-M4 | OutlineSvg/CompareResultView 硬编码浅色 | 已修 | 现走 var(--chart-grid/bg/muted) |
| R3-L2 | 全局搜索 placeholder 与行为不符 | 已修（替代） | GlobalSearchPage 创建+资源筛选 |
| R3-P2 | ChargesPage 删除无响应 | 已修 | ChargesPage.tsx:204-212 ConfirmDialog |
| R3-P3 | 非受控 select 不重置 | 已修 | 全库 defaultValue 0 命中 |
| R3-P1 | ProcessingOrderFormFields 回填竞态 | 已修（残余：同挂载内无重试按钮） | 加载期禁输入 + dialogEpoch 重挂载 |
| R7-C1 | window.prompt 驳回失效 | 已修 | ReviewRowActions.tsx PromptDialog |
| R7-C2 | 时间线分当元 | 已修 | PatientTimelinePage.tsx:158 formatMoney |
| R7-C3 | ConfirmDialog 无 busy | 已修 | dialog.tsx:143-169 |
| R7-H1 | 7 工作台整页门控 | 已修（8 处全部核实） | QuerySection 分区 |
| R7-H2 | Cephalometric 同接口双请求 | **未修**（ImagingPage 同构） | CephalometricPage.tsx:29-34 |
| R7-H3 | 12 处无 busy 守卫 | 已修 | useAsyncAction 全面覆盖（逐处核实） |
| R7-M1 | SearchableSelect 无上限 | 已修（10 页上限） | searchable-select.tsx:98-100 |
| R7-M2 | DataTable 无虚拟化 | 部分修（500 行硬截断，A15） | data-table.tsx:32-37 |
| R7-M4 | PatientsPage key 重挂载 | 已修 | initialSearch + 渲染期同步 |
| R7-M8 | 处方刷新 toast 先于结果 | **未修** | prescriptions/status-dialog.tsx:57-63 |
| R7-M9 | 渲染期写 ref 两处 | 已修（MemberCardsPage 残留 staleRef 同类反模式） | ReloadSync 迁 effect |
| R7-M12 | 行内 select 非受控 | 已修 | Visits/Treatments/InventoryWorkflow 受控+复位 |
| R7-M13 | InventoryPage itemId null | 已修 | 字段级校验 |
| R7-L2 | 采购编辑回填竞态 | 已修 | 加载期禁输入 |
| R7-L3 | 审核汇总 0 单闪烁 | 已修 | placeholderData + '—' |
| R7-L5 | SystemOperations key={index} | 部分修 | id 优先、索引兜底 |
| R7-L6 | BackupsPage window.confirm | 已修 | ConfirmDialog danger |
| R14 | 无自动化 UI 视觉回归 | 未解决 | 本审计即人工替代；阶段 7 将建立截图基线 |
| R29 | UI 专项无新 P1/P2 | 维持（a11y 基线良好） | — |
| R43 | Tooltip 焦点态 | 已修 | Tooltip.tsx onFocus/onBlur + .visible |
| 多维度 | 图表/牙位图/Kanban a11y 语义 | 部分修：图表 role=img 已加（compact 缺）；牙位有 aria-label 无 aria-pressed；看板键盘移动但无 live 播报/焦点管理 | 各文件 |
| 多维度 | ChargesPage 414 行单文件 | 部分修（拆出 charges/ 子目录，主文件仍 422 行） | ChargesPage.tsx |
| 多维度 | hub-tabs Unicode 转义 | 未修（A17） | hub-tabs.tsx 66 处 |
| 多维度 | 无乐观更新 | 部分修（use-crud-resource 已做 patch/prepend/remove） | use-crud-resource.ts |
| 缺陷台账 | OPEN 缺陷 | 0 OPEN | 缺陷台账.md |

## 附录 B：机械化扫描统计（本报告的数据底座）

- 52 页 .tsx：hex 命中 1（数据默认色 #3b82f6）、rgba 0、内联 style 对象 8、var(-- 内联引用 0（无内联样式故）、fontSize/borderRadius/boxShadow 内联 0。
- 子组件目录（pages/ 与 components/ 之外）：仅 6 个文件含样式，其中 5 个走 var()；charges/ 2 处内联 gridTemplateColumns 含硬编码轨道宽 80/72/90px。
- styles.css（组件区，token 块之外）：700 处 px、621 处 var(-- 引用、#fff 5 处、999px 圆角 5 处、6px 圆角 3 处。
- CSS 类失配：定义 287 / 使用 237 / 用了没样式 8（A6）。
- 历史复核：第 7 轮 27 项中 23 项已修、2 项部分修、2 项未修（M8、H2）；第 3 轮 UI 项全部闭环。

---

## 五、阶段 2：设计方向（第二轮确认版）

### 5.1 基调确认

**保留现有 teal 主色（`--primary` #0D8282 亮 / #14A0A0 暗）与「青蓝×薄荷」医疗专业风，不换品牌色、不换字体、不引入任何新框架/组件库。** 理由：现有语义 token 双主题完整、页面层纪律好，本轮是「对齐与修复」而非「重塑」；品牌一致性优先（AGENTS.md 架构约束同样禁止引入新 UI 框架）。

本轮范围（确认版）：A1/A2/A4/A6/A12/A13/A16/A18/A19 + B1/B4/B5 + C2/C6/C7 + D1/D2 的暗色与 loading/error 项 + A5 的低风险部分（删孤儿 CSS、修正 PRIMITIVES.md）。**不做**：A15（DataTable 虚拟化）、A17（hub-tabs Unicode）、C 级 busy 文案类、A3/A7/A8/A9/A10/A11 的系统性刻度重构（二期）、看板/时间线/表格合并（二期）。

### 5.2 视觉支柱（本轮只声明与落地范围内部分）

1. **字体体系**：保持 `--font: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif` 回退链；数字继续用 `font-variant-numeric: tabular-nums`（已全局落地于表格）。字号刻度（11/12/13/14/16/18/24 七档收敛）属 A7，二期。
2. **间距刻度**：4px 基（2/4/6/8/10/12/16/20/24/32 已约定俗成）。`--space-*` token 化属 A3，二期；本轮新增的 CSS 一律用 4px 倍数。
3. **圆角体系**：保留 `--radius: 10px / --radius-sm: 8px / --radius-xs: 5px`；本轮新增 `--radius-pill: 999px`（为二期收编 5 处硬编码胶囊做准备，本轮暂不替换存量）。
4. **阴影层级**：保留 `--shadow / --shadow-hover / --shadow-toast / --shadow-pressed` 四级。
5. **状态色**：保留 `--success/--warning/--danger` 及 `*-soft` 系列；本轮新增 `--on-primary`（A2）与 `--barcode-ink`（A12）。

### 5.3 设计原则（简短）

1. **信息密度优先**：13px 正文 / 12px 表头 / 紧凑表格是产品根基，不追求营销页式的放大留白。
2. **医疗专业感**：teal 主色、克制红（禁止纯红大按钮，仅危险操作）、状态色语义稳定。
3. **明暗双主题均成立**：本轮每处改动必须同时验证亮/暗两套（截图门）。
4. **一致性优先于新颖**：复用现有变量名与现有组件，破坏性改名与体系重构留二期。
5. **可访问性不退化**：对比度 WCAG AA（正文 4.5:1、大字/UI 组件 3:1）、focus 可见、键盘可达、aria 语义。

---

## 六、阶段 3：三层 token 方案（新增 token + 逐步替换，禁止重写 styles.css）

### 6.1 Primitive 层（从现有语义值反推，声明式）

现有语义变量反推出的色阶（本轮只落地「落地列 = 是」的项，其余仅作方案声明，二期启用）：

| Primitive | 值（亮/暗） | 来源（现有语义） | 本轮落地 |
|---|---|---|---|
| `--teal-600` | #0D8282 / #14A0A0 | `--primary` | 否（保留现有语义直写） |
| `--teal-700` | #0B7474 / #17B4B4 | `--primary-hover` | 否 |
| `--mint-500` | #28A87E（两主题同） | `--accent-strong` | 否 |
| `--teal-50` | #E6F4F1 / #163238 | `--soft` | 否 |
| `--ink-900` | #16303A / #E6F4F1 | `--text` | 是（A12 派生 `--barcode-ink`） |
| `--ink-950` | #0C171A / #0C171A | `--bg` 暗值 | 是（A2 暗色 `--on-primary`） |

### 6.2 语义层新增（本轮落地）

| Token | 亮 | 暗 | 用途 | 落地位置 |
|---|---|---|---|---|
| `--on-primary` | #FFFFFF | #0C171A | 主按钮/主色底上的文字（A2） | 裸 `button`、`.btn-login`、`.ui-tree-action`、`.toast.info` 等白字处 |
| `--barcode-ink` | #16303A | #16303A（恒深） | 条码条颜色（A12：白底恒深条，两主题可读） | `.barcode-svg` |

对比度核算：亮 `#FFFFFF` on `#0D8282` = 4.63:1 ✓；暗 `#0C171A` on `#14A0A0` ≈ 5.9:1 ✓（L(#14A0A0)=0.2787，L(#0C171A)≈0.006 → 0.3287/0.056 ≈ 5.87）。暗色 `--text #E6F4F1` on `#14A0A0` ≈ 3.9:1 不达 4.5，故 A2 用深青而非 `--text`。

### 6.3 组件层 token（本轮落地）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-pill` | 999px | 声明；A2/A18 等本轮组件不使用，二期收编胶囊 |

组件层其余（`--btn-* / --card-* / --table-*` 状态矩阵）属 A3/A8 系统性重构，二期进行；本轮不改组件 API、不加新组件类（除 A18 的 `.modal-close` 与 A6 的 8 个补齐类）。

### 6.4 替换纪律

- 只新增 token、不改既有 token 的变量名与取值（破坏性改名留二期）。
- 每处替换必须同时覆盖亮/暗（暗色经 `@media (prefers-color-scheme: dark)` 块声明）。
- 禁止一次性重写 styles.css；改动以「块」为单位小步提交并即时回归。

---

## 七、本轮实施清单（第二轮范围，逐项修复方案）

| # | 项 | 修复方案（表现层，不改业务逻辑） | 涉及文件 |
|---|---|---|---|
| A1 | 弹窗遮罩层级 | **已目验属实**：`.hub` 因 `pageRise` 动画 fill-mode both 保留 identity transform → 遮罩 rect (198,83)→(1416,1552)，不盖顶栏且超长。功能上顶栏已被 `modal-a11y` 置 inert（无点击漏洞），但视觉缺陷真实。修复：`@keyframes pageRise` 终态 `transform: translateY(0)` → `transform: none`（动画期间照常插值，结束后不再残留 transform） | styles.css:549-558 |
| A2 | 暗色按钮对比度 | 新增 `--on-primary`（亮 #fff / 暗 #0C171A）；裸 `button`、`.btn-login`、`.ui-tree-action` 的 `color: white/#fff` → `var(--on-primary)` | styles.css:97-101 附近、1608、1700、2964 |
| A4 | 取消/次级按钮契约 | 6 处裸主色按钮改 `btn-secondary`：CrudPage:154、ResourcePage:467、HelpDialogs:28-29/40、FollowUpExecutionDialog:83；QuerySection 重试、SearchableSelect 加载更多一并改（同语义） | 各 tsx |
| A6 | 8 个失配类 | 补样式：`.arrived`（状态徽章，走 `--success-soft/--success`）、`.report-truncated`（同 `.reminder-muted`）、`.relation-load-cap`（同 `.searchable-select-cap`）、`.ui-tree-node`（grid 容器）、`.ceph-compare-options`（flex wrap 同 `.ceph-compare-controls`）、`.imaging-compare-toolbar`（同 `.imaging-compare-controls`）、`.sidebar-group-wrap`（display:contents 无视觉影响）、`.upper`（显式 no-op 注释或补与默认一致的规则） | styles.css |
| A12 | 条码暗色 | `.barcode-svg { color: var(--barcode-ink) }`（白底恒深条）；`.barcode-print` 保持白底（打印语义） | styles.css:587-601 |
| A13 | 加载态统一 | 裸 `<p>加载中...</p>` 3 处（ReportDialog/TeethMarkDialog/HistoryDialog）+ Layout 2 处改现有 `LoadingState` 组件；TriageQueuePanel loading `return null` → 渲染 `LoadingState` | 各 tsx |
| A16 | tag 双拷贝 | 提取 `.tag` 基类（2px 10px + soft/primary），`.reminder-head .tag`、`.wechat-template-head .tag` 改引用基类 | styles.css:1939-1945、2007-2013 |
| A18 | 弹窗无关闭按钮 | Dialog 头部加 `.modal-close`（lucide X，`icon-btn` 尺寸、aria-label「关闭」），点击走 requestClose | dialog.tsx + styles.css |
| A19 | Tree 双缩进 | 删除 Tree.tsx:58 内联 `paddingLeft: depth*16+8`，缩进只留 `.ui-tree-children { margin-left: 16px }`（每层 16px） | Tree.tsx |
| B1 | 工作台错误态/徽章/hover | `workbench.error` 消费：错误时该卡片显示错误提示 + 重试（不再伪装空态）；`.arrived` 样式（见 A6）；`.appointment-row:hover` 背景 `--surface-muted` | DashboardPage.tsx + styles.css |
| B4 | 处方假成功 toast | `status-dialog.tsx`：`await refresh()` 后再按成功/失败分别 toast；refresh 内 try/catch | prescriptions/status-dialog.tsx |
| B5 | 同端点双请求 | CephalometricPage/ImagingPage 对比选项查询与 CrudPage 列表共享同一 queryKey（读 use-crud-resource 确认键结构后对齐），初始态只发 1 条 GET | CephalometricPage.tsx、ImagingPage.tsx |
| C2 | 报表 refetch 闪烁 | InventoryReportPanel 加 `placeholderData: (prev) => prev` | InventoryReportPanel.tsx |
| C6 | 桌面设置页头 | 主渲染分支补 `.page-head` 包裹（与 !desktop 分支一致） | DesktopSettingsPage.tsx |
| C7 | 经营分析 busy + 图表 aria | `exportCsv`/`applyDates` 加 busy 守卫（禁用+文案）；compact 条形图补 `role="img"` + aria-label | AnalyticsDashboardPage.tsx |
| D1 | 头影暗色+loading/error | `COMPARE_COLORS` 10 个固定色改为 `var(--chart-1..10)`（SVG stroke 改 style 属性挂载；用户可配置的轮廓/折线色保持豁免不动）；对比选项列表加 loading/error 态；ReportDialog 加载文本 → LoadingState | constants.ts、OutlineSvg.tsx、CompareResultView.tsx、CephalometricPage.tsx、ReportDialog.tsx |
| D2 | 影像暗色+loading/error | `categories` 查询 loading/error（加载中骨架、失败重试，不再「暂无影像分类」误导）；对比选项查询 loading/error；分类按钮 busy 文案不在本轮范围（C 级 busy 文案类延后） | ImagingPage.tsx |
| A5(部分) | 孤儿 CSS + 文档 | 删除无组件文件且无调用方的 `.ui-switch/.ui-radio/.ui-segmented/.ui-accordion/.ui-steps/.ui-dropdown*/.ui-multiselect*/.ui-date-range/.ui-drawer*/.ui-chip`（先 grep 调用方确认）；PRIMITIVES.md 改为如实描述现状（该批原语未实现，CSS 已清理，后续如需按 `.ui-*` 规范新增实现） | styles.css、PRIMITIVES.md |

**验证**：每批改动后跑 `test`（web 相关）+ typecheck + lint；全部完成后 `test:coverage:web`、knip、阶段 7 亮/暗截图对比并保存 `after` 基线。

---

## 八、实施记录（第二轮，进行中）

### 8.1 A1 目验结论（截图 + 探针证据）

- **改前实测**（`ui-baseline/before/a1-stack-probe.json`、`a1-ancestor-probe.json`、`a1-modal-open-light.png`）：
  - `.hub` 计算样式 `transform: matrix(1,0,0,1,0,0)`（identity 矩阵，`pageRise` 动画 `fill-mode: both` 保留的 `translateY(0)`）→ 创建 containing block 与 stacking context；
  - `modal-backdrop`（position:fixed, z-20）实测 rect = **(198, 83) → (1416, 1552.6)**：从内容区顶部开始、不覆盖顶栏（0-63px），且高度 1469px 盖满整段滚动内容（远超视口）；
  - 顶栏命中测试：弹窗打开期间 `topbarInert=true`（`modal-a11y` 机制生效），elementFromPoint 跳过 inert 顶栏——**「顶栏仍可点击」不成立（无功能漏洞），「遮罩不盖顶栏 + 遮罩超长错位」视觉缺陷属实**。
- **修复**：`@keyframes pageRise` 终态 `translateY(0)` → `none`（styles.css，1 处改动；动画期间插值照常，结束后不再残留 transform）。
- **改后验证**：见阶段 7 截图对比与 a1 复测探针。

### 8.2 本轮改动清单

| 项 | 文件 | 改动 |
|---|---|---|
| A1 | styles.css | pageRise 终态 transform: none |
| A2 | styles.css | 新增 `--on-primary`（亮 #fff / 暗 #0C171A）；裸 button、.btn-login、.ui-tree-action、.toast.info 白字 → var(--on-primary) |
| A4 | CrudPage / ResourcePage / HelpDialogs / FollowUpExecutionDialog / status.tsx / searchable-select | 6+2 处裸主色「取消/重试/加载更多」→ btn-secondary |
| A6 | styles.css | 补 8 个失配类：.appointment-row .status、.report-truncated、.relation-load-cap、.ui-tree-node、.ceph-compare-options、.imaging-compare-toolbar、.sidebar-group-wrap、.ui-tooth-grid.upper |
| A12 | styles.css | 新增 `--barcode-ink`；.barcode-svg 条色改恒深青 |
| A13 | ReportDialog / TeethMarkDialog / HistoryDialog / TriageQueuePanel / Layout / DashboardPage | 裸文本/return null 加载态 → LoadingState 骨架屏 |
| A16 | styles.css | 提取 .tag 基类（2px 10px），删除两处作用域拷贝 |
| A18 | dialog.tsx + styles.css | 弹窗头部新增 .modal-close X 按钮（aria-label「关闭弹窗」，走统一 requestClose）；同步更新 dialog.spec/index.spec 焦点断言 |
| A19 | Tree.tsx | 删除内联 paddingLeft（depth*16+8）与 depth 属性，缩进统一为 .ui-tree-children margin-left 16px |
| B1 | DashboardPage.tsx + styles.css | workbench.error 消费（错误块 + 重试）；.arrived 中性徽章样式；.appointment-row hover |
| B4 | prescriptions/status-dialog.tsx | await 结果后再 toast（成功/失败分流）；refreshing 防重；关闭按钮 btn-secondary |
| B5 | CephalometricPage.tsx / ImagingPage.tsx | 对比选项初始态 queryKey 与 CrudPage 列表共享缓存（`['cephalometric',1,'']` / `['imaging',1,'']`），消除同端点双请求；ImagingPage.spec 两处断言改为计数（同名文本多处匹配） |
| C2 | InventoryReportPanel.tsx | placeholderData 延续旧数据，消除 refetch 整表闪烁 |
| C6 | DesktopSettingsPage.tsx | 主渲染分支补 .page-head |
| C7 | AnalyticsDashboardPage.tsx | exportCsv 800ms 冷却防双击；4 个图表补 role="img" + aria-label |
| D1 | cephalometric/constants.ts + CompareResultView.tsx + CephalometricPage.tsx + ReportDialog.tsx | COMPARE_COLORS → var(--chart-1..10)（SVG 改 style 挂载，暗色自动换色）；对比选项 loading/error 态；ReportDialog 加载态 → LoadingState（用户可配置轮廓/折线色保持豁免） |
| D2 | ImagingPage.tsx | 分类表与对比选项的 loading/error 态（骨架屏 + 重试） |
| A5(部分) | styles.css + PRIMITIVES.md | 删除孤儿 CSS（.ui-drawer-*/.ui-switch/.ui-segmented/.ui-accordion/.ui-steps/.ui-dropdown*/.ui-multiselect*/.ui-date-range/.ui-chip 及 uiMenu/uiDrawer keyframes，约 150 行，删前全库 grep 零调用）；PRIMITIVES.md 改写为现状如实描述 |

### 8.3 门禁状态（最终，全部通过）

| 门禁 | 结果 |
|---|---|
| `pnpm --filter @dental/v2 test` | ✅ 298 文件 / **3266 用例全绿** |
| `pnpm --filter @dental/v2 test:coverage:web` | ✅ 99.88 / 99.91 / 99.83 / 99.87（基线 96.82 / 93.01 / 98.57 / 98.53，不降反升） |
| `pnpm --filter @dental/v2 typecheck` | ✅ |
| `pnpm --filter @dental/v2 run lint` | ✅（新增代码零告警） |
| `pnpm --filter @dental/v2 run knip` | ✅（新脚本已登记为 `shots:ui-baseline` / `shots:a1-probe`） |
| `pnpm --filter @dental/v2 build` | ✅ |

### 8.4 修复后实测证据

- **A1**：改后探针 `after/a1-ancestor-probe.json`——`.hub` transform=none；遮罩 rect **top=0 bottom=900**（完整视口，改前 top=83 bottom=1552.6）；`elementAtTopbarCenter = DIV.modal`（遮罩已覆盖顶栏）；`after/a1-stack-probe.json` 同证。
- **A2**：暗色下 `.btn-login` 计算色 = `rgb(12, 23, 26)`（#0C171A on #14A0A0 ≈ 5.9:1，AA 达标）。
- **A6**：CSS 类失配扫描复测 defined=262 / used=238 / **missing=0**（改前 8）。
- 阶段 7 截图：`after/` 下亮/暗各 10 页 + `a1-modal-open-light.png`，与 `before/` 同名对照。

---

## 九、阶段 7 视觉验证与 R14 视觉回归护栏（本轮建立）

### 9.1 截图基线（固定目录）

- **固定目录**：`apps/v2/test-results/ui-baseline/`（`before/` 改前、`after/` 本轮改后），亮/暗双主题各 10 个关键页：Login / Dashboard / Appointments / AppointmentBoard / Patients / Charges / Inventory / MedicalRecords / Cephalometric / Settings。
- **生成脚本**：`pnpm --filter @dental/v2 shots:ui-baseline`（`scripts/ui-baseline-shots.mjs`，环境变量 `UI_BASELINE_SCHEME=light|dark`、`UI_BASELINE_DIR=<目录>`）；A1 层级探针：`shots:a1-probe`。
- 前置条件：Vite dev（5180）+ 模拟库 API（admin `v2-sim-admin-password`；`apps/v2/data/simulated-clinic` 一键复制）。
- 目录已在 `apps/v2/.gitignore` 忽略（截图不入库，避免仓库膨胀；作为本机固定护栏目录长期保留）。

### 9.2 后续轮次对比方法（R14 闭环）

1. 新改动前：`UI_BASELINE_DIR=.../baseline/<轮次>-before` 跑 `shots:ui-baseline` 两次（light/dark）。
2. 改动后：同目录 `<轮次>-after` 再跑两遍。
3. 逐对 diff 检查：对齐、留白、层级、一致性、溢出、对比度；弹窗层级可用 `shots:a1-probe` 的 JSON 探针做数值级断言（backdrop rect top=0、祖先链无 transform）。
4. 每个页面的统一性结论与改动清单回写本文（第 7 章/第 8 章模式）。

### 9.3 本轮逐页结论（52 页口径更新）

本轮范围内改动页的结论更新（其余页结论维持第四章逐页表）：

- **Auth/Login**：A2 落地（登录按钮暗色深青字），其余保持。
- **Appointments 4 页**：AppointmentBoard 无本轮改动（看板合并属二期）；Appointments/Schedules/PurposePanel 无改动（零问题）。
- **Clinical 9 页**：Cephalometric（D1：对比色 token 化 + loading/error + B5 去重）；Imaging（D2：分类/对比 loading/error + B5 去重）；Prescriptions（B4：假成功 toast 修复）；MedicalRecords/Visits/Treatments/FirstExams/TreatmentPlans/ClinicalWorkflow 经 A4/A6/A13/A18 全局组件受益（取消按钮、关闭按钮、骨架屏、失配类）。
- **Finance 6 页**：Charges/MemberCards 等经 A2/A4/A18 受益；QuickCharge 单价裸显示等属二期。
- **Inventory 8 页**：InventoryPage（A12 条码）；InventoryReportPanel（C2 防闪烁 + A6 .report-truncated）；其余经全局组件受益。
- **Patients 3 页**：经全局组件受益（本页无本轮专项）。
- **Communication 6 页**：FollowUps/FollowUpExecutionDialog（A4 取消按钮）；WechatTemplateLibrary（A16 tag 基类）；其余经全局组件受益。
- **Analytics 3 页**：Dashboard（B1 错误态/徽章/hover）；AnalyticsDashboard（C7 busy + 图表 aria）；ClinicOverview 无改动。
- **System 9 页**：DesktopSettings（C6 .page-head）；GlobalSearch/Backups/SystemOperations 等经全局组件受益；busy 文案类属延后项未动。
- **Hr 2 页 / Front-desk 1 页**：经全局组件受益（无本轮专项）。

### 9.4 延后项台账（二期）

A15（DataTable 真虚拟化）、A17（hub-tabs Unicode 还原）、C 级 busy 文案类（Backups/ChangeOwnPassword/DesktopSettings/Imaging 分类按钮等）、A3/A7/A8/A9/A10/A11 系统性刻度重构（--space-*/--font-size-*/卡片三族/z-index token/硬编码值收编）、A5 剩余部分（看板/时间线/表格双体系合并）、B2 看板键盘拖拽与 ISO 时间、B3 全局搜索 tab 容器与英文列名、B6 医生下拉 6 处错误态、C1 备份内联样式、C4 时间线 ISO 与 busy、C10 静默失败族、C13 导出类 busy、A9 统计卡统一。

