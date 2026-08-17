# 全局优化审查 — Server 与 Domain

> 范围：`apps/v2/src/server` 与 `apps/v2/src/domain`
> 方法：grep 统计反模式 + 重点文件精读（repository / database / charge / member-discount / commission / treatment-plan-billing / edit-save / refund-flow / sync / backup / idempotency / files / auth / router / resources）。
> 结论先行：这是一个成熟度高、护栏充分的代码库。多数风险已通过参数化 SQL、CAS 乐观锁、事务、幂等键、租户过滤与架构守卫测试覆盖。以下发现的优先级按「真实影响」排序，高优先级仅 2 条为可复现的正确性边界。

## 1. 高优先级（正确性/性能/安全）

### 1.1 治疗计划「edit-save」路径绕过划价锁定，可篡改已划价计划的金额/状态
- `apps/v2/src/server/application/service-modules/edit-save.ts:82-86`
- 问题：`saveTreatmentPlan` 无条件 `UPDATE TreatmentPlan SET totalFee=?, status=?, ...`，缺少「存在已划价明细（billed=1）即拒绝」的守卫。而同一字段在另外两条路径都被显式锁定：
  - `treatment-plan-billing.ts:147-150`（`setPlanDiscount` 用 `AND NOT EXISTS (SELECT 1 FROM TreatmentPlanItem i WHERE i.planId=TreatmentPlan.id AND i.billed=1 ...)`）
  - `router.ts:256-266`（通用 PATCH 在存在 billed 明细时 `throw ConflictError('治疗计划已划价，费用与状态字段不可修改')`）
- 影响：计划一旦产生过划价单（Charge），仍可通过 `PATCH /api/v2/treatment-plans/:id/save` 修改 `totalFee` 与 `status`，使「计划金额」与「已生成账单金额」脱节，破坏财务凭证一致性；同一计划两个写入口的规则不一致。
- 建议：在 `saveTreatmentPlan` 的主表 UPDATE 里并入同样的 `AND NOT EXISTS(billed=1)` 守卫（失败抛 ConflictError），与 `setPlanDiscount`/通用 PATCH 三处对齐。

### 1.2 会员折扣 ROUND 取整可令报价总价超过原价、优惠为负
- `apps/v2/src/server/application/service-modules/member-discount.ts:99-103` 与 `238-240`
- 问题：`roundTotal(rawTotal, 'ROUND') = Math.round(rawTotal / 100) * 100` 按「整元」四舍五入。当 `baseTotal` 的「分」部分 ≥ 50 且折扣极小/为零时，取整向上会越过原价：
  - 例：`baseTotal=199`（¥1.99）、折扣率 100%（或 `maxDiscountAmount=0`）→ `discount=0`、`rawTotal=199` → ROUND 得 `200` → `finalDiscount = 199 - 200 = -1`，返回 `total=200 > baseTotal`。
- 影响：报价口径下「优惠金额为负、应付超过原价」，属金额口径一致性缺陷（医疗收费敏感）。
- 建议：`const total = Math.min(baseTotal, roundTotal(rawTotal, roundingMode))`，并断言 `finalDiscount >= 0`。

## 2. 中优先级（健壮性/一致性）

### 2.1 提成计算按整月 Charge 构造无上限 `IN (?,...)`
- `apps/v2/src/server/application/service-modules/commission.ts:158-164`
- 问题：`calculate()` 先取全月 `Charge` 行，再 `chargeId IN (${chargeIds.map(()=>'?')})` 一次性查询明细。高流水诊所单月收费单可能超过 SQLite 参数变量上限（better-sqlite3 默认 `SQLITE_MAX_VARIABLE_NUMBER` ≈ 32766），触发 `too many SQL variables`，整月提成计算 500。
- 影响：大批量场景可用性；整月数据一次性载入内存也偏重。
- 建议：按 500~1000 条/批分批查询，或改为 `JOIN ChargeItem ON ChargeItem.chargeId = Charge.id` 的子查询/窗口聚合。

### 2.2 患者身份证/手机号在通用列表全量明文返回给全部临床角色
- `apps/v2/src/domain/resources/core.ts:35`（`idCard` 无脱敏声明）+ `apps/v2/src/server/infrastructure/security.ts:42-44`（注释明确业务 PII 不掩码）
- 问题：`patients` 资源 `roles: reception`（BOSS/ADMIN/DOCTOR），通用 `findMany`/`findById` 仅经 `maskSensitiveFields`（只掩码凭据字段），`idCard`（身份证号）、`phone`、`wechatId` 全文返回；仅在 CSV 导出（`router.ts:338-342`）与审计落库（`maskAuditFields`）脱敏。
- 影响：数据最小化不足——任意医生可见全部患者完整身份证号，超出诊疗所需。
- 建议：列表响应对 `idCard` 做「保留后 4 位」脱敏，完整值收敛到带审计的专用详情/编辑端点；`phone` 可沿用现有 `maskPhoneForExport` 思路。

