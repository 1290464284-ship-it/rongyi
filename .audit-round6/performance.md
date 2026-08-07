# 第六轮全面深度审计 · 性能子报告

- 审计对象：`apps/v2/src/server/`（后端）与 `apps/v2/src/web/`（前端）
- 基线：branch `codex/v2-full-optimization`，HEAD `dcca390`
- 方法：源码通读（grep/read）+ 对开发库 `apps/v2/v2.sqlite`（migration 145，纯 v2 索引）与遗留库 `apps/v2/data/v2.sqlite`（71 迁移，遗留索引）做只读 `EXPLAIN QUERY PLAN` / `sqlite_master` 对照验证
- 范围说明：第五轮已修复项（启动路径、backup cleanup 顺序、staged TTL、dispense 单事务化、迁移 146 的 7 个索引）未重复复核，已确认存在于迁移清单（migrations.ts:1321-1367）
- 结论：本轮无 P0/P1；P2 × 7、P3 × 8（其中 P2-4 为索引缺口组，含 4 张表）

---

## 1) 新发现清单

### P2（中等，值得在下轮修复）

#### P2-1 `batchGenerate` 循环内单条查询 + 单事务放大（N+1）
- 证据：`apps/v2/src/server/application/service-modules/operations.ts:250-333`
  - `:255-268` 外层 `SELECT DISTINCT V.patientId ... FROM Visit V INNER JOIN Treatment T ON T.visitId = V.id WHERE V.status='COMPLETED' AND T.status='COMPLETED' ... LIMIT ≤200`（Treatment.visitId 无索引，见 P2-4）
  - `:279-288` `alreadyExists()` 每次调用现 prepare 一条 `SELECT 1 FROM FollowUp WHERE patientId=? AND planDate=? ... LIMIT 1`
  - `:290-324` 整段循环包在**单个** `db.transaction()` 中：最坏 `rows(200) × templates(20) = 4000` 次 alreadyExists SELECT + 4000 次 INSERT（`SqliteFollowUpRepository.insert`，core.repositories.ts:501-515，纯 INSERT 无 FTS 放大）
- 影响：手动端点 `POST /api/v2/follow-ups/batch-generate`（workflow.ts:345-346，有 batchLimiter），但一次触发可产生约 8000 条语句的单一写事务，期间长时间持有写锁，阻塞同库所有读写；limit 参数可被客户端直接调到 200。
- 建议：单条 `INSERT ... SELECT ... WHERE NOT EXISTS` 或先一次性查出已存在 (patientId, planDate, templateId) 集合做内存判重；或将事务拆小（按 patient 或按 100 条一批）。

#### P2-2 `sync.push` 每变更构造 Repository + 无变更总数上限
- 证据：`apps/v2/src/server/application/service-modules/sync.ts:88-178`
  - `:124` 每个 change `new SqliteRepository(...)` → 构造函数执行 `PRAGMA table_info`（repository.ts:79-82），一次 push 内反复内省同一批表
  - `:88` 仅按 500/批切事务，`payload.changes.length` **无总量上限**，设备可一次推送任意多条
  - 每变更语句数 6-8 条：findById（repository.ts:91）+ insert/update 内 assertRelations 每关系字段 1 条 SELECT（repository.ts:184/211/273-286）+ INSERT/UPDATE + searchIndexResource 表的 FTS DELETE+INSERT（repository.ts:192/223）+ SyncChange INSERT（sync.ts:203-207）
- 影响：万级变更的 push 约等于 10k 次 PRAGMA + 6-8 万条语句；单用户桌面场景偶发，但无上限属结构性风险，恢复/首次全量同步时明显卡顿。
- 建议：限制 `payload.changes.length`（如 ≤5000 并分批返回游标）；按表缓存 Repository（或把 PRAGMA 结果缓存进 Map）。

