# ADR-0001: 全局缓存服务单例

## 状态
已采纳

## 日期
2026-07-24

## 背景
项目中原有多个业务模块（如 SettingsModule、StatsModule）各自声明了 `CacheService` provider，
导致两个独立实例互不可见，跨模块缓存失效无法生效。

例如：用户更新设置时，希望 settings cache 失效；用户创建收费时，希望 stats cache 失效。
但因为是多个实例，业务方需要直接调用 `delPattern`，无法通过单一入口清理全局缓存。

## 决策
将 `CacheService` 抽离到独立的全局模块 `CacheModule`，通过 `@Global()` 装饰器，
保证所有业务模块共享同一个 `CacheService` 实例。

## 后果

### 正面
- 跨模块缓存失效成为可能（任何模块都能触发全局缓存清理）
- 减少重复实例的内存占用
- 缓存统计（命中率、容量）能够反映真实情况

### 负面
- 全局单例增加耦合性，需要谨慎设计缓存键的命名空间
- 单点风险：缓存实例崩溃影响所有模块

## 实施
- 文件：`src/common/services/cache.module.ts`
- 缓存键前缀统一在 `src/common/constants/cache-keys.ts` 定义

## 替代方案
- 保持各模块独立实例：通过事件总线实现跨模块缓存失效
  - 缺点：增加复杂度，事件订阅和清理容易遗漏
