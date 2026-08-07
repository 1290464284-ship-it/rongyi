# Round 7 前端与 Electron 层深度审计报告

- 审计范围：`source/apps/v2/src/web/`（9 个业务模块 + 根目录页面）、`electron/main.cjs`、`electron/preload.cjs`、`vite.config.ts`、`tsconfig.web.json`、`index.html`
- 审计维度：状态管理、性能、边界健壮性、IPC、UI/UX 正确性、可访问性/国际化
- 方法：静态逐文件审查 + 关键行号核验；未跑 Lighthouse；未做运行时改动
- 结论：代码库整体质量高（防重复提交、请求序号守卫、孤儿清理、friendlyError、Dialog 焦点陷阱、渲染期 setState 调整均已成体系），本报告只列真实残留问题，按严重度分组

---

## 严重（Critical）—— 功能错误或破坏性竞态

### C1. `window.prompt` 在 Electron 中未实现，「驳回」功能桌面端静默失效
- **文件:行**：`src/web/PurchaseOrdersPage.tsx:365`（`const reason = window.prompt('请输入驳回原因', '')`）
- **触发场景**：桌面打包版（Electron 43）中，采购单审核 → 点击「驳回」。
- **影响**：Electron 不实现 `window.prompt`（官方 issue electron/electron#31560 明确 "window.prompt is not implemented"），调用直接返回 `null` 且不弹出任何输入框。`if (reason === null) return;` 使整个驳回流程静默无操作——用户点击按钮毫无反应、无任何提示，核心审核操作在桌面端完全不可用。浏览器 dev 模式可用，故难以在开发期发现。
- **修复建议**：改用本仓库已有的 `PromptDialog`（`components.tsx` 中已导出，与 ConfirmDialog 同族）承接驳回原因输入；或走 Electron `dialog` 模块；不要用原生 prompt/confirm。

### C2. 患者时间线金额「分当元」直接渲染
- **文件:行**：`src/web/PatientTimelinePage.tsx:131`（`` ` · ${String(event.amount)}` ``）
- **触发场景**：患者时间线展示收费/退款事件（amount 为服务端分值）。
- **影响**：`5000` 分直接渲染为 "5000"，实际应为 ¥50.00（同仓库其他页面一律用 `formatMoney`/`centsToYuanString`，如 PurchaseOrdersPage.tsx:85）。金额数值放大约 100 倍，财务信息误导患者与诊所人员，且无任何单位标注。
- **修复建议**：`event.amount === undefined ? '' : ` · ${formatMoney(event.amount)}``；建议补一条渲染测试断言分值到元字符串。

### C3. `ConfirmDialog` 确认按钮无 busy/disabled 态，4 个调用点双击双发
- **文件:行**：`src/web/components.tsx:342-364`（ConfirmDialog 渲染 `onConfirm` 直接绑定，无 submitting 态、`onConfirm: () => void` 不支持异步）；调用点：`src/web/ImagingPage.tsx:193`（confirmDeleteCategory）、`src/web/ImagingPage.tsx`（toggleCategory，双 PATCH 来回切换）、`src/web/dispense/DispenseListPanel.tsx:40`（confirmDeleteDispense）、`src/web/dispense/DispenseNarcoticPanel.tsx:63`（confirmDeleteNarcotic）。
- **触发场景**：用户双击确认按钮，或确认后手速再点一次（弹窗关闭有动画延迟时尤其容易）。
- **影响**：删除类双发两次 DELETE（幂等性依赖服务端软删除）；`toggleCategory` 双 PATCH 使开关状态净零变化，但先后弹出两条互相矛盾的 toast（"已启用"/"已禁用"），UI 状态与服务端状态可能短暂错位。仓库其他表单已普遍实现 `submitting` 模式（如 FollowUpsPage.tsx:159），此组件是遗漏点。
- **修复建议**：ConfirmDialog 增加内部 `submitting` 状态：`onConfirm` 改为可返回 Promise，pending 期间两个按钮 disabled 并显示「处理中…」；或要求调用点自行守卫（AppointmentsPage/RefundsPage 已有范式可参照）。

---

## 高（High）—— 可恢复性 / 性能 / 一致性缺陷