#### P2-3 每次 Patient PATCH 触发子表搜索索引全量刷新
- 证据：`apps/v2/src/server/infrastructure/repository.ts:224` → `refreshPatientChildSearchRows`（search-index.ts:64-74）
  - 每表 `PRAGMA table_info`（3 次）+ `SELECT id ... WHERE patientId=?`（3 次）+ 每子行 `upsertSearchRow` = DELETE + INSERT 两条 FTS 语句（search-index.ts:55-56）
  - 触发面：任意 Patient 字段更新（改电话、地址、备注等）都会执行
  - 另：每次写操作（insert/update/softDelete）都会 `hasSearchIndex()` 查一次 `sqlite_master`（search-index.ts:45-49、repository.ts:192/223/245）
- 影响：病史长、收费多的患者（如 300 Charge + 100 Appointment + 50 FollowUp）一次保存触发约 900 条 FTS 语句；患者资料编辑是最常用操作之一。
- 建议：Patient 更新仅当搜索相关字段（name/code/phone）变化时刷新子行；将 `hasSearchIndex` 结果做成进程级缓存。

#### P2-4 v2 迁移索引缺口（fresh/restore 库全表扫描；遗留导入库被 `idx_*` 旧索引部分掩盖）
验证方式：`apps/v2/v2.sqlite`（仅 v2 迁移索引）与 `apps/v2/data/v2.sqlite`（遗留索引）双库 `sqlite_master` 对照；`EXPLAIN QUERY PLAN` 实测。

| 表 | v2 迁移索引 | 实际热点查询（证据） | 影响 |
|---|---|---|---|
| **Treatment** | 无（0 个） | `INNER JOIN Treatment T ON T.visitId=V.id`（operations.ts:257-268）；`COUNT(*) FROM Treatment WHERE patientId=?`（core.repositories.ts:589） | 每次 batchGenerate 全表扫描；患者治疗计数全表扫描 |
| **FirstExam** | 无（0 个） | 概览 `GROUP BY followUpStatus ... WHERE clinicId`（first-exam-tracking.ts:72-84）；到期统计 `followUpStatus IN (...) AND nextFollowUpAt LIKE`（:90-94）；每日 `substr(createdAt,1,10)=?` 扫描（wechat-reminder.ts:204-212） | 初诊跟踪页每次加载全诊所扫描；每日提醒生成全表扫 |
| **Registration** | 仅 `(clinicId, departmentId, status)` | 看板 `registeredAt LIKE ? AND status!='CANCELLED'`（workbench.ts:43-48、:65-68） | 前台看板每加载全诊所扫描；缺 `(clinicId, registeredAt)` |
| **Visit** | 仅 `(doctorId)`、`(patientId)` | 看板 `status='IN_PROGRESS' AND startTime LIKE`（workbench.ts:75-77）；召回 `status='COMPLETED' AND substr(endTime)=?`（wechat-reminder.ts:195-201） | 看板/召回全诊所扫描；缺 `(clinicId, status)` 或 `(clinicId, startTime)` |

- 遗留导入库（生产主路径）存在 `idx_treatment_*`、`idx_visit_clinic/status`、`idx_registration_clinic*`、`idx_first_exam_*` 等旧索引，会掩盖上述缺口；但新建库、从 v2 备份恢复、测试/CI 环境（无遗留索引）将直接退化为全表扫描。`idx_v2_*` 迁移清单见 migrations.ts:101-146；实测 `EXPLAIN QUERY PLAN`：遗留库 1-4 号查询均走旧索引（SEARCH ... USING INDEX idx_*），v2 库同名查询无索引可用。
- 建议：迁移 147 显式补齐 4 个索引（Treatment(visitId)、Treatment(patientId)、FirstExam(clinicId, followUpStatus)、Registration(clinicId, registeredAt)、Visit(clinicId, status)），与遗留索引共存无冲突（IF NOT EXISTS）。

#### P2-5 BulkImport 双重 FTS 维护（逐行 upsert + 末尾全量重建）
- 证据：`apps/v2/src/server/application/service-modules/clinical-ops.ts:128-182`
  - `:155` 每行 `repository.insert` → searchIndexResource 表逐行 `upsertSearchRow`（repository.ts:192）
  - `:179` 结束后无条件 `rebuildSearchIndex(this.db)` → `DELETE FROM SearchIndex` + 全量重建 6 类资源（search-index.ts:76-109）——即使导入的是无搜索索引的资源（如 DrugCatalogItem）也触发
