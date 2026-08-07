# Round 7 后端深度审计报告

- 审计范围：`apps/v2/src/server/`（http 全部 + infrastructure 全部 + application 全部）与 `apps/v2/src/domain/`（resources/contracts）
- 审计日期：2026-08-07
- 审计方式：静态阅读 + 交叉验证（迁移/路由注册/前端字段依赖 grep 核对），只读，未对运行库写操作
- 结论：**Critical 0 · High 6 · Medium 9 · Low 8，共 23 条**

行号为本次阅读时的源码行号（CRLF 文件按行号计）。每条含：文件:行、触发场景、影响、修复建议。

---

## Critical（无）

未发现必然导致资金损失或数据全量损坏的缺陷。以下 High 中的 H1/H2/H3/H4 为稳定复现的功能性故障，建议优先处理。

---

## High

### H1. 幂等 async 路径的"完成标记"在事务外，且存在 5 个真实 async 调用点（注释已过时）

- **文件:行**：`infrastructure/idempotency.ts:67-89`；调用点 `http/router.ts:63`、`http/routes/workflow.ts:31`（预约创建）、`workflow.ts:81/94`（微信单发/群发）、`workflow.ts:187`（采购收货）
- **触发场景**：客户端带 `idempotency-key` 调用上述任一接口。业务回调是 `AsyncFunction`，走 async 分支：业务写入（better-sqlite3 同步落库）先提交，随后 `.then` 里才执行 `UPDATE IdempotencyRecord SET status='COMPLETED'`——该 UPDATE **不在业务事务内**。若此 UPDATE 失败（SQLITE_BUSY 超时、进程崩溃、磁盘错误），记录残留 `PROCESSING`；30 分钟后 `cleanupIdempotencyRecords`（idempotency.ts:122-128）删除它；客户端重试同一 requestId → 无缓存记录 → **副作用重复执行**（重复创建预约、重复发微信、重复入库）。
- **影响**：微信场景副作用不可逆（外部网关已收到消息）；预约/采购收货重复落库。注释 "No current call site uses it"（idempotency.ts:66）与实际代码不符，说明开发者误以为该分支无人使用。
- **修复建议**：async 分支改为"业务完成 + 幂等标记"同事务（把 async 回调拆成同步段，或使用 `db.transaction` 包裹业务写入与 UPDATE；better-sqlite3 不允许 async 回调进事务，可改为：先同步执行业务、再同步 UPDATE，并捕获 UPDATE 失败时**回滚业务**不可能时，至少记录告警并保留 PROCESSING 记录不清理）；或将调用点改为同步回调（workflow.ts:211/308/325 已是同步回调，模式可参考）。

### H2. 通用 CRUD 响应把 phone/email/idCard 等置 null，前端患者/用户手机号功能整体失效

- **文件:行**：`infrastructure/repository.ts:300`（`mapRow` 末尾 `maskSensitiveFields(result)`）、`infrastructure/security.ts:21-22`（SENSITIVE_FIELDS 含 `phone`/`email`/`idCard`/`cardNo`）、`security.ts:87`（命中即置 `null`）
- **触发场景**：任何 `/api/v2/resources/patients`、`/users` 等列表/详情/搜索请求。前端 `src/web/PatientsPage.tsx:119/158/161`、`src/web/UsersPage.tsx:103` 直接依赖返回的 `phone` 字段。
- **影响**：患者/员工手机号在通用 CRUD 响应中恒为 `null` → 列表电话列全空、编辑回显为空、按手机号搜索（`PatientsPage.tsx:161` 本地比对 `String(row.phone ?? '') === form.phone`）永远匹配失败。与系统自身的设计意图矛盾：`http/read-routes.ts:149-154` 注释明确"临时患者电话属敏感字段，直出接口需**掩码**、保持响应结构不变"，而这里做的是**置空**而非掩码。写入正常、读出为空，前后端契约不对称。
- **修复建议**：`mapRow` 改为对敏感字段做部分掩码（如 `138****5678`，复用 `maskPhoneForExport`）而非置 null；或在 resources 元数据上标记"掩码字段"，仅对确实不需要回传的字段置空。

### H3. 微信提醒的日期过滤用 UTC 日期与 +8 诊所日期比较，凌晨时段系统性漏提醒；时间显示用服务器本地时区

