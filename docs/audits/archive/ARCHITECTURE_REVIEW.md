# API 项目架构审查报告

> 项目：`source/apps/api`
> 审查方法：Brooks Lint 架构审计（模块依赖 · 层级完整性 · 抽象泄漏 · 循环依赖 · 死代码）
> 审查范围：`src/modules/*` `src/common/*` `src/db/*`
> 报告日期：2026-07-24

## 0. 项目体量与健康度概览

| 指标 | 数值 |
| --- | --- |
| 源码文件数 | 309 |
| 测试文件数 | 69 |
| 源码总行数 | 20,593 |
| 测试代码占比 | 77.16% |
| `any` 类型（类型断言 + 类型注解） | 766 |
| ESLint 错误/警告 | 0 / 0 |
| TODO/FIXME/HACK/REVIEW 标记 | 81 |
| 综合健康评分（`npm run health`） | **70 / 100（良好）** |
| 行覆盖率 | 0%（未运行 `test:cov`） |
| 数据库 schema 表数 | 9 个 schema 文件，`src/db/schema` 共 5,613 行 |

主要业务模块按行数（来自 `npm run health`）：

```
db                  5,613 行
common              4,488 行
modules/system      2,937 行
modules/clinical    1,960 行
modules/financial   1,752 行
modules/inventory   1,107 行
modules/auth          571 行
modules/content       539 行
modules/scheduling    401 行
modules/communication 396 行
modules/patients      308 行
modules/equipment      88 行
```

## 1. 模块依赖矩阵

> 单元格取值：**D** = 直接 import、**X** = 反向依赖（禁止）、**S** = 同模块子目录。

| 模块                       | common | db | auth | clinical | communication | content | equipment | financial | inventory | patients | scheduling | system |
| -------------------------- | :----: | :-: | :--: | :------: | :-----------: | :-----: | :-------: | :-------: | :-------: | :------: | :--------: | :----: |
| **common**                 |  -     |  -  |  -   |    -     |       -       |    -    |     -     |     -     |     -     |    -     |     -      |   -    |
| **db**                     |   -    |  -  |  -   |    -     |       -       |    -    |     -     |     -     |     -     |    -     |     -      |   -    |
| **auth**                   |  D (✓) |  D  |  -   |    -     |       -       |    -    |     -     |     -     |     -     |    -     |     -      |   -    |
| **clinical**               |  D     |  D  |  -   |  S       |       -       |    -    |     -     |     -     |     -     |    -     | **D (⚠)**  |   -    |
| **clinical/registrations** |  D     |  D  |  -   |  S (visits) |    -       |    -    |     -     |     -     |     -     |    -     | **D (⚠)**  |   -    |
| **communication**          |  D     |  D  |  -   |    -     |       S       |    -    |     -     |     -     |     -     |    -     |     -      |   -    |
| **content/prescriptions**  |  D     |  D  |  -   |    -     |       -       |  S (drug-catalog) | - | - | - | - | - | - |
| **equipment**              |  D     |  D  |  -   |    -     |       -       |    -    |     -     |     -     |     -     |    -     |     -      |   -    |
| **financial/charge**       |  D     |  D  |  -   |    -     |       -       |    -    |     -     |  S (member-cards) | - | - | - | - |
| **inventory**              |  D     |  D  |  -   |    -     |       -       |    -    |     -     |     -     |     S     |    -     |     -      |   -    |
| **patients**               |  D     |  D  |  -   |    -     |       -       |    -    |     -     |     -     |     -     |    -     |     -      |   -    |
| **scheduling**             |  D     |  D  |  -   |    -     |       -       |    -    |     -     |     -     |     -     |    -     |     S      |   -    |
| **system**                 |  D     |  D  |  -   |    -     |       -       |    -    |     -     |     -     |     -     |    -     |     -      |   S    |

### 关键观察

