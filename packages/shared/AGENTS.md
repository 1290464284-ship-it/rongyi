# @dental/shared — 契约包指引

## 包定位

`@dental/shared` 是前后端共享的**契约包**，提供：

- **类型定义**（`types/`）：接口、类型别名
- **枚举常量**（`enums.ts`）：运行时可用的枚举值
- **业务常量**（`constants/`）：分页、角色、缓存 key 等
- **验证器**（`validators/`）：金额、手机号等校验工具

## 修改边界（重要）

### ✅ 允许的修改

- 新增类型、接口、枚举值
- 新增验证器函数
- 新增常量
- 修复验证器 bug
- 添加单元测试

### ❌ 禁止的修改

- **删除或重命名**已导出的类型、接口、枚举、函数（会破坏消费方）
- **修改已有类型签名字段**（如 `Patient` 接口删除字段）
- **改变常量值**（如修改 `MAX_PAGE_SIZE`）
- **改变验证器行为**（如 `yuanToCents` 返回值规则）

### 正确做法

如需破坏性变更：

1. 先在 shared 中**新增**替代项（保留旧项）
2. 消费方（api/web）迁移到新 API
3. 确认无引用后再废弃旧项

## 测试要求

- 所有验证器必须有单元测试
- 新增导出需更新 `src/__tests__/index.test.ts`
- 运行测试：`pnpm test`
- 测试框架：vitest

## 目录结构

```
src/
├── enums.ts              # 枚举定义（唯一来源）
├── index.ts              # 统一导出
├── types/                # 类型定义
│   ├── index.ts          # 业务接口
│   └── sync.ts           # 离线同步类型
├── constants/            # 业务常量
│   ├── cache-keys.ts     # 缓存 key 前缀
│   ├── pagination.ts     # 分页常量
│   └── roles.ts          # 角色权限
└── validators/           # 验证器
    ├── money.ts          # 金额工具（元 ↔ 分）
    └── phone.ts          # 手机号校验
```

## 消费方使用

```typescript
// API 或 Web 中
import { Patient, yuanToCents, isPhoneNumber, ROLES } from '@dental/shared';
```

## 约束

- 禁止引入第三方依赖（仅允许 `typescript`）
- 所有代码必须兼容 CommonJS 和 ESM
- 遵循项目规则：SQL 参数化、软删除、禁 ORM 等（见 `.qoder/rules/`）
