# ADR-0004: Health 模块独立化

## 状态
已采纳

## 日期
2026-07-24

## 背景
`HealthController` 和 `DatabaseConsistencyService` 之前直接在 `app.module.ts` 中注册：

```typescript
controllers: [HealthController],
providers: [DatabaseConsistencyService, ...]
```

这种做法破坏了 NestJS 模块化原则：
- 健康检查相关的所有组件散落在根模块
- 难以测试（无法单独 import 整个 health 子系统）
- 增加 app.module.ts 复杂度

## 决策
创建独立的 `HealthModule`：
- 文件：`src/modules/system/health/health.module.ts`
- 封装 `HealthController` 和 `DatabaseConsistencyService`
- 通过 `SystemModule` 统一导入

## 后果

### 正面
- 关注点分离：健康检查自成子系统
- 可独立测试
- app.module.ts 保持简洁
- 与系统其他子模块（settings, backups, search 等）结构一致

### 负面
- 增加一个文件层（微小开销）

## 实施
```typescript
// src/modules/system/health/health.module.ts
@Module({
  imports: [DbModule],
  controllers: [HealthController],
  providers: [DatabaseConsistencyService],
  exports: [DatabaseConsistencyService],
})
export class HealthModule {}
```

## 替代方案
- 保持现状：直接注册到 app.module.ts
  - 缺点：违反模块化原则
