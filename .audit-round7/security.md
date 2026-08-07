# Dental Clinic V2 — 安全深度审计报告（Round 7）

- 审计对象：`D:/Desktop/rongyi/source/apps/v2`（Electron + Vite + React + Express + better-sqlite3，382 个 TS/TSX/CJS/MJS 文件，约 7 万行）
- 审计日期：2026-08-07
- 审计方法：按 `security-audit` / `security` skill 方法论的静态审计 + 定向动态验证（Chromium/Electron 行为实测、GitHub API 查询、限流/路由枚举）
- 重点维度：认证/授权（JWT、RBAC、IDOR）、注入（SQL/命令/XSS/路径穿越）、密钥与敏感信息、IPC 安全、依赖供应链、输入校验
- 结论摘要：**未发现可远程直接利用的注入或认证绕过漏洞**；SQL 全部参数化、路由 deny-by-default、前端无 XSS 直出。主要风险集中在**更新供应链（High）**、**登录侧 DoS（Medium）**、**财务权限边界不一致（Medium）** 以及一批纵深防御缺口（Low）。

---

## 统计

| 级别 | 数量 | 编号 |
|---|---|---|
| Critical | 0 | — |
| High | 1 | H1 |
| Medium | 7 | M1–M7 |
| Low | 8 | L1–L8 |
| 已验证加固点（非发现） | 2 | N1–N2 |

---

## High

### H1. 自动更新供应链无签名强制：公开 feed + autoDownload + Windows 无 publisherName → 更新即 RCE

- **位置**：`electron/main.cjs:697-703`（autoDownload/allowPrerelease/verifyUpdateCodeSignature 注释）、`package.json` build.publish（GitHub `1290464284-ship-it/rongyi`，无 `win.publisherName` / 无签名证书）、`electron/main.cjs:816-830`（check-updates/install-update）
- **问题描述**：
  1. 更新源仓库经 GitHub API 实测为**公开仓库**（`"private": false`），latest release `v2-2.1.4` 含 `Dental-Clinic-V2-Setup-2.1.4.exe` 资产，任何能获得该仓库写权限的人都能发布"新版本"。
  2. `autoUpdater.autoDownload = true`（main.cjs:697）：发现新版本即自动下载安装包，无需用户确认下载。
  3. electron-updater 在 Windows（NsisUpdater）上**仅当 electron-builder 配置了 `publisherName` 时才会执行 Authenticode 签名校验**；当前构建配置（package.json build）没有 `publisherName`，也没有代码签名证书，因此**下载的更新包不会被校验签名**。main.cjs:699-703 注释认为"默认实现即启用签名校验"，这在 macOS 上成立，在 Windows 上不成立（且未签名产物本身也无法被校验）。
- **攻击场景**：攻击者通过 GitHub 账号失陷 / 泄漏的 CI 令牌 / 仓库管理权，向 `1290464284-ship-it/rongyi` 发布 `v2.2.0` release，其中 Setup exe 为恶意载荷（如添加后门）。所有已安装客户端（`allowPrerelease` 对正式版关闭，但正式版号递增即触发）自动下载该包；用户点击"安装更新"（或托盘提示后重启安装）→ 以当前用户权限执行任意代码 → 窃取 userData 下数据库、备份、safeStorage 可解密密钥、患者数据。
- **修复建议**：
  1. 为安装包配置代码签名证书，并在 electron-builder 中设置 `win.publisherName`，确保 NsisUpdater 强制签名校验；保留 `verifyUpdateCodeSignature` 默认实现（勿赋布尔值覆盖）。
  2. 将 `autoDownload` 改为 `false`，改为"发现更新 → 提示 → 用户确认后下载安装"。
  3. 更新 feed 迁移到私有仓库或自建私有发布通道；对 release 资产维护独立 SHA256 清单并在服务端核验。
  4. 建立 GitHub 仓库的强身份认证（2FA）、最小权限令牌、发布审批流程。

---

## Medium

