# 无人维护多机部署 + 软件全面深度优化（原始计划核对版任务书）

日期：2026-08-15
定位：本文件是对 **2026-08-14 20:00 已批准的原始计划**（出处：主会话
`session-2bf1cb5c`，exit_plan_mode 计划原文）的**逐条状态核对**与剩余任务书。
编号以原始计划为准（A-P0~A-P4、B-1~B-6），不再自创编号。

## 0. 最新进度快照（2026-08-15 05:0x，执行本任务书前先读）

- **PR #15（A-P1 全自动更新/自启/状态可见）已合并进 main** ✅；合并后 main
  push CI 全绿。
- **PR #14（A-P0.3 公开链降级）/ #16（B-1.2 actions 升级）/ #17（A-P2、
  A-P3.x、B-2.1、B-3.2、B-4）**：三件套 CI 重跑中（#17 曾因 backup.ts 503 行
  超 450 行架构门禁失败，已拆分 backup-mirror.ts / backup-crypto.ts 修复，
  现 419 行）。全绿后自动合并（后台监控中）。
- **A-P0.1 内部发布链验证**：run 31841021319 重跑中（首个 run 卡 8h 已取消）。
- **B-2.2 SSH 密钥注册**：✅ 已完成（2026-08-16）——`gh auth refresh`
  补齐 `admin:public_key` 后经 api.github.com 注册
  `dsh-agent@PC-20260410UFBQ`（GitHub key id 160379533），
  `ssh -T git@github.com` 与 SSH fetch main 均实测通过；github.com
  阻断窗口亦已恢复。
- 本次会话的临时脚本产物（scan/extract/pr-checks/merge-monitor 等）在
  %TEMP%，与本仓库无关；仓库内新增文档仅本任务书 + docs/plans 下既有文件。

原始计划目标（用户原话）：
> 「结合各种技能仔细思考给我最佳的，一步到位的优化路线。我的目标是可以在
> 多台电脑上都可以无人维护的长期使用。」「不要只盯着我给的任务，这个软件
> 还有什么地方需要优化也要写在计划里」（→ B 线来源）。「UI最后再做，不要
> 放在计划里」（→ B-7 UI 打磨已排除）。

完成标准（计划原文）：新电脑部署脚本静默信任证书 → 静默安装 → 开机自启 →
自动更新（静默下载+重启安装）→ 自动备份（本机+异地镜像，加密）→ 自愈 →
磁盘/日志自动治理 → dsh-ssh 巡检每机一个 health.json。**单机连续 90 天零人工
干预，数据随时可恢复**。质量分 100 与三件套 CI 全绿不跌破。

---

## 1. 逐条状态核对（2026-08-15 实测）

### A 线：无人维护多机部署

| 编号 | 条目 | 状态 | 证据 |
|---|---|---|---|
| A-P0.1 | 真实验证内部发布链（触发 v2-internal-release 2.2.0） | 🔄 **卡住** | run 31836006584 触发于 08-14 20:02，截至 08-15 04:5x 仍 in_progress（8+ 小时），结果未知，需查/重跑 |
| A-P0.2 | 证书信任链跨机验证（干净机 certutil 导入 + 真实升级） | ⬜ 未做 | — |
| A-P0.3 | 公开链降级（v2-release.yml tags → workflow_dispatch） | ✅ 已做未合并 | `feat/release-trigger`，**PR #14 开** |
| A-P1.1 | 全自动更新（autoDownload/autoInstallOnAppQuit=true） | ✅ 已做未合并 | `84892e24`，**PR #15 开**（feat/auto-update） |
| A-P1.2 | 开机自启默认开 | ✅ 已做未合并 | 同上（first-run auto-launch） |
| A-P1.3 | 更新状态可见（设置页：上次检查/可用版本/失败原因） | ✅ 已做未合并 | 同上 |
| A-P2.1 | 备份镜像同步（V2_BACKUP_MIRROR_DIR + sha256 + 对账） | ✅ 已做未合并 | `7c00e4b8`，**PR #17 开**（feat/backup-mirror） |
| A-P2.2 | 镜像保留策略（V2_BACKUP_MIRROR_KEEP） | ✅ 已做未合并 | 同上 |
| A-P2.3 | 恢复 SOP（OPS.md，密钥丢失=数据不可恢复警示） | ⬜ 未做 | — |
| A-P2.4 | 恢复演练（disaster drill 扩展镜像路径恢复用例） | ⬜ 未做 | — |
| A-P3.1 | health.json 快照（启动+每 15min，固定 schema） | ✅ 已做未合并 | `54b44f80`，PR #17 |
| A-P3.2 | 磁盘阈值可配（V2_DISK_THRESHOLD_BYTES） | ✅ 已做未合并 | `6bab843d`，PR #17 |
| A-P3.3 | 时钟漂移检测（>72h 偏差提示） | ✅ 已做未合并 | `6bab843d`，PR #17 |
| A-P4.1 | 一键部署脚本 deploy-fleet.ps1（信任证书→/S 安装→预置 userData） | ⬜ 未做 | — |
| A-P4.2 | 静默安装验证（installer:smoke 补 /S 用例） | ⬜ 未做 | — |
| A-P4.3 | OPS.md 运维手册（部署/证书再生成/恢复/巡检/故障排查） | ⬜ 未做 | — |

