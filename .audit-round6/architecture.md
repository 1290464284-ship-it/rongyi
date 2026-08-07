# 第六轮全面深度审计 — 架构子代理报告

- 仓库：`D:/Desktop/rongyi/source`（分支 `codex/v2-full-optimization`，HEAD `dcca390`）
- 范围：`apps/v2/`（server + web + electron + scripts + docs）
- 方法：只读 grep/rg/node 脚本验证；typecheck 通过（tsc server + web 均无错误）
- 分级：P0 阻断 / P1 高 / P2 中 / P3 低（另附正面确认）

---

## 一、新发现清单

### P0 — 无

本轮未发现阻断级（崩溃/数据丢失/安全漏洞）架构问题。

### P1 — 1 项

**P1-1 MATURITY.md 覆盖门禁声明与实际配置严重漂移（质量门禁可信度）**
- 证据：
  - `apps/v2/MATURITY.md:37-41`：“Coverage raised to 100% statements, 100% branches, 100% functions, and 100% lines … The delivery gate is now **100/100/100/100**”
  - `apps/v2/MATURITY.md:188-190`：web 门禁“**98.5/92.5/98.5/100**”
  - 实际：`apps/v2/vite.config.ts:24-28` 门槛为 **95/85/97/95**（注释自述 2026-08-07 按 CI 实测基线调低）；`apps/v2/vite.web-coverage.config.ts:14-18` 为 **80/69/77/83**
  - `git log`：`b8f2582 fix(ci): lower coverage thresholds to measured baselines` 已降门槛，但 MATURITY.md 未同步更新
- 影响：交付文档对外宣称 100% 门禁，实际 CI 以 95/85/97/95 放行；外部读者（验收方）对质量门禁的判断会失真。第五轮只修了 MATURITY 的 “111 resources”，未覆盖此条。

### P2 — 5 项

**P2-1 AuditService.log 为死代码，且与 app.ts pushAudit 形成审计写入双实现**
- 证据：
  - `src/server/application/service-modules/auth.ts:420-436`：`AuditService.log()` 同步 INSERT OperationLog
  - 生产调用者为零：`grep -rn "audit.log(" src/server --include="*.ts"` 仅命中测试 `services.spec.ts:890`、`services-edge.spec.ts:441`；生产写入全部走 `src/server/http/app.ts:110-131` 的批量缓冲 `pushAudit`（带 statusCode 字段与失败重试）
  - 两套 INSERT 已漂移：`app.ts` 含 `statusCode` 列，`auth.ts` 的 `log()` 不含
- 影响：同一表两处写入实现；`AuditService.log` 仅被测试覆盖以凑覆盖率（coverage 守卫生效的反效果）；后续改表结构需同步两处，易漏。

**P2-2 useAsyncAction 新抽象未推广，8+ 处手写 submitting 样板残留**
- 证据：
  - `src/web/use-async-action.ts:6` 注释宣称 “Unify all pages' ad-hoc `if (submitting) return; setSubmitting(true); ... finally` copies on this hook”
  - 实际仅 `src/web/PermissionsPage.tsx:39` 使用该 hook（1/40+ 页面）
  - 残留样板：`InventoryPage.tsx:183/189/205/206/220/230/258/259/305`（4 组）、`AppointmentsPage.tsx:176/302/330`（3 组）、`first-exams/TrackingDialog.tsx:41`（1 组）
- 影响：新建 hook 成为半死代码；并发双击防护逻辑重复维护，行为（如 busy 合并到同一按钮）不统一。

**P2-3 web 端日期工具三处重复实现，format.ts 已提供等价函数**
- 证据：
  - `src/web/AnalyticsDashboardPage.tsx:35-45`：手写 `today()`/`daysAgo()`（= `format.ts` 的 `todayLocalDate()`）
  - `src/web/ImagingPage.tsx:84-94`：手写 `formatDateTime()`/`toLocalDatetime()`（= `format.ts` 的 `formatDateTime()`/`toLocalInput()`，仅入参默认值不同）
  - `src/web/FollowUpsPage.tsx:316`：手写 `todayKey`（= `todayLocalDate()`）
