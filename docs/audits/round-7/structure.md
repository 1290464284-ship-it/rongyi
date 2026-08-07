# Round 7 — 结构与代码卫生审计：apps/v2

- 审计日期：2026-08-07
- 审计范围：`D:/Desktop/rongyi/apps/v2`（git 根 `D:/Desktop/rongyi/source`）
- 基线数据：仓库共 693 个文件（不含 node_modules）；git 跟踪 411 个文件、约 3.3MB；`src/` 359 个文件（219 非 spec + 139 spec + 1 coverage-boundaries），目录深度最深 3 层。
- 工具：`find`/`wc`/`grep` 静态统计 + `git ls-files`/`git check-ignore` + `knip`（退出码 0，无报告；其 ignore 列表见 [H-04]）。

---

## 严重度：高

### H-01 收费单编号生成逻辑复制粘贴 6 处

**路径**：
- `src/server/application/service-modules/financial.ts:108`
- `src/server/application/service-modules/charge-tree.ts:125`
- `src/server/application/service-modules/prescription-process.ts:100-101`
- `src/server/application/service-modules/treatment-plan-billing.ts:213`
- `src/server/application/service-modules/inventory-docs.ts:49`（`prefix` 参数变体）
- `src/server/application/service-modules/replenishment.ts:125`（`PO-` 变体 + 序号后缀）

**证据**：4 处完全相同的字面量 `CHG-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`（financial.ts:108、charge-tree.ts:125、prescription-process.ts:100、treatment-plan-billing.ts:213）；`grep -rn "toString(36).toUpperCase()"` 命中 7 处，`randomUUID().slice(0, 8)` 模式 9 处。格式规则（前缀、基数 36、截断 UUID、大写）在 6 个服务中各自实现。

**影响**：修改编号格式（如增加诊所前缀、改长度、防碰撞重试）必须同步 6 处，漏改即产生不兼容编号；`Date.now()` 无碰撞保护，同毫秒并发创建收费在业务层无法区分。

**建议**：
1. 在 `src/server/application/service-modules/common.ts`（已存在，无 spec）新增 `generateDocumentNumber(prefix: string): string`，收拢 `toString(36)`/`randomUUID().slice` 逻辑；
2. 替换 6 处调用，删除各文件内联实现；
3. 为 `generateDocumentNumber` 补一个 spec（当前 `common.ts` 无 spec，属高危共享代码裸奔）。

### H-02 前后端 DTO 双写：`web/types.ts` 的 Resource 类型与 `domain/contracts.ts` 不同步

**路径**：`src/web/types.ts:11-30` vs `src/domain/contracts.ts:905-953`；`src/domain/resources.ts` 使用 contracts 版本。

**证据**：两份 `ResourceField`/`ResourceDefinition` 定义。字段集已漂移：
- `contracts.ts` 版 `ResourceField` 含 `unique/searchable/sortable/default/min/max`、`relation.foreignKey`、`type: FieldType`；web 版是 `type: 'text'|...|'decimal'` 字面量并缺上述字段。
- `contracts.ts` 版 `ResourceDefinition.capabilities` 是 `ResourceCapabilities {list,create,update,delete,softDelete}`，且含 `searchableFields/searchIndexResource/defaultSort/audit/roles: UserRole[]`；web 版 `capabilities` 是 `{create,update,delete,softDelete}`（无 `list`）、`roles?: string[]`。
- web 版被 `ResourcePage.tsx:5`、`FormBuilder.tsx:5`、`use-crud-resource.ts` 消费。

**影响**：后端新增字段元数据（如 `default`、`min/max`）时前端组件静默忽略；前端渲染假设的 `capabilities.list` 不存在，行为与声明不符。类型漂移是这类 CRUD 元数据驱动的 UI 最常见的 bug 源。

**建议**：
1. 删除 `web/types.ts` 中的自定义定义，改为 `export type { ResourceField, ResourceDefinition } from '../domain/contracts'`（`Page` 已这样 re-export，见 types.ts:1-3）；
2. 若前端确实需要精简视图类型，改为 `Pick`/`Omit` 派生而非重新声明；
3. `ResourcePage.tsx` 读取字段时按 contracts 版字段名核对一次。

