# ADR-0009: 测试策略

## 状态
已采纳

## 日期
2026-07-24

## 背景
口腔诊所管理系统是医疗业务系统，对数据准确性、事务一致性、并发安全有极高要求：
- 收费/退费涉及金额，不能出错
- 库存并发扣减必须正确
- 患者数据不能跨诊所泄露
- 数据库迁移不能丢失数据

单一的单元测试或 E2E 测试无法覆盖这些风险点，需要建立多层级、多视角的测试体系。

## 决策
建立 **多层级测试体系**，按测试金字塔从底到顶分层覆盖：

### 测试金字塔

| 层级 | 目的 | 实现 | 运行命令 |
|------|------|------|----------|
| 单元测试 | 验证 Service 业务逻辑 | `MockDbService` 模拟数据库 | `npm test` |
| 集成测试 | 验证多模块协作 | 内存 SQLite（`:memory:`） | `npm test`（`*.integration.spec.ts`） |
| E2E 测试 | 验证完整 HTTP 流程 | Supertest + 内存 SQLite | `npm run test:e2e` |
| 烟雾测试 | 验证核心流程可用 | 启动检查 + 核心模块探测 | `npm run test:smoke` |
| 迁移测试 | 验证数据库迁移安全 | 旧 Schema → 迁移 → 校验 | `npm run test:migration` |
| 并发测试 | 验证并发安全 | 并发工具 + 事务冲突注入 | `npm test`（`*.concurrent.spec.ts`） |
| 故障注入测试 | 验证容错能力 | `FaultInjector` 注入异常 | `npm test`（`*.fault.spec.ts`） |

## 替代方案

### 仅单元测试
- 缺点：Mock 掩盖了真实 SQL 行为，无法发现数据库层问题

### 仅 E2E 测试
- 缺点：执行慢、定位问题困难、无法覆盖并发和故障场景

## 后果

### 正面
- **测试覆盖全面**：从单元逻辑到完整流程、从正常路径到故障注入，分层保障
- **并发安全验证**：并发测试专门验证库存扣减、收费支付等并发敏感场景
- **容错能力验证**：故障注入测试验证事务回滚、重试、降级等容错机制
- **迁移安全验证**：迁移测试确保 Schema 变更不丢数据
- **覆盖率可追踪**：通过 `npm run test:cov` 生成覆盖率报告

### 负面
- **测试维护成本高**：7 个层级意味着测试代码量较大，需求变更时需同步更新
- **MockDbService 复杂度高**：模拟 better-sqlite3 的完整行为（事务、SAVEPOINT、故障注入）逻辑复杂
- **运行时间长**：`verify:full` 运行全部测试套件耗时较长

## 实施
- 框架：Jest + `class-validator`（DTO 校验）+ `fast-check`（属性测试）
- 配置文件：
  - `jest.config.js`：单元/集成测试
  - `test/jest-e2e.json`：E2E 测试
  - `jest.smoke.config.js`：烟雾测试
  - `jest.migration.config.js`：迁移测试
- 测试辅助：
  - `src/common/test-helpers/mock-db-factory.ts`：`MockDbService` / `FaultyMockDbService`
  - `src/common/test-helpers/concurrent-test-utils.ts`：并发测试工具
  - `src/common/test-helpers/fault-injection.ts`：故障注入器
  - `src/db/__mocks__/`：数据库 Mock 和测试模块
  - `src/db/seed/factories/`：测试数据工厂（患者、用户、收费等）
- 覆盖率目标路线：25% → 50% → 65% → 80%（当前阈值 25%，逐步提升）
- 一键验证：`npm run verify:full`（typecheck → lint → unit → e2e → smoke → migration）
