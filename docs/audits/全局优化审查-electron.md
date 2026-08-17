# 全局优化审查 — Electron 主进程

> 范围：`apps/v2/electron/*`（main.cjs、preload.cjs、tray.cjs、window.cjs、api-process.cjs、api-env.cjs、secrets.cjs、constants.cjs、cert-trust.cjs、logging.cjs、telemetry.cjs、watchdog.cjs、supervisor.cjs、redact.cjs、state.cjs、error.html）+ `package.json` 的 `build` 段。
> 性质：只读审计，未修改任何 src/electron 文件。

## 1. 高优先级（安全/稳定性）

**H1. API 随机端口重启后，渲染层 meta CSP 的 connect-src 失效 → 所有请求被拦截（稳定性/一致性）**
- `window.cjs:127-157`（prepareRuntimeHtml）把 `index.html` 里 meta CSP 的 `http://127.0.0.1:*` 替换为“当前”精确端口后写入 userData 缓存；`api-process.cjs:146`（doStartApi → `pickFreePort()`）在每次重启时都重新随机选端口（`api-process.cjs:82-88`）。打包版 API 崩溃/手动重启后端口变化，而渲染层只做 `resetApiBase()` 与 `invalidateQueries()`（`src/web/lib/api.ts:102-107`、`src/web/main.tsx:22-24`、`src/web/pages/system/DesktopSettingsPage.tsx:112-114`），既不重跑 prepareRuntimeHtml 也不重载页面。旧端口的 `connect-src` 仍在，新端口 `http://127.0.0.1:<new>` 被 CSP 拦截。
- 影响：手动「重启 API」按钮、以及崩溃后自动恢复，都会让应用进入“API 已就绪但所有请求被 CSP 挡死”的状态，直到窗口关闭重建（createWindow 重跑 prepareRuntimeHtml）或应用重启。
- 建议：会话内保持端口稳定（重启时复用 `state.apiPort`，仅在端口被占时才换新端口），从根上消除漂移；或端口变化时重写运行时 HTML 并强制 `reloadURL`（须先重跑 prepareRuntimeHtml 再载入新 URL）。禁止靠“改回 connect-src 通配”来回避——那会退回 `http://127.0.0.1:*` 的回环探测风险。

**H2. JS 级崩溃被双重拉起：watchdog `app.relaunch` 与外部 supervisor 同时启动新实例（稳定性）**
- `logging.cjs:87-100`（handleFatalCrash）→ `watchdog.cjs:60-75`（relaunchAfterCrash）执行 `app.relaunch()` + `app.exit(1)`；但 `supervisor.cjs:42-83` 检测到父进程死亡且无停止标记时也会 spawn 新实例。JS 崩溃路径在未达上限时（`watchdog.cjs:36-54`）不写 `.supervisor-stop`，于是两个拉起机制同时触发。
- 影响：瞬时双实例竞态（靠单实例锁兜底、第二个实例退出），产生冗余进程与日志噪音；且 `crash-loop.json`（watchdog，`watchdog.cjs:8-9`）与 supervisor 的 `MAX_CONSECUTIVE`（`supervisor.cjs:24-25`）是两套独立的崩溃环计数，语义重叠。
- 建议：统一拉起机制——JS 崩溃路径要么在 relaunch 前写停止标记让 supervisor 放弃，要么不再调用 `app.relaunch` 而交给 supervisor 统一拉起（或 supervisor 识别 `V2_SUPERVISED`/relaunch 信号去重）。

**H3. `.supervisor-stop` 残留标记可在下次启动时静默关闭看门狗（稳定性）**
- `main.cjs:438-448`（will-quit）每次优雅退出都写 `.supervisor-stop`，`supervisor.cjs:46-54` 读到即删除并退出；但没有任何启动逻辑清除该标记。若上次退出时 supervisor 已不在（典型路径：初始 `startApi()` 失败 → `main.cjs:343-346` 提前 return、未 spawnSupervisor → 错误窗点「退出」→ will-quit 写标记），标记残留；下次成功启动 spawn 的 supervisor 一读到旧标记立即退出。
- 影响：该会话完全失去硬崩溃自动拉起能力，且无任何告警。
- 建议：在 whenReady 内 spawnSupervisor 之前（或紧接其后）删除 `userData/.supervisor-stop`，使“优雅退出写入、启动清除”成对；或在 spawnSupervisor 入口显式 `rmSync(stopMarker)`。

