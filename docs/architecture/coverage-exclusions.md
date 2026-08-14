# 覆盖率排除与质量指标登记册

日期：2026-08-13
用途：覆盖率/变异测试的排除项唯一登记处。v8 ignore 标记数量由
`pnpm --filter @dental/v2 run v8-ignore:report` ratchet（基线 525 处 / 202 文件，
`apps/v2/quality/v8-ignore-baseline.json`）；**新增排除必须先在本文件登记理由并更新基线**。

## 1. 历史遗留（round 77 覆盖率校准，525 处）

2026-08-13 审计发现：round 77「覆盖率校准」把 525 处 `v8 ignore` 标记批量写入
202 个文件（含整个 scheduler.ts、logger.ts、database.ts、migrations/** 及 88 个
web 页面/组件），其中相当部分超出 AGENTS.md 承诺的「schema/SQL 保证的防御分支」
范围。这些标记使覆盖率门槛对 UI 组件层与核心基础设施失效。

**清理计划（四批，每批保持覆盖率门禁绿）：**

| 批次 | 范围 | 状态 |
|---|---|---|
| A | server 基础设施（logger/scheduler/database/idempotency/db-write-queue/clock/secret-file/security/search-index/sqlite-files/seed/ttl-cache） | ✅ 完成（2026-08-13 深夜） |
| B | server service-modules（48 文件） | ✅ 完成（2026-08-13 深夜） |
| C | web lib/hooks/components 核心（api/messages/use-crud-resource/data-table/dialog 等） | ✅ 完成（2026-08-13 深夜） |
| D | web pages/dialogs（88 文件） | ✅ 完成（2026-08-13 深夜） |

四批一次性执行完毕：`v8 ignore` 标记 525 处（202 文件）→ **145 处（15 文件）**，
剩余全部为带理由的细粒度防御分支排除（见 §4 口径）。移除后实测门禁：
服务端 **96.33% statements / 90.92% branches / 99.47% functions / 97.64% lines**，
Web **96.82% / 92.94% / 98.66% / 98.58%**，双门禁全绿——覆盖率口径恢复真实。

每批完成后重跑 `test:coverage` / `test:coverage:web` 并下调用
`V2_V8_UPDATE_BASELINE=1 pnpm --filter @dental/v2 run v8-ignore:report` 更新基线。
不可测分支不再裸加 ignore：要么补测试，要么在本文件「不可测防御分支」小节登记。

## 2. 变异测试扩面计划

- 2026-08-13 扩面：纳入 triage/stocktake/refund-flow/commission/wechat-reminder/
  shift-template 六个高覆盖服务模块；实测总分 77.61（此前 pilot 9 文件为 100）。
- 幸存变异清单（按消灭优先级）：
  1. `wechat-reminder.ts`（58.25）：29 个 noCoverage 变异为主——补发送候选/定时边界测试；
  2. `stocktake.ts`（75.68）：5 个幸存——补盘点锁/校验边界；
  3. `triage.ts`（87.50）与其余模块的少量幸存。
- 阈值 ratchet：high 82 / low 77 / break 75；每消灭一批上调。
- 算子排除（StringLiteral/ObjectLiteral/ConditionalExpression/MethodExpression/Regex）
  暂维持——等价变异比例高；放开条件：先完成 A/B 批次的 v8 清理，确保有真实测试兜底。

## 3. 外键扩展（P2，已部分交付，剩余登记）

- 已交付：迁移 158（MemberCard/ProcessingOrder/TreatmentPlanItem/PrescriptionItem/
  ProcessingOrderItem/InventoryReplenishmentSuggestion 的 FK）+ 迁移 159（外键子列
  `(parentId, deletedAt)` 复合索引）。
- **剩余**：Charge/Appointment/Visit/FollowUp 的 `patientId → Patient(id)` 外键。
  需按迁移 116/158 的 `forceRebuildTable` 模式重建四张核心表，先做孤儿扫描与隔离
  （Quarantine 表），并在 `verify-foreign-keys` 中登记新关系。风险高，单独一轮
  迁移（v160+）交付，配 `drill:legacy-dirty` 式演练。
- 用户/医生外键（doctorId→User 等）：软删除语义复杂，维持应用层校验，暂不声明。

## 4. 不可测防御分支（登记示例，按需追加）

| 文件 | 分支 | 理由 |
|---|---|---|
| `src/web/components/ResourcePage.tsx`（fieldValue json） | `typeof value !== 'string'` / `value ?? '{}'` | FormBuilder 的 json 控件始终以 textarea 字符串提交，非字符串/空值输入不可达 |
| `src/web/components/ResourcePage.tsx`（fieldValue number） | `value ?? 0` | 数字控件提交字符串；submit 会跳过可选空值，nullish 不可达 |
| `src/web/components/ResourcePage.tsx`（fieldValue 兜底） | `value ?? ''` | 其余类型表单值恒为字符串/布尔，nullish 不可达 |
| `src/web/components/ResourcePage.tsx`（fieldValue datetime） | `Number.isNaN(...) ? value` 真值分支 | datetime-local 输入由浏览器/表单清洗为合法值或空串，非法非空字符串不可达 |
| `src/web/components/ResourcePage.tsx`（openEdit / toggleSelect / toggleSelectAll） | `if (staleRows) return` | 三个入口按钮/复选框在 stale 期间均 `disabled`，浏览器不派发点击/变更事件，内部守卫为防御冗余 |
| `src/web/components/ResourcePage.tsx`（remove） | `!target` 与 `submitting`/`submittingRef` 守卫 | ConfirmDialog 仅在 deleteTarget 非空时渲染；且 ConfirmDialog 内部已对 pending 确认去重，重复调用不可达。stale 守卫仍可测（弹窗先开后置 stale） |
| `src/web/components/ResourcePage.tsx`（ReadOnlyListPage exportCsv） | `if (truncated) return` | 导出按钮在 truncated 时 disabled，onClick 不会触发，内部守卫为防御冗余 |
| `src/web/pages/finance/ChargesPage.tsx`（payRoots/payLeafOptions） | `payRoots[0]?.id ?? ''`、`payLeafOptions[0]?.id ?? ''` 与 `payRootNode ? ... : []` | 2026-08-13 简化为直接索引 + 非空断言：内置缴费方式兜底保证三处集合恒非空（行为零变化，不再需要排除） |
| `src/web/pages/finance/ChargesPage.tsx`（pay） | `leaf ? ... : 'OTHER'` 的 OTHER 分支、`METHOD_LABELS[...] ?? effectivePayLeaf` 的空值分支 | effectivePayLeaf 经 `some` 校验必在选项/键集中，查表恒命中 |
| `src/web/pages/finance/ChargesPage.tsx`（deleteCharge） | `crud.page > 1 && (...)` 整行 | 收费列表暂无分页 UI，crud.page 恒为 1，回退逻辑为未来分页预留 |
| `src/server/application/service-modules/inventory-batch.ts`（adjust/update/remove/consumeFifo） | `result.changes === 0` 冲突分支、`!fresh`、`available <= 0` | 同步流程内读后即写（adjust 在 IMMEDIATE 事务内），CAS 条件恒满足，竞态守卫为防御冗余 |
| `src/server/application/service-modules/inventory-batch.ts`（consumeFifo） | `fresh.remainingQuantity ?? 0` 空值分支 | 批次列表查询已过滤 `remainingQuantity > 0`（NULL 被排除），重读恒为正数 |
| `src/server/application/service-modules/inventory-batch.ts`（generateExpiryAlerts） | `expiryDate ? ... : '无效期'` 的无效期分支 | expiring 查询要求 `expiryDate >= today`，NULL 被排除，无效期分支不可达 |
| `src/server/application/service-modules/dispense-stock.ts`（dispense/returnItems） | 事务内 `!locked`/状态 CAS/批次 CAS/退药 CAS 的冲突分支 | 预检与事务内重读同属同步流程，CAS 条件恒满足，竞态守卫为防御冗余（legacy NULL 数据路径仍可测） |
| `src/server/application/service-modules/shift-template.ts`（addDays） | `if (!match) throw` 日期格式校验 | 调用方均先经 normalizeWeekStart 归一化，日期格式恒有效 |
| `src/server/infrastructure/idempotency.ts`（async 分支） | async 回调的同步抛错 catch 与 `!isPromise(result)` 返回 | AsyncFunction 恒返回 Promise、恒不同步抛错，两条分支为防御性兜底 |
| `src/server/infrastructure/idempotency.ts`（sync 路径） | `if (isDbWriteActive(db))` 第二次写锁检查 | 66 行已拦截活动写锁，两次检查之间无异步让出，重复守卫不可达 |
| `src/web/pages/inventory/ProcessingOrdersPage.tsx`（行内按钮/状态选择/撤销结算） | `if (ctx.stale) return`、`if (disabled) return`、`!flowTarget \|\| flowBusy`、`!orderId` | 触发按钮在 stale/busy 期间 disabled（浏览器不派发点击）；对话框按钮仅在 target 非空时渲染；编辑态 orderId 由 formFromRow 恒写入——均为防御冗余 |
| `src/web/pages/inventory/ProcessingOrdersPage.tsx`（advanceFlow/adjustStep 成功守卫） | `if (flowRequestIdRef.current === requestId)` 未命中分支 | 过期响应丢弃行为由 spec「ignores stale advance and adjust responses」覆盖（probe 验证执行）；该分支无源码区间，v8-ignore 与多种结构重写（else/return/同步 helper/单语句/局部变量）均无法让其入账，属 v8 覆盖采集缺陷 |
| `src/web/pages/patients/PatientTimelinePage.tsx`（queryFn 编码 / loadMore / saveCustomFields） | `patientId ?? ''`、`if (loadingMore) return`、`!definitions \|\| !patientId` | enabled 与按钮渲染条件已保证非空/不可达，均为防御冗余 |
| `src/web/pages/patients/PatientTimelinePage.tsx`（派生患者 id / loadMore 失败提示） | `current ?? (...)` 与 `if (failed)` 的已执行路径 | 行为由 spec「uses the first real patient id」与「reports load-more failures」覆盖（断言通过即执行），v8 未将其入账，属采集缺陷 |
| `src/web/pages/clinical/ImagingPage.tsx`（confirmDeleteCategory / toggleCategory / missingSelectLabel） | `!target`、`toggleBusyId === id`、`!row` 守卫 | ConfirmDialog 仅在 target 非空时渲染；忙碌行按钮不可重复点击；过期 id 由 selectCompare 恒写入 selectedRows——均为防御冗余 |
| `src/web/pages/clinical/ImagingPage.tsx`（submitOverride imageUrl） | `form.imageUrl ?? ''` 的 nullish 分支 | 行为由 spec「submits a blank image url for records with a null image」覆盖（断言 body.imageUrl 为空串即执行），v8 未入账，属采集缺陷 |
| `src/web/components/dialog.tsx`（ConfirmDialog handleConfirm） | `submitting \|\| submittingRef.current` 守卫 | 确认按钮在 submitting 时 disabled，双击不可达，防御冗余 |
| `src/web/components/dialog.tsx`（requestClose 定时器） | `closeEpochRef.current !== epoch` 迟到通知守卫 | 关闭时组件卸载会先清掉定时器（spec 验证），迟到通知不可达，防御冗余 |
| `src/server/application/service-modules/custom-fields.ts`（setValues BOOLEAN） | `parseBooleanStrict(...) ? '1' : '0'` 的真值分支 | 行为由 spec「sets null clinic values...」覆盖（断言结果为 '1' 即执行），v8 未入账，属采集缺陷 |
| `src/server/application/service-modules/wechat-reminder.ts`（dayRange） | `if (start === null \|\| end === null) throw` 解析失败守卫 | shiftDate 恒产出合法 YYYY-MM-DD（含 +8 时区与负间隔），`slice(0,10)` 解析不会失败，防御冗余 |
| `src/server/http/audit-buffer.ts`（scheduleAuditRetry） | `if (room > 0)` 空位守卫与 `length + rows > capacity` 超容量丢弃守卫 | 缓冲被 unshift 封顶在 100 且 push 满 50 立即刷出：重试未在途时 buffer≤49、rows≤50（和 ≤99），重试在途时 splice 后 room 恒 ≥49——两条防御分支不可达（容量配置预留），超容量丢弃路径由 spec「drops overflow rows...」覆盖 |
| `src/web/pages/analytics/AnalyticsDashboardPage.tsx`（printReport） | `if (printing \|\| printingRef.current) return` | 打印按钮在 printing 期间 disabled（浏览器不派发点击），双击竞态守卫为防御冗余 |
| `src/web/pages/communication/FollowUpsPage.tsx`（goToPage / batchGenerate） | `if (stale) return` 守卫 | 分页与批量生成按钮在 stale（placeholderData）期间 disabled，浏览器不派发点击，守卫为防御冗余；submitCompletion/submitExecution 的同款守卫由 spec「ignores a stale ... submit」真实覆盖 |
| `src/web/pages/clinical/CephalometricPage.tsx`（runCompare / rowActions） | `caseIds` 区间守卫与 `if (ctx.stale) return` | 开始比较按钮在 0 选中时 disabled 且 toggleCompare 封顶 10；本页列表无分页/搜索（queryKey 恒定、同 key refetch 不产生 placeholderData），stale 恒为 false——均为防御冗余 |
| `src/web/pages/clinical/MedicalRecordsPage.tsx`（rowActions / submitReview） | `if (ctx.stale) return` 守卫与 `!reviewTarget \|\| submitting \|\| staleRef` 守卫 | 本页列表无分页/搜索（queryKey 恒定），stale 恒为 false；审核按钮仅在 reviewTarget 非空时渲染且 submitting 期间 disabled（jsdom 对 disabled 按钮不派发 click）——均为防御冗余；submitEditRequest 的 busy 守卫由 spec「ignores a second submit...」真实覆盖 |
| `src/web/pages/clinical/TreatmentsPage.tsx`（TreatmentStatusSelect / transitionTreatment） | `if (disabled) return` 守卫与 `if (!transitionGuard.start(id)) return` 去重 | 本页列表无分页/搜索（queryKey 恒定），disabled 恒为 false；在途去重由 spec「ignores a second status transition...」覆盖（探针验证 handler 执行且仅 1 次 PATCH），v8 未入账，属采集缺陷 |
| `src/web/pages/hr/CommissionPage.tsx`（confirmDelete / calculate / 空值兜底） | `busy \|\| busyRef.current` 守卫与 `rules.data ?? []`、`statements.data ?? []` | 删除确认与计算按钮在 busy 期间 disabled（jsdom 对 disabled 按钮不派发 click），busy 守卫不可达；TanStack Query v5 将 data 为 undefined 的查询直接标记为 errored（页面落入 PageError 分支），`?? []` 兜底不可达——均为防御冗余 |
| `src/web/dispense/DispenseEditDialog.tsx`（setItemsMeta onLoaded） | `row.batchManaged ?? 0` 的 nullish 分支 | 位于 setState 更新器内的 `??`，v8 不为其入账（setState-updater 采集缺陷类，见多处既往登记）；行为由 spec「treats items without a batchManaged flag...」覆盖（无 batchManaged 的条目不渲染批次下拉） |
| `src/web/first-exams/TeethMarkDialog.tsx`（selectTooth） | `if (tooth) setSelectedToothId(...)` 未命中守卫 | 图表按钮仅渲染 teeth 列表内存在的编号（同一数据源 filter 而来），lookup 恒命中，防御冗余 |
| `src/web/pages/system/SystemOperationsPage.tsx`（runSearch generation 守卫） | `generation === searchGenerationRef.current` 的未命中分支 | searchBusy 状态 + 按钮 disabled 已完全串行化搜索（同一时间最多一个在途请求），过期响应不可达；import/cleanup 的 busy 守卫由 spec「guards import and cleanup against same-tick double submits」真实覆盖 |
| `src/web/pages/inventory/InventoryWorkflowPage.tsx`（applySuggestions / StatusFlowSelect / 采购状态列） | `if (!selectedSuggestions.length) return`、`if (next) run(...)` 与 `PURCHASE_STATUS_LABELS[...] ?? String(...)` 兜底 | 应用按钮在 0 选中时 disabled；占位项是受控 value（重选 '' 不派发 change）；pendingPurchaseRows 已过滤为恒 PENDING（标签查表恒命中）——均为防御冗余 |
| `src/web/pages/clinical/TreatmentPlansPage.tsx`（rowActions / 划价对话框标题） | `if (ctx.stale) return` 守卫与 `billingTarget ? ... : '明细与划价'` 的空值分支 | 本页列表无分页/搜索（queryKey 恒定），stale 恒为 false，守卫防御冗余；对话框标题三元在关闭态（billingTarget null）每次渲染都执行空值分支（行为即默认标题），v8 未为 JSX 属性表达式入账，属采集缺陷 |
| `src/web/pages/clinical/ClinicalWorkflowPage.tsx`（状态标签兜底） | `STATUS_LABELS[status] ?? status` / `STATUS_LABELS[next] ?? next` 的原始值分支 | 2026-08-14 已删除兜底：transitions 配置内的全部状态（IN_PROGRESS/CANCELLED/COMPLETED/SUBMITTED/APPROVED）均在标签表中，兜底仅面向未来配置扩展，删除后行为零变化（渲染列的空值兜底保留） |
| `src/web/pages/system/UsersPage.tsx`（deleteUser / resetPassword / savePermissions / 权限标签） | `!deleteTarget \|\| submitting`、`!passwordTarget \|\| submitting`、`!permissionTarget \|\| permissionBusy` 守卫与 `PERMISSION_LABELS[key] ?? key` | 确认/重置/保存按钮仅在目标非空时渲染且 busy 期间 disabled（jsdom 不派发）；PERMISSION_KEYS 全部在标签表中，`?? key` 仅面向未来扩展——均为防御冗余；openPermissions 的 requestId 守卫由 spec「drops a stale permission load...」真实覆盖 |
| `src/server/application/service-modules/workbench.ts`（today） | `dayStart/dayEnd 为 null` 解析失败守卫 | clinicDate 恒产出合法 YYYY-MM-DD（+8 时区），`clinicDayStartUtc/EndUtc` 解析不会失败，防御冗余（COUNT(*) 空值兜底已删除，聚合恒返回一行） |
| `src/web/components/Tree.tsx`（handleToggle） | `if (!hasChildren) return` | 展开按钮仅在有子节点时渲染（`hasChildren &&`），无子节点分支不可达，防御冗余 |
| `src/web/pages/clinical/PrescriptionsPage.tsx`（effect / ProcessPrescriptionButton） | `if (!prescriptionId) return` 与 `if (disabled) return` | editLoadKey 仅在 formFromRow（先写入 editingIdRef）中递增，prescriptionId 恒非空；处理按钮 busy/disabled 期间禁用（jsdom 不派发）——均为防御冗余 |
| `src/server/application/service-modules/prescription-process.ts`（事务内小计校验） | `chargeSubtotal` 溢出守卫 | 同一算式已在事务外（dispensePlans 构建时）校验并拦截，两次校验之间无数据变更，事务内二次校验为防御冗余 |
| `src/web/lib/format.ts`（formatDate dateOnly） | `!Number.isNaN(local.getTime())` 的 NaN 分支 | 四位年份的 Date 构造恒产生有效日期（越界自动滚动），NaN 分支不可达，防御冗余 |
| `src/web/components/ResourceHub.tsx`（handleTabKeyDown） | `if (!target) return` | keydown 来自已渲染的 tab 按钮（filteredTabs 非空且 next 恒在界内），target 恒存在，防御冗余 |
| `src/web/pages/clinical/FirstExamsPage.tsx`（rowActions） | `if (ctx.stale) return` 守卫 | 本页列表无分页/搜索（queryKey 恒定），stale 恒为 false，守卫为防御冗余 |
| `src/web/pages/finance/RefundsPage.tsx`（RefundRowActions） | `if (stale) return` 守卫 | 动作按钮在 stale 期间 disabled（jsdom 不派发 click），守卫为防御冗余；stale 期间行为由 spec「ignores stale action clicks」覆盖 |
| `src/web/pages/appointments/AppointmentsPage.tsx`（transition / openEdit / delete） | `if (stale) return` 与 `!deleteTarget \|\| submitting` 守卫 | 行内动作/编辑/删除按钮在 stale 期间 disabled，确认框仅在目标非空时渲染且 submitting 期间 disabled——均为防御冗余；stale 期间行为由 spec「does not save an edit while the appointment list is stale」覆盖 |
| `src/server/maintenance/runtime-metrics.ts`（eventLoop 采样） | `Number.isFinite(lagHistogram.max/mean/percentile)` 的 NaN 分支 | 测试环境直方图恒有样本（初值有限），NaN 路径为文档化防御（无样本场景） |
| `src/server/infrastructure/database.ts`（columnType / alignLegacyTables） | 未知列类型 fail-fast 与 `!tableExists` 跳过 | 资源注册表类型为编译期枚举（含 drift guard）；alignLegacyTables 紧跟 createTableSql 且同一事务内建齐全部资源表，表恒存在——均为防御冗余 |
| `src/web/pages/hr/HrWorkflowPage.tsx`（approve） | `if (stale) return` 守卫 | 行内审批按钮在 stale 期间 disabled（jsdom 不派发 click），守卫为防御冗余 |
| `src/web/schedules/TemplateSection.tsx`（toggleActive） | `togglingId === template.id` 去重守卫 | ToggleActiveButton 的 busy 状态已禁用按钮（jsdom 不派发），同行动作去重守卫为防御冗余 |
| `src/web/pages/inventory/PurchaseOrdersPage.tsx`（submitOverride / 收货按钮） | `!orderId` 抛错与 `if (ctx.stale) return` | editing 提交恒经 openEdit（formFromRow 先写 editingIdRef），orderId 恒非空；收货按钮在 stale 期间 disabled——均为防御冗余 |
| `src/web/treatment-plans/PlanBillingDialog.tsx`（bill） | `selectedIds.length > 0 ? ... : {}` 的空选分支 | 划价按钮在 0 选中时 disabled，`{}` 兜底不可达，防御冗余 |
| `src/web/pages/finance/MemberCardsPage.tsx`（openAction / openPlan / openQuote / runAction） | `if (stale) return` 与 runAction 综合守卫 | 本页列表无分页/搜索（queryKey 恒定），stale 恒为 false 且按钮 disabled；动作表单仅在目标与动作类型就绪时渲染、busy 期间按钮 disabled——均为防御冗余 |
| `src/server/http/routes/workflow.ts`（全部写路由的空体 nullish 与 payMethodName 三元） | `req.body ?? {}`（7 处 requestBodyHash：appointment/wechat.send/charge/purchase-receive/processing-status/bulk-import/batch-complete + charges.create）与 `typeof payMethodName === 'string' ? ... : undefined` 的 undefined 分支 | 行为由 workflow.spec「normalizes absent write bodies」真实执行（probe 中间件验证 req.body 为 undefined、handler 返回 400/404、断言通过即执行）；单文件/双文件覆盖运行均入账，全量多 worker 套件合并时 v8 不为其入账且丢失集合随运行浮动，属 v8 覆盖合并采集缺陷 |
| `src/web/pages/finance/FinanceWorkflowPage.tsx`（run） | `if (stale) return` 守卫 | run 仅由 submitAmount 在 stale 已校验为 false 后同步调用（其间无 await），stale 守卫为防御冗余；submitAmount 的同款 stale 守卫由 spec「ignores amount submissions while the page is stale」真实覆盖 |
| `src/web/pages/system/PermissionsPage.tsx`（save） | `if (busy) return` 守卫 | 保存按钮在 busy 期间 disabled（jsdom 不派发 click），双击守卫不可达，防御冗余 |
| `src/server/http/app.ts`（审计截断 keys / 权限规则） | `typeof masked === 'object' ? ... : 0` 的非对象分支与 `if (permissions)` 的缺失分支 | 2026-08-14 已删除两处死代码：maskAuditFields 对对象输入恒返回对象（maskWith 顶层非数组非深度溢出）；authMiddleware 恒先写 context.permissions（effectivePermissions 恒返回数组），且前置 audit 中间件已用 req.context!——均为不可达防御，删除后行为零变化 |
| `src/server/scheduler.ts`（runAutoBackup finally / 两个清理闭包） | `currentBackup === task` 的身份不符分支与 `!idempotencyCleanup`/`!syncChangeCleanup` 空守卫 | isRunning 串行化保证 currentBackup 恒为当前 task；两个清理闭包仅在注册点（存在性已 gate）调用，闭包内空守卫不可达——均为防御冗余 |
| `src/server/application/service-modules/clinical-ops.ts`（doImport 系统错误消息） | `error instanceof Error ? ... : String(error)` 两处非 Error 分支 | 2026-08-14 已删除：两处三元均在 isSystematicSqliteError 分支内，而该守卫以 instanceof Error 为前提，String(...) 兜底为死代码，删除后行为零变化 |
| `src/server/infrastructure/db-write-queue.ts`（executeWithActive finally） | `activeWriters.get(db) ?? 1` 的 nullish 与 `next > 0` 的留存分支 | per-DB 队列串行化保证 finally 时本 run 计数恒 ≥1（条目必存在、next 恒为 0）；nullish 与留存分支为嵌套写场景预留的防御，当前无嵌套调用方——防御冗余 |
| `src/server/infrastructure/stats-aggregate.ts`（tableRowCount / aggregateThresholdExceeded） | `row.c ?? 0` 两处 nullish 兜底 | 2026-08-14 已删除：COUNT(*) 与标量 COUNT 子查询恒返回一行且 c 恒为整数（空表为 0），?? 0 为死代码，删除后行为零变化 |
| `src/web/pages/clinical/VisitsPage.tsx`（VisitStatusSelect / transitionVisit） | `if (disabled) return` 守卫与 `if (!transitionGuard.start(id)) return` 去重 | 本页列表无分页/搜索（queryKey 恒定、同 key refetch 不产生 placeholderData），disabled 恒为 false；在途去重由 spec「ignores a second status transition while the first is in flight」覆盖（探针验证 handler 执行且仅 1 次 PATCH），v8 未入账，属采集缺陷 |

## 5. 其他已知取舍

- 质量分公式不含 lint/typecheck/安全扫描分项（这些是独立硬门禁，非指标）。
- `pnpm verify` 现包含 mutation（约 13 分钟）与 quality-score、v8-ignore ratchet，
  本地全量 verify 耗时显著上升；快速迭代可用 `verify:critical`（typecheck+test+build）。