- ✅ **common ↔ modules 单向依赖**：未发现 `src/common` 引用任何 `src/modules/*`（`grep` 验证）。层级边界守得住。
- ✅ **db ↔ modules 单向依赖**：未发现 `src/db` 引用任何 `src/modules/*`。
- ⚠ **跨主模块耦合**：
  - `clinical` → `scheduling/appointments`（`src/modules/clinical/clinical.module.ts:2`）
  - `clinical/registrations` → `scheduling/appointments`（`src/modules/clinical/registrations/registrations.module.ts:5`）
  - `clinical/registrations.service` 直接 `import` `AppointmentsService` 与 `VisitsService`（`src/modules/clinical/registrations/registrations.service.ts:11-12`）
- ⚠ **同级子模块横向耦合**：
  - `financial/charge` → `financial/member-cards`
  - `content/prescriptions` → `content/drug-catalog`
  - `clinical/registrations` → `clinical/visits`
  - 这三处属于同模块内部子目录间的耦合，原则上 OK，但仍暗示领域边界模糊（"挂号" 知道 "预约" 的存在）。

## 2. 关键发现（按优先级）

### P0 — 必修

#### P0-1. 跨模块耦合：`clinical → scheduling`
- **位置**：
  - `src/modules/clinical/clinical.module.ts:2` —— `ClinicalModule` 显式 import `AppointmentsModule`
  - `src/modules/clinical/registrations/registrations.module.ts:5` —— `RegistrationsModule` 同时 import `VisitsModule`、`AppointmentsModule`
  - `src/modules/clinical/registrations/registrations.service.ts:12, 46-47` —— `RegistrationsService` 注入 `AppointmentsService` 与 `VisitsService`，并在 `startVisit()` 中跨服务调用
- **问题**：挂号（registration）是临床领域，预约（appointment）是排班领域。跨模块让测试时需要同时启动 `AppointmentsModule` + `VisitsModule`，且任何排班字段调整都会牵连 clinical。
- **建议**：
  1. 在 `common/services/` 下引入 `BookingContextService`（或领域事件）将"建立 Visit / 回填 Appointment.visitId"封装为统一接口；
  2. 短期可先在 `clinical/registrations` 内 `forwardRef` 懒加载，避免循环；
  3. 长期建议将"预约 → 挂号 → 就诊"合并为 `clinical/visits` 一个聚合根，由它统一编排。

#### P0-2. 抽象泄漏：服务中散落大量手写 SQL
- **统计**：跨 200+ 处 `this.dbService.prepare(...)` 散落在 `src/modules/**`（含 spec 文件）。
- **典型样例**（节选）：
  - `auth.service.ts:87, 102, 119, 137, 180, 186, 230, 255, 290, 303, 325, 329, 333` —— 14+ 处
  - `system/stats/stats.service.ts:60-251` —— 至少 18 处聚合 SQL
  - `system/operation-logs/operation-logs.service.ts` —— 整文件 100+ 行
  - `financial/refunds/refunds.service.ts:64, 80, 91, 122, 172, 178, 194, 199, 205, 210, 231, 248, 257` —— 13 处
  - `financial/charge/charge.service.ts:82-137, 158` —— `createCharge` 整段手写 `INSERT INTO Charge ... VALUES (...)` 与 `generateChargeNumber` 重复了 `BaseService.generateCode()` 的实现
  - `financial/member-cards/member-cards.service.ts:50-55, 76, 95, 128, 145, 175, 198, 230` —— 8 处
  - `clinical/medical-records/medical-records.service.ts`、`clinical/registrations/registrations.service.ts:55-70, 153-161, 178-179, 185-198` —— 6+ 处
  - `clinical/visits/visits.service.ts:28, 29, 38, 40, 84, 85` —— 6 处
  - `clinical/first-exams/first-exams.service.ts:63, 64, 76, 82, 93, 99, 107, 108, 116, 128, 136` —— 11 处
  - `system/health/health.controller.ts:52, 116, 201, 296, 318, 321` —— 6 处（健康检查控制器里写 SQL 也不合理）
  - `patients/patients.service.ts:80, 181, 199, 244`
