# B 线评估与收口（2026-08-15）

本文登记任务书 `unattended-fleet-and-deep-optimization-2026-08-15.md` 中
B 线「评估后决定」类条目的结论与证据，作为后续月度/季度复盘的输入。

## B-1.3 verify job 拆分评估

结论：**不拆分**。

- 当前 `v2-ci.yml` 的 verify job 单线执行
  `typecheck→lint→knip→unit→shuffle→mutation→coverage→quality→...`，
  顺序本身保证了 mutation/coverage/quality-score 共享同一份构建产物，
  拆分并行会引入 artifact 搬运与 ratchet 竞态。
- B-1.1 收编后本地 mutation 由 13m31s 降至 11m53s，并消除 3 个 timeout；
  CI 端到端时长已可接受，拆分的收益不抵复杂度。
- 后续若 verify job 稳定超过 45 分钟再重启此评估。

## B-1.4 新激活工作流首跑观察

- `v2-flaky.yml`（cron `17 0 * * *`）与 `v2-security-audit.yml`
  （cron `0 3 * * 1`）此前从未运行；2026-08-14 22:02Z 通过
  `workflow_dispatch` 触发首跑，结果见 Actions。
- 结论在任务书 §1 快照更新时回填；两者均有 workflow_dispatch 入口，
  后续防漂移月检可直接手工触发。

## B-2.3 防漂移月度复跑

结论：**注册为月度人工任务**（不做自动 issue）：

- 每月 15 日前后执行：`pnpm verify`、`test:flaky`、
  `disaster:drill`、`delivery:drill`、`benchmark:load`、
  `v8-ignore:report`，并核对质量分 100 与 v8 ratchet 286。
- 执行清单已写入 `docs/delivery/OPS.md` §8。
- 下次复跑：2026-09-15。

## B-3.1 soak 长期验证

结论：**每周 1 小时自动 soak + 季度长跑保留人工**。

- GitHub-hosted runner 单 job 上限 6 小时，无法承载 24h job；
- 新增 `v2-soak.yml`（每周日 04:30 UTC，workflow_dispatch 可调时长），
  默认 1h、2 RPS，覆盖创建患者/dashboard/deep-health 并校验 p95 与
  数据库完整性；
- 季度级 24h+ 长跑保留在受控机器上手工执行
  （`V2_SOAK_SECONDS=86400 pnpm --filter @dental/v2 soak:smoke`）。

## B-3.3 内存/句柄增长监控

结论：**并入 weekly soak**。

- `soak-smoke.mjs` 自首请求成功后每 30s 采样 RSS/heap/external 与
  `process.getActiveResourcesInfo().length`，结束后对比首末样本，
  超限即失败（默认 heap 64MiB / RSS 128MiB / 活动资源 20，均可配）。
- `runtime.json` 与 `stability.json` 继续作为长期趋势的历史数据源。

## B-5.1 启动时间基准

结论：**用打包 smoke 的既有窗口作为健康基带，不新增专用计时器**。

- `packaged-ui-smoke` 以 90s firstWindow/60s 关键文案可见为硬上限，
  `installer-smoke` 以 90s 健康检查窗口为硬上限；任一超时 CI 即红。
- 专用冷启动秒表会拉长 CI 且不稳定（runner/杀软波动），收益有限；
  若出现「临界 90s」报告再引入 `benchmark:startup` 精确计量。

## B-5.2 前端 bundle 体积审计

2026-08-15 实测（`pnpm --filter @dental/v2 build`，Vite 8 / React 19）：

- `dist-web` 总 0.71MB；主入口 `index-*.js` 360KB（gzip 114KB），
  CSS 48KB（gzip 9KB）；
- 所有页面均已路由级 lazy chunk（最大页面 chunk 19.9KB），
  `use-crud-resource` 等共享逻辑独立分包；
- 结论：无需低风险项改动，维持现状；季度复看。

## B-5.3 DB 基准趋势季度回顾

2026-08-15 复跑 `benchmark:load`（对照 2026-08-12 基线）：

| 项目 | 本次 | 基线 | 阈值 | 结论 |
|---|---|---|---|---|
| 插入患者 | 1083ms | 913ms | 30000ms | PASS |
| 插入收费 | 1606ms | 1040ms | 30000ms | PASS |
| 患者搜索 | 7ms | 7ms | 5000ms | PASS |
| dashboard 聚合 | 99ms | 69ms | 10000ms | PASS |
| sync 全量元数据 | 54ms | 54ms | 5000ms | PASS |
| sync 全量患者页 | 74ms | 75ms | 5000ms | PASS |

均在阈值内，无趋势恶化信号；下次季度回顾 2026-11-15。

## B-6.1 月度依赖升级 PR 节奏

结论：**沿用现有 chore PR 惯例，每月第一个工作日开一条依赖升级 PR**，
不引入 Dependabot 自动流（历史审计要求第三方 action pin SHA + 人工复核，
自动流会绕过该复核）。升级后必须全量 `pnpm verify` 并人工确认
electron/better-sqlite3/vite 三类高风险依赖的 release notes。

## B-6.2 安全扫描调度确认

结论：**已完成（无需新代码）**。

- `v2-security-audit.yml` 已有 cron `0 3 * * 1`（每周一 03:00 UTC），
  覆盖 pnpm audit / osv-scanner / source security scan / license check /
  SBOM 上传；另有 workflow_dispatch 可即时触发。
- 与任务书快照「未做」不一致的原因：该 cron 在更早的 workflow hardening
  轮次已写入，本任务书只做了确认。