### M1. 预认证登录 DoS：账户 5 次失败锁定 15 分钟 + IP 限流在回环绑定下为全局共享额度

- **位置**：`src/server/application/service-modules/auth.ts:60-64`（5 次失败 → lockedUntil 15 分钟）、`src/server/http/routes/auth-admin.ts:11-12`（loginLimiter 20/min、ipLoginLimiter 10/min）、`src/server/http/rate-limit.ts:79-81`（createIpRateLimit 键 = `req.ip`）
- **问题描述**：
  1. 攻击者不需要任何凭据：对任一已知用户名（`admin`、`doctor` 或拼音姓名）尝试 5 次错误密码，即把该账户锁定 15 分钟；可循环锁定全部账户。无验证码、无邮件/短信确认、无管理员解锁通道（BOSS 也被锁）。
  2. API 默认绑定 `127.0.0.1`（`src/server/main.ts:189`），`req.ip` 恒为 `127.0.0.1` → `createIpRateLimit` 的 10 次/分钟额度是**全诊所所有登录请求共享的全局预算**：任何人（或某用户 10 次输错密码）在 1 分钟内触发 10 次登录请求，即全局拒绝所有登录 1 分钟。
  3. 若按 `.env.example` 建议配置 `V2_HOST=0.0.0.0` 局域网暴露，则上述 DoS 可远程发起。
- **攻击场景**：局域网内任意未认证攻击者循环 `POST /api/v2/auth/login`（admin + 随机密码 ×5 → 锁 15 分钟；再对任意用户名凑满 10 次/分钟 → 全局 429）→ 全诊所无法登录，业务停摆。
- **修复建议**：
  1. 账户锁定增加"已锁定账户也须等待/IP 指纹校验"或引入失败延迟（如逐次 +1s 退避）而非硬锁定；或锁定后提供 BOSS 紧急解锁接口（仍须 BOSS 登录，可改为仅限本机）。
  2. IP 限流按真实客户端地址：在反向代理/局域网场景解析 `X-Forwarded-For`（仅在可信代理后启用），或将限流键改为 `用户名` 为主、IP 为辅，避免回环单键。
  3. 对登录端点增加验证码/人机校验（局域网场景可接受简单滑动校验）。
  4. 文档明确：`V2_HOST=0.0.0.0` 属高风险配置，须配合 TLS 与网络层访问控制。

### M2. chargeCombos 授权不一致：DOCTOR 可创建/修改含价格套餐并越权读写他人私有套餐

- **位置**：`src/domain/resources.ts:829-846`（chargeCombos/chargeComboItems roles = ['BOSS','DOCTOR']，create/update 开启，字段含 `price`/`quantity`/`ownerId`/`type`）、`src/server/http/routes/charge-combo-routes.ts:15-28`（专用路由全部 financeStaff=BOSS）、`src/server/application/service-modules/charge-combo.ts:21-22`（注释明示"组合管理走 /resources 通用 CRUD"）、`src/server/application/service-modules/charge-combo.ts:51-68`（applyToCharge 用明细存储价格直接建收费单）
- **问题描述**：
  1. 专用路由 `/api/v2/charge-combos`（含 apply）为 BOSS-only，但**组合与明细的管理（增改）经通用 CRUD** `/api/v2/resources/chargeCombos|chargeComboItems` 放行 DOCTOR（registry roles 含 DOCTOR、create:true、update:true）。
  2. `applyToCharge` 直接用 `ChargeComboItem.price` 创建收费单（charge-combo.ts:58-64），**无价格一致性校验**（不比对价目表/ChargeTree）。任意 DOCTOR 可创建 PUBLIC 套餐并填任意价格（如 ¥0.01 或 ¥999999），BOSS 一键调出时即按该价格划价 → 财务造假 / 超收 / 少收风险。
  3. 通用 CRUD 的 update/delete **无所有权校验**：DOCTOR 可 PATCH 他人 PRIVATE 套餐（改 `ownerId`/`type` 为 PUBLIC、改明细价格），也可经 `GET /api/v2/resources/chargeCombos` 列出他人 PRIVATE 套餐及其明细（type/ownerId 可见）——专用服务 `comboWithItems`（charge-combo.ts:44-46）的私有可见性限制被通用路径绕过。
  4. 套餐 CRUD 默认 `audit: false`（crud() 默认），组合价格改动不留审计痕迹。
