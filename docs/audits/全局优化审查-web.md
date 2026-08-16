# 全局优化审查 — Web 渲染层

> 范围：`apps/v2/src/web`（React + @tanstack/react-query + TypeScript 桌面端渲染层，不含 `.spec.*`）。
> 方法：grep 统计（fetchAllPages / v8 ignore / queryKey / aria / 金额日期格式化 / 分页 / 行数）+ 重点文件精读。
> 说明：UI 视觉已统一两轮，本报告不涉及样式/token。每条发现格式：`【优先级】文件:行号 — 问题 — 影响 — 建议（风险）`。

---

## 1. 高优先级（正确性/性能）

- 【P0】`pages/finance/ChargesPage.tsx:51,136-142` — 收费列表 `listPath` 固定 `pageSize=50`，页面无任何分页器，`crud.page` 恒为 1，只渲染前 50 条。第 51 条起的收费单永远无法查看/收款/退款，属数据可达性缺陷。建议：接 `PagePager`/load-more，或改 cursor 分页。（风险：高）

- 【P0】`pages/inventory/InventoryPage.tsx:153-157` — 扫码定位只请求 `page=1&pageSize=20`，再在前 20 条内 `find` 精确匹配 barcode/code；目标条码落在第 21 条之后时误报「未找到匹配的库存项目」。建议：后端增加 barcode/code 精确查询参数，或全量/服务端精确匹配。（风险：高）

- 【P0】`pages/inventory/InventoryPage.tsx:68-73` — `batches` 查询在 `itemId` 为空时退化为 `GET /inventory-batches` 全量拉取；且翻页/重置 `itemId` 会反复触发全量拉取 + 无分页整表渲染。建议：`enabled: !!itemId`，批次单独分页，翻页不清空 itemId。（风险：高）

- 【P1】多页面 CRUD 列表无分页/搜索，被 `useCrudResource` 默认 `pageSize=50` 静默截断：`pages/clinical/MedicalRecordsPage.tsx:103`、`TreatmentPlansPage.tsx:63`、`PrescriptionsPage.tsx:53`、`VisitsPage.tsx`、`TreatmentsPage.tsx`、`FirstExamsPage.tsx`、`CephalometricPage.tsx`、`pages/finance/MemberCardsPage.tsx`。病历/处方/治疗计划/就诊/会员卡为可增长数据，超过 50 条即无法在列表内触达（仅能靠全局搜索）。建议：高频页补 `paged`（或至少放大 pageSize + 空态提示截断）。（风险：中）

- 【P1】`/doctors` 同一端点使用 12 个不同 queryKey，且「医生下拉 + option 循环 + MissingSelectOption + 错误重试块」整套 JSX 复制约 10 份：`pages/appointments/AppointmentsPage.tsx:53`、`pages/clinical/VisitsPage.tsx:167`、`TreatmentsPage.tsx:177`、`imaging/ImagingFormFields.tsx:34`、`medical-records/RecordFormFields.tsx:19`、`treatment-plans/PlanFormFields.tsx:76`、`prescriptions/PrescriptionForm.tsx:10`、`processing-orders/ProcessingOrderFormFields.tsx:23`、`first-exams/FirstExamFormFields.tsx:8`、`pages/hr/CommissionPage.tsx:68`、`pages/analytics/AnalyticsDashboardPage.tsx:57`、`clinical-workflow/RecordDialog.tsx:22`/`TriageDialog.tsx:26`。缓存完全无法跨页复用，每次进页/开表单都重新请求；改一处要同步 10 处。建议：抽 `useDoctors()`（固定 `queryKey: ['doctors']` + `staleTime: Infinity`）与 `DoctorSelect` 组件收敛。（风险：中）

- 【P1】随访状态两套中文映射：`first-exams/constants.ts:2-7`（re-export `lib/labels.ts:90-96` FOLLOW_UP_STATUS_LABELS）vs `treatment-plans/types.ts:86-92` FOLLOW_UP_LABELS，同一 `followUpStatus` 枚举文案不一致（如 NONE=未追踪/无、PENDING=待跟进/待回访、LOST=已流失/流失）。同一业务状态两个页面显示不同文案，易误判。建议：治疗计划侧复用 `lib/labels.ts` 的 FOLLOW_UP_STATUS_LABELS。（风险：中）

