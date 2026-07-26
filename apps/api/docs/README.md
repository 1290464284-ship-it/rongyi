# 🏥 牙科诊所管理系统 API 文档中心

欢迎来到牙科诊所管理系统 API 后端服务文档中心。本文档索引页将帮助您快速找到所需的技术文档。

---

## 📚 文档导航

### 🏗️ 架构文档

| 文档 | 说明 |
|------|------|
| [API 版本策略](./architecture/api-versioning.md) | API 版本管理规范与演进策略 |
| [系统架构总览](../../../docs/architecture/system-architecture.md) | 系统整体架构设计 ↗ |
| [事件驱动架构](../../../docs/architecture/event-driven-architecture.md) | 事件驱动设计 ↗ |
| [数据库迁移计划](../../../docs/architecture/database-migration-plan.md) | 数据库迁移方案 ↗ |
| [云部署规划](../../../docs/architecture/cloud-deployment-plan.md) | 云端部署架构 ↗ |

### 📋 业务文档

| 文档 | 说明 |
|------|------|
| [患者管理流程](./business/patient-flow.md) | 患者档案、就诊记录管理 |
| [预约排班流程](./business/appointment-flow.md) | 预约、排班、椅位管理 |
| [临床诊疗流程](./business/clinical-flow.md) | 初诊、病历、治疗计划、治疗记录 |
| [收费结算流程](./business/charge-flow.md) | 收费、支付、退款、财务流水 |
| [会员卡管理流程](./business/member-card-flow.md) | 会员卡充值、消费、余额管理 |
| [库存管理流程](./business/inventory-flow.md) | 库存、采购、加工单、供应商管理 |

### 💻 开发文档

| 文档 | 说明 |
|------|------|
| [开发环境搭建](./development/setup.md) | 本地开发环境配置指南 |
| [测试指南](./development/testing-guide.md) | 单元测试、集成测试、E2E 测试 |
| [日志规范](./development/logging.md) | 日志分级、结构化日志、敏感数据脱敏 |
| [代码提交规范](./development/commit-convention.md) | Git 提交信息格式规范 |
| [代码审查清单](./development/code-review-checklist.md) | PR 代码审查逐项检查清单 |

### 🚀 部署运维

| 文档 | 说明 |
|------|------|
| [Docker 部署](./deployment/docker-deployment.md) | 容器化部署方案 |
| [备份与恢复](./operations/backup-restore.md) | 数据备份、验证、恢复流程 |
| [监控与告警](./operations/monitoring-alerting.md) | 系统监控、指标采集、告警配置 |
| [故障排查](./operations/troubleshooting.md) | 常见问题排查与解决方案 |

### 🔒 安全文档

| 文档 | 说明 |
|------|------|
| [安全架构](./security/security-architecture.md) | 整体安全架构设计 |
| [数据加密](./security/data-encryption.md) | 敏感数据加密存储与传输 |
| [限流策略](./security/rate-limiting.md) | API 限流与防刷机制 |

### 📊 API 文档

| 文档 | 说明 |
|------|------|
| [认证机制](./api/authentication.md) | JWT 认证、Token 轮换、权限控制 |
| [错误码说明](./api/error-codes.md) | 业务错误码定义与处理 |
| [分页与过滤](./api/pagination-filtering.md) | 列表查询分页、排序、过滤规范 |

> **在线 API 文档**：开发环境启动后访问 `http://localhost:3001/api/docs` 查看 Swagger UI

### 🗄️ 数据库文档

| 文档 | 说明 |
|------|------|
| [数据库设计](./database/database-design.md) | 表结构设计、ER 图、数据字典 |
| [索引策略](./database/index-strategy.md) | 数据库索引设计与优化 |
| [SQLite 优化](./database/sqlite-optimization.md) | SQLite 性能调优最佳实践 |

### ⚡ 性能优化

| 文档 | 说明 |
|------|------|
| [性能优化指南](./performance/optimization-guide.md) | 数据库、缓存、查询优化 |

### ✨ 功能特性

| 文档 | 说明 |
|------|------|
| [通知系统](./features/notifications.md) | 站内通知、消息推送机制 |

---

## 🔗 快速链接