- **文件:行**：`application/service-modules/wechat-reminder.ts:186`（`substr(a.startTime,1,10) = ?`）、`:197`（`substr(COALESCE(v.endTime,v.startTime),1,10)`）、`:206`（`substr(e.createdAt,1,10)`）、`:90-95`（`formatLocalTime` 用 `date.getHours()` 服务器本地时区）；对照 `infrastructure/clock.ts:8-16`（`clinicDate` 固定 +8）
- **触发场景**：`today()` 生成当日提醒。`today` 是 +8 本地日期；`startTime` 是 UTC ISO 字符串。北京时间 00:00-07:59 的预约，其 UTC 日期 = 本地日期 − 1，与目标日期（本地日期 ± N）**永远差一天** → 凌晨预约/就诊/首诊的患者永不生成提醒。另：若服务器进程 TZ 非 Asia/Shanghai，`formatLocalTime` 输出与北京时间不符，提醒话术中的 `{appointmentTime}` 显示错误。
- **影响**：提醒功能对 0-8 点时段的数据系统性漏发；部署时区非 +8 时全部提醒内容时间错误。数据本身不受损，属确定性功能故障。
- **修复建议**：统一时区口径。SQL 侧用 `datetime(startTime, '+8 hours')` 或 `substr(startTime,1,10)` 改为 `substr(datetime(startTime, '+8 hours'),1,10)`；`formatLocalTime` 改为按 `CLINIC_TZ_OFFSET_HOURS` 偏移计算（同 `clinicDate` 的偏移算法）。

### H4. FTS 搜索索引与业务写入脱节：触发器已删，专用服务直写不维护索引，全局搜索漏数据

- **文件:行**：`infrastructure/migrations.ts:712-738`（迁移 119 删除全部 search_* 触发器）；`infrastructure/repository.ts:192/223/245`（仅通用 CRUD 维护 SearchIndex）；直写路径：`application/service-modules/auth.ts:511`（AppointmentService.create 直插 Appointment）、`charge-tree.ts:130`、`treatment-plan-billing.ts:230`、`prescription-process.ts:106`、`financial.ts:132/840`、`refund-flow.ts:141`、`triage.ts:173`
- **触发场景**：通过专用服务（预约创建、划价、处方收费、退费、收费状态变更等）新增或修改数据后，调用 `/api/v2/search` 或资源列表的 `search` 参数。
- **影响**：新建预约、新划价单、处方收费、退费后的状态变化**不会出现在全局搜索中**（SearchIndex 无对应行或内容陈旧），直到 `rebuildSearchIndex` 手工重建。搜索是核心工作台功能，表现为"刚建的单子搜不到"。
- **修复建议**：二选一：(a) 恢复触发器（迁移 119 撤回，触发器与 repository 维护并存需去重设计，可用 INSERT OR REPLACE）；(b) 在专用服务的写路径统一调用 `upsertSearchRow/removeSearchRow`（如 AppointmentService.create/transition、financial.pay/refund、treatment-plan-billing.bill、refund-flow、triage.updateAppointment 等），并为 Charge/Appointment 的 UPDATE 补充刷新入口。

### H5. 审计缓冲在 flush 失败 + 缓冲超限时静默丢弃审计行，且无任何日志

- **文件:行**：`http/app.ts:158-169`（`scheduleAuditRetry`：`auditBuffer.length + rows.length > AUDIT_BUFFER_MAX * 2` 时直接 `return` 丢弃）、`:166-169`（重试再失败只记日志、行丢弃不再入队）
- **触发场景**：DB 短暂不可用（busy 超时、锁）期间高并发写操作，审计缓冲超过 2×上限；或 flush 连续失败两轮。
- **影响**：操作审计（谁在何时做了什么）**静默丢失**，无告警、无计数。医疗诊所场景下审计是合规刚需，且丢失不可恢复。
- **修复建议**：丢弃前至少 `logger.error` 计数告警；或在缓冲超限时改为丢弃最旧但保留最新并记 metrics；将"审计丢弃数"暴露到 `/metrics`。

### H6. createUser 的用户插入与诊所成员关系不在同一事务

- **文件:行**：`application/service-modules/auth.ts:315-325`
- **触发场景**：`addClinicMembership` 失败（如 UserClinic 唯一约束冲突、DB 瞬时错误）而 `insertUser` 已成功。
- **影响**：产生"无任何诊所成员关系"的用户：可登录但无 clinicId 上下文，`tenant.ts` 过滤后看不到任何数据，且该用户名已占用无法重试创建；需要人工清理。
- **修复建议**：`insertUser + addClinicMembership` 包进同一个 `db.transaction`（两段都是同步 better-sqlite3，可直接事务化）。

---

## Medium

### M1. sync push 中业务写入成功后记录 SyncChange 失败 → 该条标 failed 但已生效，客户端重试撞唯一约束