- 影响：4+3 套日期处理未完全收口；时区/格式微调需多点同步（例如 `toLocalDatetime` 与 `toLocalInput` 行为已不完全一致）。

**P2-4 ui-contract.md 与实际 UI 漂移（core dedicated pages 契约未兑现）**
- 证据：
  - `docs/ui-contract.md:12-16`：“Core dedicated pages … must receive custom business pages”
  - 实际 `src/web/hub-tabs.tsx`：`familyMembers`（:97）、`debtRecords`（:109）、`attendance`/`leaveRequests`/`equipment`（:125-127）、`followUpTemplates`/`wechatMessages`（:117-119）均为 `kind: 'resource'` 泛型页
  - `memberCardLogs`、`chargeItems`、`inventoryTransactions` 在 `src/web` 中零引用（无定制页也无 hub tab 入口）
- 影响：契约文档声称“source of truth”，与实际 UI 层级不符；新开发者按文档判断会以为这些资源有定制页。

**P2-5 备份配置缺失被错误分类为 500 “Internal server error”**
- 证据：
  - `src/server/application/service-modules/backup.ts:58`：`throw new Error('Refusing to create plaintext backup: set V2_BACKUP_KEY or V2_ALLOW_PLAINTEXT_BACKUP=1')`
  - `src/server/application/service-modules/common.ts:62`：`backupEncryptionKey()` 缺 key 时同样抛 `new Error`
  - `src/server/http/middleware.ts:34`：`asAppError(error)` 对普通 Error 返回 500；`:38-43` 对 ≥500 将 message 替换为 “Internal server error”
  - 触发路径：`src/server/http/routes/system.ts:81` POST /backups
- 影响：开发/部署配置缺失（未设 V2_BACKUP_KEY 且未开明文）时用户创建备份只得到 500 + “Internal server error”，无法得知是配置问题；应抛 AppError(4xx，带配置提示)。

### P3 — 10 项

**P3-1 剩余内联金额转换未改用 centsToYuanString**
- 证据：`src/web/TreatmentPlansPage.tsx:81`：`(Number(row.totalFee) / 100).toFixed(2)`；`src/web/format.ts:22-28` 已新增 `centsToYuanString`（null/undefined 返回 `''`，行为一致）
- 影响：同页 `ChargesPage.tsx:5` 已用 `centsToYuanString`，此处遗漏，统一口径收尾未完成。（AnalyticsDashboardPage:105/269/361 为图表比例计算，非金额展示，不算残留。）

**P3-2 build:api 是 no-op typecheck，与 typecheck 脚本重复**
- 证据：`package.json` `build:api` = `tsc -p tsconfig.server.json`，而 `tsconfig.server.json:11` 有 `"noEmit": true`；API 运行产物实际由 `electron:compile`（esbuild → dist-electron/server.cjs）生成
- 影响：“build” 名不副实（`pnpm build` 的 api 部分不产出任何文件）；与 `typecheck`（同样的 tsc 命令）重复执行。

**P3-3 appointment-purpose.spec.ts 命名与测试目标不符**
- 证据：`src/server/application/service-modules/appointment-purpose.spec.ts:12` 导入 `AppointmentService` from `./auth`（`auth.ts:451` 定义），文件名却叫 appointment-purpose；同目录其他 spec 均与源文件同名
- 影响：检索与维护误导；该文件实际覆盖 AppointmentService 的 purpose/临时患者分支。

**P3-4 imaging-category.spec.ts 命名与资源链测试约定不一致**
- 证据：`src/server/http/routes/imaging-category.spec.ts` 测试 `createResourceRouter`（router.ts）的 imagingCategories 资源链，而其他同类测试命名为 `xxx-routes.spec.ts`（如 charge-combo-routes.spec.ts）
- 影响：测试组织风格不统一，与“无对应 routes 源文件”的孤儿判读混淆。