### H-03 运行时用正则解析 TS 源文件建表：`syncLegacySchema`

**路径**：`src/server/infrastructure/database.ts:278-303`；被读目录 `legacy/schema/*.tables.ts`（9 个文件，共 1442 行）；入口 `src/server/main.ts:21`（`V2_LEGACY_SCHEMA_DIR` 默认 `legacy/schema`）。

**证据**：`syncLegacySchema` 用 `extractCreateTableStatements` + `CREATE TABLE IF NOT EXISTS` 正则从 `.ts` 源码文本中提取 SQL 执行（database.ts:286-297）；`knip.json` 将 `legacy/schema/**` 加入 ignore（因此 knip 报 0 死代码），但它并非死代码——是运行时文件系统资源。包配置 `package.json` `extraResources: [{ from: "legacy", to: "legacy" }]` 将其打进安装包。

**影响**：建表正确性依赖"TS 文件里恰好有可正则匹配的 CREATE TABLE 文本"这一隐式契约；任何人改写 schema 文件格式（加注释、改缩进、换模板字符串）会静默改变建表结果；表结构同时存在于 `domain/resources.ts` 声明与 legacy schema 文本两处，属于 schema 双写。测试环境 `NODE_ENV=test` 直接跳过该路径（database.ts:281），CI 覆盖不到。

**建议**：
1. 将 `legacy/schema/*.tables.ts` 固化为纯 `.sql` 资源（迁移脚本内联），`syncLegacySchema` 只读 SQL 文件；
2. 或由 `scripts/generate-legacy-resources.mjs` 一次性提取 CREATE TABLE 生成 `src/domain/legacy-schema.generated.sql` 并提交，运行时读生成物；
3. 短期兜底：在 database.spec.ts 中加一条"解析结果包含全部 9 个文件的表"的断言，防止格式漂移。

### H-04 `knip` 静默通过但存在 3 个忽略项，死代码审计有盲区

**路径**：`knip.json`；被忽略文件 `src/domain/contracts.ts`、`legacy/schema/**`、`electron/preload.cjs`。

**证据**：`pnpm run knip` 与 `node node_modules/knip/bin/knip.js --include ...` 均退出码 0 且零输出；debug 模式确认它扫描了 package.json 入口链。`legacy/schema/**` 实为运行时资源（见 H-03），`preload.cjs` 是 electron 入口，ignore 合理；但 `contracts.ts` 被 ignore 后，其 953 行中是否含有未使用导出无法由 knip 证明。

**影响**：knip 的"干净"结论不能作为死代码证据；后续维护者可能误信 0 报告而跳过人工核查。

**建议**：
1. 在 `knip.json` 为每个 ignore 项写注释说明原因（如 `// runtime resource read via fs in database.ts`）；
2. 对 `contracts.ts` 尝试移除 ignore 并修复（或改 `export type` 集合），跑一次真实结果；
3. CI 的 `v2-ci.yml` 中确认 knip 步骤有 `--reporter` 明确输出，避免静默成功。

---

## 严重度：中

### M-01 `src/web/` 目录 105 个文件，超出 20 文件阈值；命名三层分裂

**路径**：`src/web/`（共 155 文件：顶层平铺 105 = 57 非 spec + 48 spec，7 个功能子目录另 50 文件）；`src/server/http/` 81 文件；`src/server/application/` 79 文件；`src/server/infrastructure/` 35 文件。

**证据**：`find src/web -maxdepth 1 -type f | wc -l` = 105；顶层 57 个非 spec 页面/组件 + 48 个 spec 平铺。命名约定分裂：
- 顶层页面 PascalCase：`AppointmentsPage.tsx`、`ChargesPage.tsx`；
- 功能子目录 kebab-case：`cephalometric/`、`clinical-workflow/`、`first-exams/`、`processing-orders/`、`treatment-plans/`；
- 子目录内又是 PascalCase 组件 + 混合命名类型文件：`FormFields.tsx`、`charge-types.ts`、`dispense-types.ts`、`plan-types.ts`、`types.ts`（三种类型文件命名并存）；
- 同层 hook 文件 `use-crud-resource.ts`（kebab）与页面 `CrudPage.tsx`（Pascal）混排。