- **根因**：`BaseService` 仅覆盖最常见的 CRUD（`create/findMany/findOne/update/remove/softDelete`），但实际业务频繁需要：
  1. 多字段联表聚合（`stats.service`）
  2. 事务内多步写入（`charge.service.createCharge`）
  3. 业务编号生成（`charge.service.generateChargeNumber`、`member-cards.service.create`）
  4. 关联子对象批量写入（`charge.service` 同时写 `Charge` + `ChargeItem`）
- **建议**：
  1. 在 `BaseService` 之上增加 **`AggregateService` 抽象**（提供 `aggregate` / `transaction` / `upsert` / `exec` 等），让"非纯 CRUD"的 SQL 仍然走 `common/services`，避免直接拿到 `DbService`；
  2. 把"事务 + 多表 + 审计"的样板下沉为 `withTransaction(fn)`、`withAudit(type, fn)` 高阶方法；
  3. 对 `member-cards`、`charge` 这类需要"自定义编号"的实体，提取 `codeGenerator` 策略对象，结束 `generateCode` 在多个 service 中复制的现状。

#### P0-3. 重复 Provider 声明
- **位置**：
  - `src/common/common.module.ts:13-20` —— `IdempotencyService` 已在 `@Global()` 的 `CommonModule.providers` 中导出
  - `src/modules/financial/charge/charge.module.ts:14` —— 再次声明 `IdempotencyService` 为 provider
  - `src/modules/financial/refunds/refunds.module.ts:8` —— 同样再次声明
- **问题**：在 NestJS 中，对同一 token 重复声明 provider 会**生成多个实例**，状态（`Map`）会分裂，幂等性失效。
- **建议**：从 `charge.module.ts` / `refunds.module.ts` 的 `providers` 中删除 `IdempotencyService`（已经能从 `common` 拿到）。

#### P0-4. 系统健康子目录缺少 Module 封装
- **位置**：`src/modules/system/health/` 下只有 `health.controller.ts`、`db-consistency.service.ts`、`db-consistency.service.spec.ts`，**没有** `health.module.ts`。
- **问题**：
  - `app.module.ts:18-19, 45-47` 绕过模块直接在 `controllers`/`providers` 注册 `HealthController` + `DatabaseConsistencyService`
  - 健康检查与其它 system 子模块处于"特殊公民"状态，破坏了"每个子目录配一个 module"的对称性
  - `system/index.ts`（barrel）没有 re-export 任何 health 符号，进一步加深"未完成感"
- **建议**：创建 `src/modules/system/health/health.module.ts` 注册 controller + service，然后：
  - `app.module.ts` 改为 `imports: [..., SystemModule, ...]`
  - `SystemModule.imports` 中追加 `HealthModule`
  - 删除 `app.module.ts:18-19, 45-47` 的直接注册

### P1 — 重要

#### P1-1. `IdempotencyService` 接口依赖 `transaction`，但 `BaseService` 不传 `db` 句柄
- **位置**：`src/common/services/idempotency.service.ts`（被 `charge-payment.service.ts`、`refunds.service.ts`、`charge.module.ts` 引用）
- **观察**：`charge-payment.service.ts` 中 `payCharge` 需要在事务内调用 `idempotency.tryRun`，因此把 `IdempotencyService` 注入到 service 中。这种"业务 service 拿幂等服务"的模式本身没问题，但 `IdempotencyService` 被注册了 3 次（P0-3），实际行为不可预测。
- **建议**：删除重复 provider 后，把"幂等 key 由 controller 注入、由 service 使用"标准化为 `@Idempotent(key: string)` 装饰器；或保留但 **统一通过 `@Global()` 注入**。

