# 第六轮前端全面深度审计报告（frontend）

- 仓库：`D:/Desktop/rongyi/source`，分支 `codex/v2-full-optimization`，HEAD `dcca390`（第五轮已修复，本报告**不重复复核**第五轮修复内容）
- 审计范围：`apps/v2/src/web/`（React 19 + TypeScript + vite + react-query）
- 审计日期：2026-08-07
- 方法：全量代码走读（覆盖 web 目录全部 90+ 文件）+ 真实 Chromium 验证（stepMismatch / '1e3' / '0x10' 行为）+ 运行时逻辑推演
- 验证脚本（临时文件，保留）：`.audit-round6/step-test.html`、`.audit-round6/step-test.mjs`（用于验证 number input 的 step 与科学计数法通过性）

---

## 一、新发现清单

### P1（数据错误 / 用户明显受阻）

#### 1. 金额 number 输入缺 `step="0.01"`，小数金额被浏览器校验拦截
- 证据（均已用真实 Chromium 验证：无 step 时输入 `12.5` → `stepMismatch=true`、表单不提交；加 `step="0.01"` 后正常）：
  - `apps/v2/src/web/charges/PaymentDialog.tsx:38`（收款金额）
  - `apps/v2/src/web/charges/RefundDialog.tsx:24`（退款金额）
  - `apps/v2/src/web/charges/ChargeCreateForm.tsx:61,93`（明细单价、优惠金额）
  - `apps/v2/src/web/MemberCardsPage.tsx:171,187,199`（充值/消费金额、折扣上限）
  - `apps/v2/src/web/PrescriptionsPage.tsx:91`（明细单价）
  - `apps/v2/src/web/PurchaseOrdersPage.tsx:466`（采购单价）
  - **新增**：`apps/v2/src/web/TreatmentsPage.tsx:205`（治疗"价格"输入 `type="number" min="0"` 无 step，`12.5` 元同样被浏览器静默拦截）
- 对照正例：`ProcessingOrdersPage.tsx:308`（settle 有 `step="0.01"`）、`clinical-workflow/ChargeDialog.tsx:92`（单价有 `step="0.01"`）、`QuickChargeDialog` 数量 `step=1` 合理。
- 影响：用户在收费/退款/会员卡/划价/治疗等场景无法录入带角分的金额，表单 submit 被浏览器静默拦截且无任何提示，属于高频核心路径的用户可见故障。
- 修复：上述输入加 `step="0.01"`（整数场景 `step="1"`）。

#### 2. `use-crud-resource.ts:143-161` onBeforeSubmit 双提交窗口（可重复创建数据）
- 证据：`submit()` 中 `if (submitting) return`（:145）是 state 守卫，而 `setSubmitting(true)` 在 `await options.onBeforeSubmit(...)`（:154-155）**之后**才执行（:161）。onBeforeSubmit 是网络请求（查重）时按钮仍未 disabled，双击保存 → 两次查重都通过 → 两个相同 POST。
- 唯一使用点：`PatientsPage.tsx:154`（重复创建患者）。
- 影响：双击保存重复创建患者（真实数据重复）。
- 修复：`setSubmitting(true)` 提前到函数开头，或用 ref 守卫（参照 `use-async-action` 的实现）。

#### 3. `PurchaseOrdersPage.tsx:70-79,463` 每行 SearchableSelect 的 `onLoaded` 相互覆盖 → 明细名称存空
- 证据：明细行各自 `onLoaded={(rows) => setInventoryRows(rows)}`，最后触发者整体覆盖 `inventoryRows`；`buildValidItems`（:76-77）用 `inventoryRows.find(id)?.name ?? ''` 解析选中物料名称。若最终 inventoryRows 不含该行，`name` 以空字符串提交。
- 影响：采购单明细项目名称可能被存为 `''`（数据质量问题，后续单据/报表展示残缺）。
- 修复：按行合并（如 `DispenseCreateForm.tsx:96-102` 的 merge 写法），或提交时重新请求该行数据。