- **攻击场景**：恶意 DOCTOR 创建 PUBLIC 高额套餐 → 诱导 BOSS 在收费台一键应用 → 患者被多收；或修改主任医生 PRIVATE 套餐价格 → 下次 BOSS 调出时少收/多收。
- **修复建议**：
  1. 统一权限模型：组合/明细写操作与专用路由一致改为 BOSS-only（registry roles 收窄为 `boss`），或保留 DOCTOR 自建但强制 `type=PRIVATE` 且 `ownerId=context.userId`，并对 update/delete 做所有权校验。
  2. `applyToCharge` 增加价格校验：明细价格与 `catalogId` 对应价目（ChargeTree/ChargeItem）比对，偏差超阈值拒绝或标记复核。
  3. 套餐及明细 CRUD 开启审计（audit: true）。

### M3. stats/dashboard 对 DOCTOR 泄露诊所级财务汇总，与 revenue 的 BOSS-only 策略不一致

- **位置**：`src/server/http/route-policy.ts:53`（`/api/v2/stats/dashboard` → allStaff）、`src/server/http/route-policy.ts:54`（`/api/v2/stats/revenue` → adminStaff=BOSS）、`src/server/application/read-services.ts:26-52`（dashboard 返回 `paidAmount`/`unpaidAmount` 汇总）
- **问题描述**：系统为财务数据设置了 financeStaff=BOSS 角色（charges/revenue 均 BOSS-only），但 dashboard 端点对 DOCTOR 开放且返回诊所级累计实收/应收金额。若诊所政策是"医生不见钱"，此处即绕过。
- **攻击场景**：DOCTOR 调用 `GET /api/v2/stats/dashboard` 即可持续获得全诊所收入规模与应收余额，用于薪酬谈判/泄露给第三方。
- **修复建议**：将 dashboard 的金额字段按角色裁剪（DOCTOR 返回 `paidAmount/unpaidAmount` 为 null 或仅返回本人相关统计），或把 dashboard 拆分为 BOSS/DOCTOR 两个视图。

### M4. 非生产默认凭据：NODE_ENV 缺省即 development，首启种 admin/ry0801 与 doctor/123456；V2_ALLOW_DEV_SEED=1 每次启动重置 admin 密码

- **位置**：`src/server/main.ts:193`（`NODE_ENV ?? 'development'`）、`src/server/infrastructure/database.ts:354-397`（seedDatabase：非生产种 admin（默认 `ry0801`，可用 `V2_ADMIN_PASSWORD` 覆盖）+ doctor/123456 + demo 数据；`NODE_ENV==='development' && V2_ALLOW_DEV_SEED==='1'` 时**每次启动重置 admin 密码为 seedPassword**）
- **问题描述**：
  1. 生产部署若忘记设置 `NODE_ENV=production`（手动 `npm start` / 直接跑 server.cjs），主进程按 development 处理：JWT secret 每次重启随机（main.ts:203）、种子账户被创建——首次启动即存在 `admin/ry0801` 与 `doctor/123456` 两个可登录账户。
  2. `V2_ALLOW_DEV_SEED=1` + development 会把 admin 密码**每次启动重置**为默认值：一旦误开且服务暴露（LAN），任何人都能以默认密码登录 BOSS。
  3. 生产环境本身是安全的（seedDatabase 在生产且无 admin 时直接 throw，database.ts:361-363）——风险全部来自配置错误。
