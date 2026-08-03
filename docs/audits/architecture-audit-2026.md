# 架构审计报告

**项目**: d:\Desktop\rongyi\source\apps\api  
**审计日期**: 2026-07-27  
**审计范围**: src/modules 下所有模块及 common、db 模块

---

## 一、模块依赖关系图

### 1.1 业务模块依赖概览

```
root (app.module)
├── bootstrap
├── common
├── config
├── db
├── modules/auth
├── modules/clinical
├── modules/communication
├── modules/content
├── modules/equipment
├── modules/financial
├── modules/inventory
├── modules/notifications
├── modules/patients
├── modules/scheduling
├── modules/sync
└── modules/system
```

### 1.2 详细依赖关系

| 模块 | 依赖的模块 | 被依赖次数 |
|------|-----------|-----------|
| **modules/system** | common, config, db | **6** (最高) |
| modules/auth | common, config, db | 2 |
| modules/scheduling | common, db, system | 2 |
| modules/clinical | common, config, db, scheduling | 1 |
| modules/financial | common, config, db, system | 1 |
| modules/inventory | common, config, db, system | 1 |
| modules/patients | common, config, db, system | 1 |
| modules/sync | common, db, auth | 0 |
| modules/communication | common, db | 1 |
| modules/content | common, db | 1 |
| modules/equipment | common, db | 1 |
| modules/notifications | common, db | 1 |

### 1.3 跨模块引用详情

- `modules/clinical` → `modules/scheduling`
- `modules/financial` → `modules/system`
- `modules/inventory` → `modules/system`
- `modules/patients` → `modules/system`
- `modules/scheduling` → `modules/system`
- `modules/sync` → `modules/auth`

**跨模块引用总数: 17 处

---

## 二、发现的架构问题（按严重程度排序）

### 🔴 严重问题

#### 问题 1: 循环依赖 - common ↔ db

**严重程度**: 🔴 严重  
**问题描述**: common 模块与 db 模块存在双向依赖

**具体文件**:
- `src/db/database.ts:15` → 导入 `../common/utils/infra/log`
- `src/db/paths.ts:5` → 导入 `../common/utils/infra/log`
- `src/db/schema/maintenance.ts:2` → 导入 `../../common/utils/infra/log`
- `src/db/test-helpers.ts:23` → 导入 `../common/services/clinic-context.service`
- `src/common/services/base.service.ts:3-4` → 导入 `../../db/db.service`, `../../db/db.interface`

**影响**:
- 增加模块耦合度，难以独立测试和部署
- 可能导致 NestJS 模块加载顺序问题
- 违反单一职责原则

**修复建议**:
1. 将 `common/utils/infra/log` 提取为独立的轻量级日志工具包，或直接移到 db 模块内部
2. 将 `clinic-context.service` 的接口提取到 common/types 中，实现留在 common/services
3. 采用依赖倒置原则：db 模块定义接口，common 模块依赖接口而非实现

---

#### 问题 2: 循环依赖 - common ↔ modules/system

**严重程度**: 🔴 严重  
**问题描述**: common 模块与 system 模块存在双向依赖

**具体文件**:
- `src/common/interceptors/metrics.interceptor.ts:5` → 导入 `../../modules/system/metrics/metrics.service`
- `src/common/utils/cache-invalidation.ts:1` → 导入 `../../modules/system/stats/stats.interfaces`
- system 模块大量文件导入 common 模块 (30+ 处)

**影响**:
- 公共模块不应依赖业务模块，违反分层架构原则
- 导致 common 模块不再是纯基础设施层

**修复建议**:
1. 将 `MetricsInterceptor` 移到 `modules/system/metrics/` 目录下
2. 将 `StatsCacheCategory` 类型移到 `common/types/` 或 `common/constants/` 中
3. 遵循"依赖方向应该是：业务模块 → 公共模块，而不是反向

---

#### 问题 3: 分层不清晰 - Service 层直接操作 DB

**严重程度**: 🔴 严重  
**问题描述**: 43 处 Service 直接导入并操作数据库，缺少 Repository 层

**具体文件（部分示例）**:
- `src/common/services/base.service.ts:3` → 直接导入 `DbService`
- `src/modules/financial/charge/charge.service.ts:2` → 直接导入 `DbService`
- `src/modules/financial/charge/charge-payment.service.ts` → 直接导入 `db.interface`
- `src/modules/financial/member-cards/member-cards.service.ts` → 直接导入 `db.interface`
- `src/modules/inventory/inventory/inventory.service.ts` → 直接导入 `db.interface`
- `src/modules/patients/patients.service.ts` → 使用 `sql-builder`
- 以及其他 36 处...

**影响**:
- 违反 Controller → Service → Repository → DB 的分层架构
- 业务逻辑与数据访问逻辑耦合
- 难以替换数据库或替换数据库
- 难以进行单元测试时需要模拟整个数据库