**P3-5 大文件拆分观察（非阻断）**
- 证据（行数）：`services-edge.spec.ts` 1898、`migrations.ts` 1668（其中 ~1350 行为声明式迁移数组，可接受）、`app.spec.ts` 1457、`financial.ts` 859（ChargeService/MemberCardService/PurchaseOrderService/ProcessingOrderService/DebtService 五类一文件）、`main.cjs` 922（进程监督单一职责，可接受）
- 影响：`services-edge.spec.ts` 与 `financial.ts` 建议按领域拆分；迁移/Electron 文件属声明式/单一职责，可不拆。

**P3-6 78/139 个 spec 重复 mkdtemp 样板，无共享测试工厂**
- 证据：`grep -rl "mkdtempSync" src --include="*.spec.ts" --include="*.spec.tsx" | wc -l` = 78；每个文件重复 `fs/os/path` import + beforeAll mkdtemp + afterAll rmSync（约 12 行）
- 影响：测试样板重复；但各 spec 独立生命周期亦为 vitest 常规做法，建议抽 `createTestDb()` helper 降噪。

**P3-7 verify-update.mjs 不校验 latest.yml 的 sha512 与安装包哈希一致**
- 证据：`scripts/verify-update.mjs:17-20` 仅检查 latest.yml 是否包含 `version:`/`sha512:`/`path:` 字样；`verify-remote-release.mjs` 校验 size 但不校验 sha512 内容
- 影响：latest.yml 若由旧/错哈希生成可通过校验，升级客户端会在下载后才发现校验失败。

**P3-8 docs/refactor-v2-architecture.md 声称 Event bus，代码中不存在**
- 证据：`docs/refactor-v2-architecture.md:7`（Goals 第 5 条）、`:67`（EVENT_BUS 节点）、`:119`（Key Decision 4）描述“typed events / domain event bus”；`grep -rln "EventBus|eventBus" src` 零命中
- 影响：历史规划文档未标注“未实现”状态，新读者会误以为存在事件总线层；建议标注已取消或更新文档。

**P3-9 服务端日期工具三处并存**
- 证据：`src/server/infrastructure/clock.ts:12-18`（clinicDate，UTC+8）；`src/server/application/service-modules/shift-template.ts:315-320`（formatLocalDate，本地时区）；`src/server/application/service-modules/wechat-reminder.ts:89-95`（formatLocalTime + shiftDate）
- 影响：三套实现时区语义不同（UTC+8 vs 本机时区），`shift-template` 在非 +8 主机上会与 clock 口径不一致；建议统一收口并注明时区语义。

**P3-10 resources.ts 命名映射 TODO 仍存在**
- 证据：`src/domain/resources.ts:19` TODO 注释仍声明 name→table 双命名约定；`imaging`/`firstExamTeeth`/`memberCardLogs`/`memberPointLogs` 名称与表名不一致；`syncChanges` 同时出现在 registry 声明与 `INTERNAL_RESOURCE_TABLES`（:1000-1005，语义微妙但当前安全）
- 影响：已知技术债，建议本轮收尾时明确单一命名策略或关闭 TODO。

---

## 二、正面确认清单