- **文件:行**：`application/service-modules/sync.ts:144-146`（`this.record(...)` 在 `repo.update/insert` 之后、同一 try 内）
- **触发场景**：批内某条业务写入成功、随后 `record()` 抛非系统级错误（无 `code` 的错误）。
- **影响**：该条被计入 failed 并回给客户端 → 客户端重试 → `repo.insert` 撞唯一约束 → 永久失败，客户端与服务端数据不一致，需人工核对。
- **修复建议**：`record()` 失败时将该条视为"已提交但未记账"，把整批标记为需人工核对（或把 record 放进业务事务内一并提交）；至少错误消息里明确"该条可能已生效，请勿直接重试"。

### M2. 微信单条发送无并发/去重守卫：status 检查与 markSent 之间存在 await，并发请求可重复发送

- **文件:行**：`application/service-modules/wechat.ts:157-188`（`sendOne`：检查 status → `await provider.send` → `markSent`）
- **触发场景**：同一消息被两个并发请求发送（双标签页、双击、`sendBatch` 中同一 id 出现两次、批内 Promise.all 与另一单发重叠）。两次都读到 `PENDING`，都通过 `SENDABLE_WECHAT_STATUSES` 检查，都调网关 → 患者收到两条；`markSent` 的 `changes === 0` 只让后到者报 ConflictError，但消息已发出。
- **影响**：重复骚扰患者/重复计费消息；外部网关无幂等。
- **修复建议**：发送前置 `UPDATE ... SET status='IN_PROGRESS', updatedAt=? WHERE id=? AND status IN ('PENDING','DRAFT')` 并检查 changes（同 wechat-reminder.markSent 的写法），失败即 409；发送成功后置 SENT。

### M3. dispense list/count 的分页参数用 `Number()` 弱转换，NaN 直通 better-sqlite3 抛 TypeError → 500

- **文件:行**：`application/service-modules/dispense.ts:199-201`
- **触发场景**：`service.list()` 被直接调用且 `filter.page='abc'`（当前路由层 `dispense-routes.ts:31` 已先经 `parsePagination` 兜底，故线上经路由不可达；但任何未来直接调用方、或把 service 暴露给其他入口时即爆）。`Number('abc')` = NaN → `Math.max(1, NaN)` = NaN → `OFFSET NaN` → better-sqlite3 绑定错误 → 500。
- **影响**：API 契约不统一（其他列表均 400）；防御性缺口。
- **修复建议**：与 `parsePagination` 语义对齐：非有限数字抛 `ValidationError`（400），并在 service 层复用同一校验。

### M4. 发药单号重复时返回 500 而非 409（唯一约束未转换）

- **文件:行**：`application/service-modules/dispense.ts:149-166`（事务内 `INSERT INTO Dispense`，无 UNIQUE 冲突捕获）
- **触发场景**：两个客户端提交相同 `(clinicId, number)` 发药单（单号由客户端/前端生成，非服务端分配）。
- **影响**：DB 有 `UNIQUE(clinicId, number)`（migrations.ts:1078）兜底不产生脏数据，但客户端收到裸 500 + SQLite 错误信息，无重试/友好提示；并发场景下后提交者必然失败。
- **修复建议**：捕获 UNIQUE 错误转为 `ConflictError('发药单号已存在')`（与 repository.ts:304-307 的 `isUniqueConstraintError` 相同手法）。

### M5. repository.update/softDelete 无 changes===0 检查；update 的 findById→UPDATE 存在微任务交错窗口

- **文件:行**：`infrastructure/repository.ts:198-228`（`await this.findById` 后 UPDATE，两语句之间让出事件循环）、`:230-258`
- **触发场景**：两个并发 PATCH 同一记录：A `findById` 通过 → 让出；B 先完成 UPDATE/软删；A 的 UPDATE 此时 changes=0 静默成功（返回 success 但什么都没改）。softDelete 直接执行，对不存在 id 也静默成功（路由层 `router.ts:147-150` 有预检，业务直调路径无）。
- **影响**：并发更新丢失/静默"假成功"，客户端看到 200 但数据未变。
- **修复建议**：UPDATE/DELETE 后检查 `changes === 0` 抛 NotFoundError；findById 与 UPDATE 合并为单条带条件 UPDATE（`WHERE id=? AND deletedAt IS NULL`）。

### M6. 治疗计划明细"已划价不可改"检查在事务外（check-then-act），并发窗口可绕过