- 影响：10k 行导入 = 10k×（逐行 FTS 维护）+ 一次全量 FTS 重建（患者/收费/预约量大时重建本身耗秒级）；两段逻辑重复做同一件事。
- 建议：`rebuildSearchIndex` 仅对 searchIndexResource 资源导入后保留（或整批末尾一次性重建并跳过逐行 upsert，二选一）。

#### P2-6 SyncChange 无定时清理，表无限增长
- 证据：`scheduler.ts:5-116` 仅有 backup / audit cleanup（365 天，:86-91）/ idempotency cleanup（:96-101）三个任务，**无 SyncChange 任务**；清理只存在于手动 API `POST /api/v2/sync/cleanup`（system.ts:31-34 → sync.ts:213-220，默认 90 天 cutoff）
- 影响：系统每次写操作都会 `recordSyncChange` 落一行（repository.ts:193-195/225-227/246-248 等），长期运行磁盘/备份体积持续增长，pull 的 `LIMIT 1000` 扫描窗口也随之变宽（sync.ts:47-58）。
- 建议：scheduler 增加月度 SyncChange 清理（复用 sync.cleanup 逻辑，≥90 天）。

#### P2-7 每请求同步日志写盘（事件循环阻塞）
- 证据：`apps/v2/src/server/infrastructure/logger.ts:108-129`：`fs.existsSync` + `fs.statSync` + `fs.appendFileSync`（超限时还有最多 4 次 `fs.renameSync` 轮转）；`apps/v2/src/server/http/app.ts:307-321` 每个 HTTP 请求 `res.on('finish')` 写一条 request 日志
- 影响：所有 API 请求（含高频只读轮询）都在事件循环上同步做 stat+append；Windows 下 appendFileSync 每次打开/写入/关闭文件，单次约数十到数百 µs 的阻塞放大到每次请求。
- 建议：请求日志改异步（fs.promises 追加队列）或按秒批量写；轮转判断移出热路径。

### P3（轻微，可随下轮顺手处理）

#### P3-1 auth 中间件每请求 3 次 DB 查询（含 1 次重复）
- 证据：`middleware.ts:65-76`：`getUserById`（auth.ts:187-192 → findById）+ `isClinicAccessible`（auth.ts:177-185 → 再次 findById + clinicMemberships），同一用户同一请求查了 2 次 findById
- 影响：均为 PK 点查，单请求开销小；但每请求多 1 次冗余查询，可合并。

#### P3-2 idempotency 写路径懒清理
- 证据：`idempotency.ts:34` 每个 `withIdempotency` 写操作前置 `DELETE FROM IdempotencyRecord WHERE expiresAt <= ?`（有 `idx_v2_idempotency_expiry`，成本低）；每日 cleanup（idempotency.ts:122-128）只清非 COMPLETED，COMPLETED 过期行完全依赖写路径懒删除
- 影响：写操作固定多一条 DELETE；COMPLETED 表行在无写流量时不被回收。

#### P3-3 appointments/by-date 无 LIMIT
- 证据：`read-routes.ts:135-148`：`SELECT ... WHERE startTime BETWEEN ? AND ? ORDER BY startTime ASC` 无 LIMIT（索引 `idx_v2_appointment_clinic_start` 可收敛范围，但单日预约量大时响应体无上限）
- 影响：看板单日数据通常几百行内，风险低。

#### P3-4 PurchaseOrderService.create 循环内点查校验
- 证据：`financial.ts:589-606`：`items.map` 中每 item `inventoryRepository.findItem`（≤500 次点查，PK 索引）
- 影响：≤500 次 PK 查询，可接受；批量建单时可改为 `id IN (...)` 一次取回。

#### P3-5 ChargeComboItem(comboId) 无索引
- 证据：`charge-combo.ts:73-78` `itemsOf(comboId)` 全表扫描；v2 迁移与遗留库均无 comboId 索引（dev 遗留库仅有 `idx_charge_combo_item_clinic_combo`）
- 影响：组合项每套组合通常数行，量小；开单时每次全表扫。

