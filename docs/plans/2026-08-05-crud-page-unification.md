# T5.5 Phase A — CRUD 页面模板收敛（试点：Visits + Prescriptions）

> **状态：** Phase A 进行中（调用方审查后提交；本代理禁止 git 写操作）。
> **范围：** 子计划文档 + `useCrudResource`/`CrudPage` 设计实现 + 迁移 2 个试点页（Visits、Prescriptions）+ 对应 spec 收敛。
> **Phase B（调用方另派）：** 批量迁移其余 12 页。本计划第 5 节给出迁移顺序与风险页清单，第 9 节给出给 Phase B 的注意事项。

---

## 1. 背景与目标

审计发现 14 个 CRUD 页面高度重复（相似度 0.55-0.78，共约 3066 行），14 个对应 spec 也高度相似（0.70-0.94）。目标：

1. 抽取公共 hook `useCrudResource` + 通用组件 `CrudPage`，封装列表查询、加载/错误/空态、表格、搜索/分页、新建/编辑表单、删除确认、toast 等重复机制；
2. 每页收敛为 ~50-80 行配置 + 少量页面特有辅助代码；
3. 页面行为不得回退：Visits 的状态标签、transition 下拉、新建表单校验与 payload 语义；Prescriptions 的多明细编辑与孤儿清理必须保持；
4. spec 收敛：hook/CrudPage 深度断言测试承担通用覆盖，页面 spec 只保留差异化断言；测试总数不得净减少（基线 76 文件 582 用例）。

**基线（改动前实测）：**

| 项 | 结果 |
|---|---|
| `pnpm --filter @dental/v2 typecheck` | ✅ 绿 |
| `pnpm --filter @dental/v2 test` | ✅ 76 文件 / 582 用例全绿 |
| `pnpm --filter @dental/v2 test:coverage` | ⚠️ 基线已红：All files 96.52 stmt / 95.22 branch / 99.24 fn / 97.39 line，全局阈值 100%（**预存问题**；coverage include 仅 `src/server/**`、`src/domain/**`，本 Phase 只改 web 文件，指标不可低于基线） |
| `pnpm --filter @dental/v2 knip` | ⚠️ 基线已红：`electron/error.js`（未用文件）、`migrations.ts:980 dedupNullClinicRows`（未用导出）——均不在本 Phase 范围，本次不得新增问题 |

---

## 2. 现状盘点：14 页清单与每页特殊逻辑

全部页面位于 `apps/v2/src/web/`（无 pages/ 子目录），经 `hub-tabs.tsx` 以 `kind: 'custom'` 懒加载注册。行数为改动前实测。