**H4. safeStorage 不可用时 JWT/备份密钥明文落盘（安全）**
- `secrets.cjs:60-62`：`safeStorage.isEncryptionAvailable()` 为 false 时把 JWT 密钥与备份加密密钥以明文写入 `userData/secrets`（仅 `console.warn`）。
- 影响：Windows 上 DPAPI 一般可用，但一旦不可用（域策略/损坏的用户 profile），JWT 签名密钥与 `.enc` 备份解密密钥明文暴露，可被用于伪造会话、解密患者数据备份。
- 建议：至少 fail-closed（拒绝明文持久化，改用仅内存会话并明确提示），或提示用户修复 DPAPI 前不写备份密钥。

## 2. 中优先级（一致性/健壮性）

**M1. 头 CSP 与 meta CSP 双轨且字段分歧，注释意图与生产实际不符（一致性/维护）**
- `main.cjs:218-237` 用 `onHeadersReceived` 注入 header CSP；生产页面经 `file://` 加载，Electron webRequest 不拦截 `file://`，故该 header CSP 在生产不生效，生产实际只受 `index.html:12-15` 的 meta CSP + `window.cjs:127-157` 重写约束。两处字段也不一致：header 用 `base-uri 'none'`、无 `media-src`、生产仍 `style-src 'unsafe-inline'`、`script-src 'self'`（无 nonce）；meta 用 `base-uri 'self'`、有 `media-src`、nonce。`main.cjs:220-223` 注释称“收紧 connect-src 到精确端口”，在生产实际由 prepareRuntimeHtml 承担，header 属重复/误导。
- 影响：维护者可能误以为两处均生效；后续改 CSP 易失同步。
- 建议：明确“meta（+prepareRuntimeHtml）为生产唯一来源、header 仅 dev 生效”，并在注释写明；或统一两者字段，避免分歧。

**M2. WeChat AppId 双通道传递 + adminPassword 打包态仍可经 secret file 注入（一致性）**
- `api-env.cjs:26-38` 的 optionalKeys 含 `V2_WECHAT_APP_ID`，同时 `api-process.cjs:161` 又把 `wechatAppId` 写入 secret file，AppId 走 env 与 secret file 两条通道；`api-env.cjs:22-24` 注释“JWT/备份密钥只经 V2_SECRET_FILE”未说明 AppId 例外。
- `api-process.cjs:165` 无条件 `process.env.V2_ADMIN_PASSWORD ?? undefined` 写入 secret file（打包态亦然），而 `api-env.cjs:40-42` 只在非打包态透传 `V2_ADMIN_PASSWORD`；`api-process.cjs:156` 注释“生产打包版不注入 V2_ADMIN_PASSWORD”与实现不符。
- 影响：注释/文档误导，且打包态若环境变量存在会经 secret file 传入初始管理员密码（非预期注入面）。
- 建议：统一白名单与通道（AppId 只走一处），修正 adminPassword 注释，或在打包态也显式跳过 adminPassword。

**M3. 端口探测存在 TOCTOU 竞态（健壮性）**
- `api-process.cjs:72-88`：`isPortFree` 先 bind 探测再 close，随后才 spawn 子进程绑定；探测释放到子进程绑定之间的窗口期可能被其他进程抢占，子进程仍会 EADDRINUSE → 走重启退避。注释（`api-process.cjs:69-71`）声称“避免 EADDRINUSE”，并不完全成立。
- 影响：概率极低（回环 + 2 万随机段），但注释夸大。
- 建议：修正注释为“显著降低但不消除竞态”；如需根除可改由内核分配端口（listen 0 后回读），或结合 H1 一并“复用端口”从而只需首次探测一次。