### H1. 系统性模式：整页门控多查询，任一子查询失败整页不可用（7 页）
- **文件:行**：`src/web/clinical-workflow/ClinicalWorkflowPage.tsx:51-66`（today + 4 个 pageSize=100 列表）、`src/web/AnalyticsDashboardPage.tsx:215-220`（6 查询）、`src/web/CommunicationWorkflowPage.tsx:55-68`、`src/web/InventoryWorkflowPage.tsx:63-79`、`src/web/PatientWorkflowPage.tsx:19-31`、`src/web/PatientTimelinePage.tsx:50-66`、`src/web/FinanceWorkflowPage.tsx:28-40`
- **触发场景**：任一子接口超时/5xx（如统计接口临时故障），或首屏全部查询并发挂起。
- **影响**：单个次要查询失败即整页 `PageError`，工作台整体不可用；`isLoading` 单门控使首屏等待最慢的查询（N 请求瀑布串行暴露），本地 API 偶发慢响应时用户长时间看到全屏 Loading。
- **修复建议**：按查询分区渲染（Skeleton 分区加载），失败卡片降级显示"该区块加载失败 + 重试"，不影响其余区块；用 `Promise.allSettled` 聚合或 per-query 状态判断。

### H2. CephalometricPage 与 CrudPage 同接口重复请求，注释与实际不符
- **文件:行**：`src/web/CephalometricPage.tsx:38-44`
- **触发场景**：页面挂载。`useQuery(['cephalometric','caseList',1,''])` 请求 `/resources/cephalometricCases?page=1&pageSize=50`；同页 CrudPage 用 `useCrudResource`，queryKey 展开为 `['cephalometric',1,'']`（use-crud-resource.ts:106 默认 pageSize=50），URL 完全相同。
- **影响**：同一份 50 条列表被拉取两次，缓存不共享；注释第 38-39 行声称"与 CrudPage 共享查询缓存"，第 40-41 行又自述"使用独立键"，前后矛盾，误导维护者。对比候选列表也不会随 CrudPage 分页/搜索变化而联动（各自为政）。
- **修复建议**：让 `caseList` 复用 CrudPage 的查询键与分页状态（或直接读 useCrudResource 的 data），并修正注释。

### H3. 无 busy 守卫的散点操作按钮（聚合 12 处）
- **文件:行**：`src/web/PrescriptionsPage.tsx:238`（「处理」→ 双 POST `/prescriptions/:id/process`，可重复生成划价单+领药单）、`src/web/FollowUpsPage.tsx:388`（submitExecution，双击/连按 Enter 重复创建执行记录）、`src/web/HrWorkflowPage.tsx:32`（approve）、`src/web/PatientWorkflowPage.tsx:33`（calculate）、`src/web/CommunicationWorkflowPage.tsx:70/89/100`（send/markReminderSent/dismiss）、`src/web/RefundsPage.tsx:160`（transitionRefund）、`src/web/FollowUpsPage.tsx:210/220/262`（batchGenerate/submitCompletion/submitExecution）、`src/web/InventoryWorkflowPage.tsx:81/160`（run/stocktakeAction）、`src/web/AppointmentsPage.tsx:224/238`（togglePurpose/transition）、`src/web/SchedulesPage.tsx:170`（toggleActive）。
- **触发场景**：用户双击或快速重按；列表页按钮无 pending 反馈。
- **影响**：重复写请求；toggle/transition 类按钮二次触发可能造成状态来回或重复状态迁移；`processPrescription` 场景直接产生重复业务单据。
- **修复建议**：统一抽一个 `useBusyAction`/在调用点加 `busy` state（`disabled={busy}`，成功/失败 finally 复位），与 CrudPage 的 `submitting` 模式对齐。

### H4. 明细 reconcile 逐条串行 PATCH/POST/DELETE，无整体事务与失败恢复
- **文件:行**：`src/web/processing-orders/items.ts`（reconcileProcessingItems）、`src/web/PrescriptionsPage.tsx:290-332`（updatePrescription）、`src/web/PurchaseOrdersPage.tsx:208-256`（reconcilePurchaseItems）
- **触发场景**：编辑大明细单保存时中途网络抖动/超时。
- **影响**：主记录已 PATCH 而明细只更新了一部分，表单中已移除的行未 DELETE——数据半新半旧且无提示；错误 toast 后用户重试又可能叠加重复明细。无幂等（PATCH 幂等，POST 不幂等，重试会复制新增行）。
- **修复建议**：服务端提供批量明细端点（一次事务）；前端至少：先做全部有效性校验、POST 时携带 `requestId`（PurchaseOrdersPage.tsx:165 创建已有先例）并提示"部分明细可能未保存，请核对后重试"。