| # | 页面 | 行数 | 特殊逻辑（相对公共骨架） |
|---|---|---|---|
| 1 | VisitsPage | 219 | 状态 transition 下拉（`/visits/:id/status` PATCH）；`SearchableSelect` 患者 + `/doctors` 医生下拉；datetime-local → ISO 转换；空值转 `undefined`；校验「请选择患者、医生并填写开始时间」；仅新建（无编辑/删除） |
| 2 | PrescriptionsPage | 188 | **主子表创建**：先 POST `/resources/prescriptions`，再循环 POST `/resources/prescriptionItems`；**孤儿清理**（明细失败时先删已建明细再删主记录，软删除不级联）；明细行增删；`toCents` 单价；校验「请选择患者、医生并至少填写一条有效处方明细」 |
| 3 | FirstExamsPage | 233 | transition（`/first-exams/:id/status`）；会诊医生第二个 `/doctors` 下拉；11 字段表单 |
| 4 | TreatmentsPage | 241 | transition（`/treatments/:id/status`）；价格 `toCents` + 数量/价格校验；`formatMoney` 列 |
| 5 | TreatmentPlansPage | 220 | **主子表**（treatmentPlans + treatmentPlanItems）+ 孤儿清理（与 Prescriptions 同模式）；`totalFee` 手动输入或按明细计算兜底；计划状态为自由文本 input |
| 6 | ProcessingOrdersPage | 215 | 主子表明细但**单请求** POST `/processing-orders`（items 内嵌）；`totalFee` 计算兜底；`requestId: crypto.randomUUID()`；transition（`/processing-orders/:id/status`） |
| 7 | PurchaseOrdersPage | 165 | 主子表单请求 POST `/purchase-orders`；**两个 SearchableSelect**（供应商 + 库存项，`onLoaded` 收集 inventoryRows 供选项合并）；收货动作 `/purchase-orders/:id/receive`（仅 `PENDING` 可点）；`number`/`supplierId` |
| 8 | MedicalRecordsPage | 230 | 两个选项查询：`/doctors` + `/resources/visits`（就诊下拉）；状态自由文本 input |
| 9 | ImagingPage | 187 | **文件上传** `uploadFile` 得 url 后随记录 POST `/resources/imaging`；`/doctors` 下拉 |
| 10 | CephalometricPage | 164 | 状态自由文本 input；字段较少 |
| 11 | MemberCardsPage | 201 | 余额/积分充值 Dialog（`/member-cards/:id/...` 按类型分支）；`pageSize=100`；`cardNo`/`status`/`level`；`formatMoney` 列 |
| 12 | PatientsPage | 367 | **防抖搜索 + 分页**（pageSize=20）；编辑 + 删除（ConfirmDialog）；**提交前异步查重**（phone/code 重复检查）；数组字段 `splitLines`/`joinLines` 转换；15+ 字段表单 |
| 13 | ChargesPage | 277 | **内联创建表单**（非 Dialog）；主子表明细单请求 POST `/charges`；**收款/退款 Dialog**（`/charges/:id/pay`、`/charges/:id/refund`，均带 `requestId`）；`formatMoney` 列 |
| 14 | FollowUpsPage | 159 | **非标准 CRUD**：`/follow-ups/reminders` 数组 + summary 统计 + 批量生成/批量完成/导出 + 按日期分组渲染 + PromptDialog + 选择列 |

**共同骨架**（14 页重复部分）：列表 `useQuery`（`/resources/{x}?page=1&pageSize=50`）→ LoadingState/PageError → `.page-head`（h1 + 新建按钮）→ DataTable/EmptyState → Dialog + form + 校验 + submit（POST/PATCH）+ toast + refetch。

**行尾事实（实测）：** VisitsPage.tsx 与 VisitsPage.spec.tsx 为 CRLF（VisitsPage.tsx 217/219 行 CRLF）；PrescriptionsPage.tsx 与 PrescriptionsPage.spec.tsx 为全 LF；FirstExams/Imaging/MedicalRecords/MemberCards 及多数 spec 为 CRLF；api.ts/components.tsx 等基础设施为 LF。**修改既有文件必须保留各自原行尾**（Python 文本模式读写）。

---

## 3. ResourcePage 关系结论：**并存**（互不替换）

`ResourcePage.tsx` 是 **resource-meta 驱动**的通用 CRUD：拉 `/resource-meta` 得到 `ResourceDefinition`，用 `FormBuilder` 按字段类型生成表单，支持搜索/分页/删除/CSV 导出，被 hub-tabs 约 25 个 `kind:'resource'` tab 与 `/resources/:resource` 路由复用，自带 20 条 spec。

**结论：新 `useCrudResource` + `CrudPage` 与 ResourcePage 并存，不替换、不合并，但复用其模式与既有组件。** 理由：