- 【P1】写操作只靠 `disabled={busy}`、handler 内无 ref 级 in-flight 守卫，与 `useAsyncAction`/`createInFlightGuard` 已建立的约定不一致：`cephalometric/SendWechatDialog.tsx:14-32`、`clinical-workflow/RecordDialog.tsx:33-63`、`clinical-workflow/CreateFollowUpDialog.tsx:28-48`、`first-exams/TrackingDialog.tsx:39-62`、`cephalometric/ReportDialog.tsx:49-84`。快速双击（尤其「发送微信」）会在 re-render 前连发两次非幂等 POST，重复发消息/建重复记录。建议：统一改用 `useAsyncAction` 或补 `useRef` 守卫。（风险：中）

- 【P1】`pages/inventory/InventoryWorkflowPage.tsx:36-39,48-54` — 「待收货采购单」「待应用补货建议」是在当前页(pageSize=100)内客户端 `filter`，非服务端过滤；首页 PENDING/OPEN 占比低时用户需逐页翻找，易误判为无待处理项。建议：列表端点增加 `status=PENDING`/`status=OPEN` 过滤参数。（风险：中）

---

## 2. 中优先级（体验/一致性）

- `status` 列表列裸显英文枚举：`medical-records/columns.ts:10`、`cephalometric/columns.tsx:8`、`TreatmentPlansPage.tsx:27`、`purchase-orders/columns.tsx:10`、`pages/finance/FinanceWorkflowPage.tsx:97`。对应中文 label（如 `EDIT_STATUS_LABELS`、`PURCHASE_STATUS_LABELS`）已存在却未用于列表渲染。建议：统一补 `statusLabel` 映射。
- 日期格式化多套实现/口径不一：`imaging/format.ts:4-14` 重写 `formatDateTime`/`toLocalDatetime`（与 `lib/format.ts:46-51,73-78` 近似但行为有差异、不判 NaN）；`pages/clinical/VisitsPage.tsx:62`、`pages/appointments/AppointmentBoardPage.tsx:26`、`appointments/columns.tsx:48` 手写 `new Date(...).toLocaleString('zh-CN',{hour12:false})`；`TreatmentPlansPage.tsx:45` 裸 ISO（`String(row.nextFollowUpAt)`）；`TreatmentsPage.tsx:102-103`、`VisitsPage.tsx:98` 用 `.slice(0,10)` 截日期；`InventoryWorkflowPage.tsx:211` 用 `.slice(0,16).replace('T',' ')`。建议：统一走 `lib/format` 的 `formatDate`/`formatDateTime`。
- 金额手工分转元未用工具函数：`TreatmentPlansPage.tsx:82`（`(Number(row.totalFee)/100).toFixed(2)`）、`ChargesPage.tsx:380`（`(item.price/100).toString()`）。建议：统一 `centsToYuanString`。
- `medical-records/RecordFormFields.tsx:76-78` — 「关联就诊」下拉 option 显示 `String(row.id)`（原始 UUID），无法区分是哪次就诊。建议：显示 `startTime + 主诉` 等可读 label。
- 枚举/外键字段用自由文本 `<input>` 编辑，与同页面 select+label 惯例不一致：`cephalometric/CephalometricFormFields.tsx:21-27`（status/templateId）、`treatment-plans/PlanFormFields.tsx:110-114`（status）、`imaging/ImagingFormFields.tsx:65`（type）。易输入非法枚举。建议：改 select + 枚举 label。
- `pages/clinical/ClinicalWorkflowPage.tsx:85-88,95,133,161,178,198` — `stale` 对四个资源的 `isPlaceholderData` 做全局 OR，翻任一资源分页（进入 placeholder）会让其它三个无关区块的操作按钮全部禁用。建议：按资源维度分别计算 `stale`。
- `pages/finance/ChargesPage.tsx:76-79` — `pay-methods/tree` 查询错误被静默回退内置方式，而同页 `charge-trees` 错误在 `147-153` 显式展示；自定义缴费方式树加载失败时用户无感知丢失配置。建议：为 `payMethodQuery.error` 加行内提示 + 重试。
- `pages/inventory/InventoryWorkflowPage.tsx:65-74` — 每次操作后 `Promise.all` refetch 四个查询（purchase/purchaseItems/processing/suggestions），收货只影响 purchase、流转只影响 processing、应用建议只影响 suggestions。建议：按操作维度精确 `invalidateQueries`。
- 常量字典/枚举类查询缺 `staleTime`：`processing-orders/ProcessingOrderFormFields.tsx:22-25`（/doctors）、`ChargesPage.tsx:72-79`（/charge-trees、/pay-methods/tree）每次挂载/聚焦都重拉。建议：加 `staleTime: 5 * 60_000` 或 Infinity。
- render 期写 ref（与 `MedicalRecordsPage.tsx:259-272` 自述的 M9 约定矛盾）：`MedicalRecordsPage.tsx:151`（`staleRef.current = ctx.stale` 写在 rowActions 渲染期）、`PrescriptionsPage.tsx:122`（`updateFormRef.current = ctx.update` 写在 renderForm 渲染期）。当前幂等无实际 bug，但属已声明规避的反模式回潮。建议：迁到 effect。
- 重复实现：`purchase-orders/api.ts:8-56` `reconcilePurchaseItems` 与 `processing-orders/items.ts:44-87` `reconcileProcessingItems` 逐行近似（fetchAllPages→PATCH/POST/DELETE 对账）；`components/FormBuilder.tsx:82-165` `RelationSelect` 与 `components/searchable-select.tsx:13-137` 重复「远程搜索 + 加载更多 + 累计 + 页数上限」逻辑。建议：抽 `useLoadOrderItems` 与共享远程选择 hook。
- ad-hoc busy 状态机重复：`InventoryPage.tsx`（submitting/editing 等 5 组）、`ChargesPage.tsx:36-37`、`FinanceWorkflowPage.tsx:21-22`、`MemberCardPlanDialog.tsx:24-25`、`DispenseNarcoticPanel.tsx:23-24` 手写 `if(x)return;setX(true);try{}finally{setX(false)}`，与现成 `useAsyncAction` 语义一致。建议：统一迁移。

