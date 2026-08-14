# 优化决策记录（2026-08-12）

## 1. 高频日期查询统一 UTC 区间

- 状态：已采纳
- 背景：工作台“今日”与微信提醒候选此前用 `LIKE 'YYYY-MM-DD%'` / `substr(datetime(...))`，既无法利用时间索引，也在 +8 时区下把 UTC 前缀误当成诊所本地日期。
- 决策：统一使用 `clinicDayStartUtc/clinicDayEndUtc` 生成 `[start, end]` 区间条件，时间列保留可索引形式。

## 2. 大列表 keyset 游标分页

- 状态：已采纳（服务端 + `fetchAllPages` + 患者列表页启用）
- 决策：`Page.nextCursor` / `RepositoryQuery.cursor` 作为可选契约；传入 cursor 时按 `id ASC` 拉取下一页，`total` 口径不变。前端 `useCrudResource` 支持 `cursorPagination`，`CrudPage` 渲染游标分页器。避免深分页 offset 扫描。

## 3. smoke 脚本公共运行时

- 状态：已采纳
- 决策：`scripts/lib/smoke-runtime.mjs` 统一 `pnpmCommand`、端口探测、进程树清理与参数注入防护；`run-smokes.mjs` / `delivery-smoke-runner.mjs` 复用。

## 4. 请求日志采样

- 状态：已采纳
- 决策：普通 GET 默认 1% 采样，可通过 `V2_REQUEST_LOG_SAMPLE_RATE` 覆盖；写请求、错误请求、慢请求（>200ms）始终记录。

## 5. 大库惰性物化快照（>100k 行）

- 状态：已采纳
- 决策：当 `Patient+Charge`（dashboard）或 `InventoryTransaction`（replenishment）行数超过 100k 时，启用惰性物化快照：
  - `StatSnapshot`：dashboard 六项指标 JSON，写路径经 `trackResourceWrite` 失效。
  - `ReplenishmentSnapshot`：90 天消耗聚合，写路径失效 + `MAX(createdAt)` 二次校验，避免漏失效。
  - 未达阈值时维持实时查询；快照仅作为“重建一次后复用”的缓存，不引入增量账本复杂度。

## 6. 全局搜索作为跨模块导航习惯

- 状态：已采纳
- 决策：顶栏搜索进入 `/search` 全局结果页，按资源筛选并支持跳转患者/库存/收费/预约；快捷键说明同步更新。