#### P1-2. `BaseService` 的"白名单列名 / 表名"机制绕过了类型系统
- **位置**：`src/common/services/base.service.ts:57-83, 88, 159-163, 247, 363, 453, 555-560`
- **问题**：`validateColumnName` / `validateTableName` 都是 **运行时** 正则校验；如果业务忘了配置 `searchFields/cascadeTables/moneyFields`，仍然可以"裸"调用 `BaseService.create({})` 直接写库，绕过了 sanitize。
- **建议**：
  1. 将 `searchFields` / `moneyFields` 改为必填参数（强制每个子类声明元数据）；
  2. 提供编译期 `dto → table` 映射生成器（基于 `db/schema/*.tables.ts` 自动推导），消除手写白名单。

#### P1-3. 控制器 / 服务循环引用
- **观察**：未发现明显的 `A → B → A` 循环，但 `clinical.module.ts` 既 import `scheduling/appointments` 又被 `clinical/registrations` 间接 import；将来 `AppointmentsModule` 若反过来引用 `clinical` 即构成循环。
- **建议**：在 `clinical.module.ts` 顶部加注释声明："禁止 scheduling 反向引用 clinical"；或使用 `forwardRef` + ESLint 规则 `no-restricted-imports` 强制单向。

#### P1-4. 测试 Helper 渗透到生产运行时
- **位置**：`src/common/test-helpers/mock-db-factory.ts`、`src/common/test-helpers/fault-injection.ts`、`src/common/test-helpers/concurrent-test-utils.ts`、`src/db/__mocks__/db-service.mock.ts`
- **观察**：
  - `__mocks__/db-service.mock.ts` 720 行实现了一个 mini SQL 引擎，**仅**给 spec 用；
  - `MockDbService` 通过正则解析 `WHERE/LIMIT/COALESCE/CASE WHEN`（`db-service.mock.ts:232-388, 668-703`），与生产 `BaseService` 行为只是"近似对齐"；
  - 5 个 spec 直接 import 这些 mock（`grep` 验证）
- **风险**：当生产 SQL 升级（如新增 `LEFT JOIN` / `JSON_EXTRACT` / `WINDOW`）而 mock 没跟上，**单测通过但集成失败**。
- **建议**：
  1. 把 `src/common/test-helpers/*` 与 `src/db/__mocks__/*` 移到 `test/` 顶层（保持 `src/` 纯净）；
  2. 对 mock 引擎加"不支持的 SQL 语法"断言，**主动失败**而不是悄悄走 fallback；
  3. 长期以真实 SQLite + `better-sqlite3` 内存模式（`:memory:`）替代自研 mock。

#### P1-5. `system/index.ts` barrel 不完整
- **位置**：`src/modules/system/index.ts:1-15`
- **问题**：
  - `system.module.ts` 实际 import：`SettingsModule, BackupsModule, OperationLogsModule, SearchModule, StatsModule, ClinicsModule`
  - `system/index.ts` 只 re-export 了 5 个子模块（漏 `clinics`、`health`）
  - 但既然 barrel 本身在生产路径中**未被任何文件 import**（`grep` 验证），它实际上是死代码
- **建议**：删除 9 个 `index.ts` barrel 文件（`auth` / `clinical` / `communication` / `content` / `financial` / `inventory` / `patients` / `scheduling` / `system`），或在 `tsconfig.json` 加 `"noUnusedLocals": true` 让编译器提示。

#### P1-6. `backup-manual` / `backup-auto` / `backups` 三个服务职责重叠
- **位置**：
  - `src/modules/system/backups/backup-manual.service.ts` (350 行)
  - `src/modules/system/backups/backup-auto.service.ts` (325 行)
  - `src/modules/system/backups/backups.service.ts` (65 行)
- **问题**：按"手动 / 自动"两个能力拆 service，但 `backups.service.ts` 仅做 wrapper，没有"自动调度触发器"实现；`backup-auto` 名字暗示调度但内容仍是"按需创建备份"。
- **建议**：合并为单个 `BackupsService` + `BackupStrategy`（manual/auto），将调度逻辑移到 `bootstrap/scheduler/`（或 NestJS `@Cron` 装饰器），service 只剩领域逻辑。