- **攻击场景**：运维用默认方式启动（未设 NODE_ENV）并配 `V2_HOST=0.0.0.0` 后，攻击者用 `admin/ry0801` 直接登录获得 BOSS 全权限。
- **修复建议**：
  1. 启动时强制校验：非显式设置 `NODE_ENV=production` 且存在种子账户时打 WARN 并在日志中高亮；生产部署脚本强制注入 `NODE_ENV=production` 与 `V2_JWT_SECRET`。
  2. 移除 `V2_ALLOW_DEV_SEED` 的"重置已存在 admin"行为，改为仅创建缺失账户；文档标注其危险语义。
  3. 首启后强制改密（admin 首次登录必须修改默认密码才能继续）。

### M5. 局域网暴露（V2_HOST=0.0.0.0）时全链路明文：无 TLS、Bearer 令牌明文传输

- **位置**：`src/server/main.ts:189`（`host = process.env.V2_HOST ?? '127.0.0.1'`）、`.env.example`（"需要局域网访问时改为 0.0.0.0"）、`src/server/http/app.ts:304`（express.json 无 TLS）
- **问题描述**：API 无 HTTPS 能力（无证书加载代码），JWT、刷新令牌、患者数据在局域网明文传输；同时 CORS 对"无 Origin 头"的请求一律放行（app.ts:270-272），`curl`/脚本/内网恶意程序可完全无视 CORS 调用 API（仅受登录保护）。
- **攻击场景**：诊所 Wi-Fi 上攻击者抓包获得 `admin` 的 Bearer token / refresh token → 离线重放（refresh token 重放会吊销会话族，但 access token 8 小时有效期内可直接使用）；或直接脚本爆破登录（叠加 M1）。
- **修复建议**：局域网部署启用 TLS（自签/内部 CA + 客户端预置 CA 均可行，Electron 侧允许自签 CA 需在 webRequest 处理）；或将 V2_HOST 保持回环并在前置代理（nginx HTTPS）后转发；为 refresh token 增加设备绑定。

### M6. 审计盲区：401/403 经中间件短路不入审计表；BOSS 可无痕清空审计

- **位置**：`src/server/http/app.ts:339-371`（authMiddleware 在审计中间件之前，401 直接 next(error) 短路；角色门 403 依赖 `res.on('finish')` 才记录）、`src/server/application/service-modules/auth.ts:414-417`（AuditService.cleanup 仅校验 BOSS 角色）
- **问题描述**：
  1. 未认证请求（无/坏 token）在 authMiddleware 即被拒绝，**不产生审计记录**——对受保护端点的令牌探测/重放尝试不可见（仅有普通请求日志含 statusCode，无结构化审计、无细节）。
  2. `system/audit/cleanup` 允许 BOSS 删除全部审计日志（按设计），审计日志不可抵赖性依赖 BOSS 行为自律。
- **攻击场景**：攻击者使用窃取的过期/伪造 token 探测各端点时不留审计痕迹；内部 BOSS 删除审计后无法追责（如 M2 中的套餐价格篡改）。
- **修复建议**：将审计中间件移到 authMiddleware 之前（401/403 也记录 userId=null + statusCode）；cleanup 增加"保留最近 N 天"或导出归档后才允许删除；审计表追加 append-only 约束（触发器禁止 UPDATE/DELETE，清理走专用归档流程）。

### M7. 已划价后计划级金额仍可经通用 CRUD 修改

- **位置**：`src/server/http/router.ts:125-130`（仅 `treatmentPlanItems` 的 price/quantity 在 billed=1 时锁定）、`src/domain/resources.ts:306-345`（`treatmentPlans.totalFee` 为 money 可写字段，`billed` 由专用 SQL 写入）
- **问题描述**：明细级有"已划价不可改价/量"锁，但计划级 `totalFee`/`discountRate` 未随 `billed` 状态锁定——DOCTOR（clinicalStaff）可在 BOSS 划价完成后继续 PATCH 计划的金额/折扣字段，造成"患者确认单显示金额"与"实际收费单金额"不一致，且无强制审计。
- **攻击场景**：内部人员划价后修改计划金额以掩盖超收/折扣，与 M2 组合可制造账实不符。
- **修复建议**：计划 PATCH 时若存在 billed=1 的明细，则拒绝修改 totalFee/discountType/discountRate/status；或对计划金额类字段变更强制审计 + BOSS 复核。

