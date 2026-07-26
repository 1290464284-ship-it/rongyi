# 测试指南

## 1. 测试策略总览

### 1.1 测试金字塔

本项目采用经典的测试金字塔模型，从下到上依次为：

```
        / E2E 测试 \       少而精，覆盖核心业务流程
       /─────────────\
      / 集成测试       \    模块间协作、API 测试
     /─────────────────\
    /   单元测试         \   函数、类、Service 级别的测试
   /─────────────────────\
  /     静态检查           \  类型检查、Lint、代码规范
 /─────────────────────────\
```

| 层级 | 比例 | 测试对象 | 执行速度 | 编写成本 |
|------|------|----------|----------|----------|
| 静态检查 | 基础 | 所有代码 | 快 | 低 |
| 单元测试 | ~70% | Service、工具函数、领域模型 | 很快 | 中 |
| 集成测试 | ~20% | Controller、模块集成、数据库 | 中 | 中 |
| E2E 测试 | ~10% | 核心业务流程、API 全链路 | 慢 | 高 |

### 1.2 测试覆盖率目标

| 指标 | 最低要求 | 推荐目标 | 说明 |
|------|----------|----------|------|
| 语句覆盖率 | 50% | 70% | 执行到的代码行比例 |
| 分支覆盖率 | 45% | 60% | 条件分支覆盖比例 |
| 函数覆盖率 | 50% | 70% | 被调用的函数比例 |
| 行覆盖率 | 50% | 70% | 代码行覆盖比例 |

**当前配置：** 见 `jest.config.js` 中的 `coverageThreshold`

```javascript
// jest.config.js
coverageThreshold: {
  global: {
    statements: 50,
    branches: 45,
    functions: 50,
    lines: 50,
  },
},
```

### 1.3 测试命名规范

#### 文件命名

| 测试类型 | 命名模式 | 示例 |
|----------|----------|------|
| 单元测试 | `*.spec.ts` | `auth.service.spec.ts` |
| 集成测试 | `*.integration.spec.ts` | `registrations.integration.spec.ts` |
| E2E 测试 | `*.e2e-spec.ts` | `auth.e2e-spec.ts` |
| 冒烟测试 | `*.smoke.spec.ts` | `app.smoke.spec.ts` |
| 并发测试 | `*.concurrent.spec.ts` | `inventory.concurrent.spec.ts` |
| 故障注入测试 | `*.fault.spec.ts` | `charge-payment.fault.spec.ts` |

#### 用例命名

使用 "should...when..." 或 "given...when...then..." 模式：

```typescript
// ✅ 好的命名
it('should return patient data when valid id is provided', () => {
  // ...
});

it('should throw BusinessException when patient not found', () => {
  // ...
});

// ❌ 避免模糊命名
it('test patient', () => {
  // ...
});
```

#### 测试分组

使用 `describe` 按功能或场景分组：

```typescript
describe('AuthService', () => {
  describe('login', () => {
    it('should return tokens when credentials are valid', () => {});
    it('should throw error when password is wrong', () => {});
  });

  describe('changePassword', () => {
    it('should succeed when old password is correct', () => {});
  });
});
```

---

## 2. 单元测试指南

### 2.1 目录结构

单元测试文件与被测文件放在同一目录下：

```
src/
  common/
    services/
      cache.service.ts
      cache.service.spec.ts       ← 单元测试
      logger.service.ts
      logger.service.spec.ts      ← 单元测试
    utils/
      security/
        encryption.ts
        encryption.spec.ts        ← 单元测试
  modules/
    auth/
      auth.service.ts
      auth.service.spec.ts        ← 单元测试
      auth.controller.ts
      auth.controller.spec.ts     ← 单元测试
```

### 2.2 命名规范

**描述风格：** 行为驱动（BDD）风格，描述预期行为而非实现细节

```typescript
// ✅ 描述行为
it('should increment the counter by 1', () => {});

// ❌ 描述实现
it('calls counter.increment', () => {});
```

**Arrange-Act-Assert 模式：**

```typescript
it('should create a patient', () => {
  // Arrange
  const dto = { name: '张三', phone: '13800138000', gender: 'MALE' };

  // Act
  const result = service.create(dto);

  // Assert
  expect(result.name).toBe('张三');
  expect(result.phone).toBe('13800138000');
});
```

### 2.3 Mock 规范

