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

1. **SQLite + 原生 SQL**：数据库使用 `better-sqlite3`，通过 `DbService` 执行参数化 SQL。**无 ORM、无 Prisma**。Schema 定义在 `apps/api/src/db/schema.ts`，迁移在 `apps/api/src/db/migrations.ts`。
2. **pnpm monorepo**：包管理器为 pnpm 11+，workspace 协议引用内部包。所有安装/运行命令须在对应 workspace 下执行或使用 `pnpm --filter`。
3. **NestJS 模块边界**：每个业务域一个 Module，通过 DI 注入服务。跨模块调用须经 Module imports 显式声明，禁止直接 import 其他模块内部文件。
4. **本地优先部署**：Electron 桌面应用 + 可选 LAN 浏览器访问，无云依赖。
5. **软删除**：所有表使用 `deletedAt` 列实现软删除。
6. **参数化查询**：SQL 一律使用 `?` 占位符，严禁字符串拼接。
7. **UI 语言**：界面中文 (zh-CN)，代码标识符英文。
8. **共享包**：跨前后端的类型/枚举放 `packages/shared`，修改后需重新 build。

## 验证命令路由

| 场景 | 命令 | 工作目录 |
|------|------|---------|
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
| 全量构建 | `pnpm build` | 根目录 |
| 开发模式 | `pnpm dev` | 根目录 |

## 禁止事项

- ❌ **不引入 Prisma / TypeORM / 任何 ORM** — 本项目使用原生 SQL
- ❌ **不运行数据库 migration 命令** — 迁移由应用启动时自动执行
- ❌ **不直接修改 `src/db/schema.ts`** — 须通过 migration 流程变更表结构
- ❌ **不在 SQL 中使用字符串拼接** — 必须参数化
- ❌ **不跨模块直接 import 内部文件** — 通过 NestJS Module 导出
- ❌ **不修改 `pnpm-lock.yaml` 手动内容** — 由 pnpm 命令管理
- ❌ **不在前端直接调用 SQLite** — 所有数据操作经 API
- ❌ **不删除 `packages/shared/dist/`** — 由 build 生成，修改源码后重新 build

## 快速定位指南

- 要改后端业务逻辑 → `apps/api/src/modules/<领域>/`
- 要改前端页面 → `apps/web/src/modules/<领域>/`
- 要改 API 调用层 → `apps/web/src/lib/api/`
- 要改公共组件 → `apps/web/src/components/`
- 要改数据库结构 → `apps/api/src/db/`
- 要改共享类型 → `packages/shared/src/`
- 要改认证/权限 → `apps/api/src/modules/auth/` + `apps/api/src/common/guards/`
- 要改全局中间件/拦截器 → `apps/api/src/common/`