**影响**：新模块不知道该往哪放（顶层还是子目录）、类型文件该叫 `xxx-types.ts` 还是 `types.ts`；IDE 折叠与全局搜索噪音大；目录既是"组件库"又是"页面目录"又是"模块目录"，职责未分层。

**建议**：
1. 将顶层 24 个业务页面（AppointmentsPage…ProcessingOrdersPage）下沉为 `src/web/pages/`，通用组件/hook 移入 `src/web/components/`、`src/web/hooks/`；
2. 类型文件统一为 `types.ts`（模块内）或 `*.types.ts`，二选一并在 README 记录；
3. 已存在的功能子目录（first-exams 等）保持，作为"领域模块"约定写入 `src/web/README.md`。

### M-02 三个通用列表/CRUD 页面组件职责重叠：CrudPage / SimpleListPage / ResourcePage

**路径**：`src/web/CrudPage.tsx`（138 行）、`src/web/SimpleListPage.tsx`（54 行）、`src/web/ResourcePage.tsx`（286 行）。

**证据**：
- `CrudPage`：泛型 CRUD 基座，被 CephalometricPage/FirstExamsPage/ImagingPage/MedicalRecordsPage/MemberCardsPage/PatientsPage/PrescriptionsPage/ProcessingOrdersPage/PurchaseOrdersPage/TreatmentPlansPage/TreatmentsPage/VisitsPage 共 12 页使用；
- `SimpleListPage`：54 行只读表格，仅被 `hub-tabs.tsx:157-162` 用于 5 个统计端点（/stats/revenue、/stats/inventory、/analytics/rfm、/analytics/churn、/analytics/doctor-anomalies）；
- `ResourcePage`：286 行元数据驱动 CRUD（读 /resources/meta），被 `App.tsx:29`（`resources/:resource` 路由）与 `ResourceHub.tsx:93` 使用。
- 三者各自实现"加载→表格→分页/搜索"，`use-debounced-value` 的 300ms 防抖在 FormBuilder.tsx:96、ResourcePage.tsx:63、SystemOperationsPage.tsx:16、use-crud-resource.ts:98 重复 4 处。

**影响**：SimpleListPage 与 ResourcePage 都是"通用表格页"，新报表开发者需判断用哪个；列标签字典 `COLUMN_LABELS`（SimpleListPage.tsx:7-18）与各页内联 label 字典重复维护。

**建议**：
1. 让 `SimpleListPage` 改由 `ResourcePage` 的只读模式承载（ResourcePage 增加 `readOnly` 能力），删除 SimpleListPage；
2. 若保留，则把 `COLUMN_LABELS` 合并进 `src/web/format.ts` 或 `messages.ts` 的公共 label 字典；
3. 统一防抖入口：只保留 `use-debounce`（已存在），确认 4 处全部走它。

### M-03 状态/标签文案常量复制粘贴 ≥8 处

**路径**：`src/web/AppointmentsPage.tsx:11-17`、`src/web/AppointmentBoardPage.tsx:9-15`、`src/web/cephalometric/constants.ts:1`、`src/web/charges/charge-types.ts:1-15`、`src/web/clinical-workflow/types.ts:1-16`、`src/web/dispense/DispenseListPanel.tsx:18`、`src/web/first-exams/constants.ts:1-12`、`src/web/HrWorkflowPage.tsx:8`、`src/web/InventoryWorkflowPage.tsx:10-20`。

**证据**：同一预约状态枚举的中文标签被 AppointmentsPage（BOOKED 已预约/ARRIVED 已到诊）与 AppointmentBoardPage（BOOKED 已预约/ARRIVED 已到店）各写一遍且**文案不一致**（"已到诊" vs "已到店"）；`STATUS_LABELS` 同名常量在 5 个文件独立定义，收费状态 UNPAID/PARTIAL/PAID/REFUNDED/CANCELLED 在 charge-types.ts 定义但其他页面（如 ChargesPage 相关 spec）各持有自己的副本。

