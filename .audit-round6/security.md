# 第六轮深度安全审计报告 — apps/v2/src/server

- 审计对象：`D:/Desktop/rongyi/source`（分支 `codex/v2-full-optimization`，HEAD `dcca390`）
- 范围：`apps/v2/src/server/`（Express 5 + better-sqlite3 + JWT + bcryptjs）
- 方式：本轮全部结论基于实际 grep/read 源码与运行临时校验脚本（`check-route-coverage.js`、`_route-policy.transformed.js`），未修改任何源文件、未提交代码。
- 排除：第五轮已修复项（git log 7403761/8d2b404/4546a3d/dcca390）不重复复核。

---

## 一、新发现问题清单

### P1 — 锁定病历可经通用 CRUD PATCH 直接改写/解锁/伪造审核状态，完全绕过申请-审核流程

**影响**：DOCTOR 角色可通过 `PATCH /api/v2/resources/medicalRecords/:id` 直接修改已锁定病历的全部内容字段、将 `isLocked` 置回 `false` 解锁、伪造 `editRequestStatus:'APPROVED'`，无需经过 `MedicalRecordEditService` 的申请-审核流程。该流程在代码注释中明确设计为「已锁定的病历只能经申请审核修改」（medical-record-edit.ts:25-30，审核通过才合并白名单字段并解锁 `isLocked=0`）。锁定保护是病历审计追溯的关键控制点，绕过它等于可任意篡改医疗档案并抹除锁定痕迹。

**证据链**：
1. 通用 CRUD PATCH 处理器无锁定检查（`http/router.ts:117-145`）：只校验 `resource.capabilities.update`、剥离受保护字段、校验 `treatmentPlanItems` 已划价，**没有** `medicalRecords && existing.isLocked` 分支。对照组：DELETE 处理器**有**锁定检查（`http/router.ts:151-154`，`if (resource.name === 'medicalRecords' && existing.isLocked === true) throw FORBIDDEN`）——同文件同资源，PATCH 唯独漏掉。
2. `medicalRecords` 资源注册为可写且字段齐全（`domain/resources.ts:217-246`）：`capabilities.update: true`，roles `clinical = ['BOSS','DOCTOR']`；字段含 `isLocked`(233)、`editRequestStatus`(238)、`lockedAt/lockedBy`(234-235)、`status`(237)、`chiefComplaint` 等全部内容字段——均可由通用 PATCH 写入。
3. `isLocked`/`editRequestStatus`/`status` 不在 `PROTECTED_WRITE_FIELDS` 中（`infrastructure/security.ts:36-78`），`stripProtectedWriteFields` 不会剥离；`validatePayload` 的 boolean/enum 校验会放行 `isLocked:false` 与 `editRequestStatus:'APPROVED'`（`http/validation.ts:90-98`）。
4. `SqliteRepository.update` 直接拼装所有传入字段执行 UPDATE（`infrastructure/repository.ts:198-222`），无任何锁定状态钩子。
5. 路由可达性已实测：`GET /api/v2/resources/medicalRecords/xxx` 命中 route-policy 规则 6（`/^\/api\/v2\/resources/`，BOSS+DOCTOR），进入 router 后 `resource.roles` 含 DOCTOR，PATCH 放行。
6. 测试盲区佐证：`http/router.spec.ts:150-181` 只覆盖了「DELETE 拒绝锁定病历」，没有对应的 PATCH 用例，故漏检。

**建议**：在 router.ts PATCH 分支增加与 DELETE 相同的 `medicalRecords.isLocked` 检查（并拒绝写入 `isLocked`/`editRequestStatus` 等审计字段，或将其加入 PROTECTED_WRITE_FIELDS 的按资源豁免机制）。

---

### P2 — charges.create 的 items 数组无数量上限（对比同类接口均有 500 上限），可造成同步阻塞 DoS

