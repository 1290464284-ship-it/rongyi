# 深度审计报告-第七轮-主报告

- 审计日期：2026-08-07
- 审计对象：`apps/v2`（Electron + Vite + React + Express + SQLite 桌面应用，~7 万行 TS，359 个源文件）
- 基线：main @ `2b345bb`（PR #2 合并后）
- 方法：5 路子代理并行（安全 / 后端逻辑 / 前端 & Electron / 结构卫生 / CI/CD 运维），主代理对全部 Critical/High 发现逐一实证复核（读源码 + 运行验证 + GitHub API 实证）

## 发现统计（5 份子报告合计 121 条）

| 维度 | 子报告 | Critical | High | Medium | Low/Info | 合计 |
|---|---|---|---|---|---|---|
| 安全 | security.md | 0 | 1 | 7 | 10 | 16 |
| 后端逻辑 | backend.md | 0 | 6 | 9 | 8 | 23 |
| 前端 & Electron | frontend.md | 3 | 5 | 13 | 6 | 27 |
| 结构卫生 | structure.md | 0 | 4 | 7 | 9 | 22 |
| CI/CD 运维 | cicd.md | 2 | 9 | 14 | 8 | 33 |

**总评**：代码工程质量整体较高（SQL 全参数化、租户过滤基本到位、事务原子性可靠、注入面经实测收口），连续多轮无 P0 级崩溃类问题；但本轮发现 **2 个 CRITICAL 发布阻断**、**3 个会真实影响业务的前端严重缺陷**、**1 个供应链 RCE 高危**，且部分属于"本地验证 ≠ 线上行为"的系统性偏差。以下按你的 15 个问题逐一回答。

---

## 1. 你觉得你遗漏了什么？（审计自身的盲区）

诚实地说，本轮审计仍有五块盲区，是"想查但没查透"的：

- **SQLite 数据真实性验证**：没有用真实诊所数据规模（几十万行）跑一次备份→损坏→恢复→重启全链路。`delivery-drill.mjs` 脚本存在且质量不错，但从未在 CI/本轮中实际执行（cicd-H5）。
- **Electron 打包产物实测**：虽然做了 file:// 下 fetch 的 CORS 实测，但没有完整安装 `Dental-Clinic-V2-Setup-2.2.0.exe` 走一遍新装机流程——而这恰恰会撞上 CRITICAL C1（dental.sqlite 缺失）。
- **多诊所/多租户并发压测**：只做了 20 万行基准插入（CI），没有模拟多诊所同时操作、库存扣减并发、微信提醒高峰。
- **迁移脚本在真实库上的增量升级**：101 个迁移版本只验证了全新库建库路径，没有验证"2.1.4 正式库 → 2.2.0"的原地升级。
- **Windows 原生行为**：窗口管理、托盘、开机自启、自动更新安装链路没有在真实 Windows 上端到端验证（自动更新又是安全 H1 的载体）。

**另一个遗漏是流程性的**：历轮审计报告（第二~六轮）此前从未推送到远程仓库，只存在本地；本轮已一并恢复并推送（见文末提交说明）。

## 2. 你觉得我遗漏了什么？（用户/项目层面的盲区）

- **你把"发布"当成"未来的事"**：C1/C2 表明只要打 `v2-2.2.0` tag，发布链路**必然失败**（verify-package 硬性要求已被删除的 dental.sqlite），而失败原因在 PR 合并前就已在 windows-smoke 上亮红（H3 实证：失败但没阻塞合并）——这条线一直没人看。
- **`source/` 双份工作副本**（cicd-H6）：仓库根 `apps/v2` 与 `source/apps/v2` 已漂移（system.ts、多个页面/spec、installer-smoke.ps1 不一致），GitHub 上生效的是根目录那份。本地验证结果 ≠ CI 验证结果，这是"明明测过却线上不同"的高发根源。
- **"等正式签名版"的两个前提都没验证**：① 签名证书（pfx）从未在 Actions 中真实跑过签名（v2-internal-release.yml 从未运行，H4）；② 自动更新通道依赖公开仓库且无 publisherName 签名校验（安全 H1）——如果签名证书缺失/无效，"正式签名版"发布时才会暴露。
- **2.2.0 的"冻结"只是文档动作**：external-gates.md 声称冻结 2.2.0，但远程从未发布 v2-2.2.0，本地却已构建产物——版本事实源是乱的（C2）。
- **没有一个人负责"数据完整性门禁"**：verify-foreign-keys（19 个核心关系）、verify-database、delivery-drill 全部只在人工跑（H5），对真实诊所数据这是不可逆风险。

