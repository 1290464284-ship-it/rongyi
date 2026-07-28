# AGENTS.md — 口腔诊所管理系统 (dental-clinic)

## 项目结构速览

```
source/
├── apps/
│   ├── api/          # NestJS 后端 (port 3001, 内嵌 SQLite)
│   └── web/          # React 前端 (Vite + Electron 桌面壳)
├── packages/
│   └── shared/       # 共享 TypeScript 类型/枚举 (@dental/shared)
├── docs/             # ADR、架构文档、计划
├── package.json      # 根 workspace 脚本
└── pnpm-workspace.yaml
```

包名：`@dental/api`、`@dental/web`、`@dental/shared`

## 模块所有者映射

| 领域 | API 模块路径 | Web 模块路径 |
|------|-------------|-------------|
| 认证 | `src/modules/auth/` | `src/modules/auth/` |
| 患者 | `src/modules/patients/` | `src/modules/patient/` |
| 预约/排班 | `src/modules/scheduling/` (appointments, chairs) | `src/modules/appointment/` |
| 临床 | `src/modules/clinical/` (first-exams, oral-examinations, periodontal-records, registrations, visits, treatments, treatment-plans, medical-records) | `src/modules/clinical/`, `first-exams/`, `medical-records/`, `treatment-plan/`, `registration/` |
| 收费/财务 | `src/modules/financial/` (charge, refunds, member-cards) | `src/modules/charge/`, `charge-v2/`, `finance/` |
| 库存 | `src/modules/inventory/` (inventory, suppliers, purchase-orders, processing-orders) | `src/modules/inventory/`, `processing-orders/` |
| 内容 | `src/modules/content/` (drug-catalog, imaging, prescriptions, tooth-records) | `src/modules/imaging/`, `prescription/` |
| 沟通 | `src/modules/communication/` (follow-ups, wechat) | `src/modules/follow-ups/`, `wechat/` |
| 系统 | `src/modules/system/` (backups, clinics, health, metrics, operation-logs, search, settings, stats) | `src/modules/settings/`, `dashboard/`, `report/`, `staff/` |
| 设备 | `src/modules/equipment/` | `src/modules/equipment/` |
| 公共基础 | `src/common/` (guards, filters, interceptors, middleware, services, repositories) | `src/lib/`, `src/components/ui/` |
| 数据库 | `src/db/` (schema, migrations, seed, DbService) | — |

## 关键约束

> **规范来源声明**：以下约束的详细规范定义在 `.qoder/rules/` 目录中，此处仅作摘要。修改约束时请更新对应的 rule 文件。

1. **SQLite + 原生 SQL** → 详见 `.qoder/rules/no-orm-usage.md`
2. **pnpm monorepo**：包管理器为 pnpm 11+，workspace 协议引用内部包
3. **NestJS 模块边界** → 详见 `.qoder/rules/nestjs-module-boundary.md`
4. **本地优先部署**：Electron 桌面应用 + 可选 LAN 浏览器访问，无云依赖
5. **软删除** → 详见 `.qoder/rules/soft-delete-enforcement.md`
6. **参数化查询** → 详见 `.qoder/rules/sql-parameterization.md`
7. **UI 语言**：界面中文 (zh-CN)，代码标识符英文
8. **共享包**：跨前后端的类型/枚举放 `packages/shared`，修改后需重新 build

## 验证命令路由

| 场景 | 命令 | 工作目录 |
|------|------|--------|
| **根级全量验证** | `pnpm verify` | 根目录 |
| **Pre-commit 钩子** | 自动（lint-staged + typecheck + test，api/web 并行） | 提交时自动触发 |
| API 单元测试 | `pnpm test` | `apps/api` |
| API 覆盖率 | `pnpm test:cov` | `apps/api` |
| API E2E 测试 | `pnpm test:e2e` | `apps/api` |
| API 冒烟测试 | `pnpm test:smoke` | `apps/api` |
| API 迁移测试 | `pnpm test:migration` | `apps/api` |
| API Lint（严格） | `pnpm lint:strict` | `apps/api` |
| API 类型检查 | `pnpm typecheck` | `apps/api` |
| API 全量验证 | `pnpm verify` | `apps/api` |
| Web 构建 | `pnpm build` | `apps/web` |
| Web E2E 测试 | `pnpm test:e2e` | `apps/web` |
| Web Lint | `pnpm lint` | `apps/web` |
| Web 全量验证 | `pnpm verify` | `apps/web` |
| 全量构建 | `pnpm build` | 根目录 |
| 开发模式 | `pnpm dev` | 根目录 |

## 禁止事项

> 以下每条约束只有一个规范来源（rule 文件），修改时请更新对应 rule 文件。

- ❌ **不引入 ORM** → 详见 `.qoder/rules/no-orm-usage.md`
- ❌ **不手动运行 migration** → 详见 `.qoder/rules/no-manual-migration.md`
- ❌ **不直接修改 schema.ts** → 详见 `.qoder/rules/db-schema-protection.md`
- ❌ **不在 SQL 中拼接字符串** → 详见 `.qoder/rules/sql-parameterization.md`
- ❌ **不跨模块 import 内部文件** → 详见 `.qoder/rules/nestjs-module-boundary.md`
- ❌ **不手动修改 pnpm-lock.yaml** → 详见 `.qoder/rules/pnpm-lock-protection.md`
- ❌ **不在前端直接访问数据库** → 详见 `.qoder/rules/frontend-no-direct-data.md`
- ❌ **不删除 packages/shared/dist/** — 由 build 生成，修改源码后重新 build

> **注意**：以上禁止事项为全局架构约束，无论编辑哪个文件均须遵守。核心规则（SQL 参数化、软删除、Schema 保护、pnpm-lock 保护、禁止 ORM、禁止第三方 UI 框架、禁止 any 类型）已设为 `alwaysApply: true`，在任何文件编辑时均会触发。其他规则（NestJS 模块边界、前端 API 层、前端数据访问、手动 migration）通过 glob 模式在相关文件中自动触发，但约束本身同样适用于所有相关文件。

## 快速定位指南

- 要改后端业务逻辑 → `apps/api/src/modules/<领域>/`
- 要改前端页面 → `apps/web/src/modules/<领域>/`
- 要改 API 调用层 → `apps/web/src/lib/api/`
- 要改公共组件 → `apps/web/src/components/`
- 要改数据库结构 → `apps/api/src/db/`
- 要改共享类型 → `packages/shared/src/`
- 要改认证/权限 → `apps/api/src/modules/auth/` + `apps/api/src/common/guards/`
- 要改全局中间件/拦截器 → `apps/api/src/common/`