**位置**：`application/service-modules/financial.ts:76-109`（`if (!input.items?.length)` 只校验非空，无上限）→ 路由 `POST /api/v2/charges`（BOSS/DOCTOR 均可达，route-policy 规则 14）。
**对比**：`PurchaseOrderService.create`（financial.ts:583）与 `ProcessingOrderService`（financial.ts:748）均限制 `1..500` 条。
**影响**：全局 body 限制为 2mb（`http/app.ts:304`），按最小 item 约 60 字节计可塞入数万条 item；每条都要 `assertSafeSubtotal` + 逐条 `INSERT INTO ChargeItem`（financial.ts:137-153），better-sqlite3 同步单线程执行，单请求可长时间阻塞事件循环（配合并发请求即 DoS）。金额逻辑本身安全（服务端重算、`assertSafeSubtotal` 防溢出），问题仅在数量无界。

---

### P2 — 患者手机号经多个列表/导出接口直出未掩码（与全站掩码策略不一致）

系统其余接口（search、appointments/by-date、wechat-reminder listPending、remindersCsv）均对 phone 掩码，以下四处遗漏：

1. `GET /api/v2/follow-ups/reminders` — `infrastructure/repositories/core.repositories.ts:491`：`SELECT ... P.phone AS patientPhone` 原样返回（路由 `http/routes/workflow.ts:291-293`，BOSS+DOCTOR）。
2. `GET /api/v2/dispenses` — `application/service-modules/dispense.ts:203`：`P.phone AS patientPhone` 原样返回（route-policy 规则 21，BOSS+DOCTOR）。
3. `GET /api/v2/analytics/churn` — `infrastructure/repositories/core.repositories.ts:650`：`SELECT P.id, P.name, P.phone` 原样返回（BOSS-only，风险略低）。
4. `GET /api/v2/doctors` — `application/service-modules/auth.ts:222-229`：`SELECT id, name, phone, role FROM User` 直出医生手机号（路由 `http/routes/auth-admin.ts:106-107`，BOSS+DOCTOR 均可见）。

**影响**：患者/医生手机号 PII 泄露给本应只看到掩码数据的角色；与系统既定脱敏策略不一致，属遗漏而非设计。

---

### P3 — 患者手机号明文写入 cephalometric 报告 remark 字段

**位置**：`application/service-modules/cephalometric-report.ts:102`：`const remark = input.phone && input.phone.trim() !== '' ? `phone:${input.phone}` : null;`
**影响**：手机号以明文落入 `CephalometricReport.remark` 持久化（DB 明文残留），虽未直接经 API 返回，但破坏 PII 最小化原则；报表导出/打印若引用 remark 会再次带出。建议不入库或加密存储。

### P3 — backup 文件名直接内嵌 clinicId，缺乏字符消毒（理论路径逃逸）

**位置**：`application/service-modules/backup.ts:23-24`（`clinicPrefix`：`clinic-${clinicId}-`）与 `:60-62`（拼接 `backup-${timestamp}-${uuid}` 后 `path.join(this.backupDir, filename)`）。
**影响**：若 clinicId 含 `../` 等路径分隔符可逃逸 backupDir 写文件；但 clinicId 来自服务端 JWT/DB（`context.clinicId`，非用户自由输入），实际极难触发。防御性建议：`basename`/正则白名单化 clinicId（与 `safePath`/`assertClinicOwned` 的既有风格一致）。

---

## 二、正面确认清单

1. **路由策略全覆盖，无未覆盖业务路由、无授权漂移**：临时脚本（`.audit-round6/check-route-coverage.js`）剥离 TS 类型注解真实编译 `route-policy.ts` 后比对全部 181 条注册路径：
   - 171 条命中 `routeRoleRules`；10 条未命中全部为公开或自带鉴权的路由（`/api/v2/auth/login|logout|refresh` 公开注册、`/api/v2/health` 公开、`/api/v2/health/deep` 与 `/api/v2/metrics` 显式 `authMiddleware + roleMiddleware('BOSS')`、`/:resource*` 为 router.ts 相对路径实际挂载于 `/api/v2/resources` 下被规则 6 覆盖）。
   - 5 条 dead 规则（inventory-reports/inventory-docs/inventory-transfers/follow-up-dicts/departments）均被更宽前缀规则先命中，且角色集合一致（全为 BOSS），无放权风险。
   - 默认拒绝语义确认：`http/app.ts:364-371` 未命中规则 → 403，且该中间件位于全部业务路由注册之前。