### 2.3 专用列表路由普遍使用 OFFSET 深分页，未复用 keyset 游标
- `dispense.ts:191`、`refund-flow.ts:50`、`stocktake.ts:101`、`purchase-review.ts:66`、`narcotic-registry.ts:55`、`follow-up-service.ts:191`、`hr.repository.ts:30`、`alerts.repository.ts:24`
- 问题：通用仓储 `repository.ts:215-318` 已实现 keyset/游标分页（`v:` 游标 + 复合游标 + 多取一行判 truncated），但大量专用列表仍 `LIMIT ? OFFSET ?`，页码深时退化为全表扫描。
- 影响：大库下列表页越翻越慢（深分页性能）。
- 建议：统一抽取 keyset 分页工具并推广到这些专用列表；至少补 `(clinicId, createdAt)` 复合索引配合 OFFSET。

### 2.4 edit-save 保存治疗计划不重算总额，`totalFee` 完全信任客户端
- `apps/v2/src/server/application/service-modules/edit-save.ts:69-71,82-86`
- 问题：`totalFee` 由客户端传入并直写，未按明细重算；与 `TreatmentPlanBillingService.reconcilePlanTotal`（`treatment-plan-billing.ts:196-204`）口径不一致。通用 PATCH 在明细变更后会 `reconcilePlanTotal`，edit-save 路径不会。
- 影响：计划总价与明细小计之和可长期不一致，影响后续划价/报价展示。
- 建议：未划价场景在 `saveTreatmentPlan` 事务末尾调用 `reconcilePlanTotal`（或等价重算），划价后场景被 1.1 的守卫拒绝。

### 2.5 微信提醒生成在事务内逐候选 `exists` 查询（有界 N+1）
- `apps/v2/src/server/application/service-modules/wechat-reminder.ts:322,336,349`
- 问题：`generateDue` 三个场景各按 keyset 分批，但批内对每个候选调用一次 `exists.get(...)`（`SELECT 1 ... LIMIT 1`），每批最多 1000 次，单日生成等于 3×N 次查询（全部在同一事务内）。
- 影响：大库 + 多候选诊所的每日首次生成延迟偏高；有界（WECHAT_REMINDER_LIMIT=1000/批），非无界放大。
- 建议：批量载入当日已存在 `(patientId,scene,sourceId)` 键集合后内存判重，或依赖唯一索引 + `INSERT OR IGNORE` 去掉逐行 `exists`。

## 3. 低优先级（打磨/维护）

### 3.1 时区偏移魔法数字硬编码 `+08:00`
- `apps/v2/src/server/http/read-routes.ts:150-151`
- 问题：`new Date(`${date}T00:00:00+08:00`)` 硬编码 +8，与 `domain/contracts/shared.ts:7` 的 `CLINIC_TZ_OFFSET_HOURS=8` 存在双源。
- 建议：改用 `clinicDayStartUtc/clinicDayEndUtc`（`infrastructure/clock.ts:22-37`）。

### 3.2 临床工作流仓储动态表名拼接
- `apps/v2/src/server/infrastructure/repositories/clinical-workflow.repository.ts:12,19`
- 问题：`getRow(table,...)`/`updateStatus(table,...)` 直接 `${table}` 拼接 SQL；当前所有调用方（`clinical-workflow.ts:19,59,81,103,127`）均为硬编码字面量，无注入。
- 建议：加表名白名单断言（`new Set(['Registration','Visit','FirstExam','Treatment','MedicalRecord'])`）以防未来调用方误传用户输入。

### 3.3 seed 打印开发管理员临时密码到控制台
- `apps/v2/src/server/infrastructure/seed.ts:70`
- 问题：`console.warn('[seed] development admin temporary password: ...')` 输出明文临时密码，若日志被采集会长期留存。
- 建议：改为仅写入受限文件/一次性提示，避免进入日志管道。

### 3.4 文件公共签名 GET 无 clinicId 复核
- `apps/v2/src/server/http/routes/files.ts:56-58`
- 问题：公共签名路由 `SELECT id FROM FileRecord WHERE filename = ? AND deletedAt IS NULL` 不校验 clinicId（受保护 GET 与 `/sign` 均校验）。当前靠 HMAC 签名持有即授权，属设计取舍。
- 建议：可接受；若要收紧，把签名键纳入 `clinicId` 维度或加租户复核。