### P2 — 改进

#### P2-1. `AuthService` 是事实上的"用户管理 service"
- **位置**：`src/modules/auth/auth.service.ts` 343 行
- **观察**：`auth.service` 不仅处理登录/刷新，还承载了 `listUsers / createUser / updateUser / disableUser / changePassword / listDoctors` 等用户 CRUD 业务（行 80+ ~ 250+）。
- **建议**：将"用户管理"抽出到 `system/users/`（或新增 `modules/users/`），`auth/` 只保留 `LoginService`/`RefreshService`/`JwtStrategy`/`Guard` —— 与 RBAC 解耦。

#### P2-2. `ChargeController` 一个路由管 5 个聚合
- **位置**：`src/modules/financial/charge/charge.controller.ts` (140 行)
- **问题**：controller 注入了 `ChargeService + ChargePaymentService + DebtService + ComboService + PaymentMethodService`，违反了 SRP；前缀 `charge-v2` 是历史遗留命名（暗示 v1 已被废弃但保留？）。
- **建议**：
  1. 拆为 `ChargeV2Controller / DebtController / ComboController / PaymentMethodController`；
  2. `charge-v2` 改名为 `charges`，对齐 `charge-v2` API（前端也需同步）。

#### P2-3. 业务模块内部"小 service 群"未走子目录结构
- **观察**：`clinical/` 严格按子目录分模块（`first-exams/`、`medical-records/` 等），但 `financial/charge/` 把 5 个 service 摊在同层（`charge.service.ts` / `charge-payment.service.ts` / `debt.service.ts` / `combo.service.ts` / `payment-method.service.ts`）。
- **建议**：对齐 `clinical/` 风格：把 `debt.service` / `combo.service` / `payment-method.service` 各自下放为子目录（`debt/`、`combos/`、`payment-methods/`），各带 `*.module.ts`。

#### P2-4. `common/services/clinic-context.service.ts` 是隐式全局状态
- **位置**：`src/common/services/clinic-context.service.ts`（被 50+ service 注入）
- **观察**：`ClinicContextService` 实际是基于 `REQUEST` 作用域的 AsyncLocalStorage 容器；所有 service 都靠它拿 `clinicId`，但没人强制校验"调用前必须存在"。`BaseService` 在 `findMany/findOne` 里有 `ForbiddenException` 兜底，但每个绕开 `BaseService` 的 service（如 `auth.service`、`stats.service`）都需要自己复制 `clinicClause` 拼接逻辑。
- **建议**：
  1. 把 `buildClinicClause` 抽到 `common/utils/db/clinic-filter.ts`（已有），统一所有 service 直接调用；
  2. 强制要求"所有进入 db 层的 SQL 都必须走 `ClinicContext`"，可用 ESLint 自定义规则或 `BaseService` 包装器强制。

#### P2-5. `auth/jwt.strategy.ts` 与 `auth/jwt-auth.guard.ts` 的耦合
- **位置**：`src/modules/auth/jwt.strategy.ts` / `src/modules/auth/jwt-auth.guard.ts`
- **观察**：`JwtAuthGuard` 与 `JwtStrategy` 都注册为全局，但 `app.module.ts:48` 写的是 `useClass: JwtAuthGuard`，意味着"用 Guard 默认行为"，与 Strategy 的 `validate` 配合是通过 PassportModule 隐式完成。
- **建议**：保留但补单元测试；将 `JwtAuthGuard` 改造为显式 `useExisting: JwtAuthGuard`，避免重复实例化。

## 3. 圈复杂度高的服务（行数 > 200 或含 > 5 个手写方法）

> 行数从 `scripts/code-health.mjs` + PowerShell 统计综合得出。