1. **meta 驱动表达不了 14 页的行为**：自定义端点（`/visits/:id/status`、`/charges/:id/pay`、`/purchase-orders`…）、主子表多请求创建（Prescriptions/TreatmentPlans）、内联表单（Charges）、提交前异步查重（Patients）、文件上传（Imaging）、批量动作（FollowUps）都不是 `ResourceField` 能描述或 `FormBuilder` 能渲染的。
2. **用 ResourcePage 替换 14 页 = 行为回退**：会丢掉 transition/孤儿清理/查重等，且 14 页现有 UI 文案与交互（DataTable + 自定义 label 结构、aria-label）与 meta 生成结果不一致，spec 全部要重写为弱断言，违背「行为不回退」。
3. **用 CrudPage 替换 ResourcePage = 给 25 个资源 tab 增加代码**：meta 驱动的零代码收益不应被破坏。
4. **两者共享既有的基础组件**（DataTable/Dialog/ConfirmDialog/EmptyState/LoadingState/PageError/SearchableSelect），不新造样式。CrudPage 的字段转换语义（空可选字段不提交、datetime→ISO、money→toCents）对齐 ResourcePage 的 `fieldValue`/`fieldToForm` 行为，保证语义一致。
5. **可选远期（不在本 Phase）**：ResourcePage 可反向重表达为 CrudPage 的一个 meta 派生配置实例，作为 Phase C 的纯重构候选；本 Phase 不做，避免动 20 条 ResourcePage spec。

**反向抽取（本 Phase 采用）**：ResourcePage 中已成熟的通用模式（列表 URL 构造、空值跳过、分页器、删除确认、toast 文案）被吸收进 hook 的默认行为，使两套路径的 UI 语义收敛。

---

## 4. 契约设计

### 4.1 `useCrudResource`（`src/web/use-crud-resource.ts`，LF）

```ts
export interface CrudListParams { page: number; search: string }

export interface CrudResourceOptions<
  TRow extends Record<string, unknown>,
  TForm extends object,
> {
  // 注：TForm 约束为 object 而非 Record<string, unknown>（VisitForm/PrescriptionForm 等接口无索引签名）
  // —— 列表 ——
  queryKey: unknown[];                                    // 必填，如 ['visits']
  endpoint: string;                                       // 必填，如 '/resources/visits'（POST/PATCH/DELETE 基址）
  listPath?: string | ((params: CrudListParams) => string);
                                                          // 默认 `${endpoint}?page=${page}&pageSize=${pageSize}${search ? `&search=${...}` : ''}`
  pageSize?: number;                                      // 默认 50
  enabled?: boolean;                                      // 透传给 useQuery
  // —— 表单 ——
  initialForm: TForm | (() => TForm);                     // 必填；打开新建/创建成功后重置
  formFromRow?: (row: TRow) => TForm;                     // 编辑回填；缺省按 initialForm 键复制 row 同名字段
  validate?: (form: TForm) => string | null;              // 返回错误文案即拦截（toast error 并返回）
  toPayload?: (form: TForm, editing: boolean) => Record<string, unknown>;
                                                          // 缺省 {...form}；空可选字段/ISO/toCents 转换由页面配置
  // —— 行为 ——
  canEdit?: boolean;                                      // 默认 false
  canDelete?: boolean;                                    // 默认 false
  messages?: { create?: string; update?: string; delete?: string };
                                                          // 默认 创建成功/更新成功/删除成功
  errorMessages?: { create?: string; update?: string; delete?: string };
                                                          // 默认 创建失败/更新失败/删除失败（经 errorMessage() 合并原始错误）
  onBeforeSubmit?: (form: TForm, editing: boolean) => Promise<string | null>;
                                                          // 异步前置校验（如 Patients 查重）；返回错误文案即拦截
  submitOverride?: (ctx: { form: TForm; editing: boolean }) => Promise<void>;
                                                          // 自定义提交（如主子表多请求）；抛错由 hook 统一 toast，
                                                          // 成功由 hook 统一关闭/重置/刷新；孤儿清理等页面逻辑留在页面内
  onAfterCreate?: (form: TForm) => void;                  // 创建成功后、关闭/重置前回调
}

export interface CrudResourceResult<
  TRow extends Record<string, unknown>,
  TForm extends object,
> {
  query: UseQueryResult<Page<TRow>>;      // 列表查询对象（isLoading/error/data 由页面/CrudPage 消费）
  rows: TRow[];
  reload: () => Promise<unknown>;         // refetch
  search: string;                         // 已防抖的搜索词（useDebouncedValue，默认 300ms）
  setSearch: (value: string) => void;     // 同时把 page 重置为 1
  page: number;
  setPage: (value: number) => void;
  showForm: boolean;                      // 表单 Dialog 开关
  editing: boolean;                       // 当前是否为编辑态
  editingId: string | null;
  form: TForm;
  updateForm: (patch: Partial<TForm>) => void;   // 部分更新表单
  openCreate: () => void;                 // 重置为 initialForm 并打开
  openEdit: (row: TRow) => void;          // formFromRow/同名复制回填并打开
  closeForm: () => void;
  submit: (event?: FormEvent) => Promise<void>;
                                          // preventDefault → submitting 防重 → validate → onBeforeSubmit
                                          // → toPayload → POST/PATCH（或 submitOverride）→ 成功 toast+关闭+重置+reload
  submitting: boolean;
  deleteTarget: TRow | null;
  requestDelete: (row: TRow) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;     // DELETE endpoint/id → toast → reload
}
```