**影响**：同一状态在不同页面显示不同文案；新增状态（如 REVIEWING）需逐文件补 label，漏一处即显示原始枚举值。

**建议**：
1. 新建 `src/web/labels.ts`，集中所有状态/方法/类型的中文 label 字典（或按域拆 `labels/appointment.ts`、`labels/charge.ts`）；
2. AppointmentsPage 与 AppointmentBoardPage 共用同一字典，修复"已到诊/已到店"不一致；
3. 保留领域枚举定义在各自 `types.ts`，仅 label 集中。

### M-04 巨型文件：20 个非 spec 文件超 400 行

**路径**（行数）：
- `src/server/infrastructure/migrations.ts` 1668
- `src/domain/resources.ts` 1026
- `src/domain/contracts.ts` 953（自带拆分 TODO，见文件头注释）
- `src/server/application/service-modules/financial.ts` 859
- `src/server/application/service-modules/dispense.ts` 780
- `src/server/infrastructure/repositories/core.repositories.ts` 735
- `src/server/application/service-modules/auth.ts` 578
- `src/server/infrastructure/ui-meta.ts` 498
- `src/server/http/app.ts` 436
- `src/server/infrastructure/database.ts` 431
- `src/web/components.tsx` 426
- 页面：AppointmentsPage 562 / ImagingPage 533 / InventoryPage 491 / PrescriptionsPage 485 / PurchaseOrdersPage 473 / MedicalRecordsPage 471 / FollowUpsPage 464 / SchedulesPage 418 / ProcessingOrdersPage 415

**证据**：`find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn` 前 40 行统计；另有 6 个 spec 超 400 行（services-edge.spec.ts 1898、app.spec.ts 1457、services.spec.ts 1217、dispense.spec.ts 766、core.repositories.spec.ts 719、TreatmentPlansPage.spec.tsx 643）。

**影响**：`migrations.ts` 1668 行单文件承载全部迁移（版本 101+，见 M-06）；`financial.ts` 859 行同时含收费创建、收款、退款、会员卡扣减、欠费处理（类职责 >2）；页面 400-560 行说明 CrudPage 抽取不彻底，行内表单/逻辑未下沉到模块子目录。

**建议**：
1. `financial.ts` 按职责拆为 `charge-payments.ts`（收款/退款）与 `charge-creation.ts`（创建/编号），或至少把 SQL 与校验块提取为私有方法；
2. `migrations.ts` 按版本区间拆分文件（`migrations/v101-v120.ts` …），保持单一数组 export 不变；
3. >450 行页面（AppointmentsPage 562、ImagingPage 533）把表格列定义/表单块下沉到对应模块子目录（appointments/、imaging/ 尚不存在，新建）；
4. `contracts.ts` 按文件头 TODO 拆 `domain/enums.ts`、`domain/entities.ts`、`shared/contracts.ts`。

### M-05 运行时产物与备份侧车散落仓库目录（约 125MB，均未跟踪）

**路径**（全部被 git 忽略，`git check-ignore` 逐项确认）：
- `apps/v2/v2.sqlite` + `v2.sqlite-shm` + `v2.sqlite-wal`（根目录，wal 2.4MB）
- `apps/v2/data/v2.sqlite`（3.4MB）+ `data/backups/`（10+ 组 `backup-*.sqlite` + **每组都有 `-shm`/`-wal` 侧车**）+ `data/files/`
- `apps/v2/logs/v2.log`（2.6MB）
- `apps/v2/coverage/`（1.6MB+，含 coverage-final.json 1.5MB）
- `apps/v2/dist-web/`、`apps/v2/dist-electron/server.cjs`（1.8MB）
- `apps/v2/release-v2/`（112MB `Dental-Clinic-V2-Setup-2.2.0.exe` + blockmap + latest.yml）
- `apps/v2/pre-migration/pre-2026-08-06T17-10-24-130Z.sqlite`（1MB）
- `apps/v2/legacy/dental.sqlite`（2.4MB，未跟踪但被脚本依赖，见 M-07）