- **文件:行**：`http/router.ts:125-130`（先 `findById` 看 `billed`，再 `repo.update`——`repo.update` 内部又是 findById+UPDATE，两处 await）
- **触发场景**：已划价明细（billed=1）与并发 PATCH 同时发生：检查时读到 billed=0 → 让出 → 划价服务置 billed=1 → 本请求 UPDATE price 成功，绕过"已划价不可改价"约束。
- **影响**：账目金额凭证可被并发改写（金额造假面）；单进程内窗口小（需毫秒级并发），多进程/多实例放大。
- **修复建议**：UPDATE 语句加 `AND billed = 0` 条件并检查 changes（原子守卫），而非先查后改。

### M7. 打印模板整体 escapeHtml，模板作者无法使用任何 HTML 标签，打印功能受限

- **文件:行**：`application/service-modules/analytics.ts:118-123`（`PrintTemplateService.render`：先 `escapeHtml(String(row.content))` 再替换 `{{key}}`）
- **触发场景**：BOSS 维护的打印模板含 `<b>`、`<table>`、`<br>` 等排版标签（打印模板的本职）。
- **影响**：所有标签被转义为实体，打印输出丢失排版；模板系统形同虚设。无 XSS（变量值已转义，安全方向正确）。
- **修复建议**：只转义变量值（现状已做），content 原样输出；若担心存储型 XSS，改为在保存模板时做白名单 sanitize 而非渲染时整体转义。

### M8. 微信发送成功与 markSent 之间进程崩溃 → 消息已发送但状态仍 PENDING → 重试重复发送

- **文件:行**：`application/service-modules/wechat.ts:167-188`
- **触发场景**：`provider.send` 返回 ok 后、`markSent` 提交前进程崩溃/异常。
- **影响**：消息实际已到网关，DB 仍 PENDING；人工/定时重试 → 重复发送。至少一次语义无去重。
- **修复建议**：与网关约定幂等键（payload 带 messageId，网关去重）；或在崩溃恢复后对"发送超时未落库"的消息先查询网关状态再决定是否重发。

### M9. refresh 并发同 token 会吊销整个会话族，双标签页刷新被登出

- **文件:行**：`application/service-modules/auth.ts`（refresh 的 `revokeReplayedFamily`，见前轮审计）
- **触发场景**：用户双开标签页，两个 refresh 请求几乎同时到达（前端路由守卫并发刷新很常见）。
- **影响**：第二个请求判定为 replay → 吊销该 refresh token 族 → 用户被登出，需重新登录。非数据错误但体验故障高频。
- **修复建议**：将"同 token 并发"与"旧 token 重放"区分：对窗口期内（如 5 秒）的同 token 请求返回同一新 token（短窗口内存缓存），仅对窗口外重放吊销。

---

## Low

### L1. 不支持的列类型静默降级为 TEXT

- **文件:行**：`infrastructure/database.ts:24-28`（`columnType()` 默认分支 `return 'TEXT'`，其后无 throw）
- **触发场景**：新增资源字段类型未在映射表注册。
- **影响**：列类型静默错误，数据语义（如日期排序、数值比较）偏差，且无告警。
- **修复建议**：默认分支抛错或至少 `console.warn` 一次。

### L2. withIdempotency 每次调用都清理过期记录（写放大）

- **文件:行**：`infrastructure/idempotency.ts:34`
- **触发场景**：高频写接口（收费、预约）每次请求都执行一次 `DELETE FROM IdempotencyRecord WHERE expiresAt <= ?` 全表扫描。
- **影响**：IdempotencyRecord 表增长时每次请求多一次 DELETE 扫描；数据量大时放大写路径耗时。
- **修复建议**：清理移到定时任务（与 `cleanupIdempotencyRecords` 合并），热路径只做 `SELECT` + `INSERT`。

### L3. lockedUntil 无效日期时 NaN 比较绕过锁定

- **文件:行**：`http/middleware.ts`（lockedUntil 解析处）
- **触发场景**：DB 中 `lockedUntil` 为非 ISO 字符串（脏数据/手工修改）→ `new Date(...).getTime()` = NaN → `NaN > now` 恒 false → 锁定不生效。
- **影响**：仅脏数据场景；被锁账号可登录。
- **修复建议**：解析失败按"已锁定"处理（fail-closed）。

### L4. boolean 校验：字符串 '1' → false，数字 1 → true，行为不一致

- **文件:行**：`http/validation.ts:86`
- **触发场景**：客户端对 boolean 字段传 `'1'`（部分前端组件/表单序列化习惯）与传 `1` 得到相反结果。
- **影响**：字段值静默反转，难以排查。
- **修复建议**：统一 `'1'/'true'/1/true` 为 true。