#### 什么时候需要 Mock

| 场景 | 是否 Mock | 原因 |
|------|-----------|------|
| 外部依赖（数据库、第三方 API） | 是 | 单元测试应独立于外部系统 |
| 复杂的计算逻辑 | 否 | 应该测试真实逻辑 |
| 随机数、时间等非确定性行为 | 是 | 确保测试可重复 |
| 其他 Service | 视情况 | 紧密协作的可不用 Mock |

#### Mock 数据库

使用内置的 `MockDbService` 或内存数据库：

```typescript
// 方式1：使用 MockDbService（纯内存模拟）
import { MockDbService } from '@db/__mocks__/db-service.mock';

describe('PatientService', () => {
  let service: PatientService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new PatientService(db as unknown as DbService);
  });
});
```

```typescript
// 方式2：使用内存数据库（更接近真实场景）
import { Test } from '@nestjs/testing';
import { createTestDb, seedTestData } from '@db/test-helpers';

describe('PatientService', () => {
  let service: PatientService;
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db);

    const module = await Test.createTestingModule({
      providers: [
        PatientService,
        { provide: DbService, useValue: createTestDbService(db) },
      ],
    }).compile();

    service = module.get(PatientService);
  });

  afterEach(() => {
    db.close();
  });
});
```

#### Mock 外部服务

```typescript
// 使用 jest.mock
jest.mock('@common/services/cache.service', () => ({
  CacheService: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
  })),
}));

// 或使用自定义 provider
const module = await Test.createTestingModule({
  providers: [
    AuthService,
    {
      provide: CacheService,
      useValue: {
        get: jest.fn(),
        set: jest.fn(),
      },
    },
  ],
}).compile();
```

### 2.4 测试数据准备

#### 使用工厂函数

项目已内置数据工厂（`src/db/seed/factories/`）：

```typescript
import { createPatientFactory } from '@db/seed/factories/patientFactory';
import { createUserFactory } from '@db/seed/factories/userFactory';

// 生成默认测试数据
const patient = createPatientFactory();

// 覆盖特定字段
const patient = createPatientFactory({
  name: '张三',
  phone: '13800138000',
});

// 批量生成
const patients = Array.from({ length: 10 }, () => createPatientFactory());
```

#### 可用工厂函数

| 工厂函数 | 用途 | 所在文件 |
|----------|------|----------|
| `createClinicFactory` | 生成诊所数据 | `test/factories/index.ts` |
| `createUserFactory` | 生成用户数据 | `src/db/seed/factories/userFactory.ts` |
| `createPatientFactory` | 生成患者数据 | `src/db/seed/factories/patientFactory.ts` |
| `createAppointmentFactory` | 生成预约数据 | `src/db/seed/factories/appointmentFactory.ts` |
| `createChargeFactory` | 生成收费数据 | `src/db/seed/factories/chargeFactory.ts` |
| `createMemberCardFactory` | 生成会员卡数据 | `src/db/seed/factories/memberCardFactory.ts` |
| `createInventoryItemFactory` | 生成库存数据 | `src/db/seed/factories/inventoryItemFactory.ts` |

#### 使用 seedTestData 快速准备基础数据

```typescript
import { seedTestData, runInClinicContext } from '@db/test-helpers';

// 准备基础数据（诊所、用户、患者）
seedTestData(db);

// 包含会员卡
seedTestData(db, { withMemberCard: true });

// 在诊所上下文中执行测试
runInClinicContext(clinicContextService, {
  clinicId: 'test-clinic-id',
  userId: 'test-user-id',
  role: 'DOCTOR',
}, () => {
  // 这里执行的代码会有正确的诊所上下文
  const result = service.findAll();
  expect(result).toBeDefined();
});
```

### 2.5 常用断言风格

#### 基础断言

```typescript
// 相等
expect(result).toBe(value);           // 基本类型，引用相等
expect(result).toEqual(value);        // 对象/数组，深度相等
expect(result).toStrictEqual(value);  // 更严格的深度相等

// 布尔
expect(result).toBeTruthy();
expect(result).toBeFalsy();
expect(result).toBeNull();
expect(result).toBeUndefined();
expect(result).toBeDefined();

// 数字
expect(value).toBeGreaterThan(10);
expect(value).toBeGreaterThanOrEqual(10);
expect(value).toBeLessThan(100);
expect(value).toBeCloseTo(3.14, 2);  // 浮点数近似

// 字符串
expect(str).toContain('hello');
expect(str).toMatch(/regex/);
expect(str).toHaveLength(5);

// 数组
expect(arr).toContain(item);
expect(arr).toHaveLength(3);
expect(arr).toEqual(expect.arrayContaining([item1, item2]));

// 对象
expect(obj).toHaveProperty('name');
expect(obj).toHaveProperty('name', '张三');
expect(obj).toMatchObject({ name: '张三' });
```