| 服务 | 行数 | 评估 |
| --- | ---: | --- |
| `modules/system/health/db-consistency.service.ts` | 792 | **God class** —— 单一 service 注册 12+ 种一致性检查，每种都是独立函数 |
| `modules/system/backups/backup-manual.service.ts` | 350 | 多种备份策略 + 文件操作混在一起 |
| `modules/auth/auth.service.ts` | 343 | 同时承担 JWT、用户 CRUD、密码策略（见 P2-1） |
| `modules/system/backups/backup-auto.service.ts` | 325 | 与 `backup-manual` 90% 重复（见 P1-6） |
| `modules/financial/member-cards/member-cards.service.ts` | 306 | 含 create / recharge / consume / refund / log 五大子领域 |
| `modules/system/stats/stats.service.ts` | 297 | 17+ 个聚合方法，9 种返回类型 |
| `modules/inventory/processing-orders/processing-orders.service.ts` | 264 | 包含订单/产品/工厂/模板四个子域 |
| `modules/clinical/medical-records/medical-records.service.ts` | 262 | 同时管病历 / 病程 / 模板 / 修改申请（22 个技术债标记，top 1） |
| `modules/financial/refunds/refunds.service.ts` | 254 | 退款 + 会员卡扣减 + 欠款处理（事务复杂） |
| `modules/patients/patients.service.ts` | 250 | CRUD + 审计 + 复杂查询 |
| `modules/scheduling/appointments/appointments.service.ts` | 243 | 预约 + visit 关联 |
| `modules/system/settings/settings.service.ts` | 223 | 配置项 cache + 嵌套对象 |
| `modules/clinical/registrations/registrations.service.ts` | 214 | 状态机 + 跨服务调用（见 P0-1） |
| `modules/financial/charge/debt.service.ts` | 195 | 欠款 + 还款 + 联动 |
| `modules/inventory/purchase-orders/purchase-orders.service.ts` | 188 | 采购单 + 收货 |
| `modules/clinical/treatments/treatments.service.ts` | 180 | 治疗记录 + 牙位关联 |

## 4. God Class 候选（> 300 行 Service / > 100 行 Controller）

### 4.1 Service

| 文件 | 行数 | 类型 | 主要问题 |
| --- | ---: | --- | --- |
| `src/modules/system/health/db-consistency.service.ts` | 792 | 巨型类 | 12+ 种一致性检查函数，违反 SRP |
| `src/modules/system/backups/backup-manual.service.ts` | 350 | 巨型类 | 多策略混合 |
| `src/modules/auth/auth.service.ts` | 343 | 巨型类 | 认证 + 用户管理 + 密码 |
| `src/modules/system/backups/backup-auto.service.ts` | 325 | 巨型类 | 与 `backup-manual` 90% 重复 |
| `src/modules/financial/member-cards/member-cards.service.ts` | 306 | 巨型类 | 会员卡 5 个子域混合 |

### 4.2 Controller

| 文件 | 行数 | 评估 |
| --- | ---: | --- |
| `src/modules/system/health/health.controller.ts` | 334 | **应该被 service 接管**；内含 4 个 `check*` 私有方法 + SQL |
| `src/modules/financial/charge/charge.controller.ts` | 140 | 5 个 service 注入（见 P2-2） |
| `src/modules/auth/auth.controller.ts` | 131 | 9 个 endpoint，可接受 |
| `src/modules/inventory/processing-orders/processing-orders.controller.ts` | 119 | 可接受 |
| `src/modules/system/stats/stats.controller.ts` | 113 | 可接受 |
| `src/modules/clinical/medical-records/medical-records.controller.ts` | 111 | 可接受 |

### 4.3 重复 Provider 引起的 God Module
- `ChargeModule` 同时声明 `ChargeService / ChargePaymentService / DebtService / ComboService / PaymentMethodService / IdempotencyService` —— 6 个 provider 集中在同一 module

## 5. 死代码候选

### 5.1 未在 Module 中注册的 Controller

经检查，**未发现完全未注册的 controller**。但以下特殊情况需要关注：