### B 线：软件全面深度优化

| 编号 | 条目 | 状态 | 证据 |
|---|---|---|---|
| B-1.1 | 变异 3 个 timeout 收编（mutation 步骤 ~13min 压缩） | 🔄 **中断** | 08-14 20:24 开始本地跑 stryker，会话随即中断，无提交 |
| B-1.2 | 消除 Node 20 deprecation 警告（actions 升级 v7/v6） | ✅ 已做未合并 | **PR #16 开**（feat/actions-upgrade） |
| B-1.3 | verify job 拆分评估（mutation/shuffle 并行） | ⬜ 未做 | 评估后决定，可能不动 |
| B-1.4 | 新激活工作流首跑观察（v2-flaky 00:17 UTC / v2-security-audit） | ⬜ 未做 | 合并后尚未运行 |
| B-2.1 | 本地 docs 提交推送（round 46 台账） | ✅ 已做未合并 | `1decbd80`，PR #17 |
| B-2.2 | SSH 密钥注册（gh auth refresh，需用户交互） | ✅ 已完成 | 2026-08-16 注册 `dsh-agent@PC-20260410UFBQ`（key id 160379533），SSH 认证实测通过 |
| B-2.3 | 防漂移月度复跑（quality-score + v8 ratchet） | ⬜ 未排期 | 定期任务 |
| B-3.1 | soak 长期验证（季度长跑或每周 24h job） | ⬜ 未做 | 评估后决定 |
| B-3.2 | stability.json 增强（崩溃计数/最近备份时间） | ✅ 已做未合并 | `fc687785`，PR #17 |
| B-3.3 | 内存/句柄增长监控（soak 期间记录趋势） | ⬜ 未做 | 评估后决定 |
| B-4.1 | 备份加解密往返属性测试 | ✅ 已做未合并 | `6bab843d`（13 测试，发现 csvCell 真 bug 已修） |
| B-4.2 | 金额/日期/CSV-HTML 转义属性测试 | ✅ 已做未合并 | 同上 |
| B-4.3 | 既有单元测试不降级 | ✅ 通过 | CI 闸门 |
| B-5.1 | 启动时间基准（打包版冷启动→UI 就绪） | ⬜ 未做 | 评估驱动 |
| B-5.2 | 前端 bundle 体积审计（仅低风险项） | ⬜ 未做 | 评估驱动 |
| B-5.3 | DB 基准趋势季度回顾 | ⬜ 未做 | 定期 |
| B-6.1 | 月度依赖升级 PR 节奏 | ⬜ 未做 | 低优先 |
| B-6.2 | 安全扫描调度确认（v2-security-audit 补 cron） | ⬜ 未做 | — |

### 汇总