2. **生产环境凭据策略正确**：`main.ts:194-208` 生产强制 `V2_JWT_SECRET` ≥32 字符否则拒绝启动；开发环境用 `randomBytes(32)` 临时密钥。`seedDatabase` 生产环境拒绝播种默认凭据（`infrastructure/database.ts:373-375`，生产无 admin 即抛错）；默认密码仅限开发（`:358`，可用 `V2_ADMIN_PASSWORD` 覆盖）。
3. **PrintTemplateService.render 双重转义**：`application/service-modules/analytics.ts:106-116` 对模板 content 与全部 `{{var}}` 替换值均 `escapeHtml`（`shared/html.ts` 覆盖 `& < > " '`），存储型 XSS 防护到位。
4. **bulk-import 边界完整**：`clinical-ops.ts:122-182` — `FORBIDDEN_BULK_IMPORT_RESOURCES` 禁用 12 类资金/库存敏感资源（common.ts:36-48）、行数上限 10 000、chunk 级事务回滚并修正 imported 计数、`stripProtectedWriteFields` 全程生效。
5. **treatment-plan-billing 金额服务端重算**：`treatment-plan-billing.ts:201-289` 不信任客户端金额，按库存明细价格/折扣率重算 totalAmount；`billed`/`billedChargeId` 在 PROTECTED_WRITE_FIELDS（security.ts:76-77），通用 CRUD PATCH 对已划价明细拒改（router.ts:127-135）且 DELETE 拒删（router.ts:159-162）——金额凭证防篡改链路闭合。
6. **sync 通道加固**：`sync.ts:36-60` pull 仅 BOSS 且 device token 哈希比对（`assertDevice` :222-228）；push 禁用 Charge 写入（:109-110）；复合游标不丢变更。
7. **幂等设计合理**：`withIdempotency` 覆盖 pay/refund/recharge/consume/debt.pay；空 requestId 跳过（不误伤合法并发），完成态 24h 缓存返回原响应。
8. **错误响应不泄内幕**：5xx 通用消息，details 仅 VALIDATION_ERROR 白名单；审计日志 body 经 `maskSensitiveFields`（app.ts:353-355）。
9. **文件上传/下载边界完整**：扩展名白名单 + magic bytes + 20MB + 按用户配额；下载文件名正则 `^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|pdf)$` 防穿越。
10. **restore/verify 路径安全**：`safePath`（basename）+ `assertClinicOwned` 前缀校验 + marker 路径限制在 allowedDirs（restore-apply.ts）。
11. **wechat 无 SSRF**：URL 仅来自环境变量且强制 https。
12. **登录防爆破**：5 次失败锁定 15 分钟 + DUMMY_HASH 防用户名枚举（部分路径）+ 按 IP+username 维度限流（rate-limit.ts）。
13. **会话吊销族完整**：refresh 轮换 + 重用检测；changePassword/resetPassword/deleteUser 均 bump tokenVersion。
14. **scheduler 无外部输入面**：仅自动备份/审计清理/幂等清理，参数经 clamp（main.ts:247-254、scheduler.ts:38-40）。
15. **CORS 严格**：显式 origin 白名单 + loopback 端口白名单 + `null` origin 一律拒绝（app.ts:268-303）。
16. **legacy-import 完整性校验**：拒绝损坏库，import 前备份原库（legacy-import.ts:21-76）。

---

## 三、一句话总结

第六轮审计新发现 **1 个 P1（锁定病历可经通用 CRUD PATCH 绕过申请-审核流程直接改写/解锁/伪造审核状态）、2 个 P2（charges.items 无数量上限 DoS；4 处患者/医生手机号直出未掩码）、2 个 P3（手机号明文入 cephalometric remark、backup 文件名内嵌 clinicId 无消毒）**，其余核心安全机制（路由策略全覆盖、生产凭据强制、模板 XSS 防护、金额服务端重算、sync/幂等/文件/恢复链路）经实测均为正面确认。