## 3. 你最害怕的是什么？（我最怕的三件事）

1. **自动更新通道被劫持 → 全盘 RCE（安全 H1）**：更新源是公开仓库，`autoDownload=true`，Windows 打包无 publisherName 签名校验，electron-updater 直接跳过校验。仓库一旦失陷，**所有诊所的每台机器**都会自动执行攻击者代码。这是"一键控制所有客户"的单一故障点，也是本审计最重的一条安全债。
2. **新装机静默缺数据（cicd C1）**：legacy/dental.sqlite 被删但校验还要求它；绕过校验发布后，新装机的历史数据导入被静默跳过（main.ts 的 existsSync 分支），**没有任何告警**。诊所开业后才发现老数据没了，不可逆。
3. **合规审计数据静默丢失（后端 B-High）**：审计缓冲 flush 失败且超 2 倍上限时直接丢弃审计行且无日志。对医疗诊所，审计日志是合规生命线。

## 4. 技术风险总览

| 风险域 | 具体风险 | 级别 |
|---|---|---|
| 供应链 | 公开更新源 + 无签名校验 + action 未 pin SHA + CI 无权限最小化 | 🔴 高 |
| 发布链路 | dental.sqlite 缺失必失败；2.2.0 版本漂移；internal release 从未跑过 | 🔴 高 |
| 权限模型 | 收费组合 price 字段对 DOCTOR 开放；私有套餐越权；DOCTOR 可见诊所级财务汇总 | 🟠 中高 |
| 可用性 | 未认证登录 DoS（锁账号 + 全局登录限流） | 🟠 中高 |
| 数据一致性 | 幂等 async 分支 COMPLETED 标记在事务外（5 处真实调用）；FTS 索引不再维护 | 🟠 中高 |
| 时区 | 微信提醒用 UTC 日期比较 +8 诊所日期，凌晨 0-8 点系统性漏提醒 | 🟠 中高 |

## 5. 隐藏 bug（已实证的高价值 10 个）

1. **采购单驳回静默失效（前端 F-严重）** `PurchaseOrdersPage.tsx:365`：用 `window.prompt` 收集驳回理由，而 Electron 未实现该 API（官方 issue #31560），返回 null 且不弹窗 → 桌面打包版驳回功能完全不可用，且只在打包版出现。
2. **患者时间线金额放大 100 倍（前端 F-严重）** `PatientTimelinePage.tsx:131`：`String(event.amount)` 直接渲染分值（5000 显示为 "5000" 而非 ¥50.00），患者/前台看到错误金额。
3. **手机号/邮箱/身份证被置 null 而非掩码（后端 B-1）** `repository.ts:300`：通用 CRUD 响应把敏感字段置 null，前端 PatientsPage/UsersPage 依赖 → **患者列表手机号全空、按手机号搜索永久失败**（稳定复现）。
4. **幂等 async 分支的 COMPLETED 标记在业务事务外（后端 B-2）** `idempotency.ts:67-89`：注释声称"无调用点"，实际枚举出 **5 处真实调用**（workflow.ts:31/81/94/187、router.ts:63）；UPDATE 失败或进程崩溃后，30 分钟记录被清理，重试会**重复创建预约、重复发微信、重复入库**。
5. **微信提醒 UTC 日期 bug（后端 B-3）** `wechat-reminder.ts:186/197/206`：用 UTC 的 `substr(date)` 与 +8 诊所日期比较 → **每天凌晨 0-8 点的预约/就诊/建档系统性漏提醒**；`formatLocalTime` 还用服务器本地时区。
6. **新建数据全局搜索搜不到（后端 B-4）**：迁移 119 删除了全部 FTS 触发器，但预约/收费/划价/病历直写路径不再维护搜索索引 → "刚建的单子搜不到"（稳定复现，用户立刻感知）。
7. **审计缓冲静默丢弃（后端 B-5）** `app.ts:158-169`：flush 失败且缓冲超 2×上限时，审计行被丢弃且**无日志**。
8. **Cephalometric 缓存 key 不一致（前端 F-高）** `CephalometricPage.tsx:38-44`：注释声称共享缓存，实际 key 不同 → 同一 URL 首屏双请求、缓存不共享。
9. **确认按钮无 busy 态 → 双提交（前端 F-高）** `components.tsx:342-364`：ImagingPage 双 DELETE、DispenseListPanel 双删、toggleCategory 双 PATCH 净零但 toast 矛盾。
10. **种子凭据进入生产形态（安全 M4）** `database.ts:354-397`：NODE_ENV 缺省=development → 首启即种 `admin/REDACTED`、`doctor/REDACTED`；`V2_ALLOW_DEV_SEED=1` 时每次启动重置 admin 密码。