### P2（状态/竞态/一致性）

#### 4. 科学计数法 `'1e3'`（及 `'0x10'`）静默转换未拦截（第五轮仅修了 quickCharge 一处）
- 证据：`format.ts:3-7` `toCents(value) = Number(value)*100`，`Number('1e3')=1000` → 通过；浏览器对 number input 的 `'1e3'`/`'0x10'` 均放行（已用真实 Chromium 验证，`badInput` 未拦截）。仍受影响位置：
  - `ChargesPage.tsx:206`（pay）、`:240`（refund）——且这两处输入无 step，整数型 `'1e3'` 可绕过浏览器校验直接提交
  - `charge-utils.ts:18-19`（明细单价/数量）
  - `MemberCardsPage.tsx:320-328`（充值/消费/积分，`Number.isInteger` 对 1000 通过）
  - `PrescriptionsPage.tsx:102-104`（days/quantity/price）
  - `PurchaseOrdersPage.tsx:76-77`
  - `InventoryPage.tsx:184,225`（数量）
  - `AppointmentsPage.tsx:372`（sortOrder）
  - **新增**：`FinanceWorkflowPage.tsx:54`（充值/消费/欠费还款，`toCents('1e3')=100000` 通过 `Number.isFinite && amount>0`）
  - **新增**：`TreatmentsPage.tsx:78-92`（validate `Number(form.price)>0` 与 `toPayload` `toCents` 均放行 `'1e3'`）
  - **新增**：`DispenseCreateForm.tsx:32`（`Number.isSafeInteger(Number('1e3'))` 通过 → 数量 1000）
  - **新增**：`DispenseNarcoticPanel.tsx:33-34,48-49`（麻药数量/余量，`Number('1e3')` 通过）
  - **新增**：`InventoryWorkflowPage.tsx:189-193`（盘点实盘数 `'1e3'` → 1000 通过非负整数校验）
  - **新增**：`FollowUpsPage.tsx:143,74`（词典排序 `Number('1e3')||0`）
- 影响：非法输入被静默解释为大数值，金额/数量可被夸大 1000 倍（如 `1e3` 元 → 100000 分），影响账实一致与库存/麻药台账。
- 修复：金额/数量统一用 `/^\d+(\.\d{1,2})?$/`（金额）或 `/^\d+$/`（数量）正则白名单后再转数值；`toCents` 内部先做格式白名单。

#### 5. `PrescriptionsPage.tsx:334-349` processPrescription 无 busy 守卫
- 证据：`process` 按钮无 disabled，"处理"回调直接 `await apiRequest('/prescriptions/:id/process')`，无 `if (busy) return`。
- 影响：双击 → 两个 POST，可能生成两张划价单/领药单（重复发药/重复计费）。
- 修复：加 submitting ref/state 守卫，处理中禁用按钮。

#### 6. ResourceHub tab 不与 URL 同步（深链接/刷新丢失）
- 证据：`ResourceHub.tsx:9` `activeId` 为纯内部 `useState`，无 `useSearchParams` 读写；刷新或深链 `/hub?tab=xxx` 回到默认第一个 tab。
- 影响：深链接、浏览器前进/后退、刷新均无法恢复用户所在的 tab 上下文。
- 修复：用 searchParams 驱动 `activeId`（读 URL 初始化、切换时写 URL），与 `Layout.tsx` 现有路由体系一致。

#### 7. RelationSelect / SearchableSelect 防抖窗口内"加载更多"竞态
- 证据：`FormBuilder.tsx:93-146` 搜索词变化 `setPage(1)` 但 `accumulated` 未立即清空；300ms 防抖（`use-debounce.ts`）期间点"加载更多" → page=2 先于 page=1 的新搜索请求返回，第 1 页永不加载且 accumulated 混入新旧结果。`components.tsx:98-101` SearchableSelect 虽清了 loaded，但同样存在"防抖窗口内 page 变 2 丢失第 1 页"问题。
- 影响：搜索结果列表错乱/缺第一页；选中行可能来自旧搜索词。
- 修复：防抖生效时先清空 accumulated/loaded 并重置 page，或以 search 词加入 queryKey 使旧请求失效。