#### P3-6 TreatmentPlan / Imaging / Debt 按 patientId 列表无索引
- 证据：三表 v2 迁移索引分别只有：无 / `(categoryId)`（migrations.ts:1236）/ `(chargeId)`（migrations.ts:1311）；通用 `findMany` 按 `patientId=?` 过滤时全表扫（repository.ts:116-121、148-158）；Debt 连遗留库都无任何索引（实测）
- 影响：患者详情时间线/欠费列表等按患者过滤时全诊所扫描；行数中等偏小，风险有限。

#### P3-7 WechatReminder 存在性检查无索引
- 证据：`wechat-reminder.ts:217-223` `(patientId, scene, scheduledDate, sourceId)` 无索引（listPending 已由 `idx_v2_wechat_reminder_due` 覆盖）
- 影响：每日生成时每候选 1 次小扫描 + LIMIT 1；量小。

#### P3-8 MedicalRecord(patientId) 非前导列
- 证据：仅 `(clinicId, createdAt)`（migrations.ts:1304），患者病历时间线按 `patientId=? ORDER BY createdAt DESC LIMIT 50`（repository.ts:152-158 通用路径）需沿 createdAt 索引扫描过滤
- 影响：病史长的患者可能扫描较多行；分页 LIMIT 50 收敛，风险低。

> 低风险备注（无需行动）：ToothRecord / ShiftTemplate / InventoryReplenishmentSuggestion / CephalometricCase 亦无 v2 索引，但按 id/点查为主且行数极小。

---

## 2) 正面确认清单

1. **分页与查询上限健全**：`MAX_PAGE_SIZE=200`（pagination.ts:9、repository.ts:102）；`sync.pull` `LIMIT 1000` + `(createdAt, rowid)` 复合游标不丢变更（sync.ts:47-58）；SearchService FTS `LIMIT 500`（read-services.ts:177-181）。
2. **统计缓存合理**：StatsService 30s TTL + FIFO 200 上限（read-services.ts:8-27）；rate-limit Map 上限 10k 窗口并淘汰最旧（rate-limit.ts:24-35）。
3. **批量写均有批事务/上限**：sync push 500/批（sync.ts:88-89）、BulkImport chunk ≤1000（clinical-ops.ts:144-147）、replenishment ≤500、inventory-docs ≤200 items（inventory-docs.ts:126/170）。
4. **核心财务写路径为纯内存校验**：`financial.ts:88-105` 创建收费时逐项校验不查库（点查仅为 patient/doctor/visit 存在性，各 1 次）。
5. **前端产物健康**：route-level code splitting（dist-web 各页面 chunk 2-20KB，总包约 700KB 未压缩，react-vendor 227KB 为最大单体）；react-query 全局 staleTime 30s / gcTime 5min（main.tsx:13-14），ResourcePage staleTime=Infinity；搜索防抖 300ms；useAsyncAction 防重入（use-async-action.ts）。
6. **文件级导入/恢复无逐行性能问题**：legacy-import.ts / restore-apply.ts 均为 SQLite 文件复制 + 完整性校验，非逐行 ETL。
7. **索引设计大体成体系**：迁移 145（migrations.ts:1299-1316）与 146（:1321-1367）已覆盖 Appointment(clinicId,startTime)、Charge(clinicId,createdAt/paidAt)、ChargeItem(chargeId)、Refund(chargeId)、Dispense/DispenseItem、PaymentLedger、InventoryTransaction 报表、PrescriptionItem、ProcessingOrderItem、Attendance 等高频路径。

---

## 3) 一句话总结

本轮未发现 P0/P1 级问题，共 7 个 P2（batchGenerate N+1 单事务、sync push 无上限+每变更 PRAGMA、Patient 子表 FTS 全量刷新、Treatment/FirstExam/Registration/Visit 索引缺口、BulkImport 双重 FTS 重建、SyncChange 无定时清理、每请求同步日志写盘）与 8 个 P3，建议下轮优先做"索引补齐迁移 + 写路径去重（子表 FTS/PRAGMA/日志异步）"。
