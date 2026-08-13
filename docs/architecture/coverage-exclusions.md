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
| （暂无新登记——历史 525 处待四批清理计划处理） | | |

## 5. 其他已知取舍

- 质量分公式不含 lint/typecheck/安全扫描分项（这些是独立硬门禁，非指标）。
- `pnpm verify` 现包含 mutation（约 13 分钟）与 quality-score、v8-ignore ratchet，
  本地全量 verify 耗时显著上升；快速迭代可用 `verify:critical`（typecheck+test+build）。