设计要点：hook 只管机制不管 UI；搜索/分页状态内聚（无搜索 UI 的页面状态永不变化，列表 URL 与现状逐字一致）；错误文案统一走 `errorMessage(error, fallback)`（与现有页面一致，保留原始错误信息）；成功/失败 toast 文案全部可覆盖。

### 4.2 `CrudPage`（`src/web/CrudPage.tsx`，LF）

```tsx
export interface CrudRenderContext<TForm extends object> {
  form: TForm;
  update: (patch: Partial<TForm>) => void;   // = updateForm
  editing: boolean;
  reload: () => Promise<unknown>;
}
// 注：CrudRenderContext 为模块内类型（不导出，knip 无未用导出）；TForm 约束同为 object

export type CrudPageProps<TRow extends Record<string, unknown>, TForm extends object> =
  CrudResourceOptions<TRow, TForm> & {
    title: string;
    createLabel?: string;                    // 默认 '新建'
    emptyMessage?: string;                   // 默认 '暂无数据'
    columns: DataTableColumn<TRow>[];        // 不含操作列
    rowActions?: (row: TRow, ctx: CrudRenderContext<TForm>) => ReactNode;
                                             // 追加「操作」列内容（transition 下拉/收款退款按钮等）
    searchable?: boolean;                    // 显示搜索框（防抖）
    searchPlaceholder?: string;              // 默认 '搜索...'
    searchAriaLabel?: string;                // 默认 '搜索'
    paged?: boolean;                         // 显示分页器
    dialogTitle?: string | ((editing: boolean) => string);
                                             // 默认 create→createLabel，edit→`编辑${title}`
    deleteMessage?: string;                  // 默认 '确定删除该记录吗？'
    extraHeaderActions?: ReactNode;          // page-head 追加按钮（导出等）
    renderForm: (ctx: CrudRenderContext<TForm>) => ReactNode;   // 必填：Dialog 内表单体
  };
```

渲染结构（全部复用既有组件与样式类，不新造样式）：

```
.page > .page-head(h1 + extraHeaderActions + 新建按钮)
      + 搜索框(searchable)
      + DataTable(columns + 操作列)/EmptyState
      + .pager(paged)
      + Dialog > form(onSubmit=submit) > renderForm(ctx) + .modal-actions(取消/保存)
      + ConfirmDialog(canDelete)
```

页面形态：`export function VisitsPage() { return <CrudPage {...配置} />; }`，配置内 `renderForm`/`rowActions` 通过 ctx 拿到 form/update/reload，医生等辅助查询放进页面自己的表单子组件（如 `VisitForm`）。

### 4.3 与审计大纲的差异说明