### H5. 明细拉取全部 `pageSize=100` 截断，>100 条时更新产生重复/漏删
- **文件:行**：`src/web/PrescriptionsPage.tsx:171-173、219-221、301-303`、`src/web/PurchaseOrdersPage.tsx:213-215、416`、`src/web/processing-orders/items.ts`
- **触发场景**：处方/采购单/加工单明细超过 100 条时编辑保存或删除。
- **影响**：编辑回填只取前 100 条；保存时 101+ 条服务端行因不在 `existingIds` 中被当作"新行"重复 POST（复制明细），被移除的行若在 100 条之外则漏删。删除主记录前也只删前 100 条明细，留下孤儿明细。
- **修复建议**：分页聚合（`while (page.total > items.length) 拉下一页`）或服务端提供全量明细端点；至少把 pageSize 提到 500 并加循环。

---

## 中（Medium）—— 体验 / 健壮性 / 纵深缺陷

### M1. SearchableSelect「加载更多」无上限
- **文件:行**：`src/web/components.tsx`（SearchableSelect 滚动到底持续追加）
- **触发场景**：患者、库存项目等大资源滚动到底。
- **影响**：万级数据滚动时反复请求并全量持有 rows；父组件 `onLoaded` 拿到全量数组（PurchaseOrdersPage.tsx:463 `setInventoryRows(rows)`），内存与重渲染成本线性增长。
- **修复建议**：页数上限（如 10 页后停止自动加载并提示搜索）、或在父组件侧只保留当前选中项相关数据。

### M2. DataTable 无虚拟化
- **文件:行**：`src/web/components.tsx`（DataTable：rows>100 时 maxHeight 60vh + sticky 表头）
- **触发场景**：收费单/患者/库存千行级列表打开。
- **影响**：全量 DOM 渲染，滚动卡顿；60vh 内一次性挂载数百行仍可感知掉帧。
- **修复建议**：引入 windowing（react-window/tanstack-virtual）或分页默认化；至少在 100 行阈值基础上按行高估算限高。

### M3. ResourceHub 已访问 tab 保持挂载（display:none），hub 状态堆积
- **文件:行**：`src/web/ResourceHub.tsx` + `src/web/hub-tabs.tsx`（tab 构成：患者 8 项、临床 9 项、财务 7 项、库存 8 项等）
- **触发场景**：用户在一个 hub 内依次打开多个业务页。
- **影响**：所有访问过的页面组件及其 useQuery 订阅常驻内存，后台请求/订阅不释放；长时间使用后内存与事件监听累积。
- **修复建议**：切换 tab 时卸载非活动页（保留少数最近 N 个），或对常驻页启用 staleTime 并暂停非活动查询（`enabled: active`）。

### M4. PatientsPage `key={urlSearch}` 每次搜索整页重挂载
- **文件:行**：`src/web/PatientsPage.tsx`
- **触发场景**：搜索框每输入一个字符（URL search 变化）。
- **影响**：整棵页面树重建，选中状态/滚动位置丢失，每次重挂载重复发起查询；输入连续性差。
- **修复建议**：移除 key，改为受控搜索词 + `useDebounce`（仓库已有该 hook）驱动查询。

### M5. friendlyError 未命中时返回英文/内部消息
- **文件:行**：`src/web/messages.ts` + `src/web/api.ts`（errorMessage 映射表未命中走原始 message）
- **触发场景**：服务端返回未收录的错误码/消息（如新校验规则）。
- **影响**：非技术用户看到英文或内部字段名；诊断信息与用户可读文案混在一起。
- **修复建议**：未命中时兜底中文文案（"操作失败，请稍后重试"），原始 message 记入 console 或 toast 附加字段。

### M6. Electron IPC：4 个 handler 未调 assertTrustedRenderer
- **文件:行**：`electron/main.cjs:796-798`（desktop:version/quit/api-port）、`main.cjs:815`（desktop:get-auto-launch）——其余 7 个 handler（764/774/786/799/810/816/826）均已调用。
- **触发场景**：渲染进程被 XSS 后调用这些通道。
- **影响**：`desktop:quit` 可被任意注入脚本触发退出（其余三个只读无敏感数据，影响有限）；属纵深防御不一致，非当前可利用漏洞。
- **修复建议**：统一在 4 个 handler 开头补 `assertTrustedRenderer(_event)`，保持全通道一致。

