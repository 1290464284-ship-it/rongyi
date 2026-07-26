# 架构决策记录 (ADR)

本目录记录项目中重要的架构决策，每个 ADR 文件记录一个决策及其背景、后果。

## ADR 索引

| 编号 | 标题 | 状态 | 日期 |
|------|------|------|------|
| [ADR-0001](./0001-global-cache-service.md) | 全局缓存服务单例 | 已采纳 | 2026-07-24 |
| [ADR-0002](./0002-clinic-isolation-via-context.md) | 通过 ClinicContext 实现多租户隔离 | 已采纳 | 2026-07-24 |
| [ADR-0003](./0003-stats-cache-invalidation.md) | 统计缓存失效策略 | 已采纳 | 2026-07-24 |
| [ADR-0004](./0004-health-module-extraction.md) | Health 模块独立化 | 已采纳 | 2026-07-24 |
| [ADR-0005](./0005-idempotency-service-single-instance.md) | IdempotencyService 单一实例 | 已采纳 | 2026-07-24 |
| [ADR-0006](./0006-database-choice-sqlite.md) | 数据库选型 - SQLite | 已采纳 | 2026-07-24 |
| [ADR-0007](./0007-native-sql-over-orm.md) | 数据访问层 - 原生 SQL | 已采纳 | 2026-07-24 |
| [ADR-0008](./0008-jwt-authentication.md) | 认证方案 - JWT | 已采纳 | 2026-07-24 |
| [ADR-0009](./0009-testing-strategy.md) | 测试策略 | 已采纳 | 2026-07-24 |
| [ADR-0010](./0010-file-storage.md) | 文件存储方案 | 已采纳 | 2026-07-24 |

## 写作规范

- 每个 ADR 文件名格式：`NNNN-short-title.md`
- 状态：`已采纳` / `已废弃` / `待讨论` / `已替代`
- 必须包含：背景、决策、后果、替代方案