审计大纲建议 `useCrudResource({ resource, columns, formFields, ... })` 以 formFields 生成表单。**经评估放弃 formFields 方案**：14 页表单含 SearchableSelect、/doctors 下拉、主子表明细行、文件上传、内联表单等异构结构，字段配置化会退化为「配置里写 JSX」，收益为零且更难读。改为 `renderForm` 渲染插槽 + hook 管机制，页面配置 ≈ 50-80 行、特殊表单留在页面内（符合「允许少量辅助代码」）。

---

## 5. 迁移顺序（试点 → 批量）

**Phase A（本次）：** Visits（低风险）→ Prescriptions（中风险，验证 submitOverride + 孤儿清理）。同时落地 hook/CrudPage 与深度 spec。

**Phase B（调用方另派，建议顺序）：**

| 批次 | 页面 | 理由/风险 |
|---|---|---|
| 1 | FirstExams、Treatments、Cephalometric | 与 Visits 同构（transition + 表单），照抄试点模式 |
| 2 | MedicalRecords、Imaging | 多一个选项查询 / 文件上传，仍单记录表单 |
| 3 | ProcessingOrders、TreatmentPlans | 主子表：单请求（内嵌 items）或循环 + 孤儿清理；TreatmentPlans 有 totalFee 计算，**高关注** |
| 4 | PurchaseOrders、MemberCards、Charges | 行内动作（收货/充值/收款退款）+ 内联表单（Charges），需要 rowActions 多按钮与自定义 Dialog；Charges 建议用 hook 直接组合而非 CrudPage（内联表单不在 Dialog 内） |
| 5 | Patients | 搜索/分页/编辑/删除/查重全特性，作为 CrudPage 全能力验收页；formFromRow + onBeforeSubmit + splitLines/joinLines 页面辅助 |
| 6 | FollowUps | **建议豁免 CrudPage**：非标准 CRUD（统计/批量/分组/导出）。若必须收敛，仅复用 hook 的列表+reload 部分，或独立处理，需调用方决策 |

---

## 6. spec 收敛策略

1. **新增深度测试**（承担被收敛掉的通用断言）：
   - `src/web/CrudPage.spec.tsx`（LF，~12 用例）：列表渲染/加载/错误/空态；新建（校验拦截 → 无请求；通过 → POST payload 含 toPayload 转换 + 成功 toast + 列表刷新）；编辑（formFromRow 回填 → PATCH + toast）；删除（确认 → DELETE + toast；取消 → 无请求）；搜索（防抖后 URL 带 search、page 重置 1）；分页（上一页/下一页 URL 变化）；rowActions 操作列渲染；submitOverride（多请求 + 失败 toast）；onBeforeSubmit（异步拦截）；默认消息文案；canEdit/canDelete 能力开关。
   - `src/web/use-crud-resource.spec.tsx`（LF，~4 用例）：hook 直测（updateForm 部分更新、openEdit 同名复制回填、openCreate 重置、create 成功后表单重置）。
2. **页面 spec 收敛为差异化断言**：
   - `VisitsPage.spec.tsx`（保留 CRLF）：列表渲染（患者/医生 label、状态中文标签「就诊中」）、创建校验文案「请选择患者、医生并填写开始时间」+ payload（startTime ISO、空值 undefined）+ toast「就诊记录已创建」、transition 调 `/visits/v-1/status` PATCH + toast「就诊状态已更新」。
   - `PrescriptionsPage.spec.tsx`（保留 LF）：多明细创建（先 prescriptions 后 prescriptionItems 循环、toCents）、校验文案、**孤儿清理**（先删明细再删主记录顺序断言）、明细行添加/移除。
3. **覆盖点转移账**：旧 Visits 3 用例（列表+创建 / 校验 / transition）与旧 Prescriptions 3 用例（创建 / 校验 / 孤儿清理）的断言全部保留在页面 spec 内；新增 ~16 用例承担通用 CRUD 深度覆盖。**测试总数 582 → 目标 ≥ 595，无净减少。**