## 6. 边界条件没处理的（代表性 8 个）

- **分页**：`parsePagination` 已收编（第五轮修复），但通用 CRUD 的 pageSize 上限、page 超界后的行为未全量覆盖（后端 M 级若干）。
- **金额**：PatientTimelinePage 未走 formatMoney（见上）；`toFixed` 与浮点混用点在财务模块仍有残留（后端 M）。
- **空值**：多个工作台页面 `events[0]?.x` 链式访问存在 undefined 崩溃面（前端 M）。
- **时间**：全库时间基本 ISO，但 wechat-reminder 的时区假设（见上）+ 迁移脚本内嵌本地时间戳。
- **文件**：`files` 端点 GET 需 Bearer，`<img>` 标签无法带 header → 头像等图片直出 401（安全 M：可用性边界）。
- **并发**：`repository.ts update()` 中 `findById` 微任务交错窗口（后端 M）。
- **重复单号**：Dispense 有 `UNIQUE(clinicId, number)`（已核实），但冲突未转 409，仍会抛 500（后端 M4）。
- **空库/首启**：开发种子与生产形态纠缠（安全 M4）。

## 7. 性能问题

- **工作台整页门控 ×7 页（前端 F-高）**：挂载即 5 个并发查询 + 单一 isLoading 整页 Loading，任一子接口失败整个工作台不可用（ClinicalWorkflowPage:51-66 等 7 页同模式）。
- **首屏双请求**：CephalometricPage 缓存 key 不一致（F-高）。
- **CI 无缓存、18 步全串行、25 分钟超时**（cicd-H8）：pnpm store 与 Playwright 浏览器每次都全量装；20 万行基准插入在共享 runner 耗时不确定。
- **大列表**：收费/库存等长列表无虚拟化（前端 M）；`benchmark-load` 20 万行说明规模预期，UI 层未按此优化。
- **全局搜索索引失效**（后端 B-4）会演变成"搜索慢或搜不到"，比性能更糟。

## 8. 安全风险（按严重度）

- 🔴 **H1 自动更新供应链劫持 → RCE**：公开更新源 + 无 publisherName/签名校验 + autoDownload=true（electron/main.cjs:697-703）。
- 🟠 **M1 预认证登录 DoS**：5 次失败锁 15 分钟无解锁通道 + IP 限流因绑 127.0.0.1 实为全局额度 → 攻击者可锁死全部账号。
- 🟠 **M2 收费组合价格注入 + 私有套餐越权**：通用 CRUD 对 DOCTOR 开放含 price 字段，无所有权校验；按明细存储价建收费单无一致性校验 → 财务造假面。
- 🟠 **M3 DOCTOR 可见诊所级财务汇总**：stats/dashboard 对 DOCTOR 返回 paidAmount/unpaidAmount，与 revenue 仅 BOSS 可见策略不一致。
- 🟡 **M 系列**：审计日志可删、deviceToken 走 query string、跨诊所建号（创建时未锁 clinicId）、sync 令牌吊销缺失、4 个 IPC handler 无 sender 校验（低危纵深不一致）。
- ✅ **已实测收口的点**：生产打包版 CORS 实际可用（Electron file:// 请求不带 Origin，无预检）；SQL 注入面全参数化复核通过；前端 XSS 面无问题。

## 9. 重复代码、文件、目录

- **收费单编号生成逻辑复制粘贴 6 处（structure H-01）**：`CHG-${Date.now().toString(36)}-${randomUUID().slice(0,8)}` 在 financial/charge-tree/prescription-process/treatment-plan-billing 完全重复，另有 inventory-docs、replenishment 变体——改格式要同步 6 处，且无碰撞保护。
- **前后端 DTO 双写且已漂移（structure H-02）**：`web/types.ts` 重写 `ResourceField/ResourceDefinition`，与 `domain/contracts.ts` 字段集不一致（web 版缺 unique/default/min/max，capabilities 结构都不同）。
- **STATUS_LABELS 至少 8 处重复**且文案不一致（"已到诊" vs "已到店"）。
- **三个通用 CRUD 页面职责重叠**：CrudPage / SimpleListPage / ResourcePage（M-02）。
- **`.github/workflows` 根与 source 双份**（cicd-H6，且代码已漂移）。
- **表结构双写**：`syncLegacySchema` 用正则从 `legacy/schema/*.tables.ts` 文本提取 CREATE TABLE 执行（structure H-03）——格式漂移即静默改变建表结果。

