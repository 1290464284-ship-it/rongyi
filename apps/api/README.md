# 牙科诊所管理系统 API

口腔诊所管理系统的后端服务，基于 NestJS 构建，提供患者管理、临床诊疗、财务收费、库存管理等完整业务能力的 RESTful API。

## 技术栈

- **运行时**：Node.js + TypeScript 5.7
- **框架**：NestJS 11（模块化 / 依赖注入 / 装饰器路由）
- **数据库**：SQLite（better-sqlite3 同步驱动，WAL 模式）
- **认证**：JWT + Refresh Token 轮换，bcrypt 密码哈希
- **数据访问**：原生 SQL（BaseService 通用 CRUD + DbService 连接管理）
- **校验**：class-validator + class-transformer
- **文档**：Swagger / OpenAPI（开发环境自动生成）
- **测试**：Jest + Supertest + fast-check（多层级测试体系）

## 快速开始

### 1. 安装依赖

在仓库根目录执行（monorepo 工作区）：

```bash
npm install
```

### 2. 配置环境变量

复制示例文件并按需修改：

```bash
cp .env.example .env
```

必填项：
- `JWT_SECRET`：JWT 签名密钥（至少 32 位），生成命令：
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `ENCRYPTION_KEY`：数据加密密钥（64 位十六进制），生成命令：
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

> 未配置 `.env` 时，应用首次启动会自动在 `data` 目录生成一份含随机密钥的 `.env`。

### 3. 运行开发服务

```bash
npm run dev
```

服务默认监听 `http://localhost:3001`，API 路径前缀为 `/api/v1`。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务（watch 模式） |
| `npm run build` | 构建生产产物（nest build + ncc 打包） |
| `npm start` | 运行构建产物 |
| `npm test` | 运行单元测试 + 集成测试 |
| `npm run test:cov` | 运行测试并生成覆盖率报告 |
| `npm run test:e2e` | 运行 E2E 测试 |
| `npm run test:smoke` | 运行烟雾测试 |
| `npm run test:migration` | 运行数据库迁移测试 |
| `npm run lint` | ESLint 检查（0 警告阈值） |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run verify` | typecheck + lint + test |
| `npm run verify:full` | typecheck + lint + test + e2e + smoke + migration |
| `npm run seed` | 写入种子数据 |
| `npm run seed:fresh` | 重置并写入种子数据 |
| `npm run reset-password` | 命令行重置用户密码 |
| `npm run health` | 代码健康检查 |
| `npm run tech-debt` | 技术债务追踪 |

## 目录结构概览

```
src/
├── main.ts                # 应用入口
├── app.module.ts          # 根模块
├── config/                # 配置常量
├── common/                # 公共层（装饰器/守卫/拦截器/中间件/服务/工具）
├── db/                    # 数据库层（连接/Schema/迁移/种子）
└── modules/               # 业务模块
    ├── auth/              # 认证
    ├── patients/          # 患者
    ├── clinical/          # 临床诊疗
    ├── scheduling/        # 预约排班
    ├── financial/         # 财务收费
    ├── inventory/         # 库存仓储
    ├── content/           # 临床内容（影像/处方/牙位）
    ├── communication/     # 沟通随访
    ├── system/            # 系统管理
    └── equipment/         # 设备管理
test/                      # E2E / 烟雾 / 迁移测试
```

详细架构说明见 [系统架构总览](../../docs/architecture/system-architecture.md)。

## 环境变量配置

完整环境变量说明见 [.env.example](./.env.example)，主要配置项：

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | 是 | - | JWT 签名密钥（≥32 位） |
| `ENCRYPTION_KEY` | 生产必填 | - | 数据加密密钥（64 位 hex） |
| `BCRYPT_ROUNDS` | 否 | 10 | bcrypt 哈希轮数（生产建议 12） |
| `NODE_ENV` | 否 | development | 运行环境 |
| `PORT` | 否 | 3001 | API 监听端口 |
| `CORS_ORIGIN` | 生产必填 | 开发默认值 | 允许的前端域名（逗号分隔） |
| `DATA_DIR` | 否 | apps/api/data | 数据存储根目录 |
| `DB_PATH` | 否 | {DATA_DIR}/dental.sqlite | 数据库文件路径 |
| `SENTRY_DSN` | 否 | - | Sentry 错误监控 DSN |
| `BACKUP_REMOTE_DIR` | 否 | - | 异地备份目录 |

SQLite 性能调优变量：`SQLITE_BUSY_TIMEOUT_MS` / `SQLITE_JOURNAL_MODE` / `SQLITE_SYNCHRONOUS` / `SQLITE_CACHE_SIZE` 等，详见 `.env.example`。

## 测试说明

项目建立了多层级测试体系，详见 [ADR-0009: 测试策略](../../docs/adr/0009-testing-strategy.md)。

| 测试类型 | 命令 | 说明 |
|----------|------|------|
| 单元测试 | `npm test` | 基于 MockDbService 验证 Service 逻辑 |
| 集成测试 | `npm test`（`*.integration.spec.ts`） | 基于内存 SQLite 验证多模块协作 |
| 并发测试 | `npm test`（`*.concurrent.spec.ts`） | 验证并发安全（库存/收费等） |
| 故障注入测试 | `npm test`（`*.fault.spec.ts`） | 验证容错能力 |
| E2E 测试 | `npm run test:e2e` | Supertest 验证完整 HTTP 流程 |
| 烟雾测试 | `npm run test:smoke` | 启动检查与核心模块探测 |
| 迁移测试 | `npm run test:migration` | 验证数据库迁移安全性 |
| 覆盖率 | `npm run test:cov` | 生成覆盖率报告 |
| 全量验证 | `npm run verify:full` | 一键运行所有检查 |

## API 文档

开发环境下启动服务后，访问 Swagger UI：

```
http://localhost:3001/api/docs
```

> 生产环境（`NODE_ENV=production`）不启用 Swagger。

## 相关文档

- [系统架构总览](../../docs/architecture/system-architecture.md)
- [ADR 索引](../../docs/adr/README.md)
- [代码审查清单](../../docs/code-review-checklist.md)