**M4. stopApi 立即置空 apiProcess，使 will-quit/exit 的同步兜底无法覆盖未死子进程（健壮性）**
- `api-process.cjs:347-348` 先 `state.apiProcess = null` 再异步等退出；若 1500ms 宽限后 `processToStop.kill()` 失败（`api-process.cjs:364-366`），`terminateApiSync()`（`api-process.cjs:399-419`，被 `main.cjs:438-448/451-453` 调用）因 apiProcess 已为 null 无法再 taskkill 兜底。
- 影响：极低概率留下孤儿写库进程（Windows 上 TerminateProcess 基本可靠）。
- 建议：shutdown 期间保留进程引用，或让 terminateApiSync 接受显式 proc 参数。

**M5. 渲染层崩溃恢复计数不随成功恢复重置（健壮性）**
- `window.cjs:180-203`：`rendererCrashCount` 仅在 10 分钟窗口过期时重置；窗口内连续崩溃达 3 次后停止自动恢复，即使期间曾成功恢复也不降计数。
- 影响：窗口内偶发多次崩溃会被判为“崩溃环”，需要用户手动托盘退出重启；行为偏保守但非缺陷。
- 建议：在 `did-finish-load` 成功时对计数做适度衰减/重置。

**M6. `desktop:restart-api` 前置状态重置是死操作（维护）**
- `main.cjs:296-301`：先置 `shutdownStarted=false; isQuitting=false`，随即 `stopApi()` 内部又置回 true（`api-process.cjs:345-346`），stopApi 后再置 false。前置两行无效、逻辑绕。
- 影响：误导读者，易在后续改动中出错。
- 建议：删除前置重置，或把“复位”逻辑收敛到一处。

**M7. 更新检查退避 setTimeout 未跟踪、未清理（健壮性）**
- `main.cjs:128` 的退避 `setTimeout(attemptCheck, ...)` 不保存句柄；`main.cjs:438-441`（will-quit）只清 `updateRecheckTimer`。
- 影响：退出瞬间可能多触发一次 checkForUpdates。
- 建议：保存句柄并在 will-quit 一并清理。

**M8. `pickFreePort` 错误消息硬编码端口段（维护）**
- `api-process.cjs:87` 消息写死“30000-50000 段”，与 `constants.cjs:16-17` 的 `RANDOM_API_PORT_MIN/MAX` 重复。
- 建议：消息用模板字符串引用常量。

## 3. 低优先级（维护）

**L1. 脱敏规则是两份人工同步副本**
- `redact.cjs:1-12` 注释称与 `src/server/infrastructure/redact.ts` 保持同一套规则，但为独立副本，易漂移。建议用测试 pin 两者输出一致或抽成共享模块。

**L2. 魔法数字仍散落**
- `api-process.cjs:23`（5MB）、`api-process.cjs:30`（10 分钟）、`api-process.cjs:96`（500ms 超时）、`api-process.cjs:118`（400ms 重试间隔）、`api-process.cjs:330`（5000ms）、`api-process.cjs:364-366`（1500/200ms）等仍内联，虽多数有注释但未命名化。

**L3. `getOrCreateSecret` 解密成功仅校验长度（安全加固）**
- `secrets.cjs:19` 解密后只查 `plain.length >= 32`，未复用 `isUsablePlainSecret`（`secrets.cjs:6-8`）的控制字符校验；损坏 DPAPI blob 解密出含控制字符串的概率极低，但统一校验更严谨。

**L4. supervisor 关键注释重复出现**
- `supervisor.cjs:44-45` 与 `supervisor.cjs:84-85` 完全相同“绝不能 unref 轮询定时器”注释出现两次，可合并。

**L5. 窗口状态重复写盘**
- `window.cjs:213-222`：`close` 与 `closed` 各调用一次 `saveWindowState`，重复写盘。

**L6. error.html 无 meta CSP**
- `error.html:1-22` 静态、无脚本，消息经 `JSON.stringify` 转义后由 `window.cjs:240-259` executeJavaScript 注入，风险低；可加最小化 meta CSP 以防御纵深。