---

## Low

### L1. IPC 处理器 sender 校验不一致 + TRUSTED_RENDERER_PATTERN 前缀过宽

- **位置**：`electron/main.cjs:492`（`TRUSTED_RENDERER_PATTERN` 用 `^file:\/\/.*dist-web[\\/]index\.html` 的 `.*` 前缀——任意路径的 dist-web/index.html 均可信）、`electron/main.cjs:796-798`（`desktop:version`/`desktop:quit`/`desktop:api-port` 无 `assertTrustedRenderer`）、`electron/main.cjs:815`（`desktop:get-auto-launch` 无校验）
- **问题描述**：`desktop:api-port` 向任意 frame 泄露随机 API 端口（`desktop:quit` 可被任意 frame 关闭应用）。当前应用窗口导航被严格限制（will-navigate/setWindowOpenHandler/webview 阻止），实际可利用性低，但为纵深缺口：一旦出现任何渲染器 XSS 或本地文件写入（构造 `.../dist-web/index.html`），未校验 handler 即被滥用。
- **修复建议**：4 个 handler 统一加 `assertTrustedRenderer`；TRUSTED_RENDERER_PATTERN 收窄为打包目录精确路径（`path.join(__dirname,'..','dist-web','index.html')` 的 file:// URL 前缀）。

### L2. JWT/备份密钥经子进程环境变量传递；safeStorage 不可用时明文落盘

- **位置**：`electron/main.cjs:266-283`（spawn env 注入 `V2_JWT_SECRET`/`V2_BACKUP_KEY`，同机同用户进程可读）、`electron/main.cjs:126-180`（getOrCreateSecret：safeStorage 不可用时明文写入 userData/secrets）
- **问题描述**：Windows 上同用户进程可枚举子进程环境块；无 DPAPI 环境（如某些精简系统）时 JWT 密钥明文存储。本地同用户攻击者已可读写 userData（可解密数据库），实际增量风险低，但密钥本应只存在于主进程内存/受保护存储。
- **修复建议**：通过 IPC 通道把 secret 传给子进程（进程间仅保留内存引用），或使用 `process.env` 注入前加短暂随机化 + 子进程启动后立即从自身 env 清除（Node 无法完全清除，至少缩小窗口）；明文回退分支至少 `mode: 0o600` 并警告。

### L3. sync 拉取设备令牌走 query string

- **位置**：`src/server/http/routes/system.ts:19`（`req.query.deviceToken`）、`src/server/application/service-modules/sync.ts`（assertDevice）
- **问题描述**：`deviceToken` 出现在 URL 中，会进入访问日志、代理日志、浏览器历史（若浏览器模式使用）。令牌可被日志读取者重放（pull 接口）。
- **修复建议**：改为 `Authorization: Bearer <deviceToken>` 或自定义头；或至少对日志中间件做 URL 脱敏。

### L4. registerDevice 可吊销他人设备令牌

- **位置**：`src/server/application/service-modules/sync.ts:194-198`（`ON CONFLICT(clinicId, deviceId) DO UPDATE SET tokenHash = excluded.tokenHash ...`）
- **问题描述**：deviceId 为客户端任意字符串且可预测（如 "PC-1"）；同诊所任一 BOSS 调用 registerDevice 即可覆盖该 deviceId 的 tokenHash，使真实设备同步永久 401（需重新注册）。属内部设备 DoS。
- **修复建议**：重置 tokenHash 前校验既有设备归属（userId 相同才允许覆盖），或 registerDevice 幂等仅对同名同属主生效。

### L5. 备份恢复 marker 无签名/内容校验