1. **无循环依赖**：219 个源文件 import 图 DFS 检测，0 环（node 脚本验证）。
2. **route-policy 全覆盖**：175 条注册路由中 169 条命中角色规则；6 条未命中（`/auth/login|logout|refresh`、`/health`、`/health/deep`、`/metrics`）全部在 authMiddleware 之前注册为公开/特权路由，默认拒绝（未匹配 403）兜底有效。
3. **typecheck 全绿**：`tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json --noEmit` 无错误。
4. **资源总数 111 与 MATURITY 一致**：78 声明式 + 33 legacy 注册（2 条 legacy 因表重复被正确跳过），与 `MATURITY.md` “111 resources” 吻合，无回归。
5. **迁移版本连续**：101–146 共 46 个迁移，无缺口、无重复版本。
6. **金额转换已大部分收口**：`toCents/formatMoney/centsToYuanString` 在 ChargesPage/FinanceWorkflowPage/MemberCardsPage/charge-utils/ChargeDialog 等广泛复用，服务端无 `(x/100).toFixed(2)` 残留（仅 web 1 处，见 P3-1）。
7. **分页单实现收口**：`parsePagination`（pagination.ts）为唯一解析入口，dispense/refund-flow 服务内部 clamp 为业务参数上限，非重复实现。
8. **NPS 单实现**：`computeNps`（nps.ts）被 read-services 与 follow-up-execution 两处复用（第五轮修复无回归）。
9. **三个扫描脚本职责不重叠**：`audit.mjs`=pnpm 漏洞审计、`security-scan.mjs`=源码禁止模式、`license-scan.mjs`=直接依赖许可证；CI 三步均独立有效。
10. **租户样板收口**：`tenant.ts` 提供 tenantWhere/tenantParams/tenantAnd/tenantMatches，无散落 `clinicId = ?` 手写拼接（服务模块全部经 helper）。
11. **错误处理统一**：业务层 `throw new Error` 仅存于启动/完整性检查路径；HTTP 层无 4xx/5xx 直返（除 404 兜底与 201 成功），全部走 errorMiddleware + asAppError。
12. **.env.example 与代码读取一致**：main.ts/app.ts/database.ts/electron main.cjs 读取的 18 个变量均已在 .env.example 注释（V2_PORT/V2_HOST/V2_DATA_DIR/V2_DB_PATH/V2_LEGACY_DB_PATH/V2_LEGACY_SCHEMA_DIR/V2_JWT_SECRET/V2_ADMIN_PASSWORD/V2_BACKUP_KEY/V2_ALLOW_PLAINTEXT_BACKUP/V2_CORS_ORIGIN/V2_BACKUP_DIR/V2_AUTO_BACKUP_INTERVAL_MS/V2_AUTO_BACKUP_KEEP/V2_LOG_DIR/V2_WECHAT_*/V2_WEB_URL/V2_CRASH_REPORT_URL/V2_DISABLE_AUTO_UPDATE/V2_ALLOW_DEV_SEED/V2_CORRUPT_LEGACY_BACKUP）；vite proxy 与 CORS 均跟随 V2_PORT。
13. **Electron 边界安全**：secret IPC 有 ALLOWED_SECRET_KEYS 白名单 + assertTrustedRenderer + key 格式校验（main.cjs:764-795）；contextIsolation/sandbox 开启；崩溃上报 URL 强制 https；API 子进程注入变量与 .env.example 对齐。
14. **文件上传防护完整**：files.ts 有 20MB 限制、扩展名白名单、magic bytes 校验、按用户配额（200 文件/500MB）。
15. **交付链完整**：v2-release.yml（签名校验→打包→verify:package→verify:signature→installer/upgrade smoke→update:metadata→verify:update→发布→verify:remote）步骤闭合；版本号 root/apps/v2 一致（2.2.0），verify-remote 默认 tag v2-2.2.0。
16. **husky 钩子有效**：pre-commit（typecheck+test）、pre-push（typecheck+lint+knip+security+test+build）与 package.json scripts 对应，无死引用。
17. **scripts 无孤儿**：全部 28 个 scripts/* 文件均被 package.json 或 CI 引用；所有 Page 组件均被 hub-tabs 引用。
18. **scheduler 统一收敛**：自动备份/审计清理/幂等清理全部由 startSchedulers 管理并随 shutdown 停止。
19. **幂等/审计/限流集成点一致**：withIdempotency 8 处、createRateLimit 5 处、pushAudit 缓冲+重试机制实现稳定。
20. **测试组织有明确意图**：architecture.spec / coverage-boundaries / services-edge|remaining|coverage / app-edge|parameters 为“边界守护 + 覆盖补充”设计，非孤儿测试（但命名风格见 P3-3/P3-4）。

---

## 三、一句话总结

第六轮架构审计：**无 P0**；1 项 P1（MATURITY 覆盖门禁 100/100/100/100 与 98.5/92.5/98.5/100 的声明严重落后于实际 95/85/97/95 与 80/69/77/83 配置）、5 项 P2（AuditService.log 死代码双实现、useAsyncAction 未推广、web 日期三处重复、ui-contract 漂移、备份配置缺失被吞成 500）、10 项 P3，其余依赖/分页/租户/错误处理/安全边界/交付链均确认健康。