### L5. CORS 对无端口 localhost 源拒绝（`Number(url.port)` = 0）

- **文件:行**：`http/app.ts:293`（CORS 白名单端口比对）
- **触发场景**：前端从 `http://localhost`（无端口）发起请求。
- **影响**：该来源被 CORS 拒绝；仅影响未带端口的本地开发访问。
- **修复建议**：`url.port === ''` 时按默认端口（80/443）处理或显式允许。

### L6. 备份回退裸拷贝可能缺 WAL 帧

- **文件:行**：`infrastructure/sqlite-files.ts:27-34`（`VACUUM INTO` 失败回退 `copyFileSync`，若此时 checkpoint 也未完成，拷贝缺 WAL 已提交帧）
- **触发场景**：备份瞬间 DB 被锁/只读导致 checkpoint 与 VACUUM 都失败。
- **影响**：备份不一致（静默缺最近事务），restore 后丢数据；已有 warn 日志但无告警指标。
- **修复建议**：回退拷贝前单独确认 `wal_checkpoint(TRUNCATE)` 成功；失败则备份失败而非降级拷贝。

### L7. print 接口 kind 未白名单

- **文件:行**：`http/read-routes.ts:110-133`（`kind` 直接透传 `PrintService.render`）
- **触发场景**：客户端传任意 kind。
- **影响**：无注入面（render 全转义），但语义校验缺失，未知 kind 会静默渲染默认标题页。
- **修复建议**：kind 枚举白名单校验，未知值 400。

### L8. wechat-reminder `today()` 每次调用都触发 generateDue（写放大）

- **文件:行**：`application/service-modules/wechat-reminder.ts:127-133`
- **触发场景**：前端频繁刷新提醒页（每次 GET 都跑 3 个候选查询 + 最多 600 次存在性检查 + 插入）。
- **影响**：中大型诊所每请求多 3 次 JOIN 查询 + 每患者 1 次 SELECT；QPS 高时明显。
- **修复建议**：按 `(clinicId, date)` 做短时内存缓存或仅当"当天尚未生成"时执行生成。

---

## 汇总

| 严重度 | 数量 | 关键主题 |
| --- | --- | --- |
| Critical | 0 | — |
| High | 6 | 幂等 async 完成标记（H1）、响应敏感字段置空破坏前端（H2）、提醒时区错位（H3）、FTS 索引脱节（H4）、审计静默丢弃（H5）、建用户非事务（H6） |
| Medium | 9 | sync 记账失败不一致、微信并发/崩溃重复发送、dispense 分页 NaN、单号 409、repository 无 changes 检查、billed 并发绕过、打印模板转义、refresh 登出、模板渲染 |
| Low | 8 | 列类型降级、幂等清理写放大、lockedUntil NaN、boolean 不一致、CORS 无端口、备份回退、print kind、提醒生成写放大 |

## Top 5 最重要发现

1. `infrastructure/idempotency.ts:67-89` + `http/routes/workflow.ts:31/81/94/187`、`http/router.ts:63` —— async 幂等完成标记在事务外且注释声称无调用点（已过时），失败窗口可致重复创建/重复发微信
2. `infrastructure/repository.ts:300`（配合 `infrastructure/security.ts:21-22`）—— 通用 CRUD 把 phone/email/idCard 置 null，患者/员工手机号功能全面失效
3. `application/service-modules/wechat-reminder.ts:186/197/206` —— UTC 日期与 +8 诊所日期比较，凌晨数据系统性漏提醒、时区不统一
4. `infrastructure/migrations.ts:712-738`（删除 FTS 触发器）+ `application/service-modules/auth.ts:511` 等直写路径 —— 搜索索引不再随业务写入更新
5. `http/app.ts:158-169` —— 审计缓冲超限静默丢弃，审计数据不可恢复地丢失

## 最可能线上爆的 3 个 bug

1. **患者/员工手机号全空、按手机号搜索失效**（`repository.ts:300` 置 null）—— 稳定复现、核心工作台功能直接可见故障
2. **微信提醒凌晨时段漏发 / 部署时区非 +8 时提醒时间全错**（`wechat-reminder.ts:186` 等 UTC vs +8 混用）—— 每天稳定触发，且是面向患者的对外行为
3. **新建预约/收费/划价单全局搜索搜不到**（FTS 触发器删除后专用服务不维护索引）—— 稳定复现，刚建的单子搜不到会让用户立刻感知