| 文件 | 状态 | 原因 |
| --- | --- | --- |
| `src/modules/system/health/health.controller.ts` | 在 `app.module.ts:45` 直接注册，**绕过** `SystemModule` | 见 P0-4 |
| `src/modules/system/operation-logs/operation-logs.controller.ts` | 在 `OperationLogsModule.controllers` 注册 ✓ | OK |
| `src/modules/system/operation-logs/global-operation-log.interceptor.ts` | 在 `app.module.ts:52` 注册 ✓ | OK（这是 interceptor） |

### 5.2 未在 Module 中注册的 Service

| 文件 | 状态 |
| --- | --- |
| `src/modules/system/health/db-consistency.service.ts` | 在 `app.module.ts:47` 直接注册（**绕过 SystemModule**），见 P0-4 |

### 5.3 未被使用的 Export

| 路径 | 内容 | 状态 |
| --- | --- | --- |
| `src/modules/auth/index.ts` | 全部 export（module/service/controller/guard/strategy） | **未被任何文件 import**（`grep` 验证） |
| `src/modules/clinical/index.ts` | 全部 export | **未被任何文件 import** |
| `src/modules/communication/index.ts` | 全部 export | **未被任何文件 import** |
| `src/modules/content/index.ts` | 全部 export | **未被任何文件 import** |
| `src/modules/financial/index.ts` | 全部 export（**注意**：`charge.service` 也未在此处 export） | **未被任何文件 import** |
| `src/modules/inventory/index.ts` | 全部 export | **未被任何文件 import** |
| `src/modules/patients/index.ts` | 全部 export | **未被任何文件 import** |
| `src/modules/scheduling/index.ts` | 全部 export | **未被任何文件 import** |
| `src/modules/system/index.ts` | 部分 export（**漏** clinics、health） | **未被任何文件 import** |

> 上述 9 个 barrel 文件全部是 **死代码** —— 它们从未被 `import` 语句引用（仅在 `app.module.ts` 中直接 import 了各子目录的 `*.module`）。
>
> 额外问题：`financial/index.ts` 既无用，又漏了 `charge.service`（保留 barrel 但残缺）—— 暗示该 barrel 是历史遗留。

### 5.4 重复 / 冗余声明

| 位置 | 冗余内容 |
| --- | --- |
| `src/modules/financial/charge/charge.module.ts:14` | `IdempotencyService` 与 `common.module.ts:13` 重复 |
| `src/modules/financial/refunds/refunds.module.ts:8` | `IdempotencyService` 与 `common.module.ts:13` 重复 |
| `src/modules/system/clinics/clinics.module.ts:7` | `imports: [DbModule]`（`DbModule` 已 `@Global()`） |
| `src/modules/system/operation-logs/operation-logs.module.ts:8` | 同上 |
| `src/modules/system/settings/settings.module.ts:7` | 同上 |
| `src/modules/financial/member-cards/member-cards.module.ts:7` | 同上 |
| `src/modules/system/backups/backups.module.ts:11` | `exports: [..., AlertService]`（`AlertService` 已在 `common.module` 全局） |

### 5.5 `src/modules/equipment/` 缺失 index.ts
- `equipment/` 没有 `index.ts` barrel（其它 9 个主模块都有）—— 暗示 barrel 实际无人维护

## 6. 抽象层评估

### 6.1 `BaseService` 利用率
- ✅ **覆盖率**：28/39 ≈ 72% 的 service 继承 `BaseService`
- ❌ **未继承**（直接拿 `DbService` 写 SQL）：
  - `auth.service.ts`
  - `system/operation-logs/operation-logs.service.ts`
  - `system/backup-manual.service.ts`
  - `system/backup-auto.service.ts`
  - `system/backups/backups.service.ts`
  - `system/stats/stats.service.ts`
  - `system/settings/settings.service.ts`
  - `system/health/db-consistency.service.ts`
  - `system/search/search.service.ts`
  - `financial/charge/charge-payment.service.ts`
  - `content/drug-catalog/drug-catalog.service.ts`