- ✅ 已做（未合并）：**6 个提交 / 4 个 PR**（#14、#15、#16、#17 全开）
- 🔄 进行中/卡住：A-P0.1（内部发布 run 卡 8h+）、B-1.1（会话中断）
- ⬜ 未做：A-P0.2、A-P2.3、A-P2.4、A-P4.1~4.3（7 项 A 线）+ B-1.3、B-1.4、
  B-2.3、B-3.1、B-3.3、B-5.1~5.3、B-6.1、B-6.2（8 项 B 线；B-2.2 已于
  2026-08-16 完成）

---

## 2. 剩余执行顺序（关键路径）

1. **立即：合并 4 个 PR**（#14→#17）。这是所有已做工作的兑现——先查各 PR 的
   CI 状态（三件套是否全绿），绿则合并；红则按 `gh-fix-ci` 修。合并顺序建议
   先 #16/#14（独立小改动）→ #15 → #17（最大），或按依赖（无强依赖，可并行
   审查后依次合并）。
2. **A-P0.1 收尾**：查 run 31836006584 真实状态（可能卡死需取消重跑）；触发
   内部发布真实验证到 prerelease + latest.yml + verify:remote 全绿。
3. **B-1.1 收编**：继续定位 3 个 mutation timeout（会话中断处），压缩 mutation
   步骤时长。
4. **A-P2.3 + A-P4.3 合并做**：OPS.md 运维手册（恢复 SOP + 部署 + 巡检清单 +
   故障排查），A-P2.4 恢复演练 drill 配镜像路径用例。
5. **A-P4.1 + A-P4.2**：deploy-fleet.ps1（CRLF，PS 5.1 兼容）+ installer:smoke
   补 /S 静默用例。
6. **A-P0.2**：干净机证书信任链验证（installer:smoke + 真实升级）。
7. **B-1.4 / B-2.3 / B-3.1 / B-5 / B-6**：观察与评估类，逐项按计划原文的
   「评估后决定」闸门处理；B-2.2 SSH 密钥注册（2026-08-16 已完成）。
8. 全部完成后按完成标准验收（90 天零人工干预演练 + 台账写回）。

## 3. 执行规范（沿用原计划）

- 每个改动独立 PR → 三件套 CI（verify/smoke/windows-smoke）全绿 → 合并；
  质量分 100 与 v8 ratchet 286 护栏不破。
- 新增测试：更新状态机、镜像同步器（断连/校验失败/对账/保留）、health 快照、
  时钟漂移、/S 静默安装；备份加解密往返属性测试。
- 失败模式（计划原文）：镜像目录不可达→告警跳过不阻塞主备份；更新中断→
  断点续传+签名失败不安装；证书再生成→全舰队重导信任（OPS 警示）；时钟漂移
  只提示不自动改时间；备份密钥丢失=数据不可恢复（设计如此）；关键告警走
  notify+alert 表+health.json，不依赖 UI 交互。
- 用户交互点原为两处：A-P0.1 触发内部发布（已触发）、B-2.2 SSH 密钥注册
  （2026-08-16 已闭环）。

## 4. 参考文档

- 原始计划出处：主会话 `session-2bf1cb5c`（2026-08-14 20:00:31 exit_plan_mode）
- 上轮战役证据：`docs/audits/多维度评分-拉满运动-2026-08-13.md`
- 独立审查：`docs/audits/多维度评分与优化路线图-2026-08-13.md`
- 排除登记册：`docs/architecture/coverage-exclusions.md`
- 缺陷台账：`docs/audits/缺陷台账.md`（OPEN = 0）

---

## 5. 执行结果与收口（2026-08-15 会话续跑）

### 5.1 合并记录（gh api，github.com 阻断期间全程走 api.github.com）