**当前状态**:
- 项目中只有 2 个 Repository 文件（仅在 member-cards 模块）
- 大部分 Service 直接使用 `this.dbService.prepare()` 执行 SQL

**修复建议**:
1. 为每个业务实体创建对应的 Repository 类
2. Repository 封装所有 SQL 操作
3. Service 只调用 Repository 方法，不直接接触 SQL
4. BaseService 中的数据库操作提取到 BaseRepository
5. 采用依赖注入，Repository 注入 DbService

---

### 🟡 中等问题

#### 问题 4: 上帝模块 - modules/system

**严重程度**: 🟡 中等  
**问题描述**: system 模块被 6 个其他业务模块依赖，入度最高

**依赖 system 的模块**:
- modules/financial
- modules/inventory
- modules/patients
- modules/scheduling
- (通过 common 间接依赖)

**system 模块包含的子模块**:
- clinics - 诊所管理
- settings - 系统设置
- backups - 备份管理
- operation-logs - 操作日志
- search - 搜索
- stats - 统计
- health - 健康检查
- metrics - 指标监控

**影响**:
- system 模块职责过多，成为"上帝模块"
- 修改 system 模块可能影响大量其他模块
- 系统稳定性受 system 模块质量影响大

**修复建议**:
1. 将 stats 统计模块拆分为独立模块，或各业务模块自行维护统计
2. 将 clinics 提升为顶级业务模块
3. operation-logs 可以移到 common 模块（作为横切关注点）
4. metrics 可以移到 common/monitoring

---

#### 问题 5: BaseService 上帝类

**严重程度**: 🟡 中等  
**问题描述**: BaseService 承担了过多职责

**BaseService 承担的职责**:
- CRUD 操作
- 分页查询
- 软删除管理
- 审计日志
- 业务编码生成
- JSON 字段序列化/反序列化
- 金额字段转换（元/分）
- 诊所数据隔离
- SQL 注入防护（列名校验）
- 唯一约束冲突重试
- 批量关联查询（N+1 解决）

**文件**: `src/common/services/base.service.ts` (596 行)

**影响**:
- 基类过于庞大，难以维护
- 子类继承了不需要的功能
- 单一职责原则违反

**当前进展**:
- 代码注释显示已有重构尝试（第 14 行注释提到"架构重构：从 BaseService 上帝类拆分出的 4 个职责单一服务
- 已拆分出：AuditLogService、CodeGenerator、SoftDeleteManager、BaseRepository
- 但仍采用"内部实例化"而非 Nest DI 注入

**修复建议**:
1. 继续推进拆分，将各职责完全独立
2. 使用 NestJS 依赖注入替代内部实例化
3. 采用组合模式（Composition）替代继承
4. 每个服务只负责一个职责

---

#### 问题 6: 业务模块直接依赖 system 模块的 stats 服务

**严重程度**: 🟡 中等  
**问题描述**: 多个业务模块直接导入 system/stats 服务

**具体文件**:
- `src/modules/financial/charge/charge.service.ts:13` → 导入 `StatsService`
- `src/modules/financial/refunds/refunds.service.ts:14` → 导入 `StatsService`
- `src/modules/patients/patients.service.ts:18` → 导入 `StatsService`
- `src/modules/inventory/inventory/inventory.service.ts` → (间接依赖)

**影响**:
- 业务模块与系统模块紧耦合
- 统计缓存失效逻辑散落在各业务服务中
- 违反单一职责原则

**修复建议**:
1. 使用领域事件（Domain Events）模式
2. 业务服务发布事件，统计服务监听并更新缓存
3. 或使用缓存失效事件总线

---

### 🟢 轻微问题

#### 问题 7: common 模块 100% 被使用，但职责混杂

**严重程度**: 🟢 轻微  
**问题描述**: common 模块被所有 12 个业务模块使用（覆盖率 100%）

**common 模块包含的内容**:
- constants - 常量
- decorators - 装饰器
- domain - 领域模型（Money, Result）
- dto - 数据传输对象
- errors - 异常类
- events - 事件
- filters - 异常过滤器
- guards - 守卫
- interceptors - 拦截器
- middleware - 中间件
- monitoring - 监控
- repositories - 基础仓储
- services - 服务（17 个服务文件）
- types - 类型定义
- utils - 工具函数

**问题**:
- services 目录下有 17 个服务文件，common 模块像个"大杂烩"
- 部分服务应该属于业务模块而非 common

**修复建议**:
1. 将纯工具类留在 common/utils
2. 将业务相关服务移到对应业务模块
3. 将横切关注点（logging, caching, config）留在 common

---

#### 问题 8: clinical 模块依赖 scheduling 模块