#### 8. `ImagingPage.tsx` file 状态跨弹窗残留 → 误传旧文件覆盖影像（新）
- 证据：`ImagingPage.tsx:115` `file` 是页面级 state；`onAfterCreate={() => setFile(null)}`（:282）只在**创建成功**后清空，而 `use-crud-resource.ts:139-141` `closeForm()` 仅 `setShowForm(false)`，取消/关闭弹窗不触发任何重置；`initialForm`（ImagingPage.tsx:251-254）也只清 `editingIdRef` 不清 file。
- 场景：新建弹窗选了文件 → 取消 → 打开另一条记录"编辑" → 提交时 `submitOverride`（:256-257）把旧文件 `uploadFile` 后**覆盖该记录的 imageUrl**；或直接新建另一条也带上旧文件。
- 影响：影像被错误覆盖/串档（临床影像数据被替换）。
- 修复：`formFromRow`/`openCreate` 时 `setFile(null)`，或在 `submitOverride` 中仅当用户本次新选文件时才上传。

#### 9. `FollowUpsPage.tsx:262-278` submitExecution 无 busy 守卫（新）
- 证据：确认执行按钮（:446）无 `disabled`，`submitExecution` 无 `if (busy) return`。
- 影响：双击 → 两个 `POST /follow-ups/:id/execute`，同一次随访可能被记录两次执行（患者评分/疼痛度被二次覆盖）。
- 修复：busy 守卫 + 按钮 disabled。`batchGenerate`（:210-218）同样无守卫，双击会批量生成两批随访提醒（P3 级）。

#### 10. `CommunicationWorkflowPage.tsx:70-78,89-98` 发送微信无 busy 守卫（新）
- 证据：`send()`/`markReminderSent()` 无 busy 守卫，按钮未 disabled。
- 影响：双击"发送" → 两个 `POST /wechat/:id/send` → 患者**收到两条相同微信消息**（真实外部副作用）。
- 修复：busy 守卫；发送成功后禁用该行。

### P3（体验/小范围一致性）

#### 11. `TreatmentPlansPage.tsx:81` 手写金额格式化
- 证据：`(Number(row.totalFee)/100).toFixed(2)` 未复用 `centsToYuanString`（`format.ts:17-22`）。全站唯一残留手写处。
- 影响：与统一格式化语义漂移（后续改精度需多处改）；显示上结果一致。

#### 12. `TreatmentPlansPage.tsx:150` requestPrint 无 busy 守卫
- 证据：双击"打印" → `printCount +2`（无网络请求，纯计数状态错乱）。

#### 13. `AnalyticsDashboardPage.tsx:65` 立即 revokeObjectURL
- 证据：`downloadTextFile` 创建 blob URL 后立即 `revokeObjectURL`；对照 `api.ts` 的下载实现延迟 1000ms 释放（兼容 Firefox 等）。某些浏览器下下载可能失败/空文件。
- 修复：统一为延迟释放或下载完成后再释放。

#### 14. `PrescriptionsPage.tsx` 编辑打开后明细异步加载完成前保存 → 误导性报错
- 证据：编辑弹窗 items 经 `useEffect`（editLoadKey）异步加载，加载完成前点保存被 `validate` 拦截报"请至少填写一条有效处方明细"；对比 `TreatmentPlansPage.tsx:88-90` 有"加载中"提示。无 `itemsLoadedRef` 的加载中保护。
- 影响：用户以为明细丢了/校验误报，体验误导。

