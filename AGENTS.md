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

## 任务简报约定

非平凡改动（多文件、跨模块、涉及数据库/依赖变更）开始前，Agent 须先声明任务简报，包含：

1. **改动范围**：将编辑哪些模块/文件（对照"模块所有者映射"）
2. **验收标准**：完成的判定条件（如"`pnpm run verify` 全部通过 + 新增测试覆盖 X 场景"）
3. **不做什么**：本次明确排除的范围（防止范围蔓延）

复杂任务（新模块、架构调整、≥5 个文件）应先产出 Plan/Spec 并获用户确认后再执行；简单修改（单文件、配置、文档）可直接执行，但仍须在完成时报告验证结果。

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
| **根级交付验证（含 build + 三包覆盖率）** | `pnpm verify:delivery` | 根目录 |
| **根级三包覆盖率** | `pnpm test:cov` | 根目录 |
| **Pre-commit 钩子** | 自动（lint-staged + typecheck + test + arch:check，api/web 并行） | 提交时自动触发 |
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
| Web 单元测试 | `pnpm test` | `apps/web` |
| Web 覆盖率（含阈值门禁） | `pnpm test:cov` | `apps/web` |
| Web Lint | `pnpm lint` | `apps/web` |
| Web Lint（严格） | `pnpm lint:strict` | `apps/web` |
| Web 类型检查 | `pnpm typecheck` | `apps/web` |
| Web 全量验证 | `pnpm verify` | `apps/web` |
| 全量构建 | `pnpm build` | 根目录 |
| 开发模式 | `pnpm dev` | 根目录 |

## 验证执行链路

验证通过三层机制自动执行，确保每次变更都经过质量门禁：

| 层级 | 触发时机 | 覆盖范围 | 执行方式 |
|------|---------|---------|---------|
| **L0: Agent Hooks** | Agent 编辑/收尾时自动触发 | 编辑留痕 + 未验证改动提醒 | `.qoder/hooks.json`（verify-tracker + verify-gate） |
| **L1: Pre-commit Hook** | `git commit` 时自动触发 | lint-staged + typecheck + test + arch:check | `.husky/pre-commit`（api/web 并行） |
| **L2: Skill 路由** | 用户或 Agent 主动调用 | 按场景选择验证粒度 | `.qoder/skills/monorepo-verify`、`.qoder/skills/monorepo-test-verify`、`.qoder/skills/monorepo-debug-test` |
| **L3: 交付验收** | PR 准备或合并前 | 完整验证 + build + 覆盖率 | `.qoder/skills/monorepo-delivery-acceptance` |

> **注意**: Pre-commit hook 的执行不会被会话分析捕获为 tool call。这是正常行为——hook 由 git 触发，不经过 Agent 工具链。验证证据应通过 hook 执行结果（pass/fail）判断，而非会话中的 tool call 记录。

### 验证 Skill 覆盖映射

| 工作流需求 | 所有者 Skill | 触发条件 |
|-----------|-------------|---------|
| 完整门禁验证 | `.qoder/skills/monorepo-verify` (`/monorepo-verify`) | typecheck + lint + test + arch 全量 |
| 仅测试验证 | `.qoder/skills/monorepo-test-verify` (`/monorepo-test-verify`) | 运行测试、查看覆盖率 |
| 调试与修复 | `.qoder/skills/monorepo-debug-test` (`/monorepo-debug-test`) | 测试失败、构建报错、类型错误 |
| 交付验收 | `.qoder/skills/monorepo-delivery-acceptance` (`/monorepo-delivery-acceptance`) | PR 准备、合并前审查 |
| Harness 分析 | 内置 `/better-harness` | 项目健康分析、会话复核（非项目 Skill） |

## 会话模式分类指引

长会话（>45 分钟估算活跃时长）通常属于以下模式：

| 模式 | 典型时长 | 特征 | 示例 |
|------|---------|------|------|
| **子 Agent 分析任务** | 60-320 min | child-agent 角色，0 失败事件 | Better Harness 全轮分析、代码审查 |
| **复杂功能实现** | 30-90 min | 多文件编辑，多步骤验证 | 新模块开发、跨模块重构 |
| **调试与修复** | 15-60 min | 失败→诊断→修复→验证循环 | 测试失败修复、类型错误排查 |
| **简单修改** | <15 min | 单文件编辑，快速验证 | 配置修改、文档更新 |

> 子 Agent 长任务（如 Better Harness 分析）的长时长来自多步骤分析流程的正常执行，不属于工具链摩擦或效率问题。在复核时应将其分类为"复杂分析任务"而非"需要优化"。

## 编辑→验证闭环规则

**每次编辑 `source/` 下代码后，必须在同一工作流中运行验证命令**，形成可观测的编辑→验证因果链：

1. **编辑完成后**：立即运行 `/monorepo-verify`（完整门禁）或至少 `pnpm lint:strict` + `pnpm test`
2. **验证通过后**：方可继续下一个编辑或提交
3. **验证失败时**：使用 `/monorepo-debug-test` 诊断根因并修复，修复后重新验证
4. **会话收尾约束**：任何触及 `source/` 代码的会话，在最后一次编辑之后必须通过 `/monorepo-verify` Skill 执行 `pnpm run verify`（工作目录 `source/`），使收尾验证与本次改动集在同一会话内闭合；不得将收尾验证遗留给下一次会话

> 此规则确保 Better Harness 能观测到编辑与验证的因果关联（closure 从 changed-without-check 变为 closed）。verify-gate hook 会在会话收尾时对未验证改动输出提醒（含 `/monorepo-verify` 路由指引，仅提醒不阻塞）。

## 交付验收与高风险审批

### 交付验收流程

每次交付（提交/合并/发布）须按以下步骤走完，形成可追溯的验收记录：

1. **验证通过**：`pnpm run verify` 全部通过（typecheck + lint:strict + test + arch:check）；合并/发布级交付须跑 `pnpm run verify:delivery`（额外含 build + 三包覆盖率阈值门禁）
2. **验收 Skill**：合并前调用 `/monorepo-delivery-acceptance` 完成变更审查
3. **模块化提交**：按 Git 模块化提交命名规范拆分提交，每个提交是独立可回滚单元
4. **结果报告**：交付时明确报告验证结果（通过项 + 测试数量），失败时如实报告并附输出

### 高风险改动审批

以下改动属于高风险，执行前须向用户确认，不得静默执行：

| 高风险类别 | 示例 | 审批要求 |
|-----------|------|---------|
| 数据库结构变更 | 新增 migration、ALTER TABLE | 确认迁移方案 + 幂等性 |
| 依赖变更 | `pnpm add/remove/update` | 确认包名与版本 |
| 删除/覆盖文件 | 删除模块、覆盖配置 | 确认删除范围 |
| 外发操作 | git push、发布、外部 API 调用 | 逐次确认，不复用历史授权 |

### 回滚约定

- 每个模块化提交是最小回滚单元，`git revert <commit>` 即可撤销单个改动
- 数据库 migration 不可逆时，须在 migration 注释中说明手动回滚步骤
- 交付失败时优先回滚到上一个 verify 通过的提交，再排查

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