---

## 3. 低优先级（打磨/维护）

- `pages/finance/ChargesPage.tsx:298-301` — `deleteCharge` 内「删除末页最后一条回退一页」整段为死代码（本页无分页 UI，`crud.page` 恒 1），且被 `v8 ignore` 掩盖。建议：删除该死分支。
- `pages/appointments/AppointmentsPage.tsx:76-115` — 创建预约成功后表单字段（患者/医生/椅位/时间）不清空，连续创建残留旧值。建议：成功后 reset。
- `pages/inventory/InventoryWorkflowPage.tsx:177-178` — `createStocktake` 失败后仍无条件清空单号/备注，用户输入丢失。建议：仅成功后清空。
- `pages/inventory/InventoryReportPanel.tsx:55` — 「仅显示前 {report.data.total} 条」用 total 计数，truncated 时与实际展示条数不符。建议：显示 `items.length` 或后端返回 shown 计数。
- `pages/inventory/InventoryPage.tsx:354` — 库存流水类型 select 无 aria-label；`387-405/419-453` 低库存/临期/批次表无空态。建议：补 aria-label 与 EmptyState。
- `pages/finance/MemberCardsPage.tsx:219` — POINTS 积分调整校验放行负值（`!Number.isInteger(value) || value === 0`），若负积分非法则存在校验缺口。建议：确认业务语义后补 `value < 0` 拦截。
- `components/ResourcePage.tsx:82-89` — `formatStatValue` 用列名白名单启发式判定金额/日期，未列入的金额列（如 totalFee/sum）会裸显「分」、日期列裸显 ISO。建议：改为 meta 驱动字段类型，或扩展白名单并加兜底。
- 枚举 label 字典集中化不彻底：`lib/labels.ts`（M-03 声称「统一在此定义」）与 `lib/status-extra-labels.ts` 并存，且 `prescriptions/constants.ts`、`treatment-plans/types.ts`、`purchase-orders/constants.ts`、`medical-records/constants.ts`、`imaging/constants.ts`、`schedules/constants.ts`、`follow-ups/constants.ts`、`inventory/constants.ts` 仍各自持有 label 映射。建议：合并进 `lib/labels.ts`。
- 分层倒置：`components/ResourcePage.tsx:13` 从 `pages/analytics/analytics-utils` 导入 `csvCell`/`downloadTextFile`（共享组件依赖页面模块）。建议：把 `csvCell`/`downloadTextFile` 下沉到 `lib/`。
- 工具函数重复：`pages/analytics/analytics-utils.ts:18` `today()` 与 `lib/format.ts:64` `todayLocalDate()` 重复；`analytics-utils.ts:41` `downloadTextFile` 与 `lib/api.ts:388-400` `downloadCsvPath` 的 blob 下载逻辑重复。
- 同端点重复缓存键：`components/Layout.tsx:146`（`['me']`）与 `pages/system/UsersPage.tsx:101`（`['auth-me']`）都请求 `/auth/me`。建议：统一 queryKey。
- `v8 ignore` 主路径过度覆盖（覆盖率失真、且「恒 PENDING/恒非空/恒 disabled」假设脆弱）：`InventoryWorkflowPage.tsx:100-101`、`ChargesPage.tsx:236-241`、`ProcessingOrdersPage.tsx:223-224`、`PurchaseOrdersPage.tsx:64-65`。建议：将 ignore 精确到真正的不可达分支（如仅标 else），或删除冗余守卫。
- 单文件超 300 行共 16 个：`InventoryPage.tsx`(481)、`ResourcePage.tsx`(456)、`InventoryWorkflowPage.tsx`(441)、`UsersPage.tsx`(430)、`lib/api.ts`(425)、`hooks/use-crud-resource.ts`(408)、`ImagingPage.tsx`(399)、`ChargesPage.tsx`(393)、`AnalyticsDashboardPage.tsx`(380)、`DispenseNarcoticPanel.tsx`(351)、`AppointmentsPage.tsx`(336)、`CommissionPage.tsx`(325)、`ProcessingOrdersPage.tsx`(324)、`FollowUpsPage.tsx`(319)、`Layout.tsx`(317)、`PatientsPage.tsx`(311)。建议：按职责拆分（对话框/列定义/格式化下沉）。
- `InventoryWorkflowPage.tsx:93,119,127,153` — ID 列截断长度不一（14/8/8/12）。建议：统一截断宽度。

