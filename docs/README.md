# 🏥 口腔诊所管理系统（牙科管家）文档中心

欢迎来到口腔诊所管理系统项目文档中心。本页是整个仓库的文档总索引，帮助您快速定位各类技术文档。

---

## 📁 仓库结构说明

```
source/
├── apps/
│   ├── api/              # API 后端服务（NestJS + SQLite）
│   └── web/              # 前端应用 + Electron 桌面端
├── docs/                 # 仓库级文档（本目录）
│   ├── architecture/     # 架构设计文档
│   ├── adr/              # 架构决策记录
│   ├── plans/            # 项目计划文档
│   └── ...
├── .github/              # GitHub 配置（CI/PR 模板等）
└── ...
```

### 子项目文档

| 项目 | 路径 | 说明 |
|------|------|------|
| **API 后端** | [apps/api](../apps/api/) | NestJS + SQLite 后端服务 |
| **API 文档索引** | [apps/api/docs/README.md](../apps/api/docs/README.md) | API 项目文档中心 ↗ |
| **前端应用** | [apps/web](../apps/web/) | React + TypeScript + Vite 前端 |
| **Electron 桌面** | [apps/web/electron/](../apps/web/electron/) | Electron 桌面端主进程 |

---

## 📚 文档导航

### 🏗️ 架构设计文档

| 文档 | 说明 |
|------|------|
| [系统架构总览](./architecture/system-architecture.md) | 整体系统架构设计、分层架构、模块划分 |
| [事件驱动架构](./architecture/event-driven-architecture.md) | 事件驱动设计模式、领域事件 |
| [数据库迁移计划](./architecture/database-migration-plan.md) | 从 Postgres 到 SQLite 的迁移方案 |
| [云部署规划](./architecture/cloud-deployment-plan.md) | 云端部署架构设计 |

### 📋 架构决策记录 (ADR)

| 编号 | 标题 | 状态 |
|------|------|------|
| [ADR-0001](./adr/0001-global-cache-service.md) | 全局缓存服务单例 | ✅ 已采纳 |
| [ADR-0002](./adr/0002-clinic-isolation-via-context.md) | 通过 ClinicContext 实现多租户隔离 | ✅ 已采纳 |
| [ADR-0003](./adr/0003-stats-cache-invalidation.md) | 统计缓存失效策略 | ✅ 已采纳 |
| [ADR-0004](./adr/0004-health-module-extraction.md) | Health 模块独立化 | ✅ 已采纳 |
| [ADR-0005](./adr/0005-idempotency-service-single-instance.md) | IdempotencyService 单一实例 | ✅ 已采纳 |
| [ADR-0006](./adr/0006-database-choice-sqlite.md) | 数据库选型 - SQLite | ✅ 已采纳 |
| [ADR-0007](./adr/0007-native-sql-over-orm.md) | 数据访问层 - 原生 SQL | ✅ 已采纳 |
| [ADR-0008](./adr/0008-jwt-authentication.md) | 认证方案 - JWT | ✅ 已采纳 |
| [ADR-0009](./adr/0009-testing-strategy.md) | 测试策略 | ✅ 已采纳 |
| [ADR-0010](./adr/0010-file-storage.md) | 文件存储方案 | ✅ 已采纳 |

> 完整 ADR 索引见 [ADR 目录](./adr/README.md)

### 💻 开发规范

| 文档 | 说明 |
|------|------|
| [代码审查清单](./code-review-checklist.md) | PR 代码评审逐项检查清单 |
| [开发者提交前自检指南](./dev-self-check.md) | 提交代码前的自查清单 |

### 📝 项目计划

| 文档 | 说明 |
|------|------|
| [综合修复计划](./plans/2026-07-21-comprehensive-fix-plan.md) | 2026-07-21 综合修复方案 |
| [MVP 阶段计划](./superpowers/plans/2026-07-16-dental-clinic-mvp.md) | MVP 阶段开发计划 |
| [第二阶段计划](./superpowers/plans/2026-07-16-dental-clinic-phase2.md) | Phase 2 开发计划 |
| [第三阶段计划](./superpowers/plans/2026-07-16-dental-clinic-phase3.md) | Phase 3 开发计划 |

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18 LTS
- pnpm >= 8
- （可选）Electron 构建需要对应平台的构建工具

### 一键启动开发环境

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example apps/api/.env
# 编辑 apps/api/.env，设置 JWT_SECRET 等