### M7. index.html CSP 仍含 `style-src 'unsafe-inline'` 与 nonce TODO
- **文件:行**：`src/web/index.html`（CSP meta 注释 "TODO: 迁移 nonce-based 移除 unsafe-inline"）；`electron/main.cjs:750-756` 另有 onHeadersReceived 注入的 CSP。
- **触发场景**：任何样式注入向量（如通过 data URI 引入样式）。
- **影响**：CSP 对 style 注入的缓解被放宽；双份 CSP（meta + header）长期并存，维护时易漂移。
- **修复建议**：按 TODO 完成 nonce 迁移；Electron 侧 CSP 与 meta 收敛为单一来源。

### M8. 处方状态「刷新」按钮 toast 先于请求结果乐观显示
- **文件:行**：`src/web/PrescriptionsPage.tsx:398-403`（`void refresh(); showToast('状态已刷新','success')`）
- **触发场景**：状态刷新接口失败。
- **影响**：用户看到"已刷新"但数据未更新；且 `refresh()` 内 `query.refetch()`/`onChanged()` 无 catch，失败产生 unhandled rejection。
- **修复建议**：`await` 后再按成功/失败分别 toast；refresh 内加 try/catch。

### M9. 渲染期写 ref（两处）
- **文件:行**：`src/web/PrescriptionsPage.tsx:242`（`updateFormRef.current = ctx.update;` 在 renderForm 渲染期间赋值）、`src/web/MemberCardsPage.tsx:128`（渲染期写 reloadRef）
- **触发场景**：编辑对话框打开瞬间（renderForm 执行时机）配合异步回填（PrescriptionsPage.tsx:164-180 的 useEffect 依赖 `updateFormRef.current?.()`）。
- **影响**：React 渲染阶段修改 ref 属反模式；StrictMode 双渲染或对话框切换时 ref 可能指向上一表单实例，回填落入错误表单（偶发、难复现）。
- **修复建议**：改在 CrudPage 的受控回调内注入（或 useEffect 中赋值），使 ref 与当前渲染一致。

### M10. ChargeCreateForm 优惠金额无上限/无下限校验
- **文件:行**：`src/web/charges/ChargeCreateForm.tsx`
- **触发场景**：录入优惠金额时输入负数或超过应收总额。
- **影响**：客户端无 clamp，生成金额为负/超额的收费单，仅靠服务端报错；用户体验与数据完整性均受损。
- **修复建议**：前端校验 `0 ≤ 优惠 ≤ 应收总额`，超限即时提示并阻止提交。

### M11. ProcessingOrdersPage settle 允许 0 元结算
- **文件:行**：`src/web/ProcessingOrdersPage.tsx`
- **触发场景**：加工单结算时金额为 0（明细未填/金额被清空）。
- **影响**：0 元加工单可进入已结算状态，业务语义错误（空单结算）。
- **修复建议**：结算前校验 `金额 > 0`，否则禁用按钮并提示。

### M12. 行内状态 select 非受控，与同仓受控模式不一致
- **文件:行**：`src/web/VisitsPage.tsx:111-119`（行内状态 select 用 `defaultValue`）、`src/web/InventoryWorkflowPage.tsx`（processingColumns select 同样）
- **触发场景**：列表刷新/排序/翻页后，行内 select 显示旧选中值；多行同值时浏览器复用 DOM 产生串行错乱。
- **影响**：行内状态显示与实际数据不同步，提交错误状态。
- **修复建议**：改为受控 `value`（以行 id 为键），对齐 AppointmentsPage/TreatmentsPage 的复位模式。

### M13. InventoryPage submit 允许 itemId 为 null
- **文件:行**：`src/web/InventoryPage.tsx:181`
- **触发场景**：库存出入库单未选项目直接提交。
- **影响**：客户端不校验，报错延迟到服务端，且错误信息为友好文案兜底（M5 的放大场景）。
- **修复建议**：提交前校验 itemId 必填并字段级提示。

---

## 低（Low）—— 小体验 / 一致性

