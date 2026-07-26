# ADR-0007: 数据访问层 - 原生 SQL

## 状态
已采纳

## 日期
2026-07-24

## 背景
项目从 PostgreSQL + Prisma 迁移到 SQLite（见 [ADR-0006](./0006-database-choice-sqlite.md)）后，
需要重新选择数据访问方式。

Prisma 在迁移过程中暴露出的问题：
1. Prisma 对 SQLite 的支持存在限制（部分高级查询、原生 SQL 兜底不便）
2. Prisma Client 代码生成增加了构建复杂度和包体积
3. 桌面应用对启动速度敏感，ORM 的运行时反射开销不必要
4. 医疗系统对 SQL 性能和事务控制要求高，ORM 生成的 SQL 不够透明

需要一种既能保证开发效率、又能完全控制 SQL 的数据访问方案。

## 决策
使用 **原生 SQL + better-sqlite3**，不使用 ORM。

通过两层抽象保证开发效率与一致性：
1. **`DbService`**：封装 better-sqlite3 连接，提供 `prepare()`（带 prepared statement 缓存）、`transaction()`、`exec()` 等方法
2. **`BaseService<T>`**：通用 CRUD 基类，提供 `create` / `findMany` / `findOne` / `update` / `softDelete` / `remove` 模板方法，子类通过构造函数声明表名、JSON 字段、搜索字段、级联表等元信息即可复用

辅助工具：
- `UpdateBuilder`：用于动态构建 UPDATE 语句（仅包含需更新的字段）
- `buildClinicFilter` / `buildClinicFilterOptional`：构建诊所隔离 WHERE 子句
- `validateTableName` / `validateColumnName`：防 SQL 注入的标识符校验

## 替代方案

### TypeORM
- 优点：与 NestJS 集成度高、支持装饰器实体定义
- 缺点：Active Record/Data Mapper 模式带来额外抽象层；对 SQLite 同步驱动的适配不如原生直接；实体定义与表结构容易脱节
- 结论：抽象层过重

### Prisma
- 优点：类型安全、Schema 即文档、迁移工具完善
- 缺点：代码生成流程重、包体积大、对 SQLite 高级特性支持有限、运行时开销
- 结论：已在迁移中弃用

### Knex.js
- 优点：查询构建器，比完整 ORM 轻量
- 缺点：仍是异步 API，无法发挥 better-sqlite3 同步优势；引入额外依赖和抽象
- 结论：原生 SQL + 轻量工具函数即可覆盖其能力

## 后果

### 正面
- **完全控制 SQL 性能**：每条查询都显式编写，可针对性优化（如游标分页替代 OFFSET、`SELECT 1 ... LIMIT 1` 替代 `COUNT(*)` 校验）
- **无 ORM 开销**：无运行时反射、无代码生成、无额外抽象层，启动快、内存占用低
- **事务控制精确**：`DbService.transaction()` 使用 `BEGIN IMMEDIATE` 提升写隔离级别，嵌套调用自动退回 SAVEPOINT
- **类型安全**：通过 TypeScript 接口（`T extends BaseEntity`）和 DTO 手动保证类型映射，配合 `class-validator` 在入口校验

### 负面
- **SQL 语句散落在 Service 层**：复杂业务逻辑的 SQL 内联在 Service 中，缺少集中的查询定义（缓解：BaseService 覆盖了 80% 的 CRUD 场景）
- **需要手动处理类型映射**：JSON 字段序列化/反序列化、金额字段元/分转换需在 BaseService 中统一处理（已实现 `parseJsonFields` / `parseMoneyFields`）
- **代码重复**：部分跨模块的复杂查询无法复用，需在各 Service 中重复编写（缓解：`batchResolve` 工具解决 N+1 问题）

## 实施
- `DbService`：`src/db/db.service.ts`
  - prepared statement 缓存（LRU，上限 100 条，批量淘汰 10 条）
  - 慢查询日志（阈值 100ms）
  - 顶层事务用 `BEGIN IMMEDIATE`，嵌套用 SAVEPOINT
- `BaseService`：`src/common/services/base.service.ts`
  - 通用 CRUD 模板，子类只需声明元信息
  - 自动处理：clinicId 注入、软删除、JSON 序列化、金额转换、XSS 清洗、审计日志、唯一约束冲突重试
  - 支持游标分页、关键词搜索、精确过滤、排序
- `UpdateBuilder`：`src/common/utils/db/sql-builder.ts`
- 诊所隔离工具：`src/common/utils/db/clinic-filter.ts`
- 标识符校验：`src/common/utils/db/validate-name.ts`