## 10. 不容易维护的设计

- **`migrations.ts` 1668 行单体**、version 101 起跳，且同时管着"迁移"与"legacy 同步建表"两套逻辑（structure M-06）。
- **`financial.ts` 859 行、`resources.ts` 1026 行**，20 个非 spec 文件 >400 行。
- **`src/web` 155 个文件、顶层平铺 105 个** + 三种命名风格并存（PascalCase 页面 / kebab-case 目录 / 混合类型文件）——新模块不知道放哪（structure M-01）。
- **路由注册三件套**：route-policy.ts（权限表）+ registry（资源定义）+ 专用路由并存，DOCTOR/BOSS 权限在两个地方定义，已出现不一致（安全 M2/M3 即源于此）。
- **幂等注释与实现脱节**：注释说"无调用点"，实际 5 处（后端 B-2）——注释撒谎比没有注释更危险。
- **版本号多处手写**：package.json / verify-remote-release.mjs 默认值 / external-gates.md / MATURITY.md 各自维护，已漂移（cicd C2）。

## 11. 未来扩展会踩坑的地方

- **新业务模块要复制多少样板**：通用 CRUD + 专用路由 + route-policy + 资源 registry + 前端类型双写，五处都要改，任何一处漏了就出现权限/字段不一致（M2/M3 就是活例子）。
- **legacy 同步建表用正则解析 TS**：加一张表 = 改 tables.ts + 祈祷正则匹配；换成显式 schema 描述文件是必经之路（H-03）。
- **FTS 索引**：如果未来要恢复全局搜索，触发器已删、直写路径未维护，等于要从零建索引管线（B-4）。
- **发布数量增长后 upgrade smoke 静默跳过**（cicd-H9）：release >30 条后 `gh release list` 找不到当前 tag 会 exit 0 跳过，升级兼容性验证悄然失效。
- **多实例/多诊所部署**：限流绑 127.0.0.1、全局共享额度——一旦未来做服务端部署（现在只有单机），限流/登录锁语义全变（安全 M1）。
- **时区**：所有新增"日期"逻辑若继续用 `substr(ISO)` 与本地时区混搭，会持续踩 UTC/+8 的坑（B-3 是教训）。
- **自动更新**：若未来换签名证书/换发布源，electron-updater 的 `publisherName` 一旦配置错误，所有客户端更新全部失败（安全 H1 的另一面）。

## 12. 异常处理不完整的

- **审计缓冲静默丢弃**（B-5，合规风险最高）。
- **空 catch / 吞错**：子报告扫描确认整体较少（后端质量较高），但存在若干 `catch (e)` 不记录日志的异步回调（M 级）。
- **幂等失败清理**：async 路径失败后 DELETE 记录、但成功路径 UPDATE 不在事务内（B-2）——失败/崩溃语义不对称。
- **IPC invoke 未 catch**：前端个别 invoke 调用没有 .catch，失败时 UI 无提示（前端 M）。
- **启动阶段**：main.ts 对端口占用/DB 打开失败的处理有日志，但无用户可见的友好错误页（M）。
- **迁移失败**：migrations.ts 失败后无自动回滚提示，只抛异常（M）。

## 13. 日志、错误提示不清晰

- **审计丢弃无日志**（B-5）：最严重的一例"静默"。
- **工作台错误**：7 个工作台页面单一 isLoading/error，失败只显示笼统错误，不指出是哪个统计接口挂了（F-高）。
- **错误消息给用户的是英文/技术栈**：部分 HTTP 错误直接透传内部 message（M），诊所前台看不懂。
- **CI 失败无 artifact**：coverage/Playwright report 不上传，失败只 dump dev server 日志，排查靠猜（cicd-H8）。
- **smoke 跳过无告警**：upgrade smoke 静默 exit 0（cicd-H9）；建议 `::warning::`。
- **logger 本身质量不错**：统一 logger、带请求上下文，这是本轮少有的亮点（后端报告确认）。

## 14. 文件和文件夹过多，解决方案

`src/web` 155 文件平铺 + 构建产物/运行时数据散落（structure M-05，共 ~125MB 可释放）：