#### 异常断言

```typescript
// 期望抛出异常
expect(() => service.findById('invalid')).toThrow();
expect(() => service.findById('invalid')).toThrow(BusinessException);
expect(() => service.findById('invalid')).toThrow('患者不存在');
expect(() => service.findById('invalid')).toThrow(/not found/i);

// 异步异常
await expect(service.create(dto)).rejects.toThrow();
await expect(service.create(dto)).rejects.toThrow(BusinessException);
```

#### Mock 断言

```typescript
const mockFn = jest.fn();

// 调用次数
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).not.toHaveBeenCalled();

// 调用参数
expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
expect(mockFn).toHaveBeenLastCalledWith(arg1, arg2);
expect(mockFn).toHaveBeenNthCalledWith(1, arg1, arg2);
```

---

## 3. 集成测试指南

### 3.1 测试范围

集成测试验证多个组件协同工作的正确性，包括：

- Controller 层 + Service 层 + 数据库
- 多个 Service 之间的协作
- 模块间的集成
- 完整的业务流程

**不包括：**
- 外部第三方服务（使用 Mock）
- 完整的端到端 UI 交互（属于 E2E）

### 3.2 数据库测试

#### 使用内存数据库

```typescript
import { Test } from '@nestjs/testing';
import { createTestDb, seedTestData, cleanupTestDb } from '@db/test-helpers';

describe('PatientService Integration', () => {
  let db: Database.Database;
  let service: PatientService;

  beforeEach(async () => {
    // 创建内存数据库
    db = createTestDb();
    seedTestData(db);

    const module = await Test.createTestingModule({
      providers: [
        PatientService,
        ClinicContextService,
        { provide: DbService, useValue: createTestDbService(db) },
      ],
    }).compile();

    service = module.get(PatientService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  it('should create and retrieve a patient', () => {
    // Arrange
    const dto = { name: '测试患者', phone: '13900139000', gender: 'MALE' };

    // Act
    const created = service.create(dto);
    const found = service.findById(created.id);

    // Assert
    expect(found).toBeDefined();
    expect(found.name).toBe('测试患者');
  });
});
```

#### 测试事务正确性

```typescript
it('should rollback on error during transaction', () => {
  // 故意让第二步失败，验证第一步是否回滚
  const initialCount = db.prepare('SELECT COUNT(*) as cnt FROM Charge').get().cnt;

  expect(() => {
    service.createChargeWithError(dto);
  }).toThrow();

  const finalCount = db.prepare('SELECT COUNT(*) as cnt FROM Charge').get().cnt;
  expect(finalCount).toBe(initialCount);
});
```

### 3.3 API 测试

#### 使用 Supertest 测试 Controller

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PatientsModule } from '@modules/patients/patients.module';
import { createTestDb, seedTestData } from '@db/test-helpers';

describe('PatientsController (Integration)', () => {
  let app: INestApplication;
  let db: Database.Database;
  let accessToken: string;

  beforeAll(async () => {
    db = createTestDb();
    seedTestData(db);

    const moduleRef = await Test.createTestingModule({
      imports: [PatientsModule],
    })
      .overrideProvider(DbService)
      .useValue(createTestDbService(db))
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // 获取登录 Token
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: '123456' });
    accessToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it('GET /patients should return list', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/patients')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.items).toBeDefined();
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('POST /patients should create patient', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: '新患者',
        phone: '13700137000',
        gender: 'FEMALE',
      })
      .expect(201);

    expect(response.body.name).toBe('新患者');
  });
});
```

---

## 4. E2E 测试指南

### 4.1 测试范围

E2E 测试验证整个系统从 API 入口到数据库的完整链路：

- 完整的 API 请求/响应周期
- 认证授权流程
- 核心业务流程（如：挂号→就诊→收费）
- 跨模块的业务场景

**E2E 测试目录：** `test/`

```
test/
  auth.e2e-spec.ts           ← 认证模块 E2E
  patients.e2e-spec.ts       ← 患者模块 E2E
  appointments.e2e-spec.ts   ← 预约模块 E2E
  charges.e2e-spec.ts        ← 收费模块 E2E
  core-business-flow.e2e-spec.ts  ← 核心业务流程
  test-helpers.ts            ← E2E 测试辅助
  setup.ts                   ← 全局设置