| PR | 合并 SHA | 内容 | CI 结论 |
|---|---|---|---|
| #15 | `b7c2a640` | A-P1 全自动更新/自启/状态可见 | ✅（盘点前已合并） |
| #16 | `05a7ddf5` | B-1.2 actions v7/v6 | ✅ 三件套绿 |
| #14 | `af291994` | A-P0.3 公开链降级 + 工作流变更触发 CI | ✅ 三件套绿 |
| #17 | `074ecc70` | A-P2.1/2.2、A-P3.1/3.2/3.3、B-2.1、B-3.2、B-4 | ✅（修复 quality 99.94→100 覆盖率、v8 ratchet 287→286） |
| #18 | `b39567e3` | A-P0.2 cert-trust-smoke 发布门禁 + internal-release timeout 60→150 | ✅ |
| #19 | `edafcd40` | B-3.1 每周 1h soak + B-3.3 内存/句柄增长护栏 + B 线评估文档 | ✅ |
| #20 | `f3244053` | B-1.1 mutation timeout 收编 | ✅ 0 timeout / 13 白名单等价 |
| #21 | `45f1cbbb` | B-1.4 v2-flaky 补 electron:compile + v2-security-audit 换官方 action | ✅ |
| #22 | `eb85ddc3` | A-P2.3+A-P4.3 OPS.md、A-P2.4 镜像恢复演练、A-P4.1 deploy-fleet.ps1 | ✅ |
| #23 | 待合并 | v2-security-audit 改子目录 action + 大库 smoke 模拟库口令对齐 | 最终 CI 进行中 |
| #33 | 本 PR | B-2.2 SSH 密钥注册台账（计划文件 + apps/v2/README 无人值守访问说明） | 待三件套 CI |

### 5.2 关键证据

- B-1.1：本地 mutation `# timeout 0`、幸存 13 条全部命中等价白名单、
  11m53s（此前 13m31s）；CI Mutation 步骤全绿。
- PR #17 质量分：修复后 coverage statements/branches 全 100%，quality 100，
  v8 ratchet 保持 286。
- A-P4.2：`installer-smoke.ps1` 的 `/S` 静默安装+卸载用例自早期轮次已存在，
  每轮 `V2 Windows Installer Smoke` 均执行并绿；本轮核实后登记为已完成，
  不再重复造测试。
- B-6.2：`v2-security-audit.yml` 已有周一 cron（`0 3 * * 1`），登记完成。
- B-5.3：`benchmark:load` 2026-08-15 复跑全部 PASS（见
  `docs/audits/b-line-evaluations-2026-08-15.md`）。
- B-1.4：v2-flaky / v2-security-audit 首跑暴露 3 个真问题并已修复：
  缺 electron:compile、npm 无 osv-scanner 包、根目录 action.yml 无 runs；
  修复后复跑结果见 Actions。
- B-2.2（2026-08-16）：`gh auth refresh -h github.com -s admin:public_key`
  设备流补齐 scope 后，经 api.github.com 注册 ed25519 公钥
  `dsh-agent@PC-20260410UFBQ`（fingerprint
  `SHA256:q4iXBa275F/ImM/DUetJdr0aJYfAsB2WRlV76PPRM+g`，GitHub key id
  160379533，verified=true）；`ssh -T git@github.com` 返回
  `Hi 1290464284-ship-it! You've successfully authenticated`；
  SSH fetch 成功把本地 origin/main 从 `f7071df0` 更新到 `d5bbd7f4`。

### 5.3 收口时状态

- ✅ 已合并：A-P1.x、A-P0.3、A-P2.1/2.2、A-P3.1~3.3、A-P0.2、A-P2.3/2.4、
  A-P4.1/4.2/4.3、B-1.1/1.2、B-2.1、B-3.1/3.2/3.3、B-4.x、B-5.3、B-6.2、
  B-1.4（修复）、B-2.3（登记）、B-5.1/5.2（评估结论登记）、B-6.1（节奏登记）。
- ⏳ 收口最后两步：#23 合并 → 最终 main 触发 A-P0.1 内部发布 2.2.0 与
  v2-flaky / v2-security-audit 复跑；A-P0.1 成功即完成标准中的发布链闭环。
- ✅ B-2.2 已闭环：SSH 密钥注册完成并实测认证（详见 5.2）；原「唯一外部
  依赖」不复存在。