- **位置**：`src/server/application/service-modules/backup.ts`（stageRestore 写 `.restore-pending.json`，含 stagedPath）、`src/server/infrastructure/restore-apply.ts:12-59`（applyStagedRestore 校验 stagedPath 在 allowedDirs 内且文件存在，但**不校验 marker 属主/完整性**）
- **问题描述**：本地攻击者若能写入数据目录（同用户即可），可伪造 marker 指向数据目录内任意 sqlite 文件（如旧备份/恶意文件），服务重启时 `copyFileSync` 覆盖工作库。由于本地同用户攻击者本可直接改写数据库，属纵深缺口。
- **修复建议**：marker 增加 HMAC（密钥用 V2_BACKUP_KEY 派生）或限定 stagedPath 必须在 backupDir 且文件名匹配 `clinic-<id>-backup-*`。

### L6. createUser 跨诊所建号无创建者成员校验

- **位置**：`src/server/application/service-modules/auth.ts:268-328`（BOSS 可传任意 `clinicIds`，仅校验目标诊所存在，不校验创建者是否在该诊所）
- **问题描述**：多诊所部署时，诊所 A 的 BOSS 可向诊所 B（知道其 UUID）添加用户并授予角色；配合密码重置可控制诊所 B 的账户。系统内 BOSS 通常视为全局管理员，风险有限。
- **修复建议**：创建用户时校验创建者与目标诊所的成员关系（或明确 BOSS 为全局管理员并在文档声明）。

### L7. wechatMessages 创建时可直写 SENT 状态（伪造发送记录）

- **位置**：`src/domain/resources.ts`（`wechatMessages` roles = reception=[BOSS,DOCTOR]，create:true，`status`/`sentAt` 为普通字段）、`src/server/application/service-modules/wechat.ts:157-189`（真实发送才 markSent）
- **问题描述**：DOCTOR 经通用 CRUD 创建消息时可把 `status` 直接设为 `SENT` 并填 `sentAt`，无需经过实际发送通道，即可伪造"已通知患者"记录（如术后提醒、随访通知）。
- **修复建议**：将 `status`/`sentAt`/`result` 加入 PROTECTED_WRITE_FIELDS，仅允许 send 服务写入。

### L8. 文件图片 `<img>` 直链无鉴权头 → 影像缩略图实际无法加载（可用性）

- **位置**：`src/server/http/routes/files.ts:79-90`（GET 需 Bearer）、`src/web/ImagingPage.tsx:403-412`、`src/web/imaging/*`（`<img src="${apiOrigin}${row.imageUrl}">` 无 Authorization）
- **问题描述**：`<img>` 无法携带 Authorization 头，`GET /api/v2/files/:name` 恒返回 401 → 影像缩略图/大图在浏览器与 Electron 中均无法显示（CORP 放开无效）。这是鉴权设计正确但缺少"签名 URL"机制导致的可用性缺陷；若为修复可用性而放开匿名 GET，则将引入未授权文件访问。
- **修复建议**：实现短期签名 URL（`/api/v2/files/:name?exp=<ts>&sig=<hmac>`，签名密钥派生自 V2_BACKUP_KEY，有效期如 5 分钟），`<img>` 使用签名 URL；保持 GET 默认需 Bearer。

---

## 已验证加固点（非发现）

### N1. 生产打包版 CORS 实测可用（round2 P0 复核通过）

- 位置：`src/server/http/app.ts:264-303`
- 验证方式：用项目内 Electron（webSecurity:true、sandbox:true）加载 `file://` 页面，对 `http://127.0.0.1:<port>` 发起带 `Authorization` 的 fetch，**服务端实测未收到 Origin 头、无 OPTIONS 预检**（Electron 对 file:// 页面不按 CORS 预检处理）；对照用 Playwright Chromium 同一场景则发送 `Origin: null` 并触发预检。
- 结论：打包版（NODE_ENV=production + file:// 渲染器）的 API 请求走 `!origin` 分支被放行，**应用可用**；对 `Origin: null`/`file://` 的拒绝是对沙盒/iframe/恶意本地 HTML 的有效纵深防御，建议保留。附件验证脚本已删除，如需复测可按上述方法重建。

### N2. 注入面全面收口（复核确认）