### L1. 处方创建静默丢弃无效明细
- **文件:行**：`src/web/PrescriptionsPage.tsx:94-107`（validItems 过滤）
- **触发场景**：明细行填了名称但漏填单价/数量。
- **影响**：用户以为提交了全部行，实际被静默过滤；同仓 PurchaseOrdersPage.tsx:143-146 已有 "N 条明细因无效将被忽略" 的提示范式，此处未复用。
- **修复建议**：与采购单一致，提交前统计丢弃行数并 toast 提示。

### L2. 采购单编辑回填整表替换 items，可能与用户输入竞态
- **文件:行**：`src/web/PurchaseOrdersPage.tsx:411-437`
- **触发场景**：编辑打开后明细异步加载期间（慢网络）用户开始修改 placeholder 行。
- **影响**：加载完成时 `update({items: ...})` 整表覆盖，用户刚输入的改动丢失（窗口很小但真实存在）；loadedItemsForRef 只防重复不防覆盖。
- **修复建议**：加载完成前禁用明细编辑区（显示加载态），或按行 id 合并。

### L3. 采购审核汇总条加载中显示「0 单」闪烁
- **文件:行**：`src/web/PurchaseOrdersPage.tsx:259-276`（ReviewSummaryBar 无 loading 态，`query.data?.submitted ?? 0`）
- **触发场景**：页面首屏/刷新瞬间。
- **影响**：短暂显示 0 待审核/0 待收货，随后跳变；用户可能误判。
- **修复建议**：loading 时显示占位符（—/骨架）。

### L4. 处方表单医生下拉加载失败静默空列表
- **文件:行**：`src/web/PrescriptionsPage.tsx:429-434`
- **触发场景**：`/doctors` 接口失败。
- **影响**：下拉为空且无错误提示，用户误以为系统无医生数据；无法创建处方且不知道为什么。
- **修复建议**：query.error 时显示行内错误提示与重试。

### L5. SystemOperationsPage 使用 key={index}
- **文件:行**：`src/web/SystemOperationsPage.tsx:115`
- **触发场景**：表格行内操作导致行集合变化（插入/删除）。
- **影响**：React 按索引复用 DOM，行内状态（如有）错配风险；当前数据静态、影响有限，但属已知反模式。
- **修复建议**：改用行 id 作为 key。

### L6. BackupsPage 使用原生 window.confirm，绕过统一 ConfirmDialog
- **文件:行**：`src/web/BackupsPage.tsx:99、117`
- **触发场景**：暂存恢复备份 / 清理过期备份。
- **影响**：视觉与交互风格偏离全站 Dialog 体系；Electron 中 confirm 阻塞渲染进程且不可样式化；破坏性操作（清理备份不可撤销）用了系统原生弹窗而非带 danger 样式的 ConfirmDialog。
- **修复建议**：改用它处通用的 `ConfirmDialog`（danger 样式）。

---

## 备注：已验证的良好实践（非问题）

- 表单类提交普遍有 `submitting` 守卫与「保存中...」文案（FollowUpsPage.tsx:159 等）；`api.ts` 有请求序号守卫与友好错误映射；孤儿记录清理（PrescriptionsPage.tsx:277-287、cleanupOrphanPrescription）已做。
- 无直接 `fetch` 直连（全部走 api.ts）、无 `console.log` 残留（仅 console.warn 告警路径）、无 `setInterval`/`addEventListener`/WebSocket——桌面单机场景下无轮询可接受（若未来多窗口/多端共享，需补充数据刷新机制）。
- Dialog 族有焦点陷阱；SearchableSelect 已处理渲染期 setState（合并去重）。
- Electron main.cjs 有 T2R-22/L3 安全标记、`web-contents-created` 阻止 webview 挂载、CSP 注入、secret 走 safeStorage 且白名单 key（见 M6 的不一致点）。
- `tsconfig.web.json` strict/ES2022 全开；vite.config.ts 无异常。
- 采购单创建已携带 `requestId` 幂等键（PurchaseOrdersPage.tsx:165），可推广到全部 POST（H4）。

---

## 统计

- 严重 3 条（C1-C3）、高 5 条（H1-H5）、中 13 条（M1-M13）、低 6 条（L1-L6），合计 **27 条**。
- 全部条目均含 文件:行、触发场景、影响、修复建议；行号经本轮逐一核验。
