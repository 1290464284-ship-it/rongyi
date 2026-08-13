# 第 75 轮架构决策归档

日期：2026-08-13

## ADR-075-01：OpenAPI 路径模板统一为 `{param}`

- Express 路由继续使用 `:param`，生成脚本负责转换为 OpenAPI 的 `{param}`。
- 每个 generated path operation 必须声明对应 path parameter。
- `openapi-route-coverage.spec.ts` 同时校验实时路由覆盖与参数声明。

## ADR-075-02：通用资源仓库支持无 id 表

- `UserRole` 是复合业务表，没有 `id` 列。
- 仓库在排序与 keyset 游标路径中检查 `id` 列是否存在；无 id 表不启用 keyset，只按
  `createdAt DESC` 或声明字段稳定排序。
- 这避免 `UserRole` 通用 list 返回 500，并保留专用 `/user-roles` 路由作为写入口。

## ADR-075-03：开发环境 CORS 放行任意回环端口

- 生产环境仍只放行 API 端口、file:// Electron 来源和显式配置来源。
- 非生产环境额外放行任意 `http://127.0.0.1:*` 与 `http://localhost:*`，
  支持 Vite 随机端口、Playwright 与本地 smoke 工具。
- Vite proxy 固定指向 `127.0.0.1`，避免 `localhost` 在 IPv4/IPv6 下解析不稳定。

## ADR-075-04：quality-score 使用 rolling window 与 committed baseline

- flaky 与 quality 历史按最近 3 次运行计算，避免一次历史偶发永久拉低评分。
- `quality-baseline.json` 提交到仓库，当前 CI 评分低于 baseline 即失败。
- 连续两轮下降也会在本地脚本中失败。

## 保留的历史决策

- D-006：legacy 输入/产物作为内部兼容文件正式归档。
- D-007：产品正式放弃 legacy 导入前保留 legacy 路径。