---

## 4. 正面结论

1. **查询缓存有全局兜底**：`main.tsx:10-18` 配置 `staleTime: 30_000` + `gcTime: 5min` + `retry: 1`，并 `onApiReady(() => queryClient.invalidateQueries())` 消除 API 子进程重启导致的假失败。
2. **大列表渲染已虚拟化**：`components/data-table.tsx`（A15）真虚拟化 + 500 行上限 + 首行实测行高，工作台列表均走分页，未发现千行级一次性 DOM 渲染。
3. **fetchAllPages 未滥用**：全部按父 id（prescriptionId/planId/orderId）过滤拉取主子表明细，无对可增长大表的全量聚合。
4. **写路径防护到位**：`useCrudResource` 具备乐观更新 + 后台 refetch 校准 + 删除末页回退 + ref 级 in-flight 守卫；多数写操作带 `requestId: crypto.randomUUID()` 幂等键（`ChargesPage.tsx:245`、`InventoryPage.tsx:118` 等）。
5. **异步竞态处理规范**：`PrescriptionsPage.tsx:30-49`、`PlanFormFields.tsx:39-69`、`ProcessingOrderFormFields.tsx:33-66`、`ProcessingOrdersPage.tsx:57-98` 均带 `cancelled`/请求序号守卫，未发现陈旧响应覆盖最新值。
6. **金额口径基本一致**：统一 `formatMoney`/`toCents`/`centsToYuanString`，表单「元」→ 提交「分」的转换集中在各 `buildValidItems`。
7. **无障碍与错误态覆盖广**：绝大多数 input/select/图标按钮带 aria-label，存在 `accessibility-static.spec.ts` 静态护栏；错误态/空态/重试块普遍覆盖，静默 `catch {}` 均带注释说明且不掩盖主错误。

---

## 5. Top 5 建议

1. **给收费列表接分页**（`ChargesPage.tsx:51`）——这是当前唯一让用户「看不到已有数据」的 P0 缺陷，直接影响收款/退款。
2. **抽 `useDoctors()` + `DoctorSelect`**：把 `/doctors` 的 12 个 queryKey 与约 10 份「医生下拉」JSX 收敛为一处，加 `staleTime: Infinity`。
3. **修 `InventoryPage` 扫码只查 20 条 + 批次全量拉取**（`153-157`、`68-73`）：改为后端精确查询，批次查询加 `enabled: !!itemId`。
4. **统一数据口径**：followUpStatus 两套文案、status 裸英文枚举、日期/金额工具函数（`imaging/format.ts`、`VisitsPage.tsx:62`、`TreatmentPlansPage.tsx:45,82`、`ChargesPage.tsx:380`）全部收敛到 `lib/format` + `lib/labels`。
5. **写操作统一走 `useAsyncAction`/`createInFlightGuard`**，补 `SendWechatDialog`/`RecordDialog` 等缺 ref 守卫的写入口与 `pay-methods/tree` 错误提示，并清理 `v8 ignore` 对主路径的过度覆盖。