### 3.5 患者多张 ACTIVE 会员卡时按 `LIMIT 1` 隐式选卡
- `apps/v2/src/server/infrastructure/repositories/member-card.repository.ts:38-41` + `charge.service.ts:265`
- 问题：`findByPatient` 用 `status='ACTIVE' ... LIMIT 1`，未加 `ORDER BY`，多卡时选哪张取决于插入顺序，会员卡支付/退款可能命中非预期卡。
- 建议：显式 `ORDER BY createdAt ASC` 或在多卡场景抛 ConflictError 要求指定卡。

### 3.6 双 import 同行（格式/一致性）
- `apps/v2/src/server/main.ts:4`
- 问题：`import Database from 'better-sqlite3';import { createApp } from './http/app';` 两语句同行，易被 lint 工具波动误报。
- 建议：拆为两行。

## 4. 正面结论

- **SQL 注入面极小**：全部参数化（`?`），动态片段仅来自资源元数据白名单（`repository.ts:67-89` 的 relation JOIN）或调用方字面量表名；`buildFtsQuery` + `ESCAPE '\'` 处理 LIKE。
- **金额口径统一**：领域类型 `Cents`（`contracts/shared.ts:6`），`validation.ts:104-121` 强制安全整数 + `MAX_MONEY_CENTS` 上限，业务层 `Math.round` 取整并多处做分摊溢出回退（`commission.ts:380-388`）。
- **时区口径统一**：`SystemClock.clinicDate` + `CLINIC_TZ_OFFSET_HOURS=8`，统计/提醒按 `+8 hours` 归属（`stats-service.ts:81-82`、`member-discount.ts:224-226`、`follow-up-service.ts:308`）。
- **并发正确性**：金额/库存/状态均用 CAS（`charge.repository.ts:82-85,94-96` 的 `paidAmount/refundedAmount` 乐观锁；`member-card.repository.ts:61-64` 的 `balance >= ?`；`dispense-stock.ts:51` 的 BEGIN IMMEDIATE + 复读；`sync.ts` / `wechat-reminder.ts:359` / `follow-up-service.ts:300` 的 `run.immediate()`）。
- **幂等覆盖广**：`charge.pay/refund`、`debt`、`member-card`、`purchase/processing-order`、`inventory`、`dispense`、`inventory-batch`、`workflow`、`cephalometric`、通用 CRUD 均走 `withIdempotency`（键含 operation+resourceId+user+clinic+requestId+bodyHash）。
- **状态机双保险**：`STATE_MACHINE_PROTECTED_WRITE_FIELDS`（`security.ts:115-139`）阻断通用 CRUD 直写状态，专用服务用 `changes===0` CAS 强制合法迁移（`refund-flow.ts` 的 REQUESTED→PENDING_REFUND→COMPLETED 全程守卫）。
- **资源注册表一致性有测试守护**：`architecture.spec.ts` 强制服务模块 ≤450 行、财务/库存资源只读、ADMIN↔BOSS 角色对齐、搜索索引↔注册表对齐、clinicId 过滤不遗漏、同步表写路径必须记 SyncChange。
- **备份/恢复安全完备**：AES-256-GCM 加密、HMAC restore marker、WAL checkpoint(TRUNCATE) 后校验无侧车、clinic 归属校验（`backup.ts` / `restore-apply.ts` / `sqlite-files.ts`）。
- **租户隔离全面**：`tenantAnd/tenantParams` 贯穿所有查询，`authMiddleware` 运行时校验 clinic 成员关系（`middleware.ts:96-98`），JWT 中 clinicId 失效即 403。
- **进程健壮性**：优雅关闭（`main.ts:462-479`）、孤儿进程守卫（`main.ts:80-159`）、崩溃审计冲刷、迁移失败自动回滚快照（`main.ts:314-332`）。

## 5. Top 5 建议

1. **修 edit-save 划价锁定缺口**：`edit-save.ts:82` 的 `saveTreatmentPlan` 加 `AND NOT EXISTS(billed=1)` 守卫，与 `treatment-plan-billing.ts:147` / `router.ts:256` 三处统一。
2. **修 ROUND 取整超收边界**：`member-discount.ts:239` 用 `Math.min(baseTotal, roundTotal(...))` 兜底，禁止 `total > baseTotal` 与负 `finalDiscount`。
3. **提成计算 IN 分批**：`commission.ts:161` 按批（≤1000/批）查询 `ChargeItem`，消除 SQLite 变量上限与内存峰值。
4. **患者敏感字段列表脱敏**：`core.ts:35` 的 `idCard`/`phone` 在通用列表脱敏（保留尾号），完整值收敛到专用带审计端点。
5. **专用列表路由统一 keyset 游标**：把 `repository.ts:215-318` 的游标分页抽成公共工具，替换 `dispense/refund/stocktake/purchase-review/narcotic-registry/follow-up` 等处的 `LIMIT/OFFSET`。