```

### 4.2 Playwright 使用

**注意：** 当前项目 E2E 测试使用 Jest + Supertest 进行 API 级别的端到端测试。若需要前端 E2E，可引入 Playwright。

#### （可选）Playwright 配置参考

如需进行前端 E2E 测试，可按以下方式配置：

```bash
# 安装 Playwright
npm install -D @playwright/test

# 初始化
npx playwright install
```

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

### 4.3 测试数据管理

#### E2E 测试辅助函数

```typescript
// test/test-helpers.ts 中提供了辅助函数

// 创建测试应用
export async function createTestApp() {
  // ...返回完整的 NestJS 应用实例
}

// 获取认证 Token
export async function getAuthToken(app: INestApplication, role = 'BOSS') {
  // ...登录并返回 accessToken
}

// 重置数据库状态
export async function resetTestDb(db: Database.Database) {
  // ...清理并重新种子数据
}
```

#### 测试数据隔离原则

1. **每个测试文件使用独立的数据库实例**（内存数据库）
2. **测试前准备数据，测试后清理**
3. **避免测试间的数据依赖**
4. **使用唯一标识避免冲突**（如使用时间戳或随机字符串）

---

## 5. 测试工具

### 5.1 Jest 配置

#### 配置文件

| 文件 | 用途 |
|------|------|
| `jest.config.js` | 单元测试配置 |
| `jest.preset.js` | 基础预设配置 |
| `jest.setup.js` | 测试运行前设置 |
| `jest.smoke.config.js` | 冒烟测试配置 |
| `jest.migration.config.js` | 迁移测试配置 |
| `test/jest-e2e.json` | E2E 测试配置 |

#### 主要配置项

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.spec.ts',
    '!<rootDir>/src/main.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html', 'text-summary'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@db/(.*)$': '<rootDir>/src/db/$1',
    '^@dental/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
};
```

#### 路径别名

测试中可使用以下路径别名：

| 别名 | 映射到 |
|------|--------|
| `@/` | `src/` |
| `@common/` | `src/common/` |
| `@modules/` | `src/modules/` |
| `@db/` | `src/db/` |
| `@dental/shared` | `packages/shared/src/` |

### 5.2 Playwright 配置

（当前项目未启用，如需前端 E2E 测试可配置）

### 5.3 覆盖率报告

#### 生成覆盖率报告

```bash
# 运行测试并生成覆盖率报告
npm run test:cov

# 或
npx jest --coverage
```

#### 报告格式

- `text` - 终端文本输出
- `lcov` - LCOV 格式（SonarQube 等工具使用）
- `html` - HTML 可视化报告（`coverage/lcov-report/index.html`）
- `text-summary` - 简要摘要

#### 查看 HTML 报告

```bash
# Linux/macOS
open coverage/lcov-report/index.html

# Windows
start coverage/lcov-report/index.html
```

#### 覆盖率分析脚本

```bash
# 运行覆盖率分析脚本
node scripts/coverage-analyze.js
```

---

## 6. 测试最佳实践

### 6.1 FIRST 原则

| 原则 | 含义 | 说明 |
|------|------|------|
| **F**ast（快速） | 测试应该快速执行 | 单元测试 < 10ms，整体测试 < 1 分钟 |
| **I**ndependent（独立） | 测试之间互不依赖 | 每个测试独立运行，不共享状态 |
| **R**epeatable（可重复） | 每次运行结果一致 | 避免依赖外部环境、随机数据 |
| **S**elf-validating（自验证） | 测试能自动判断通过/失败 | 不需要人工检查输出 |
| **T**imely（及时） | 及时编写测试 | 功能开发同时或之前写测试 |

### 6.2 测试独立