---

## 6. 执行记录（医生下拉收敛）

本项对应 §1 的 `/doctors` 12 个 queryKey / 约 10 份重复 JSX 收敛。

### 新建文件

- `apps/v2/src/web/hooks/use-doctors.ts` — `useDoctors()`：固定 `queryKey: ['doctors']`、`queryFn: () => apiRequest<DoctorRow[]>('/doctors')`、`staleTime: Infinity`。返回形状按现有调用点与 `auth.listDoctors` 对齐为数组（`DoctorRow = Record<string, unknown> & { id: string; name?: string | null; role?: string | null; active?: unknown }`），非 `{ items }` 包装。
- `apps/v2/src/web/components/DoctorSelect.tsx` — 受控医生下拉：`useDoctors()` + option 循环 + `MissingSelectOption`（value 不在已加载列表且非 loading 时显示）+ 加载失败 `query-section-error` 行内提示与「重试」按钮；props：`value`/`onChange`/`required?`/`disabled?`/`ariaLabel?`/`label?`/`placeholder?`。
- `apps/v2/src/web/hooks/use-doctors.spec.ts` — 覆盖 useDoctors 请求与缓存键、DoctorSelect 加载、MissingSelectOption、错误重试、disabled/required 透传、onChange 值语义。
- `apps/v2/src/web/components/index.tsx` — 增补 `export * from './DoctorSelect';`。

### 迁移的调用点

| 文件 | 原 queryKey | 迁移方式 |
| --- | --- | --- |
| `pages/appointments/AppointmentsPage.tsx` | `appointment-doctors` | 两处下拉改用 `<DoctorSelect ariaLabel="医生">`，删除本地 useQuery/错误块/doctorMissing |
| `pages/clinical/VisitsPage.tsx` | `visit-doctors` | `<DoctorSelect label="医生">` |
| `pages/clinical/TreatmentsPage.tsx` | `treatment-doctors` | `<DoctorSelect label="医生">` |
| `imaging/ImagingFormFields.tsx` | `imaging-doctors` | `<DoctorSelect label="医生">` |
| `medical-records/RecordFormFields.tsx` | `record-doctors` | `<DoctorSelect label="医生">` |
| `treatment-plans/PlanFormFields.tsx` | `plan-doctors` | `<DoctorSelect label="医生">` |
| `prescriptions/PrescriptionForm.tsx` | `prescription-doctors` | `<DoctorSelect label="医生">` |
| `processing-orders/ProcessingOrderFormFields.tsx` | `processing-doctors` | `<DoctorSelect label="医生" placeholder="不指定">` |
| `first-exams/FirstExamFormFields.tsx` | `first-exam-doctors` | 主下拉 `<DoctorSelect label="医生">`；「会诊医生」保留独立 select 但改用 `useDoctors()` |
| `pages/hr/CommissionPage.tsx` | `commission-doctors` | 保留「适用医生/默认（所有医生）」专用 select 与 `field-error` 提示，改用 `useDoctors()` |
| `clinical-workflow/RecordDialog.tsx` | `['workbench','doctors']` | `<DoctorSelect label="医生">` |
| `clinical-workflow/TriageDialog.tsx` | `['workbench','doctors']` | `<DoctorSelect label="分诊医生">` |

说明：`pages/analytics/AnalyticsDashboardPage.tsx` 的 `doctors` 查询实际指向 `/satisfaction/doctor-rankings`（医生绩效/满意度，非 `/doctors` 医生名单），语义不同，未迁移。

### 测试与 typecheck 结果

- `pnpm --filter @dental/v2 exec vitest run src/web/hooks/use-doctors.spec.ts` — **6/6 通过**。
- 受影响页面/表单 spec（AppointmentsPage、VisitsPage、TreatmentsPage、TreatmentPlansPage、ProcessingOrdersPage、CommissionPage、PrescriptionsPage、clinical-workflow、ImagingFormFields、RecordFormFields、treatment-plans、PrescriptionForm、processing-orders、first-exams-components）— **281/281 通过（14 个文件）**。
- `pnpm --filter @dental/v2 typecheck` — **通过**（`tsc -p tsconfig.server.json && tsc -p tsconfig.web.json`）。