#### 15. 行内状态变更类操作普遍无 busy 守卫（模式性，同类问题批量汇总）
- `AppointmentsPage.tsx:238-249`（StatusTransitionSelect / togglePurpose，第五轮已修其他部分但此两处仍无守卫）
- `TreatmentsPage.tsx:118-123`（TreatmentStatusSelect，select 已受控复位但无 busy 守卫）
- `VisitsPage.tsx:110-125`（行内状态 select）
- `FirstExamsPage.tsx:71-95`（状态/牙列 select）
- `ClinicalWorkflowPage.tsx:74-89`（transition）、`clinical-workflow/TriageQueuePanel.tsx:24-27`（startVisit）
- `InventoryWorkflowPage.tsx:81-89,133,160-168,206-208`（run/收货/加工流转/盘点动作）
- `PatientWorkflowPage.tsx:33-41`（calculate 风险）
- `HrWorkflowPage.tsx:32-43`（批准/驳回）
- `RefundsPage.tsx:160-174`（transitionRefund，且操作后 summary chips 用 staleTime 30s 缓存不刷新）
- `AppointmentBoardPage.tsx:52-63,65-73`（拖拽/下拉状态变更）
- `UsersPage.tsx:192-213`（changeOwnPassword 无 `if (submitting) return` 守卫，按钮 disabled 但 handler 未拦截）
- 影响：快速连点可能乱序/重复请求；多数后端幂等或状态机校验兜底，但如 #5/#10 无幂等保护的会出真实重复数据。
- 修复：统一用 `useAsyncAction` 或按钮级 busy。

#### 16. `ChargesPage.tsx:140-169` pay/refund 取消后金额残留
- 证据：成功路径清理 `paymentAmount`/`refundAmount`，取消路径（onCancel）不清 → 下次打开弹窗仍是旧金额，误点确认可能重复收款/退款。

#### 17. `MemberCardsPage.tsx` runAction/runQuote 的 `'1e3'` 放行（并入 #4，此处列引用）
- `runAction` POINTS：`Number.isInteger(1000)` 通过；`runQuote` 同。

#### 18. `MemberCardsPage.tsx` openPlan 不预填当前折扣方案
- 证据：打开计划编辑时折扣字段为空，保存可能以"未设置"覆盖原方案（存疑，可能有意为之，建议确认后补预填或加"未修改不提交"）。

#### 19. `ProcessingOrdersPage.tsx:175-184,375-391` unsettleProcessingOrder / transitionProcessingOrder 无 busy 守卫
- 证据：两处 handler 无 busy 守卫（flowRequestIdRef 只保护流程推进，不覆盖这两处）。

#### 20. `InventoryPage.tsx` ?id= 深链参数变化不更新 itemId（新同类：`PatientTimelinePage.tsx:20`）
- 证据：`InventoryPage` 与 `PatientTimelinePage:20` 均以 `useState(urlParam)` 初始化，同实例内 URL `?id=a → ?id=b` 不触发状态更新（`PatientTimelinePage` 的 4 个查询继续用旧 patientId）。
- 影响：侧边栏切换患者/物品时内容不跟随 URL 变化。

#### 21. `SystemOperationsPage.tsx:34-46` 批量导入无 busy 守卫（新）
- 证据：导入按钮无 disabled，`submit` 无守卫。
- 影响：双击 → 两次 `POST /bulk-import/patients` → 重复导入数据（运维高危操作，建议 P2 处理）。
- 附带：`cleanupAuditLogs`（:58-73）与 `DesktopSettingsPage` toggleAutoLaunch/restartApi（:55-77）同样无守卫（P3）。

#### 22. `PatientTimelinePage.tsx:131` 金额未格式化显示
- 证据：`event.amount === undefined ? '' : ' · ' + String(event.amount)` 直接输出原始值；若后端 `totalAmount` 为分（与全站 `formatMoney` 约定一致），时间线显示 `3500` 而非 `¥35.00`，与其余页面金额格式不一致。

#### 23. `ImagingPage.tsx:34,138-141` 影像对比仅覆盖前 50 条
- 证据：对比下拉数据源为 `pageSize=50` 的第一页（共享 CrudPage 缓存键 `['imaging', 1, '']`，pageSize 默认一致可共享，但超出 50 条的影像无法参与对比）。