- **方案 A（推荐，低成本）**：按业务域建子目录（patients/appointments/billing/inventory/dispense/...），把顶层 105 个页面按域归位；统一命名约定（组件 PascalCase、页面按域命名、类型集中 types/）；用 knip 收紧 ignore 清单让死代码检查真正生效（当前 3 个 ignore 造成盲区 H-04）。
- **方案 B（中成本）**：按 feature 组织 `src/features/<domain>/{pages,components,hooks,api}`，配合 barrel export；适合未来模块化扩展。
- **立即执行**：删除 ~125MB 运行时产物（coverage/、dist-web/、dist-electron/server.cjs、release-v2/ 112MB exe、logs/、v2.sqlite* 侧车、data/backups/*.sqlite-shm/-wal、pre-migration 快照）——全部未跟踪，删除不影响 git 与构建（structure 报告有精确清单）。
- **结构性**：消除 `source/` 双副本（cicd-H6），统一开发根。

## 15. 无用代码、死代码、无用文件

- **knip 实测 0 报告但不可信**：3 个 ignore（src/domain/contracts.ts、legacy/schema/**、electron/preload.cjs）造成盲区（H-04）。
- **`legacy/schema/**` 无任何代码 import**，但它被 `syncLegacySchema` 以正则方式"运行时读取"——它是死代码的"活"依赖（H-03/M-07）。
- **`legacy/dental.sqlite` 未跟踪但 3 处发布脚本依赖它**（C1）——"被删除却还被需要"的典型。
- **`pre-migration/` 一次性快照**：迁移完成即可删除。
- **`FormBuilder` 等疑似死组件**：经核实仍被 ResourcePage 使用，未删（结构 agent 澄清过误报）——但此类"查了才知道"的组件正说明引用可视化缺失。
- **可安全删除清单**（全部未跟踪）：`coverage/`、`dist-web/`、`dist-electron/server.cjs`、`release-v2/`（112MB）、`logs/v2.log`、根 `v2.sqlite*`（确认活动库后）、`data/backups/*-shm/-wal`、空目录 `files/`、`data/files/`、`pre-migration/pre-2026-08-06*.sqlite`。
- **不可删**：`build/icon.ico`（打包图标）、`legacy/schema/**`（运行时读取）、`src/domain/legacy-resources.generated.ts`（生成物被引用）。

---

## 修复优先级建议

**P0（先做，全部是"发布/安全/合规"级）**
1. cicd-C1：恢复 dental.sqlite 进发布输入，或同步删除 3 处校验并加显式提示（二选一，但必须闭环）
2. 安全-H1：更新源加签名校验（publisherName）+ 关闭 autoDownload 或升级为强制校验；发布 action 全部 pin SHA
3. 后端-B1：手机号/邮箱掩码策略改为"掩码展示 + 搜索用原文"或明示前端改造（否则患者列表手机号全空）
4. 后端-B2：幂等 async 路径 COMPLETED 标记移入业务事务/或改用 sync 等价实现（5 个调用点）
5. 后端-B5：审计缓冲超限时改为持久化落盘或至少记 ERROR 日志

**P1（业务可见缺陷）**
6. 前端-F1：PurchaseOrdersPage 驳回改用 PromptDialog（window.prompt 在 Electron 不可用）
7. 前端-F2：PatientTimelinePage 金额走 formatMoney
8. 后端-B3：wechat-reminder 时区改为显式 +8（或配置化），修复凌晨漏提醒
9. 后端-B4：重建直写路径的搜索索引维护（或明确接受"新数据不进索引"并告知用户）
10. 前端-F4：ConfirmDialog 加 busy 态防双提交；工作台 7 页改逐接口错误态
11. 安全-M1：登录失败加验证码/解锁通道；限流改按"进程级+账号级"双维度

**P2（卫生与扩展性）**
12. cicd-C2 版本事实源统一；structure H-01 编号生成收编工具函数；H-02 DTO 单一来源（codegen）
13. `src/web` 按域分目录；删 125MB 产物；knip ignore 收紧
14. 迁移/财务大文件拆分；STATUS_LABELS 收编常量
15. 补 CI 门禁：windows-smoke 进 required checks、verify-foreign-keys/verify-database 进 CI、缓存与 artifact

## 结论

工程质量连续多轮保持高位（无 P0 崩溃级、注入面干净、事务可靠），但本轮真正的风险不在代码而在**发布链路与信任边界**：C1（发布必失败）、安全-H1（更新通道 RCE 面）、H6（双工作副本漂移）三者叠加，意味着"本地全绿、CI 全绿"都无法保证交付物可用。建议下一迭代以 P0 五项为唯一目标，修完即打 v2-2.2.0 真实验证发布链路。

*附：本轮子报告见 `.audit-round7/`（security/backend/frontend/structure/cicd.md），每条发现均含文件:行与修复建议。*