# 3. 启动开发服务（API + Web 同时启动）
pnpm dev
```

启动后访问：
- 前端：http://localhost:5173
- 后端 API：http://localhost:3001
- API 文档（Swagger）：http://localhost:3001/api/docs

### 默认测试账号

开发环境种子数据默认账号：

| 用户名 | 角色 | 密码 |
|--------|------|------|
| `boss` | 老板 | `123456` |
| `doctor` | 医生 | `123456` |
| `front` | 前台 | `123456` |

> ⚠️ 生产 / Electron 首次启动会生成随机初始密码并写入日志，请立即修改。

### 更多详细文档

- [API 项目开发指南](../apps/api/docs/development/setup.md) ↗
- [API 项目文档索引](../apps/api/docs/README.md) ↗

---

## 🛠️ 开发工具

### 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 同时启动 API + Web 开发服务 |
| `pnpm build` | 构建 shared + api + web |
| `pnpm electron:dev` | Electron 开发模式 |
| `pnpm electron:dist` | 打包桌面安装包 |
| `pnpm --filter @dental/api test` | 运行 API 测试 |
| `pnpm --filter @dental/api lint` | API 代码 Lint 检查 |

### 代码质量工具

| 工具 | 用途 |
|------|------|
| ESLint | 代码质量检查 |
| Prettier | 代码格式化 |
| Husky | Git 钩子 |
| lint-staged | 暂存文件检查 |
| Commitlint | 提交信息规范 |
| Jest | 测试框架 |

### CI/CD

配置位于 [`.github/workflows/`](../.github/workflows/)：
- `ci.yml` - 持续集成（构建、测试、Lint）
- `deploy.yml` - 部署流水线

---

## 📖 贡献指南

### 工作流

1. **Fork / 克隆** 仓库
2. **创建分支**：`feature/xxx` 或 `fix/xxx`
3. **开发代码**，遵循项目代码规范
4. **提交前自检**：对照 [开发者自检指南](./dev-self-check.md) 逐项检查
5. **提交 PR**，填写 [PR 模板](../.github/pull_request_template.md)
6. **代码审查**：审查者对照 [代码审查清单](./code-review-checklist.md) 检查
7. **合并**：审查通过后合并到主分支

### 分支命名规范

| 类型 | 前缀 | 示例 |
|------|------|------|
| 新功能 | `feature/` | `feature/patient-import` |
| Bug 修复 | `fix/` | `fix/charge-calculation` |
| 文档 | `docs/` | `docs/api-index` |
| 重构 | `refactor/` | `refactor/db-layer` |
| 性能优化 | `perf/` | `perf/query-optimization` |

### 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，详见各项目的提交规范文档。

---

## 📊 项目概览

### 技术栈

- **前端**：React 18 + TypeScript + Vite + TailwindCSS
- **后端**：NestJS 11 + TypeScript + better-sqlite3 (SQLite)
- **桌面端**：Electron
- **认证**：JWT + Refresh Token
- **测试**：Jest + Supertest + fast-check

### 核心业务模块

| 模块 | 说明 |
|------|------|
| 患者管理 | 患者档案、就诊历史、口腔记录 |
| 预约排班 | 预约挂号、椅位管理、排班 |
| 临床诊疗 | 初诊、病历、治疗计划、治疗记录 |
| 财务收费 | 收费、退款、会员卡、支付方式 |
| 库存管理 | 药品耗材、采购、加工单、供应商 |
| 系统管理 | 诊所设置、用户权限、操作日志 |

---

## 📁 文档目录结构

```
docs/
├── README.md                          # 本文件 - 根级文档索引
├── code-review-checklist.md           # 代码审查清单
├── dev-self-check.md                  # 开发者提交前自检指南
├── architecture/                      # 架构设计文档
│   ├── system-architecture.md         # 系统架构总览
│   ├── event-driven-architecture.md   # 事件驱动架构
│   ├── database-migration-plan.md     # 数据库迁移计划
│   └── cloud-deployment-plan.md       # 云部署规划
├── adr/                               # 架构决策记录
│   ├── README.md                      # ADR 索引
│   ├── 0001-global-cache-service.md
│   ├── 0002-clinic-isolation-via-context.md
│   ├── ... (共 10 条)
│   └── 0010-file-storage.md
├── plans/                             # 项目计划
│   └── 2026-07-21-comprehensive-fix-plan.md
└── superpowers/plans/                 # 阶段计划
    ├── 2026-07-16-dental-clinic-mvp.md
    ├── 2026-07-16-dental-clinic-phase2.md
    └── 2026-07-16-dental-clinic-phase3.md
```

---

> 💡 **提示**：标记 ↗ 的链接指向子项目文档（`apps/api/docs/` 等）。