- ⚠ **继承但仍直接 `prepare`**：
  - `patients.service.ts`、`clinical/*`（4 个）、`financial/refunds`、`financial/member-cards`、`financial/charge/charge.service`、`content/tooth-records.service.ts`、`inventory/*`（4 个）

### 6.2 `db/__mocks__/db-service.mock.ts` 评价
- ⚠ **过度自研**：720 行手写 SQL 解析器，只支持 `WHERE` / `LIMIT` / `COALESCE` / `CASE WHEN` / `IN` / `LIKE` 子集
- ⚠ **生产 SQL 演进**时（如新增 `JSON_EXTRACT`、`WITH` 子句）会**静默**走 fallback，导致"单测通过、集成失败"
- ✅ 在 spec 中确实有 5 处使用

### 6.3 `common/utils/db/clinic-filter.ts`
- ✅ 存在且被 `BaseService` 与 `stats.service` 使用
- ⚠ 但 `charge.service`、`registrations.service`、`tooth-records.service` 仍**重复**用 `${clinicClause}` 字符串拼接，没有走 `buildClinicFilter()` 工具

## 7. 架构改进建议（按 ROI 排序）

| # | 建议 | 工作量 | 收益 |
| --- | --- | ---: | --- |
| 1 | 删除 9 个未使用的 `index.ts` barrel | 0.5h | -200 行死代码 |
| 2 | 解决 `IdempotencyService` 重复 provider | 0.5h | 修复潜在状态分裂 bug |
| 3 | 给 `system/health/` 加 `health.module.ts`，移除 `app.module.ts` 的特例注册 | 1h | 架构对称性 + 简化 `app.module.ts` |
| 4 | 把 `system/clinics/operation-logs/settings/member-cards` 中的 `imports: [DbModule]` 全部删除 | 0.5h | 减冗余 |
| 5 | 合并 `backup-manual` / `backup-auto` / `backups` 三个 service | 4h | -600 行重复 |
| 6 | 把 `BaseService` 升级为 `BaseService` + `AggregateService`，下沉 SQL 模板 | 1-2 周 | 终结 SQL 散落（消灭 P0-2 70%） |
| 7 | 抽 `codeGenerator` 策略对象，结束 `generateChargeNumber` / `generateCode` 复制 | 1d | -80 行 |
| 8 | 把 `AuthService` 拆为 `AuthService` + `UsersService` | 2d | SRP |
| 9 | 拆 `ChargeController` 为 5 个 controller | 2d | SRP |
| 10 | 解除 `clinical → scheduling` 跨模块依赖（用 `forwardRef` 或领域事件） | 1 周 | 解除最严重跨模块耦合 |
| 11 | 用真实 `:memory:` SQLite 替代自研 `MockDbService` | 2 周 | 消除 mock 漂移 |
| 12 | 用 ESLint `no-restricted-imports` 禁止 `src/common` import `src/modules` | 0.5h | 长期架构纪律 |

## 8. 总结

`apps/api` 项目整体架构是 **典型的 NestJS 模块化布局**：

- ✅ 单向依赖（`modules → common → db`）保持得较好
- ✅ `BaseService` 抽象覆盖 72% 业务
- ✅ 多租户（`ClinicContext`）+ 软删除 + 审计日志已体系化
- ❌ 跨领域耦合（`clinical/registrations` 直接拿 `scheduling/appointments`）
- ❌ 抽象泄漏（大量 `prepare()` SQL 散落在 service 与 controller）
- ❌ 死代码（9 个未使用 barrel + `IdempotencyService` 重复注册）
- ❌ 巨型类（`db-consistency.service.ts` 792 行、`backup-manual` 350 行、`auth.service.ts` 343 行）
- ❌ 架构特例（`system/health/` 没有 module，靠 `app.module.ts` 直注册）

按 P0/P1/P2 优先级实施上表 7-12 项工作，可在 **2-3 周内** 显著提升可维护性与可测试性。

---

*报告生成于 2026-07-24，基于 `npm run health` + 静态分析 + 模块拓扑扫描；不涉及代码改动。*