**证据**：`git ls-files apps/v2` 无任何 sqlite/coverage/logs/data/dist/release 条目（除 `scripts/verify-remote-release.mjs` 等名字含 "release" 的源文件）；根 `.gitignore` 已覆盖 `*.sqlite`、`*.sqlite-wal`、`*.sqlite-shm`、`coverage`、`dist-web`、`dist-electron`、`release-v2/`、`apps/v2/data/`、`apps/v2/logs/`、`*.log`。

**影响**：git 层面是干净的（无违规提交），但工作目录携带 125MB 产物；`data/backups/` 出现 `-shm`/`-wal` 侧车说明备份流程未做 checkpoint/收尾（正常 SQLite 备份不应残留侧车），既是磁盘浪费也是备份流程缺陷信号；开发者误搜会命中生成物。

**建议**：
1. 新增 `scripts/clean-artifacts.mjs`（挂 `clean:artifacts`）统一删除 coverage/dist-web/dist-electron/release-v2/logs/v2.log/根 v2.sqlite*，data/ 与 pre-migration/ 单独处理；
2. 修复备份收尾：`backup.ts` 在备份后对源库执行 `wal_checkpoint(TRUNCATE)` 并验证无侧车残留（参考 `sqlite-files.ts` 已有 `removeSqliteSidecars` 工具）；
3. 运行一次清理释放 ~125MB；`pre-migration/` 快照确认迁移完成后移出仓库或删除（见 D-03）。

### M-06 迁移管理双轨 + 版本号断档（101 起跳）

**路径**：`src/server/infrastructure/migrations.ts:1668`；`src/server/infrastructure/database.ts`（`syncLegacySchema` + `createDatabase`）。

**证据**：`migrations.ts` 头注释："Baseline legacy table synchronization is intentionally separate. This registry owns future schema changes"，首个迁移版本 `version: 101`（migrations.ts:22）。即 1-100 版本隐含由 legacy schema 同步替代，但没有任何文档/断言说明 100 之前是什么；新迁移追加在 1668 行单体文件末尾。

**影响**：新开发者无法从版本号判断基线；`migrations.ts` 继续膨胀（已 1668 行）；legacy schema 与 migrations 两条建表路径共存，任何一条漂移都会产生"表结构不一致但迁移记录正常"的隐性故障。

**建议**：
1. 在 migrations.ts 头部注释补一段"版本 1-100 对应 legacy 同步基线（由 syncLegacySchema 负责），101 起为 V2 自有迁移"；
2. 按 M-04 拆分迁移文件，export 保持单一数组；
3. 增加 `schema_migrations` 全量核对 spec：断言 legacy 同步后表集合 ⊆ `resourceRegistry.all()` 表集合（对齐 database.ts:283 `allowedTables` 过滤）。

### M-07 生成物输入不在仓库：`legacy/dental.sqlite` 未跟踪但被生成脚本依赖

**路径**：`scripts/generate-legacy-resources.mjs:7-9`（读 `legacy/dental.sqlite`，生成 `src/domain/legacy-resources.generated.ts`，531 行已提交）；`package.json` `generate:legacy-resources`。

**证据**：`git ls-files apps/v2/legacy` 只含 9 个 `schema/*.ts`；`legacy/dental.sqlite`（2.4MB）被 `*.sqlite` 规则忽略。生成脚本 `new Database(dbPath, { readonly: true })` 直接读该文件；`.env.example:44-48` 注明"该文件已从仓库移除（R2-P0-04）"。

**影响**：新克隆/CI 机器上运行 `pnpm generate:legacy-resources` 会因文件缺失失败；虽然生成物已提交、当前构建不依赖重跑，但"生成流程在干净环境不可复现"是隐患——任何需要重新生成的场景（表字段变化）都会断。