#### 24. `FollowUpDictsTab.tsx:74` 词典 sortOrder `Number(...) || 0` 与 `'1e3'`（并入 #4）；`FollowUpsPage.tsx:319-321` 分组用字符串比较日期（ISO 格式下正确，时区边界存疑，可忽略）

---

## 二、正面确认清单（已核实，非问题）

- **api.ts**：token 不落 localStorage（safeStorage/内存）；blob URL 延迟 1000ms 释放；`AbortSignal.timeout` + signal 合并；401 刷新 + 全局登出；下载路径统一封装。
- **ProcessingOrdersPage**：openFlow/advanceFlow/adjustStep 有 `flowRequestIdRef` epoch 守卫；closeFlow 使在途请求失效。
- **AppointmentsPage**：编辑回填电话有 `editingPhoneFetchRef` 守卫 + rawPhoneCache。
- **Dialog / ConfirmDialog / PromptDialog**：焦点陷阱、Escape、关闭动画 epoch 守卫；PromptDialog value 渲染期同步。
- **ResourcePage / use-crud-resource**：删除末页回退；PROTECTED_UI_FIELDS 过滤敏感字段；queryKey `[key, page, search]` 组合与 ImagingPage 缓存共享一致。
- **PatientsPage**：`key={urlSearch}` 防旧搜索残留；`parseLocalDateTime` 拒绝 2 月 30 日等滚转日期。
- **ChargesPage**：quickCharge 用 `/^\d+$/` 拒绝 `'1e3'`（第五轮修复，正确）；金额格式化已统一走 format.ts。
- **AnalyticsDashboardPage**：csvCell 有 CWE-1236 公式注入防护。
- **Layout**：currentAllowed 深链检查（`/resources/:resource` 按 definition.roles）已实现。
- **Format 工具**：`toLocalInput`/`formatDate`/`formatDateTime` 处理非法日期返回原值，无 NaN 泄漏。
- **SchedulesPage**：TemplateSection/GenerateSection 均有 submitting/generating 守卫；workDays 解析容错。
- **BackupsPage**：创建/校验/恢复/清理均有 busy 守卫（虽按钮无视觉 disabled，但函数级拦截有效）。
- **UsersPage**：`submit` 的 `setSubmitting(true)` 在首个 await 之前，双提交防护有效；重置密码走专用端点。
- **PermissionsPage**：useAsyncAction 全局 busy，按钮禁用，无重复提交窗口。
- **MedicalRecordsPage**：submitEditRequest/submitReview 守卫正确；proposedContent JSON 解析容错。
- **clinical-workflow ChargeDialog / RecordDialog、treatment-plans SignForm / PlanBillingDialog、dispense DispenseCreateForm / DispenseNarcoticPanel**：均有 busy 守卫；ChargeDialog 单价 `step="0.01"`、数量 `step="1"` 正确。
- **InventoryWorkflowPage**：盘点实盘数校验非负整数（除 #4 科学计数法外）；补货建议选择/应用逻辑清晰。
- **SystemOperationsPage**：审计日志清理有 30-3650 天范围校验；CSV 解析器处理引号转义。
- **SimpleListPage**：金额/日期列按列名白名单格式化，避免对象泄漏。
- **TriageQueuePanel / 工作流页面**：查询键清晰，无跨资源污染。

---

## 三、一句话总结

第六轮前端审计共发现 **3 个 P1、7 个 P2、14 个 P3 类新问题**（金额 step 拦截、onBeforeSubmit 双提交、采购明细名称覆盖、'1e3' 科学计数法扩散、多处无 busy 守卫的重复提交/重复发送、ResourceHub 深链与 tab 不同步、ImagingPage 文件残留覆盖影像等），核心修复方向是：金额输入统一 `step="0.01"` + 数值正则白名单、所有异步提交补 busy 守卫、SearchableSelect/深链参数做 key 化与 URL 同步；其余基础设施（api.ts 安全、Dialog 生命周期、格式化工具、权限深链）质量良好，无需返工。
