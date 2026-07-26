# ADR-0005: IdempotencyService 单一实例

## 状态
已采纳

## 日期
2026-07-24

## 背景
`IdempotencyService` 是 `@Global()` 全局单例（在 `CommonModule` 中提供）。
但多个业务模块（`ChargeModule`、`RefundsModule`、`InventoryModule`）在本地重新声明了
`IdempotencyService` 作为 provider：

```typescript
@Module({
  providers: [ChargeService, IdempotencyService, ...]
})
```

这导致：
- 同一服务存在多个实例（违反 DRY 原则）
- 幂等性记录分散在不同实例中（潜在 bug：某些实例看不到另一些实例的记录）
- 模块耦合：业务模块需要直接导入 `IdempotencyService`

## 决策
移除业务模块中重复的 `IdempotencyService` 声明，直接依赖全局单例。

## 后果

### 正面
- 单一真相源：所有幂等性记录在同一个实例中
- 减少模块依赖：业务模块无需 import `IdempotencyService`
- 简化模块声明

### 负面
- 隐式依赖：业务模块不再显式声明 `IdempotencyService` 依赖
  - 缓解措施：在 ADR 中记录；在 service 构造函数中显式注入

## 实施
修改文件：
- `src/modules/financial/charge/charge.module.ts` - 移除
- `src/modules/financial/refunds/refunds.module.ts` - 移除
- `src/modules/inventory/inventory/inventory.module.ts` - 移除

## 替代方案
- 显式导入 CommonModule：仍然有耦合问题