**L7. 生产打包文件包含开发遗留物（一致性）**
- `package.json` `build.files` 含 `package.json` 整包与 `build/**/*`（`package.json:127-133`），会带入 `eslint.config.js` 等非运行时文件无关紧要，但 `legacy/schema/*.tables.ts` 与 `legacy/schema/legacy-schema.generated.sql`（`package.json:134-138` extraResources）是源码/生成 SQL，运行时仅需 SQL 与 `.tables.ts` 文本解析（`src/server/infrastructure/legacy-schema.ts:79-95`）。影响小，仅提示可裁剪。

## 4. 正面结论

- **隔离与 IPC 边界到位**：`window.cjs:109-119` 同时启用 `contextIsolation:true / nodeIntegration:false / sandbox:true / webSecurity:true / allowRunningInsecureContent:false / navigateOnDragDrop:false`；全部 13 个 `ipcMain.handle`（`main.cjs:245-338`）均首行 `assertTrustedRenderer`；`window.cjs:70-87` 用精确 file:// URL + 片段后缀白名单校验 senderFrame，无 `.*` 前缀通配。
- **导航/新窗口/权限收敛**：`window.cjs:89-107` 外部 http/https 一律 `shell.openExternal` 且拒绝应用内导航；`window.cjs:169-179` 新窗口强制沿用安全 prefs；`main.cjs:238-243` 全局禁止 webview + will-navigate 白名单；`main.cjs:197-203` 权限请求仅放行受信渲染器的剪贴板两项。
- **CSP 无生产 unsafe-inline**：`index.html:12-15` + `vite.config.ts:23-40` 生产 nonce 化；`window.cjs:127-157` 把回环通配收紧为精确端口（见 H1 的漂移短板，方向正确）。
- **密钥/令牌处理审慎**：safeStorage 加密（`secrets.cjs`、`main.cjs:245-276`）；JWT/备份密钥经 0o600 临时文件传递而非子进程 env（`api-process.cjs:147-166`，成功/失败均删除）；`ALLOWED_SECRET_KEYS` 白名单；`redact.cjs` 落盘前脱敏；`api-process.cjs:215-220` 子进程控制台输出脱敏落盘。
- **进程与恢复健壮**：单实例锁（`main.cjs:38-59`）、API 端口探测 + 两段式就绪窗口 + 指数退避重启上限（`api-process.cjs`、`constants.cjs:6-8/18-34`）、父侧心跳 + 孤儿自愈（`api-process.cjs:376-395`、`main.cjs:84-106`）、renderer 崩溃恢复护栏（`window.cjs:180-203`）、日志 5MB×5 轮转（`logging.cjs:15-28`）、更新缓存清理（`main.cjs:140-157`）。
- **更新器基线正确**：`main.cjs:62-64` 关闭自动下载/退出自动安装；`package.json` `win.verifyUpdateCodeSignature:true`；`main.cjs:110-136` 启动即查 + 24h 复检 + 1/5/30min 退避；`--publish never` 打包与显式发布分离。
- **环境变量白名单**：`api-env.cjs:26-42` 只透传白名单 V2_*，密钥不走 env；崩溃上报/遥测 URL 均 `isAllowedCrashReportUrl`（HTTPS + 白名单 host，fail-closed）（`constants.cjs:62-75`）。

## 5. Top 5 建议

1. **修复 API 端口漂移与 CSP 失配（H1）**：重启复用 `state.apiPort`（仅端口被占时换新），一次性消除手动重启与崩溃恢复后的“全请求被 CSP 拦截”，同时顺带缩小 M3 的 TOCTOU 面。
2. **统一崩溃拉起机制（H2）**：JS 级崩溃与原生 supervisor 去重，避免双实例竞态与两套崩溃环计数。
3. **启动时清除 `.supervisor-stop`（H3）**：与 will-quit 写入成对，杜绝残留标记静默关闭看门狗。
4. **safeStorage 不可用时 fail-closed（H4）**：禁止明文持久化 JWT/备份密钥，改仅内存会话并显式提示。
5. **收敛 CSP 单源并修正注释（M1）**：明确 meta+prepareRuntimeHtml 为生产唯一来源、header 仅 dev，消除 base-uri/media-src/style-src 分歧，避免后续维护失同步。