---

## 7. 验收标准

1. `pnpm --filter @dental/v2 test` 全绿，文件数 ≥ 76、用例数 ≥ 582（目标 ≥ 595）。
2. `pnpm --filter @dental/v2 typecheck` 全绿。
3. `pnpm --filter @dental/v2 test:coverage`：指标不低于基线（96.52/95.22/99.24/97.39）；命令本身基线已红（阈值 100%），如实报告，不修（不在范围）。
4. `pnpm --filter @dental/v2 knip`：不新增未用文件/导出/类型；基线 2 项预存问题保留并报告。
5. 行为不回退：Visits 状态标签/transition/校验/payload 语义；Prescriptions 多明细与孤儿清理；两页列表 URL、aria-label、toast 文案不变。
6. 行尾正确：VisitsPage.tsx/spec 保持 CRLF，PrescriptionsPage.tsx/spec 保持 LF，新文件 LF，子计划文档 LF。
7. 不改后端、不新增依赖、不做 git 写操作。

## 8. 改动文件与回滚

**改动/新增文件（全部在 source 工作区）：**
- 新增：`docs/plans/2026-08-05-crud-page-unification.md`、`apps/v2/src/web/use-crud-resource.ts`、`apps/v2/src/web/CrudPage.tsx`、`apps/v2/src/web/use-crud-resource.spec.tsx`、`apps/v2/src/web/CrudPage.spec.tsx`
- 改写：`apps/v2/src/web/VisitsPage.tsx`（CRLF）、`apps/v2/src/web/VisitsPage.spec.tsx`（CRLF）、`apps/v2/src/web/PrescriptionsPage.tsx`（LF）、`apps/v2/src/web/PrescriptionsPage.spec.tsx`（LF）

**回滚：** 本代理不做任何 git 写操作，diff 由调用方审查后提交。如需回退，调用方对上述文件 `git checkout -- <path>` 即可（新增文件 `git clean`/删除）；hook/CrudPage 与两页迁移相互独立，可单独回退任一侧（页面回退后 hook/CrudPage 仍被 spec 引用，测试依旧可跑，但建议同时回退对应 spec）。

## 9. 风险与 Phase B 注意事项

- **行尾**：CRLF 页面必须用 Python 文本模式读写；`sed -i`/编辑器默认保存会把整个文件转 LF 造成整文件 diff 噪音（.gitattributes 为 `* text=auto eol=lf`，web 页面文件是例外）。
- **孤儿清理是页面业务逻辑**（服务端软删除不级联）：Prescriptions 与 TreatmentPlans 都要保留各自的 cleanup 函数，不要塞进 hook；hook 的 `submitOverride` 只负责「成功统一收尾、失败统一 toast」。
- **Charges 建议不用 CrudPage**：内联创建表单 + 两个独立 Dialog（收款/退款），用 `useCrudResource` 直接组合更自然；CrudPage 的 Dialog 固定结构会逼它退回 Dialog 形态。
- **Patients 是全能力验收页**：防抖搜索（hook 已内置 300ms）、formFromRow（数组字段 joinLines 回填）、onBeforeSubmit（查重）、canEdit/canDelete。迁移后请重点回归查重与编辑回填。
- **FollowUps 豁免建议**：非 CRUD 形态，强行收敛收益低风险高；Phase B prompt 应请调用方决策。
- **后端契约观察（未改后端）**：`/visits/:id/status`、`/treatments/:id/status`、`/first-exams/:id/status`、`/processing-orders/:id/status` 为 PATCH 语义一致；`/charges/:id/pay`（PATCH）与 `/charges/:id/refund`（POST）语义不同需注意；`/purchase-orders/:id/receive` 仅 PENDING 可调（前端按钮 disable 逻辑需保留）。未发现需上报的后端缺陷。
- **coverage/knip 基线已红**为预存状态，验收以「不降/不新增」为准，避免 Phase A 范围外改动。