**建议**：
1. 若 dental.sqlite 必须移出仓库：将生成输入改为受控样本（导出最小 schema 的 SQL 或 JSON 提交到仓库，如 `legacy/dental.schema.dump.sql`）；
2. 或给脚本加"输入缺失时使用已提交生成物并打印警告"的降级路径；
3. 在 `v2-ci.yml` 增加一步 `pnpm generate:legacy-resources` + `git diff --exit-code` 验证可复现。

---

## 严重度：低

### L-01 端口/URL 常量三处硬编码重复

**路径**：`src/server/main.ts:188`（`V2_PORT ?? 3180`）、`vite.config.ts`（`process.env.V2_PORT ?? 3180` + dev 端口 5180）、`electron/main.cjs:560,749`（`http://localhost:5180` 默认）、`.env.example`。

**证据**：`grep -rn "localhost\|3180\|5180"` 在 main.ts/vite.config.ts/electron/main.cjs 命中；vite 注释已承认"P1-7/P1-8：后端端口不再硬编码，跟随 V2_PORT"，但 5180 与 3180 默认值仍分散 3 处。

**影响**：改默认端口需同步 3 处；dev HMR 端口与 CSP 白名单（electron/main.cjs:492 正则内联 5180）若不同步则 dev 模式白屏。

**建议**：在 `src/shared/constants.ts`（或 server 侧唯一常量文件）导出 `DEFAULT_API_PORT = 3180`、`DEFAULT_WEB_DEV_PORT = 5180`；electron 的 CSP 正则改为从环境变量读取。

### L-02 路由注册双签名并存

**路径**：`src/server/http/app.ts:337-401`（30+ 个 register 调用）；`src/server/http/routes/*.ts` 与 `workflow.ts`/`read-routes.ts`。

**证据**：多数 route 文件签名 `registerXxxRoutes(app: Express, db: Database)`（如 stocktake-routes.ts），而 `workflow.ts`/`read-routes.ts` 用 `registerWorkflowRoutes(app, deps: RouteDependencies)`；`deps.ts:71` 定义了 17 服务的依赖聚合，但只有 4 个 register 走 deps（app.ts:337-373），其余 26 个各自 new service。app.ts 内 `new SyncService(db)`、`new WechatService(db, undefined, undefined, logger)` 等直接实例化散布在 436 行中。

**影响**：新增路由时需判断两种模式；app.ts 既是组合根又混入服务实例化细节，测试注入困难。

**建议**：统一为 `registerXxxRoutes(app, deps)` 单签名，把 `deps.ts` 扩展为全量 `RouteDependencies`，app.ts 只做组装与安全中间件配置。

### L-03 魔法数字与内联默认值

**路径**：`src/server/main.ts:247,251`（`24 * 60 * 60 * 1000`、`30`、`60000` 回退）、`electron/main.cjs:106,215,218`（`timeout: 3000`、`randomInt(30000, 50000)`、`waitForApi(port, 30000)`）、`src/server/http/validation.ts:36-44`（日期正则内联）、`src/server/infrastructure/database.ts`（`mmap_size = 268435456` 等 PRAGMA）。

**影响**：配置分散在环境变量、代码默认值、注释三层；`268435456`、`30000` 等无命名常量难以审计。

**建议**：main.ts 的备份间隔/保留数已可环境变量覆盖，将其默认值提取为具名常量（`DEFAULT_AUTO_BACKUP_INTERVAL_MS`、`DEFAULT_AUTO_BACKUP_KEEP`）；electron 内 `30000`/`3000` 命名化。

### L-04 巨型 spec 文件

**路径**：`src/server/application/services-edge.spec.ts` 1898、`src/server/http/app.spec.ts` 1457、`src/server/application/services.spec.ts` 1217、`src/server/application/service-modules/dispense.spec.ts` 766、`src/server/infrastructure/repositories/core.repositories.spec.ts` 719、`src/web/TreatmentPlansPage.spec.tsx` 643。

**影响**：测试失败定位慢、并行度差；spec 即文档，1898 行单文件无法表达"在测什么"。