- 🚀 [快速开始（开发环境搭建）](./development/setup.md)
- 📖 [API 在线文档（Swagger）](http://localhost:3001/api/docs)
- 🐛 [故障排查手册](./operations/troubleshooting.md)
- 🔐 [安全架构概览](./security/security-architecture.md)
- 📊 [数据库设计文档](./database/database-design.md)
- 🧪 [测试指南](./development/testing-guide.md)

---

## 📖 阅读指南

### 新人上手路径

1. **了解项目** → 先阅读 [项目简介](#项目简介) 和 [系统架构](../../../docs/architecture/system-architecture.md)
2. **搭建环境** → 按照 [开发环境搭建](./development/setup.md) 配置本地开发环境
3. **熟悉规范** → 阅读 [代码提交规范](./development/commit-convention.md) 和 [测试指南](./development/testing-guide.md)
4. **业务学习** → 根据负责模块阅读对应 [业务文档](#📋-业务文档)
5. **开发调试** → 参考 [故障排查](./operations/troubleshooting.md) 解决常见问题

### 按角色推荐

| 角色 | 推荐阅读 |
|------|----------|
| **后端开发** | 开发文档 + 架构文档 + 数据库文档 + 安全文档 |
| **前端开发** | API 文档 + 业务文档 |
| **运维/DevOps** | 部署运维 + 性能优化 + 数据库文档 |
| **测试工程师** | 测试指南 + 业务文档 + API 文档 |

---

## 🎯 项目简介

**牙科诊所管理系统 API** 是口腔诊所管理软件的后端服务，基于 NestJS 构建，提供完整的 RESTful API 接口。系统支持多诊所数据隔离，覆盖患者管理、临床诊疗、财务收费、库存仓储等核心业务场景。

### 核心功能模块

- **👤 患者管理** - 患者档案、就诊历史、口腔健康记录
- **📅 预约排班** - 预约挂号、椅位管理、排班调度
- **🦷 临床诊疗** - 初诊检查、病历记录、治疗计划、治疗执行
- **💰 财务收费** - 收费结算、支付方式、退款处理、会员卡
- **📦 库存管理** - 药品耗材、采购入库、加工订单、供应商
- **📋 系统管理** - 诊所设置、用户权限、操作日志、统计报表
- **🔔 通知沟通** - 站内消息、随访提醒、微信通知

---

## 🛠️ 技术栈清单

### 运行时与框架

| 类别 | 技术选型 | 版本 |
|------|----------|------|
| 运行时 | Node.js | LTS |
| 语言 | TypeScript | 5.7 |
| 框架 | NestJS | 11 |
| 数据库 | SQLite (better-sqlite3) | 13.x |

### 核心依赖

| 类别 | 技术选型 | 说明 |
|------|----------|------|
| 认证 | JWT + Passport | Token 轮换 + bcrypt 密码哈希 |
| 数据访问 | 原生 SQL + BaseService | 无 ORM，SQL 构建器 |
| 参数校验 | class-validator + class-transformer | DTO 验证与转换 |
| API 文档 | Swagger / OpenAPI | 开发环境自动生成 |
| 安全防护 | helmet + sanitize-html | XSS / CSRF / 安全头 |
| 错误监控 | Sentry | 生产环境错误追踪 |

### 测试工具

| 类别 | 工具 | 说明 |
|------|------|------|
| 测试框架 | Jest | 单元测试 + 集成测试 |
| E2E 测试 | Supertest | HTTP 接口端到端测试 |
| 属性测试 | fast-check | 随机化测试 |
| 并发测试 | 自定义并发工具 | 竞态条件验证 |
| 故障注入 | 自定义故障注入 | 容错能力验证 |

### 代码质量

| 类别 | 工具 | 说明 |
|------|------|------|
| Lint | ESLint + 多插件 | sonarjs / security / unicorn |
| 代码风格 | Prettier | 统一代码格式 |
| Git 钩子 | Husky + lint-staged | 提交前检查 |
| 提交规范 | Commitlint | Conventional Commits |

### 运维工具

| 类别 | 工具 | 说明 |
|------|------|------|
| 备份 | 自定义备份脚本 | 全量备份 + 清理策略 |
| 监控 | Sentry + 自定义指标 | 错误 + 性能监控 |
| 容器化 | Docker | 部署容器化 |

---

## 📁 文档目录结构

```
docs/
├── README.md                    # 本文件 - 文档索引
├── api/                         # API 接口文档
│   ├── authentication.md        # 认证机制
│   ├── error-codes.md           # 错误码说明
│   └── pagination-filtering.md  # 分页与过滤
├── architecture/                # 架构文档
│   └── api-versioning.md        # API 版本策略
├── business/                    # 业务流程文档
│   ├── patient-flow.md          # 患者管理流程
│   ├── appointment-flow.md      # 预约排班流程
│   ├── clinical-flow.md         # 临床诊疗流程
│   ├── charge-flow.md           # 收费结算流程
│   ├── member-card-flow.md      # 会员卡管理流程
│   └── inventory-flow.md        # 库存管理流程
├── database/                    # 数据库文档
│   ├── database-design.md       # 数据库设计
│   ├── index-strategy.md        # 索引策略
│   └── sqlite-optimization.md   # SQLite 优化
├── deployment/                  # 部署文档
│   └── docker-deployment.md     # Docker 部署
├── development/                 # 开发文档
│   ├── setup.md                 # 开发环境搭建
│   ├── testing-guide.md         # 测试指南
│   ├── logging.md               # 日志规范
│   ├── commit-convention.md     # 代码提交规范
│   └── code-review-checklist.md # 代码审查清单
├── features/                    # 功能特性文档
│   └── notifications.md         # 通知系统
├── operations/                  # 运维文档
│   ├── backup-restore.md        # 备份与恢复
│   ├── monitoring-alerting.md   # 监控与告警
│   └── troubleshooting.md       # 故障排查
├── performance/                 # 性能文档
│   └── optimization-guide.md    # 性能优化指南
└── security/                    # 安全文档
    ├── security-architecture.md # 安全架构
    ├── data-encryption.md       # 数据加密
    └── rate-limiting.md         # 限流策略
```

---

> 💡 **提示**：标记 ↗ 的链接指向仓库根级文档（`source/docs/`），需向上导航查看。
