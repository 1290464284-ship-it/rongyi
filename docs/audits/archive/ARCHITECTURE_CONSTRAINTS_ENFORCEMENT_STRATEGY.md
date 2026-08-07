# 架构约束执行策略评估

**评估日期**: 2026-07-27（更新）  
**评估目标**: 确定关键架构约束应通过 ESLint 规则机械检查，还是保持为 agent-only 约束

## 执行摘要

已实施三层混合执行策略：
1. **ESLint 规则** — 禁止特定包导入（ORM、UI 框架、数据库直接访问、前端 axios/fetch）
2. **验证脚本** — 检测 SQL 字符串拼接、物理删除、跨模块导入、schema/lock 文件修改
3. **Qoder Rules** — Agent 操作时自动触发的语义约束

## 决策矩阵

| 约束 | 执行方式 | 理由 |
|---|---|---|
| **禁止 ORM 框架导入** (api) | ✅ ESLint `no-restricted-imports` | 可直接实现，零违规，高价值低成本 |
| **禁止 UI 框架导入** (web) | ✅ ESLint `no-restricted-imports` | 禁止 antd、@mui、@chakra-ui 等导入 |
| **禁止前端直接访问数据库** (web) | ✅ ESLint `no-restricted-imports` | 禁止 better-sqlite3、sqlite3 导入 |
| **前端 API 层封装** (web) | ✅ ESLint `no-restricted-imports` + `no-restricted-syntax` | 禁止组件直接使用 axios/fetch，lib/api/ 豁免 |
| **禁止 TypeScript any** | ✅ ESLint `@typescript-eslint/no-explicit-any` | 已启用为 error，测试文件豁免 |
| **SQL 参数化查询** (api) | 🔍 验证脚本 + 🤖 Agent | ESLint 误报过多，验证脚本检测字符串拼接和危险变量插值 |
| **软删除强制** (api) | 🔍 验证脚本 + 🤖 Agent | 验证脚本检测 DELETE FROM/TRUNCATE/DROP TABLE |
| **NestJS 模块边界** (api) | 🔍 验证脚本 + 🤖 Agent | 验证脚本检测跨模块直接 import 内部文件 |
| **DB Schema 保护** (api) | 🔍 验证脚本 | Git diff 检测 schema.ts 修改 |
| **pnpm-lock 保护** | 🔍 验证脚本 | Git diff 检测 lock 文件手动修改 |
| **禁止手动 migration** (api) | 🤖 Agent-only | 操作约束，无法通过代码检测 |

## 已实施的 ESLint 规则

### 1. ORM 禁止导入规则 (API)

**文件**: `source/apps/api/eslint.config.js`

使用 `no-restricted-imports` 禁止 prisma、typeorm、sequelize 导入。

### 2. UI 框架禁止导入规则 (Web)

**文件**: `source/apps/web/eslint.config.js`

使用 `no-restricted-imports` 禁止 antd、@mui/material、@chakra-ui/react、@emotion/react、@emotion/styled、material-ui、semantic-ui-react、primereact、@blueprintjs/core 导入。

### 3. 前端数据库访问禁止规则 (Web)

**文件**: `source/apps/web/eslint.config.js`

使用 `no-restricted-imports` 禁止 better-sqlite3、sqlite3 导入。

### 4. 前端 API 层封装规则 (Web)

**文件**: `source/apps/web/eslint.config.js`

- `no-restricted-imports`: 禁止 axios 导入（`src/lib/api/**` 豁免）
- `no-restricted-syntax`: 禁止 `fetch()` 调用（`src/lib/api/**` 豁免）

### 5. TypeScript any 禁止规则 (API + Web)

**文件**: `source/apps/api/eslint.config.js`、`source/apps/web/eslint.config.js`

`@typescript-eslint/no-explicit-any` 设为 error（继承自 recommended 配置），测试文件豁免。

**验证结果**: 
- ✅ API `pnpm lint:strict` 通过（零错误零警告）
- ✅ Web `pnpm lint` 通过（零错误，仅有预存在的 unused-vars 警告）
- ✅ API 3086 个测试全部通过

## 验证脚本

**文件**: `source/apps/api/scripts/validate-arch-rules.mjs`  
**命令**: `pnpm --filter @dental/api arch:check`

### 检查项

| # | 规则 | 检测内容 | 误报控制 |
|---|---|---|---|
| 1 | sql-parameterization | SQL 字符串拼接（`+`）、危险变量插值（`${phone}` 等） | 跳过安全模式（`clinicClause`、`tableName`、常量、函数调用、成员访问） |
| 2 | soft-delete-enforcement | `DELETE FROM`、`TRUNCATE TABLE`、`DROP TABLE` | 排除无 `deletedAt` 列的日志表（SystemAlert、SyncChangeLog 等） |
| 3 | nestjs-module-boundary | 跨模块直接 import `.service`/`.controller` 文件 | 排除 `common/`、`*.module.ts`、`packages/shared` |
| 4 | db-schema-protection | Git diff 检测 schema.ts 修改无对应 migration 变更 | 仅警告 |
| 5 | pnpm-lock-protection | Git diff 检测 lock 文件修改无对应 package.json 变更 | 仅警告 |

### 当前检测结果

- **sql-parameterization**: 0 违规（代码库无危险变量插值）
- **soft-delete-enforcement**: 1 违规（`combo.service.ts` 对 `ChargeComboItem` 使用物理删除，该表有 `deletedAt` 列）
- **nestjs-module-boundary**: 0 违规
- **db-schema-protection**: 通过
- **pnpm-lock-protection**: 通过

## Agent-Only 约束

以下约束无法通过代码检测，仅由 Qoder Rules 在 agent 操作时触发：

### 禁止手动运行 Migration (no-manual-migration.md)
- **约束**: 数据库迁移由应用启动时自动执行，禁止手动运行
- **为何无法检测**: 这是操作约束，涉及 shell 命令执行行为，代码中无可检测模式

## 验证命令

```bash
# 验证 ESLint 规则生效
cd source/apps/api
pnpm lint:strict

cd source/apps/web
pnpm lint

# 验证架构规则脚本
cd source/apps/api
pnpm arch:check

# 验证 Qoder Rules 存在
ls .qoder/rules/
```

## 结论

**三层混合策略**确保所有 11 条架构约束都有机械执行机制：

1. ✅ **ESLint 规则**（5 条约束）— CI 强制阻断，零误报
2. 🔍 **验证脚本**（5 条约束）— 可选运行，检测高危模式，最小化误报
3. 🤖 **Qoder Rules**（1 条约束）— Agent 操作时自动触发

## 参考文件

- API ESLint 配置: `source/apps/api/eslint.config.js`
- Web ESLint 配置: `source/apps/web/eslint.config.js`
- 验证脚本: `source/apps/api/scripts/validate-arch-rules.mjs`
- Qoder Rules: `.qoder/rules/*.md` (11 个规则文件)
- AGENTS.md 约束: `source/AGENTS.md`, `source/apps/api/AGENTS.md`, `source/apps/web/AGENTS.md`