**严重程度**: 🟢 轻微  
**问题描述**: clinical 临床模块直接依赖 scheduling 预约模块

**具体文件**:
- `src/modules/clinical/clinical.module.ts:2` → 导入 `AppointmentsModule`

**影响**:
- 临床模块与预约模块耦合
- 可能是合理的业务依赖，但需确认边界是否正确

**建议**:
- 确认是否应该通过领域事件解耦
- 或确认这种依赖是否属于合理的业务流程依赖

---

## 三、分层架构现状评估

### 3.1 当前分层结构

```
┌─────────────────────────────────────┐
│         Controllers (API)          │
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│         Services (业务逻辑)         │  ←─── 问题：直接操作 DB
└─────────────────────────────────────┘
                  ↓ (绕过 Repository
┌─────────────────────────────────────┐
│         DbService (数据访问)       │
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│         SQLite Database          │
└─────────────────────────────────────┘
```

### 3.2 理想分层结构

```
┌─────────────────────────────────────┐
│         Controllers (API)          │
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│         Services (业务逻辑)         │
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│      Repositories (数据访问)      │  ←─── 缺失层
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│         DbService (数据库连接)    │
└─────────────────────────────────────┘
```

### 3.3 Controller 层检查结果

✅ **好的方面**:
- 未发现 Controller 直接操作 DB
- Controller 层相对干净

---

## 四、模块边界检查结果

### 4.1 模块边界清晰度评分

| 模块 | 内聚性 | 耦合度 | 评分 |
|------|--------|--------|------|
| auth | 高 | 低 | ⭐⭐⭐⭐ |
| patients | 高 | 中 | ⭐⭐⭐ |
| scheduling | 高 | 中 | ⭐⭐⭐ |
| clinical | 中 | 中 | ⭐⭐⭐ |
| financial | 中 | 中 | ⭐⭐⭐ |
| inventory | 中 | 中 | ⭐⭐⭐ |
| system | 低 | **高** | ⭐⭐ |
| common | 低 | 中 | ⭐⭐⭐ |
| db | 高 | 中 | ⭐⭐⭐ |

### 4.2 边界问题总结

1. **system 模块边界模糊** - 包含过多职责
2. **common 模块职责混杂** - 工具与业务服务混在一起
3. **stats 统计跨模块调用** - 应通过事件解耦

---

## 五、修复优先级建议

### 第一优先级（立即修复）🔴

1. **解决循环依赖**
   - 将 MetricsInterceptor 移到 system/metrics
   - 将 StatsCacheCategory 移到 common/types
   - 提取日志工具到 db 模块内部或独立包

2. **建立 Repository 层**
   - 为核心模块创建 Repository
   - 逐步将 SQL 从 Service 移到 Repository
   - BaseService 重构为纯业务逻辑基类

### 第二优先级（计划修复）🟡

3. **拆分 system 上帝模块**
   - stats 服务使用事件驱动
   - clinics 提升为顶级模块
   - operation-logs 移到 common

4. **BaseService 继续拆分**
   - 完全使用 DI 替代内部实例化
   - 组合模式替代继承

### 第三优先级（持续改进）🟢

5. **common 模块整理**
   - 按职责重新组织子目录
   - 业务服务移回业务模块

6. **领域事件引入**
   - 解耦模块间依赖
   - 统计缓存失效事件化

---

## 六、架构健康度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 模块划分合理性 | 6/10 | 整体划分合理，但 system 和 common 职责过重 |
| 分层清晰度 | 4/10 | 缺少 Repository 层，Service 直接操作 DB |
| 依赖关系健康度 | 5/10 | 存在 3 个循环依赖链 |
| 模块内聚性 | 6/10 | 大部分模块内聚性好，但 system 差 |
| 模块耦合度 | 5/10 | 跨模块依赖较多，system 被过度依赖 |
| **总分** | **5.2/10** | **需要重点改进分层和依赖管理** |

---

## 七、总结

### 主要优点 ✅

1. 模块按业务领域划分清晰（auth, patients, clinical, financial, inventory 等）
2. Controller 层相对干净，没有直接操作数据库
3. 有 BaseService 基类，减少重复代码
4. 有单元测试覆盖较全面
5. 有尝试架构重构意识（代码中可见重构注释）

### 主要问题 ❌

1. **循环依赖** - 3 个循环依赖链需要立即解决
2. **分层缺失** - Repository 层基本缺失，Service 直接写 SQL
3. **上帝模块** - system 模块职责过重，被过度依赖
4. **基类过大** - BaseService 承担过多职责

### 下一步行动建议

1. 先解决循环依赖问题（风险最低，收益最高）
2. 引入 Repository 模式，逐步迁移
3. 拆分 system 模块
4. 引入领域事件解耦模块间通信

---

**报告生成时间**: 2026-07-27