- SQL：`src/server/infrastructure/repository.ts`（列名白名单、参数化、LIKE 转义 `[\\%_]`）、`src/server/infrastructure/search-index.ts:3-8`（FTS MATCH 参数化 + 双引号包裹）、`src/server/http/validation.ts`（声明式字段校验 + 白名单取键）、`legacy-registry.ts`（静态 registry 查表）——全库模板字符串 SQL 仅插值白名单标识符（tenantAnd/表名/排序字段），无用户输入直拼。
- 认证：HS256 固定算法（auth.ts:148-154）、tokenVersion 全端失效、refresh token 旋转 + RFC 6819 重放吊销（auth.ts:81-122）、bcrypt cost 10 + DUMMY_HASH 防枚举（auth.ts:47）。
- 授权：路由 deny-by-default（app.ts:364-371）+ 资源级角色（router.ts:28-30）+ 租户作用域（tenantAnd）+ 敏感字段写保护（security.ts:36-78）+ 同诊所关联校验（repository.ts assertRelations）+ 已划价明细锁定（router.ts:125-130）。
- 上传：`files.ts` 扩展名白名单 + magic bytes + 20MB/200 文件/500MB 配额 + 服务端 UUID 文件名 + GET 文件名 UUID 正则。
- XSS：前端无 dangerouslySetInnerHTML/innerHTML/document.write/eval（全量 grep）；打印与模板渲染全部 escapeHtml（read-services.ts:155-162、analytics.ts:106-116）；CSP `script-src 'self'` 无 unsafe-inline（main.cjs:750）；`setPermissionRequestHandler` 全拒、webview 阻止（main.cjs:743,761）。
- 密钥：JWT secret 生产缺失即拒绝启动且要求 ≥32 字符（main.ts:199-206）；safeStorage 加密（不可用时明文回退见 L2）；secret IPC 键白名单（main.cjs:488,764-795）。
- 幂等：withIdempotency 同步路径已事务化（idempotency.ts:96-109），round2 的非原子问题已修复。
- 备份：AES-256-GCM + magic + 前缀隔离（backup.ts）；restore marker 路径校验（restore-apply.ts:29-44）。
- 依赖版本：express 5.2.1 / better-sqlite3 13 / jsonwebtoken 9 / bcryptjs 3 / helmet 8 / electron-updater 6.3 均无已知公开高危版本（未发现 lockfile 或 SCA 报告，建议接入 CI 依赖审计）。

---

## Top 5 发现

1. **H1** `electron/main.cjs:697-703` + `package.json` build：自动更新供应链无签名强制（公开仓库 + autoDownload）→ 更新即 RCE
2. **M1** `src/server/application/service-modules/auth.ts:60-64` + `src/server/http/rate-limit.ts:79-81`：账户锁定 + 全局 IP 限流 → 未认证登录 DoS
3. **M2** `src/domain/resources.ts:829-846` + `src/server/application/service-modules/charge-combo.ts:51-68`：套餐价格注入与私有套餐越权
4. **M3** `src/server/http/route-policy.ts:53-54` + `src/server/application/read-services.ts:26-52`：dashboard 向 DOCTOR 泄露诊所财务汇总
5. **M4** `src/server/infrastructure/database.ts:354-397` + `src/server/main.ts:193`：非生产默认凭据（admin/ry0801、doctor/123456）与每次启动重置开关

## 最危险的 3 件事

1. **更新通道被劫持（H1）→ 全盘任意代码执行**：公开 feed + 无签名校验 + 自动下载，一旦仓库/账号失陷，所有客户端静默变为肉鸡，患者数据、数据库、备份全部失守——这是唯一可能导致"完全沦陷"的路径，应最先处置。
2. **未认证登录 DoS（M1）→ 诊所业务停摆**：5 次错误密码锁一个账户、10 次/分钟锁全诊所登录；局域网暴露下可远程反复触发，且无解锁通道。
3. **收费组合价格注入 + 财务越权（M2）→ 财务造假/多收少收**：DOCTOR 可写任意套餐价格并篡改他人私有套餐，BOSS 一键划价即生效，且套餐改动无审计——直接威胁资金与医患信任。