```typescript
// ✅ 每个测试独立准备数据
describe('PatientService', () => {
  let service: PatientService;

  beforeEach(() => {
    // 每个测试前重置状态
    const db = createTestDb();
    service = new PatientService(db);
  });

  it('test 1', () => { /* ... */ });
  it('test 2', () => { /* ... */ });
});

// ❌ 测试间共享状态
let sharedData = [];
it('test 1', () => { sharedData.push(item); });
it('test 2', () => { expect(sharedData.length).toBe(1); });
```

### 6.3 避免过度测试

**测试什么：**
- 核心业务逻辑
- 复杂的条件分支
- 容易出错的边界情况
- 曾经出过 bug 的地方

**不用测试什么：**
- 简单的 getter/setter
- 框架或库的功能
- 过于简单的代码
- 内部实现细节（测试行为，不是实现）

**判断标准：** 如果这个测试删了，你会担心出 bug 吗？不会就别写。

### 6.4 测试维护

#### 测试代码也是代码

- 遵循相同的代码规范
- 保持可读性和可维护性
- 定期重构测试代码
- 删除无用或过时的测试

#### 常见坏味道

| 坏味道 | 问题 | 改进 |
|--------|------|------|
| 过长的测试函数 | 难以理解 | 拆分为多个小测试 |
| 过多的 Mock | 测试失去意义 | 减少 Mock，用真实依赖 |
| 脆弱的测试 | 稍微改动就失败 | 测试行为而非实现 |
| 睡眠等待 | 慢且不可靠 | 使用事件或回调 |
| 测试间依赖 | 执行顺序影响结果 | 确保测试独立 |

---

## 7. CI/CD 中的测试

### 7.1 测试流水线

```
代码提交
   ↓
Lint 检查 (eslint)
   ↓
类型检查 (tsc --noEmit)
   ↓
单元测试 (jest)
   ↓
冒烟测试 (jest --config jest.smoke.config.js)
   ↓
迁移测试 (jest --config jest.migration.config.js)
   ↓
E2E 测试 (test/jest-e2e.json)
   ↓
覆盖率检查
   ↓
构建 (nest build)
```

#### 相关 npm 脚本

```bash
# 完整验证（类型检查 + Lint + 单元测试）
npm run verify

# 全量验证（包含 E2E、冒烟、迁移测试）
npm run verify:full

# 仅单元测试
npm test

# 单元测试 + 覆盖率
npm run test:cov

# 冒烟测试
npm run test:smoke

# 迁移测试
npm run test:migration

# E2E 测试
npm run test:e2e

# 类型检查
npm run typecheck

# Lint 检查
npm run lint
```

### 7.2 失败处理

#### 测试失败时的排查步骤

1. **查看错误信息** - 确定失败的测试和原因
2. **本地复现** - 在本地运行相同的测试，确认问题
3. **检查近期变更** - 看是否有相关代码改动导致失败
4. **是否是 flaky 测试** - 多跑几次看是否稳定失败
5. **修复问题** - 修复代码或测试

#### CI 日志查看

- 关注第一个失败的测试
- 查看完整的错误堆栈
- 检查测试前后的输出
- 注意是否有超时问题

### 7.3 覆盖率门禁

**当前门禁（50% 语句/行覆盖率，45% 分支覆盖率）：**

```javascript
// jest.config.js
coverageThreshold: {
  global: {
    statements: 50,
    branches: 45,
    functions: 50,
    lines: 50,
  },
},
```

**低于阈值时，CI 会失败。** 提升覆盖率的方法：

1. 为核心业务逻辑补充测试
2. 为边界条件和异常路径添加测试
3. 分析未覆盖的代码，评估是否需要测试

---

## 8. 常见问题

### 8.1 Flaky 测试

**什么是 Flaky 测试：** 同一份代码，有时通过有时失败的测试。

**常见原因和解决方案：**

| 原因 | 解决方案 |
|------|----------|
| 依赖时间 | Mock `Date.now()` 或使用固定时间 |
| 依赖随机数 | Mock `Math.random()` 或使用种子随机 |
| 异步时序问题 | 使用正确的等待方式，避免 `setTimeout` |
| 测试间状态污染 | 确保 `beforeEach` 正确重置状态 |
| 并发问题 | 使用 `runConcurrentTest` 工具函数，适当加锁 |

#### Mock 时间示例

```typescript
jest.useFakeTimers();
jest.setSystemTime(new Date('2024-01-15T10:00:00Z'));

// 测试代码...

jest.useRealTimers();
```

