# Round 7 审计：CI/CD、发布流程与运维可观测性

- 审计日期：2026-08-07
- 审计对象：`D:/Desktop/rongyi/source`（GitHub 实际生效内容为仓库根 `D:/Desktop/rongyi`，两者存在漂移，见 H6）
- 覆盖范围：`.github/workflows/` 全部 4 个 workflow（v2-ci.yml、v2-release.yml、v2-internal-release.yml、v2-windows-smoke.yml）、`apps/v2/RELEASE.md / MATURITY.md / README.md / package.json / .env.example`、`apps/v2/scripts/`（26 个脚本，重点：备份、同步、wait-for-services、验证类）、外层 `.github/workflows/` 与 `docs/`（release-modes.md、refactor-v2-release.md、docs/delivery/*）
- 方法：逐文件读全部 workflow（on/jobs/env/secrets/permissions）、GitHub API 实证（分支保护、releases、tags、environments、run 历史）、脚本逐行审阅、应用内 logger/错误处理/健康检查 grep、本地与远程版本一致性核对

> 注：任务清单中提到的 `ci.yml`、`deploy.yml`、`release.yml` 在本仓库中不存在，实际只有 `v2-*` 四个 workflow（见 I1）。本项目交付形态为桌面应用（GitHub Release = 交付渠道），没有常规"部署目标"，此点已计入审计结论。

---

## 严重度汇总

| 严重度 | 数量 | 编号 |
|---|---|---|
| 🔴 CRITICAL | 2 | C1, C2 |
| 🟠 HIGH | 9 | H1–H9 |
| 🟡 MEDIUM | 14 | M1–M14 |
| ⚪ INFO | 8 | I1–I8 |

---

## 🔴 CRITICAL（发布阻断 / 静默数据缺失）

### C1 — `legacy/dental.sqlite` 已从仓库移除，但发布链路全部硬性依赖它 → 现在打任何 `v2-*` tag 发布必然失败

- 位置：`apps/v2/scripts/verify-package.mjs:27-34`、`apps/v2/scripts/installer-smoke.ps1:42-47`（第 45 行检查 `resources\legacy\dental.sqlite`）、`apps/v2/package.json:112-117`（`build.extraResources` `from: legacy`）、`apps/v2/src/server/main.ts:165`（`existsSync` 判断 legacy 导入）
- 问题：提交 `5cf6967 chore(v2): remove legacy patient database from repository`（2026-08-05）把 `apps/v2/legacy/dental.sqlite` 从仓库删除（git 实证：`v2-2.1.4` tag 含该文件，`main` 不含；本地 `apps/v2/legacy/` 只有 `schema/`）。但所有发布验证脚本仍要求打包产物必须包含该文件：
  - `v2-release.yml:56-57` "Verify package"（`verify:package`）→ `verify-package.mjs` 检查 `win-unpacked/resources/legacy/dental.sqlite` 存在，缺失即 exit 1；
  - `v2-release.yml:62-63` "Installer smoke"（`installer:smoke`）→ `installer-smoke.ps1:45` 同样要求该文件；
  - `v2-internal-release.yml:43-52`（默认 `run_installer_smoke=true`）→ `build-internal-installer.ps1` 内部调用 `installer:smoke`，同样失败。
- 实证：V2 Windows Installer Smoke run `31152269595`（2026-08-07，PR）失败，日志 `Missing installed file: ...\resources\legacy\dental.sqlite`。
- 影响：① 现在打 `v2-2.2.0` tag 触发 `v2-release.yml`，在 "Verify package" 步骤即失败，发布直接红；② 即使手工绕过校验发布成功，打包版 `resources/legacy/dental.sqlite` 缺失 → `main.ts:165` 的 `existsSync` 为 false → **新装机用户 legacy 数据导入被静默跳过**（老用户升级不受影响，但新装机没有历史数据，且无任何告警）。
- 修复建议：把 `dental.sqlite`（2.4 MB）重新纳入发布输入——从 `v2-2.1.4` tag 提取并提交回仓库（内部受控交付，体积可接受），或 release workflow 先从 git 历史/工件下载再打包；若产品决定正式放弃 legacy 导入，必须同步修改 `verify-package.mjs`、`installer-smoke.ps1`、`upgrade-smoke.ps1` 与新装机验收路径，而不是只删文件。

### C2 — 2.2.0 版本漂移：package.json=2.2.0、本地产物已生成，但远程从未发布 v2-2.2.0

- 位置：`apps/v2/package.json:3`（`"version": "2.2.0"`）、`apps/v2/release-v2/`（存在 `Dental-Clinic-V2-Setup-2.2.0.exe`、blockmap、latest.yml）、`apps/v2/scripts/verify-remote-release.mjs:3`（默认 tag 硬编码 `'v2-2.2.0'`）
- 问题：GitHub API 实证：远程 tags/releases 最新只有 `v2-2.1.4`（另有 prerelease `v2-internal-2.1.4`），**没有 v2-2.2.0**。本地却已构建 2.2.0 产物，`verify-remote-release.mjs` 默认值也写死 2.2.0（本地裸跑 `verify:remote` 会因 release 不存在而失败）。
- 影响：版本事实源混乱——"2.2.0 是否已发布"无法从仓库判断；`docs/delivery/external-gates.md` 称"以…冻结 2.2.0"但从未发布；electron-updater 无新版本可更新；后续发布时 upgrade smoke 的 previous（v2-2.1.4）与包内版本（2.2.0）基线跳档。
- 修复建议：二选一——修 C1 后正式打 `v2-2.2.0` tag 发布；或把 package.json 回退 2.1.4 并清理本地 `release-v2/` 产物。同时建议在 CI/发布前加"tag 与 package.json version 一致性"校验（v2-internal-release.yml 已有此校验，v2-release.yml 没有）。

---

## 🟠 HIGH

### H1 — 第三方 action 全部以可变 tag 引用，未 pin SHA（发布 job 携带签名 secrets）

- 位置：`v2-ci.yml:30,32,36`、`v2-release.yml:17,19,23,101`、`v2-internal-release.yml:24,26,30,71`、`v2-windows-smoke.yml:20,22,26`（`actions/checkout@v4`、`pnpm/action-setup@v4`、`actions/setup-node@v4`、`softprops/action-gh-release@v2`）
- 问题：全部引用可变 tag/branch。按 Actions 威胁模型，tag 可被上游改写；`v2-release.yml` 与 `v2-internal-release.yml` 的 job 内有 `CSC_LINK`/`CSC_KEY_PASSWORD` 签名证书 secrets 和 `contents: write` token，上游被攻陷即供应链 RCE。
- 影响：发布流程的信任边界完全依赖第三方仓库的 tag 不变性。
- 修复建议：第三方 action 全部 pin 40 位 commit SHA 并加注释版本（如 `uses: softprops/action-gh-release@<sha> # v2.2.1`）；`actions/*` 第一方 action 同样建议 pin。

### H2 — CI 与 smoke workflow 无 `permissions:` 最小化

- 位置：`v2-ci.yml`（整个文件无 permissions 块）、`v2-windows-smoke.yml`（无 permissions 块）；`v2-release.yml:8-9`、`v2-internal-release.yml:16-17` 只有 `contents: write`（发布所需，合理）。
- 问题：无 permissions 块时继承仓库默认 token 权限；若仓库默认非只读，CI 获得不必要的写权限。
- 影响：CI 被注入/action 被攻陷时可写仓库（低概率但成本高）。
- 修复建议：`v2-ci.yml`、`v2-windows-smoke.yml` 顶部加 `permissions: contents: read`（它们只用只读能力）。

### H3 — 发布关键验证（installer/upgrade smoke）不在任何合并门禁中，失败不阻塞合并（已实证）

- 位置：分支保护 required checks 只有 `Lint, Build, Type Check, Test & E2E`（GitHub API 实证，与 `v2-ci.yml:26` job name 一致 ✓），`v2-windows-smoke.yml:10-13` 的 PR 触发不在 required 列表。
- 问题：实证——run `31152269595`（V2 Windows Installer Smoke，2026-08-07）在 PR 上失败，但 PR #2 随后仍被合并（`2b345bb`）。也就是说 **C1 的发布阻断在合并前没有任何人看到**。
- 影响：CI 绿不代表发布链路可用；installer/upgrade smoke 只在 release workflow 内跑，翻车成本最高。
- 修复建议：修复 C1 后把 windows-smoke job 加入 required status checks；或至少在 `v2-ci.yml` 中增加 `installer:smoke` 等价验证（Linux 无法跑 NSIS，故以 required windows job 更合理）。

### H4 — `v2-internal-release.yml` 从未在 Actions 中运行过，发布路径未验证

- 位置：`.github/workflows/v2-internal-release.yml`（整文件）
- 问题：`gh run list --workflow v2-internal-release.yml` 为空；现有 `v2-internal-2.1.4` release 创建于 2026-07-26，早于该 workflow 文件存在时间，非本 workflow 产出。该 workflow 语法、`build-internal-installer.ps1` 调用链、上传逻辑全部未在真实 runner 上验证，且当前会撞 C1。
- 影响：内部发布通道是一个"看起来存在、实际未验证"的路径。
- 修复建议：修 C1 后手动运行一次 internal release 全链路验证；并把它纳入 CODEOWNERS（见 M8）。

### H5 — 数据完整性验证脚本（verify-foreign-keys / verify-database / delivery-drill）未进 CI

- 位置：`v2-ci.yml:43-95`（步骤清单中无 `verify:database`、`verify:foreign-keys`、`delivery:drill`）；脚本存在于 `apps/v2/scripts/verify-foreign-keys.mjs`（19 个核心关系孤儿扫描）、`verify-database.mjs`（integrity + foreign_key_check）、`delivery-drill.mjs`（备份→损坏→恢复→重启全链路）
- 问题：这些脚本质量不错（只读、有明确 exit code），但从未在任何自动化门禁中执行。`verify-foreign-keys.mjs` 的 19 个关系恰好对应 MATURITY 声称的"verify:foreign-keys 扫描 19 个核心关系"，却只靠人工跑。
- 影响：外键孤儿、库损坏、备份恢复链路回归只能事后发现（真实诊所数据不可逆）。
- 修复建议：CI smoke 步骤之后追加 `pnpm --filter @dental/v2 verify:database` 与 `verify:foreign-keys`（CI dev 库此时已有 smoke 产生的数据，可真实覆盖）；`delivery:drill` 至少纳入发布 workflow 或每周调度。

### H6 — 仓库根 `apps/v2` 与本地 `apps/v2` 双份工作副本漂移（嵌套 git 仓库）

- 位置：`D:/Desktop/rongyi/apps/v2` vs `D:/Desktop/rongyi/apps/v2`（diff 实证：`installer-smoke.ps1`、`verify-signature.ps1`、`legacy/schema/*.ts`、`src/server/http/routes/system.ts`、多个 web 页面及 spec 文件不一致；`source` 是嵌套 git 仓库且 remote 与根相同）
- 问题：GitHub 生效的是仓库根 `.github/workflows/` 与 `apps/v2/`（`git ls-tree main` 实证），本地开发却可能改在 `source/` 下。本次审计中两个目录的 workflow 内容一致，但应用代码已漂移。
- 影响：本地验证结果 ≠ CI 验证结果；"本地过了、CI 红"或反之的调试成本；C1 的 windows-smoke 失败可能与两目录漂移叠加放大。
- 修复建议：统一开发根目录（删除 `source/` 的嵌套 `.git` 或将 `source` 纳入单一工作树），并加 CI 一致性检查或明确废弃其一。

### H7 — `latest.yml` 的 sha512 校验不闭环

- 位置：`apps/v2/scripts/update-metadata.mjs:17-29`（计算 installer sha512 写 latest.yml）、`apps/v2/scripts/verify-update.mjs:14-16`（只检查 `version`/`sha512`/`path` 字段存在）、`apps/v2/scripts/verify-remote-release.mjs:36-38`（远程只比对 `size`，不比 sha512）
- 问题：`verify:update` 不交叉校验 sha512 是否等于实际安装包 hash；`verify:remote` 只比 size。若 installer 在 `update:metadata` 之后、上传之前被替换/篡改，或上传了错误的 blockmap，验证仍通过。
- 影响：客户端更新通道拿到不一致元数据 → 更新下载失败或校验错误（electron-updater 会校验 sha512，问题会暴露给最终用户而非 CI）。
- 修复建议：`verify-update.mjs` 重新计算 installer sha512 并与 latest.yml 比对；`verify-remote-release.mjs` 下载 asset 后校验 sha512 与 latest.yml 一致。

### H8 — CI 无缓存、单 job 串联 18 个步骤，25 分钟超时余量小

- 位置：`v2-ci.yml:24-107`（无 `actions/cache`/`setup-node cache`；typecheck→lint→knip→test×3→audit→security→license→build→electron compile→playwright install→dev servers→smoke×3→load×2 全部串行）；`timeout-minutes: 25`（第 28 行）
- 问题：无 pnpm store 缓存与 Playwright 浏览器缓存，每次全量安装 + 下载 chromium；`benchmark-load.ts` 向内存库插入 20 万行（患者 10 万 + 收费 10 万），在共享 runner 上耗时不确定。
- 影响：CI 越来越慢、容易超时；失败时无产物（coverage/playwright report 未上传 artifact），只 dump dev server 日志。
- 修复建议：加 `actions/cache`（pnpm store + `~/.cache/ms-playwright`）；把 lint/knip/audit/security/license 拆成并行 job；超时提到 40 分钟；失败时上传 coverage/测试报告 artifact。

### H9 — Upgrade smoke 依赖 `gh release list` 隐式排序与默认分页，未来会静默跳过

- 位置：`v2-release.yml:71-79`
- 问题：`gh release list` 默认只取 30 条、按创建时间倒序的隐式假设；`$index = [array]::IndexOf($releases, $current)` 找不到 current 时（release 数 > 30 或列表不含当前 tag）打印 "No previous release available; skipping upgrade smoke" 并 `exit 0` —— **静默跳过**。
- 影响：升级兼容性验证在 release 变多后悄然失效，发布仍显示成功。
- 修复建议：显式 `gh release list --limit 200` 并按 semver 排序取 previous；或直接 `gh api repos/.../releases/tags/<tag>` 不存在则报错，避免静默跳过；skip 时输出 `::warning::` 便于审计。

---

## 🟡 MEDIUM

### M1 — `environment: production` 无任何保护规则，tag push 即发布

- 位置：`v2-release.yml:14`；GitHub API 实证：仓库 environments 列表为空。
- 问题：声明的 production environment 未配置 required reviewers；`softprops/action-gh-release@v2` 直接创建公开 release，无 draft/人工确认环节。
- 影响：发布 = 推送 tag，无第二人确认；误推/错版直接对外。
- 修复建议：在 GitHub 配置 production environment 的 required reviewers，或先发布 draft release 人工确认后再转正式。

### M2 — 开发签名证书 `certs/signing-cert.pfx` 提交在仓库

- 位置：`certs/signing-cert.pfx`（2,614 B，已入库）
- 问题：开发用 PKCS12 证书进入版本库。`verify-signature.ps1` 的拒绝机制是 subject 黑名单（"Dental Clinic Dev"/"self-signed"/issuer==subject），而非信任链校验（见 M5）；若证书密码薄弱/为空，可被用于签发"看起来已签名"的安装包。
- 影响：供应链/发布信任面扩大。
- 修复建议：从仓库移除并 `.gitignore`；开发证书仅存在于开发者本机。

### M3 — 无 `concurrency` 组：重复 CI 与 release 竞态

- 位置：`v2-ci.yml:3-17`、`v2-release.yml:3-6`、`v2-internal-release.yml:3-14`（均无 concurrency）
- 问题：同一分支连续 push 会并行跑多份 CI；连续推两个 `v2-*` tag 会并发两个 release build，上传相同资产路径（latest.yml 等）可能竞态。
- 影响：浪费 Actions 分钟；发布资产互相覆盖。
- 修复建议：CI 加 `concurrency: { group: v2-ci-${{ github.ref }}, cancel-in-progress: true }`；release 加 `concurrency: v2-release`。

### M4 — Actions Node 20 淘汰预警（checkout@v4/setup-node@v4/pnpm@v4 被强制跑 Node 24）

- 位置：全部 4 个 workflow 的 `actions/checkout@v4`、`actions/setup-node@v4`、`pnpm/action-setup@v4`；runner 日志实证：`Node 20 is being deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4, pnpm/action-setup@v4`
- 问题：这些 action 的 tag 版本基于 Node 20 runtime，GitHub 淘汰后可能失效或行为变化。
- 影响：CI 无故变红或静默行为变化。
- 修复建议：升级到支持 Node 24 的新 major（checkout@v5/setup-node@v5/pnpm/action-setup@v6 等），并同时完成 H1 的 SHA pin。

### M5 — `verify-signature.ps1` 是黑名单式签名校验，不是信任链校验

- 位置：`apps/v2/scripts/verify-signature.ps1:17-22`
- 问题：只要求 `Status -eq "Valid"` 且 subject 不匹配三个黑名单模式；不校验证书链、有效期、密钥用法、时间戳。任何不叫 "Dental Clinic Dev" 的自签名/测试证书若恰好被 runner 信任（或 Status 返回 Valid）即通过。
- 影响："必须正规 CA 证书"的承诺实际由字符串匹配兜底。
- 修复建议：校验签名证书链与有效期（`Get-AuthenticodeSignature` 的 `SignerCertificate` + 链构建/吊销检查），或维护证书指纹白名单。

### M6 — Electron 随机 API 端口（30000-50000）不预检占用

- 位置：`apps/v2/electron/main.cjs:214-216`（`randomInt(30000, 50000)`）、`main.cjs:256-325`
- 问题：随机端口可能落入 Windows 排除端口保留段（README 已记录 3180 的同类问题，`upgrade-smoke.ps1:8-10` 也明确避开了硬编码端口），API 子进程 EADDRINUSE 后走重启退避，首次启动失败体验差。
- 影响：偶发启动失败/重启，用户看到错误弹窗。
- 修复建议：spawn 前在 Node 侧临时 bind 探测可用端口，或对 EADDRINUSE 单独快速重试换端口（当前重启逻辑每次换新端口，尚可；建议把该路径的错误消息改得更可操作）。

### M7 — 发布资产用通配符 `release-v2/*.exe`，残留 exe 会被一并上传

- 位置：`v2-release.yml:103-105`（`files: apps/v2/release-v2/*.exe ...`）、`v2-windows-smoke.yml:58`（把 previous-installer.exe 下载到 `apps/v2/release-v2/`）
- 问题：通配符会匹配目录下所有 exe（含本地跑 upgrade smoke 残留的 previous-installer.exe、旧版本安装包）。
- 影响：release 资产混入无关/旧安装包，latest.yml 指向错误文件（`verify:remote` 能发现部分，但资产列表已污染）。
- 修复建议：用 `artifact-name.mjs` 精确计算当前 `installerFileName(pkg)` 上传；windows-smoke 把 previous installer 下载到 `$env:RUNNER_TEMP`。

### M8 — CODEOWNERS 未覆盖全部发布相关 workflow

- 位置：`.github/CODEOWNERS:10-14`（只覆盖 `v2-release.yml` 与 `v2-ci.yml`）
- 问题：`v2-internal-release.yml`、`v2-windows-smoke.yml` 变更无需 governance 审批。
- 影响：发布路径改动绕过治理审查。
- 修复建议：补上两个 workflow（及 `apps/v2/scripts/*.ps1` 发布脚本）。

### M9 — 错误码体系无注册表/文档，5xx 一律 `INTERNAL_ERROR`

- 位置：`apps/v2/src/server/infrastructure/errors.ts:5-18`（code 为自由字符串）、`apps/v2/src/server/http/middleware.ts:41-52`（5xx 只暴露 `INTERNAL_ERROR` + traceId）
- 问题：错误码无集中枚举、无文档、前端只能匹配 `VALIDATION_ERROR`/`UNAUTHORIZED` 等少数已知码；用户/开发者无法区分"可重试"“配置缺失”“数据损坏”等 5xx 子类（好在响应带 traceId，可通过日志定位）。
- 影响：错误提示可操作性一般（消息本身是中文可读的，但码体系不可扩展）。
- 修复建议：建立集中错误码注册表（含可重试标记、用户提示文案），并在 `docs/` 出错误码文档；保持 5xx 不泄露内部细节的原则不变。

### M10 — 无 per-request 访问日志，慢请求无法按 traceId 检索

- 位置：`apps/v2/src/server/http/middleware.ts:17-23`（traceMiddleware 生成/透传 x-request-id）、`apps/v2/src/server/infrastructure/logger.ts:73-129`（结构化 JSON + 5MB×5 轮转）、`app.ts:306`（metricsMiddleware 只有聚合统计）
- 问题：traceId 体系很好（响应头回传、错误日志带 traceId、OperationLog 记 traceId），但没有请求级 access log（method/path/status/durationMs/traceId），慢请求只能看聚合指标，无法按单请求检索；日志级别只有 info/warn/error，无 debug。
- 影响：运维排障"知道慢，不知道哪次请求慢"。
- 修复建议：加 access log 中间件（含 durationMs/traceId，可采样）；日志级别可配置；考虑按天/按级别分文件。

### M11 — 数据库迁移无 down，回滚依赖手工 snapshot

- 位置：`apps/v2/src/server/infrastructure/migrations.ts:1625-1668`（只有 `up`，事务内应用）、`:1600-1617`（pre-migration snapshot，`VACUUM INTO`，保留 3 份，失败不阻断）
- 问题：迁移原子性 OK（事务包裹）、有启动前快照，但没有 down migration；`docs/delivery/rollback.md` 也承认"降级时若新迁移已写入，旧版本可能无法读取"。回滚 = 手工用快照/备份恢复，无自动化路径。
- 影响：坏迁移发布后回滚耗时且依赖人工。
- 修复建议：为破坏性迁移（删列/改约束）提供 down 或数据回填脚本；把"快照→恢复"流程脚本化并纳入 delivery:drill。

### M12 — `v2-internal-release.yml` 把 `inputs.version` 直接插值进 shell

- 位置：`v2-internal-release.yml:62-68`（`if [ "${{ inputs.version }}" != ... ]`）
- 问题：workflow_dispatch 输入未转义直接拼进 run 脚本（注入模式）。因 dispatch 仅限有仓库权限者，实际风险低，但不符合注入安全最佳实践（`${{ }}` 在 shell 执行前展开）。
- 修复建议：改为 `env:` 传递比较，或对输入加 pattern 校验（`^\d+\.\d+\.\d+$`）。

### M13 — CI 中硬编码 `V2_BACKUP_KEY`

- 位置：`v2-ci.yml:19-22`（`V2_BACKUP_KEY: ci-backup-key-0123456789abcdef`）
- 问题：注释明确"非生产密钥"，但值入库且可被任何读到仓库的人用于解密用同 key 加密的备份；若该值被误用到真实环境（复制粘贴），备份可被仓库读者解密。
- 影响：密钥卫生问题，当前风险低。
- 修复建议：改为 GitHub 仓库 secret（CI-only）或每次随机生成注入。

### M14 — Windows smoke 每次 PR 全量 `electron:dist`，成本高且当前无门禁价值

- 位置：`v2-windows-smoke.yml:36-37`（`pnpm --filter @dental/v2 electron:dist`，60 分钟超时）
- 问题：每个 PR 都下载 Electron 43 + NSIS 全量打包；失败不阻塞合并（H3），收益与成本不成比例；且无 permissions 块（H2）。
- 修复建议：与 H3 一并处理——要么纳入 required checks 并加缓存，要么改为仅 release 分支/手动触发。

---

## ⚪ INFO

### I1 — 任务清单中的 ci.yml/deploy.yml/release.yml 不存在
实际只有 `v2-*` 四个 workflow；桌面分发形态下没有部署目标，"GitHub Release = 交付"成立。建议在 RELEASE.md 明确"无自动部署，发布=打 tag"以免后人找 deploy.yml。

### I2 — `verify-remote-release.mjs` 使用不存在的 `GITHUB_REPOSITORY_NAME`
- 位置：`apps/v2/scripts/verify-remote-release.mjs:1-3`。GitHub 只提供 `GITHUB_REPOSITORY`（owner/repo）与 `GITHUB_REPOSITORY_OWNER`，没有 `GITHUB_REPOSITORY_NAME` → CI 中恒 fallback 到硬编码 `'rongyi'`。仓库改名/迁移后 verify:remote 查错仓库。修复：从 `GITHUB_REPOSITORY` 解析。

### I3 — `wait-for-services.mjs:30` 用 body 含 `'root'` 判断 web 就绪
依赖 index.html 含 `id="root"`，脆弱但当前有效；建议改查 Vite 就绪响应或固定标记。

### I4 — 默认管理员密码 `ry0801` 出现在 README、api-smoke、installer/upgrade smoke
生产路径拒绝 seed 默认账号（`main.ts:196-208`、database seed 逻辑），风险可控；保持文档明确即可。

### I5 — `.env.example` 与实际读取变量核对一致（良好）
V2_PORT/HOST、DATA_DIR/DB_PATH/LEGACY、JWT/ADMIN_PASSWORD/BACKUP_KEY/ALLOW_PLAINTEXT、BACKUP_DIR/AUTO_BACKUP_*、LOG_DIR、WECHAT_*、WEB_URL/CRASH_REPORT_URL/DISABLE_AUTO_UPDATE、DEV_SEED 全部与 `main.ts`/`app.ts`/`main.cjs`/wechat.ts 实际读取一一对应。

### I6 — 备份/恢复体系验证为健壮（良好）
加密备份（AES-256-GCM + magic header + authTag）、自动备份调度 + 失败业务告警（`scheduler.ts:60-80`）、staged restore + 摘要对比 + pre-restore 副本（`restore-apply.ts`）、CLI `restore-backup.mjs`（integrity_check + pre-restore 备份）、`delivery-drill.mjs` 全链路（导入→建档→加密备份→验证→损坏→恢复→重启→一致性）、`docs/delivery/backup-restore.md`/`rollback.md` 文档齐全。`backup.ts:55-58` 无 key 时拒绝明文（仅 test/显式允许），行为正确。

### I7 — 健康检查体系良好（良好）
`/api/v2/health` 公开、`/api/v2/health/deep` 与 `/api/v2/metrics` 需 BOSS（`app.ts:323-331`）；Electron 两级 readiness 窗口 + 指数退避重启 + 最大次数告警弹窗（`main.cjs:327-371`）；孤儿 API 进程防护（心跳 + ppid 探测，`main.ts:42-102`）。

### I8 — traceId 贯通良好（良好）
`x-request-id` 透传/生成（`middleware.ts:17-23`）、响应头回传、错误响应带 traceId、OperationLog 记录 traceId（migrations v103）、日志结构化 JSON 且防循环序列化（`logger.ts:37-64`）。

---

## Top 5 最重要的发现

1. **C1：`legacy/dental.sqlite` 删除后发布链路必然失败**（实证：windows-smoke run 31152269595 失败；verify-package/installer-smoke 硬依赖）——发布当前不可用。
2. **C2：2.2.0 版本漂移**——package.json/本地产物/verify 默认值都是 2.2.0，远程从未发布；"已冻结 2.2.0"的交付承诺无对应产物。
3. **H1：第三方 action 未 pin SHA**——release job 携带签名证书 secrets + contents:write，供应链攻击面最大的一处。
4. **H3：发布关键验证不在合并门禁**——windows-smoke 失败仍合并（实证 PR #2），C1 未被 PR 阶段拦截。
5. **H5：数据完整性验证未进 CI**——verify-foreign-keys（19 关系）、verify-database、delivery-drill 全部游离于自动化之外，真实诊所数据完整性无回归保护。

## 发布流程中最可能翻车的 3 个环节

1. **打 `v2-*` tag 后的 "Verify package" / "Installer smoke"**：C1 使 `v2-release.yml` 在打包校验阶段必然失败；即使临时跳过，新装机用户 legacy 数据导入会被静默跳过（`main.ts:165` existsSync 为 false 时无任何告警）——这是当前第一翻车点，且属于"数据缺失但不报错"的最危险形态。
2. **升级 smoke 环节（`v2-release.yml:65-93`）**：依赖 `gh release list` 隐式排序/默认 30 条分页，找不到 previous 时 `exit 0` 静默跳过；加上当前版本漂移（2.2.0 相对 v2-2.1.4 跳档），升级兼容性验证极易悄然失效。
3. **首次运行 `v2-internal-release.yml`**：该 workflow 从未在 Actions 跑过（H4），现在触发会撞 C1 直接失败；即便修复 C1，其 tag/版本推导、`build-internal-installer.ps1` 在真实 runner 上的行为（自签名证书生成、版本改写与还原）都无任何运行记录可依赖。