**建议**：拆 services.spec.ts 按 service-module 对齐（多数模块已有独立 spec，这些大文件是早期聚合测试，可逐步迁移断言到对应模块 spec 后删除）。

### L-05 `MATURITY.md`/`README.md`/`RELEASE.md` 内容重叠

**路径**：`apps/v2/MATURITY.md`（15.4KB）、`README.md`（6.4KB）、`RELEASE.md`（5.4KB）。

**影响**：低。三份文档均有价值（成熟度/使用/发布），但状态与版本信息易失同步。

**建议**：README 链接 MATURITY 与 RELEASE，RELEASE 只留最近 2 个版本记录，历史移入 docs/archive。

---

## 可安全删除清单（精确路径）

以下条目**全部未跟踪**（`git ls-files` 无条目），删除不影响 git 历史与构建（build 前会重新生成），共释放约 **125MB**：

**A. 可再生构建产物（删除安全，build/test 自动重建）**
1. `apps/v2/coverage/` — 测试覆盖率输出（含 1.5MB coverage-final.json）
2. `apps/v2/dist-web/` — vite 构建输出
3. `apps/v2/dist-electron/server.cjs` — esbuild 产物
4. `apps/v2/release-v2/` — electron-builder 输出（112MB exe + blockmap + latest.yml + builder-debug.yml）
5. `apps/v2/logs/v2.log` — 运行时日志

**B. 运行时数据库与侧车（删除需确认无未备份数据；应用重启会自动重建/从 legacy 导入）**
6. `apps/v2/v2.sqlite`、`apps/v2/v2.sqlite-shm`、`apps/v2/v2.sqlite-wal` — 根目录旧运行时库（与 `data/v2.sqlite` 并存，先确认哪个是活动库）
7. `apps/v2/data/backups/*.sqlite-shm`、`*.sqlite-wal` — 备份侧车文件（每组备份的残留；主备份 `.sqlite` 是否删除由用户决定）
8. `apps/v2/files/`、`apps/v2/data/files/` — 空目录（git 不跟踪空目录，删除仅为整洁）

**C. 一次性快照（确认迁移完成后删除或移出仓库）**
9. `apps/v2/pre-migration/pre-2026-08-06T17-10-24-130Z.sqlite`（1MB）— 迁移前快照，`pre-migration/` 目录的唯一文件

**不可删除（明确保留）**：
- `apps/v2/build/icon.ico`（270KB，**已跟踪**，electron-builder 图标）
- `apps/v2/legacy/schema/*.tables.ts`（9 文件，运行时被 `syncLegacySchema` 读取）
- `apps/v2/legacy/dental.sqlite`（未跟踪，但 `generate-legacy-resources.mjs` 依赖，删前先按 M-07 落实替代输入）
- `apps/v2/src/domain/legacy-resources.generated.ts`（生成物但已提交，删除会破坏构建）

---

## 建议执行顺序

1. **本周**：H-01 编号函数收拢、H-02 类型去重、M-05 清理脚本 + 备份侧车修复（影响面小、收益立现）；
2. **两周内**：M-04 拆 financial.ts 与 migrations.ts、M-01 web 目录分层；
3. **有专门窗口时**：H-03 legacy schema 固化、M-03 标签集中、L-02 路由签名统一；
4. 每项改动后跑 `pnpm typecheck && pnpm test && pnpm knip`，knip 需能产出非空报告再视为通过。

## 统计摘要

| 指标 | 数值 |
|---|---|
| v2 文件总数（不含 node_modules） | 693 |
| git 跟踪 | 411（约 3.3MB） |
| src 文件 | 359（219 源 + 139 spec + 1 边界测试） |
| >20 文件目录 | src/web 155（顶层 105）、server/http 81、server/application 79、infrastructure 35 |
| >400 行非 spec 文件 | 20 |
| >400 行 spec | 6 |
| 编号生成逻辑复制 | 6 处 |
| STATUS_LABELS 重复定义 | ≥8 处 |
| 未跟踪产物占用 | ~125MB |
| knip 报告 | 0 问题（3 个 ignore 项） |