#### 检测 Flaky 测试

```bash
# 多次运行同一个测试
for i in {1..10}; do
  npx jest test-file.spec.ts --testNamePattern="test name"
  if [ $? -ne 0 ]; then
    echo "Failed on run $i"
    break
  fi
done
```

### 8.2 测试速度优化

#### 慢速测试的常见原因

| 原因 | 优化方法 |
|------|----------|
| 过多的数据库操作 | 减少写入，使用内存数据 |
| 重复的初始化 | 共享 setup，使用 `beforeAll` |
| 大量测试用例 | 拆分测试文件，并行执行 |
| 同步阻塞操作 | 检查是否有不必要的同步 I/O |

#### 优化技巧

1. **使用内存数据库** - 已经默认配置
2. **合理使用 `beforeAll` 和 `beforeEach`**
   - 不变的共享数据用 `beforeAll`
   - 需要重置的状态用 `beforeEach`
3. **并行执行** - Jest 默认并行运行测试文件
4. **聚焦测试** - 使用 `.only` 或 `--testNamePattern` 只跑相关测试
5. **跳过低价值测试** - 删除无意义的测试

#### 只运行特定测试

```bash
# 只运行一个测试文件
npx jest auth.service.spec.ts

# 只运行匹配名称的测试
npx jest --testNamePattern="should return tokens when login"

# 只运行某个目录下的测试
npx jest src/modules/auth/

# 监听模式（文件变更自动重跑）
npx jest --watch

# 仅运行失败的测试
npx jest --onlyFailures
```

### 8.3 调试技巧

#### 使用 console.log

最简单直接的方式，打印关键变量：

```typescript
it('should work', () => {
  const result = service.doSomething();
  console.log('result:', result);  // 临时调试
  expect(result).toBe(expected);
});
```

#### 使用 VS Code 调试

在 VS Code 中创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Jest Current File",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": [
        "${fileBasenameNoExtension}",
        "--config",
        "jest.config.js",
        "--runInBand"
      ],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "disableOptimisticBPs": true,
      "windows": {
        "program": "${workspaceFolder}/node_modules/jest/bin/jest"
      }
    }
  ]
}
```

#### 使用 Node.js inspector

```bash
# 以调试模式运行测试
node --inspect-brk node_modules/.bin/jest --runInBand test-file.spec.ts

# 在 Chrome 中打开 chrome://inspect 进行调试
```

#### 并发测试调试

使用 `concurrent-test-utils.ts` 中的工具：

```typescript
import { runConcurrentTest, measureExecutionTime } from '@common/test-helpers/concurrent-test-utils';

// 测试并发场景
const result = await runConcurrentTest(
  10,  // 并发任务数
  (i) => service.createItem(dto),
  5    // 并发数
);

console.log(`成功: ${result.successCount}, 失败: ${result.failureCount}`);
console.log(`总耗时: ${result.totalDurationMs}ms`);
```

#### 故障注入测试

使用故障注入工具测试异常场景：

```typescript
import { FaultInjector } from '@common/test-helpers/fault-injection';
import { createDbFaultWithSqlPattern } from '@common/test-helpers/mock-db-factory';

const faultInjector = new FaultInjector();
const { db, cleanup } = createDbFaultWithSqlPattern(
  faultInjector,
  /INSERT INTO Charge/i,
  'charge-insert-fail',
  { type: 'error', error: new Error('模拟数据库写入失败') }
);

const service = new ChargeService(db as unknown as DbService);

await expect(service.create(chargeDto)).rejects.toThrow();

cleanup();
```

---

## 附录：测试命令速查表

| 命令 | 说明 |
|------|------|
| `npm test` | 运行所有单元测试 |
| `npm run test:cov` | 运行单元测试并生成覆盖率报告 |
| `npm run test:smoke` | 运行冒烟测试 |
| `npm run test:migration` | 运行迁移测试 |
| `npm run test:e2e` | 运行 E2E 测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm run verify` | 类型检查 + Lint + 单元测试 |
| `npm run verify:full` | 所有验证（含 E2E、冒烟、迁移） |
| `npx jest --watch` | 监听模式，文件变更自动重跑 |
| `npx jest --testNamePattern="xxx"` | 只运行匹配名称的测试 |
| `npx jest --onlyFailures` | 只运行上次失败的测试 |
