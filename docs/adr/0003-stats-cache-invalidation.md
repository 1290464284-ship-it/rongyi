# ADR-0003: 统计缓存失效策略

## 状态
已采纳

## 日期
2026-07-24

## 背景
`StatsService.dashboard()` 使用 `CacheService.getOrSet()` 缓存当日统计结果（TTL: 5 分钟）。
但项目原先**没有任何缓存失效机制**：

- 用户创建收费单 → 缓存陈旧 → dashboard 显示 5 分钟前的数据
- 用户支付/退费 → 缓存陈旧 → 财务数据不准
- 库存调整 → 缓存陈旧 → 库存统计错误

这导致：
1. 关键业务指标可能延迟 5 分钟才更新
2. 用户可能基于陈旧数据做决策

## 决策
在 `StatsService` 中添加 `invalidateStatsCache(clinicId)` 方法，
并在所有写操作（创建/更新/支付/退费/调整）完成后调用 `cache.delPattern(CACHE_PREFIXES.STATS)`。

## 后果

### 正面
- 统计数据的强一致性（写后立即失效）
- 用户体验提升：关键操作后立刻看到最新数据
- 集中失效：使用 delPattern 一次清理所有 stats:* 缓存

### 负面
- 频繁写操作时缓存命中率下降（dashboard 频繁重算）
  - 缓解：TTL 5 分钟提供兜底保护
- delPattern 是 O(n) 操作（n = 缓存键数量）
  - 当前最大 1000 条缓存，影响可忽略

## 实施
- `src/modules/system/stats/stats.service.ts`：添加 `invalidateStatsCache` 方法
- `src/modules/financial/charge/charge-payment.service.ts`：支付/退费时调用
- 缓存键前缀：`CACHE_PREFIXES.STATS = 'stats:'`

## 替代方案
- 写穿透（Write-through）：写入时同步更新 stats 表
  - 缺点：增加 stats 表的写入压力
- 主动失效（当前方案）：写后失效，下一次读时重算
  - 优点：实现简单，影响可控
