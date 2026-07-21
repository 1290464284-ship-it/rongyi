# 融义牙科诊所管理系统 — 详细修复计划

**生成日期:** 2026-07-21
**基于审计:** 第十二轮全面审计报告
**目标:** 消除 P0 安全风险、补齐测试短板、改善可观测性

---

## 任务总览

| 编号 | 任务 | 优先级 | 预估复杂度 | 风险等级 |
|------|------|--------|-----------|----------|
| T1 | 核心财务模块单元测试 | P0 | 中 | 低 |
| T2 | 前端 Token 改为 httpOnly Cookie + CSRF | P0 | 高 | 高（涉及前后端协议变更） |
| T3 | Service 层引入 Repository 接口 | P1 | 高 | 中（大范围重构） |
| T4 | 日志统一 traceId | P1 | 低 | 低 |
| T5 | 动态 UPDATE 公共 Builder | P2 | 低 | 低 |
| T6 | 数据备份自动校验与恢复演练 | P2 | 中 | 中 |

---

## T1: 为核心财务模块补单元测试

### 目标
为 `charge-v2.service.ts`、`refunds.service.ts`、`member-cards.service.ts` 建立可独立运行的单元测试，不依赖 HTTP 层或真实 SQLite。

### 为什么优先
- 全量 E2E 已达 16 个套件 / 139 用例，但无单元测试
- 财务逻辑（金额计算、欠费、退款规则）最适合单元测试覆盖
- E2E 定位失败成本高，单元测试可将反馈时间从分钟级降到秒级

### 详细步骤

#### Step 1.1 — 确认测试框架配置（0.5h）
- **文件:** `apps/api/package.json`
- **动作:** 确认 `jest` 已配置 `testRegex: '.*\\.spec\\.ts$'` 或支持 `src/**/*.spec.ts`
- **验证:** 在 `apps/api/src/modules/financial/charge-v2/` 下新建 `charge-v2.service.spec.ts`，运行 `pnpm test charge-v2.service.spec` 能正确识别

#### Step 1.2 — 创建 DbService Test Double（1h）
- **新建文件:** `apps/api/src/db/__mocks__/db-service.mock.ts`
- **设计:**
  ```typescript
  export class MockDbService {
    private data = new Map<string, any[]>();
    private transactions: any[][] = [];

    prepare(sql: string) {
      return {
        get: (...params) => this.executeGet(sql, params),
        all: (...params) => this.executeAll(sql, params),
        run: (...params) => this.executeRun(sql, params),
      };
    }

    exec(sql: string) { /* DDL 模拟 */ }

    transaction(fn: (db: MockDbService) => any) {
      return fn(this);
    }

    // 辅助方法：注入测试数据
    seed(table: string, rows: any[]) { this.data.set(table, rows); }
    clear() { this.data.clear(); }
  }
  ```
- **原则:** Mock 只需模拟 `better-sqlite3` 同步 API（prepare/get/all/run/exec/transaction），不需要真实数据库

#### Step 1.3 — charge-v2.service.ts 单元测试（2h）
- **文件:** `apps/api/src/modules/financial/charge-v2/charge-v2.service.spec.ts`
- **测试场景:**
  1. `createCharge` — 正常创建收费单，验证总金额为各项目小计之和
  2. `createCharge` — 空项目列表应抛异常
  3. `payCharge` — 全额支付，验证状态变为 PAID
  4. `payCharge` — 部分支付，验证欠费记录生成
  5. `payCharge` — 超付应抛异常（或拒绝）
  6. `payCharge` — 并发/重复支付（幂等性）
  7. `createChargeCombo` — 正常创建套餐
  8. `updateChargeCombo` — 修改套餐项目
- **技巧:** 对 `dbService.prepare(...).get/all/run` 使用 `jest.spyOn` 或注入 MockDbService

#### Step 1.4 — refunds.service.ts 单元测试（1.5h）
- **文件:** `apps/api/src/modules/financial/refunds/refunds.service.spec.ts`
- **测试场景:**
  1. `createRefund` — 正常退款，验证金额扣减
  2. `createRefund` — 退款金额超过可退上限应抛异常
  3. `createRefund` — 对已全额退款的收费单再次退款应失败
  4. `createRefund` — 退款后欠费记录调整
  5. `createRefund` — 幂等性（相同 idempotency key）

#### Step 1.5 — member-cards.service.ts 单元测试（1.5h）
- **文件:** `apps/api/src/modules/financial/member-cards/member-cards.service.spec.ts`
- **测试场景:**
  1. `recharge` — 充值后余额正确
  2. `recharge` — 并发充值幂等性
  3. `consume` — 消费扣减余额
  4. `consume` — 余额不足应失败
  5. `addPoints` — 积分增加

#### Step 1.6 — 运行与持续集成（0.5h）
- **命令:** `pnpm --filter @dental/api test:unit`
- **验收标准:**
  - 新增单元测试 ≥ 20 个
  - 单元测试执行时间 < 10 秒
  - 覆盖率（行覆盖）对财务模块 ≥ 70%

### 依赖
- MockDbService 设计需稳定
- 若 Service 直接依赖 `DbService`，需确认构造函数可注入 mock

---

## T2: 前端 Token 改为 httpOnly Cookie + CSRF

### 目标
将 JWT 从 `localStorage` 迁移到 `httpOnly` Cookie，消除 XSS 窃取 token 的风险，并补充 CSRF 防护。

### 为什么优先
- **当前风险:** `auth-store.ts` 使用 zustand persist + localStorage 存储 `access_token` 和 `refresh_token`；任何 XSS 漏洞可直接窃取完整凭证
- **影响面:** 登录、鉴权、API 调用、路由守卫、Electron 安全上下文

### 风险评估
| 风险 | 描述 | 缓解 |
|------|------|------|
| 破坏性变更 | 前后端鉴权协议改变，所有接口调用方式变化 | 分阶段：先支持双模式，再废弃 localStorage |
| Electron 兼容 | Electron 的 webSecurity + file 协议可能影响 Cookie | 需验证 `httpOnly` Cookie 在 Electron 内是否正常工作 |
| 开发体验 | 开发环境跨域 Cookie 需要 `credentials: include` | 配置 devServer proxy |

### 详细步骤

#### Step 2.1 — 后端 Cookie 设置（2h）
- **文件:** `apps/api/src/modules/auth/auth.controller.ts`
- **动作:**
  1. 在 `POST /auth/login` 成功时，设置两个 Cookie：
     - `access_token` — httpOnly, Secure, SameSite=Strict, MaxAge=1h
     - `refresh_token` — httpOnly, Secure, SameSite=Strict, MaxAge=24h
  2. 在 `POST /auth/refresh` 返回新 access_token 时，同时更新 Cookie
  3. 在 `POST /auth/logout` 时清除两个 Cookie
- **示例:**
  ```typescript
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    res.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600 * 1000,
    });
    res.cookie('refresh_token', result.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 3600 * 1000,
    });
    return { user: result.user };
  }
  ```

#### Step 2.2 — 后端鉴权从 Header 改为 Cookie（1.5h）
- **文件:** `apps/api/src/modules/auth/jwt-auth.guard.ts` 或 `jwt.strategy.ts`
- **动作:**
  1. 修改 JWT Strategy，优先从 `req.cookies['access_token']` 读取，兼容 `Authorization: Bearer` 头（过渡期内双模式）
  2. 若 `access_token` 过期但 `refresh_token` 存在且有效，可在 Guard 层自动刷新（或返回 401 让前端处理）
- **库依赖:** 确认 `cookie-parser` 已作为 NestJS 中间件注册

#### Step 2.3 — 后端 CSRF 防护（1.5h）
- **文件:** `apps/api/src/main.ts` 或全局 Guard
- **动作:**
  1. 使用 `csurf` 或自研 CSRF Guard：
     - 对 `GET/HEAD/OPTIONS` 免检
     - 对 `POST/PUT/PATCH/DELETE` 校验 `X-CSRF-Token` Header 与 Cookie 中的 `csrf-token`
  2. 在 `GET /auth/csrf-token` 暴露 CSRF Token（非 httpOnly Cookie 或响应体）
  3. 登录接口（`POST /auth/login`）本身可免 CSRF（因为尚未有 session/cookie）
- **Electron 注意:** 若前端是 `file://` 协议，SameSite=Strict 可能阻止 Cookie；需测试验证

#### Step 2.4 — 前端移除 localStorage Token（1.5h）
- **文件:** `apps/web/src/lib/auth-store.ts`
- **动作:**
  1. 移除 zustand persist 中的 `token` / `refreshToken` 存储
  2. auth-store 仅保留 `user` 对象（非敏感信息）
  3. 移除 `isTokenExpired()` 逻辑（过期由后端 Cookie MaxAge 控制，或前端通过 401 判断）
  4. 移除 `setToken()` 方法，或改为仅更新内存状态

#### Step 2.5 — 前端 API 层适配（1h）
- **文件:** `apps/web/src/lib/api.ts`
- **动作:**
  1. 所有 axios 请求添加 `withCredentials: true`
  2. 移除请求拦截器中手动添加 `Authorization: Bearer ${token}` 的逻辑
  3. 移除响应拦截器中的 `refreshAccessToken` 逻辑（或改为在 401 时调用 `/auth/refresh` 接口，由后端 Cookie 自动处理）
  4. 在请求拦截器中为写操作添加 `X-CSRF-Token` Header：
     ```typescript
     const csrfToken = document.cookie.match(/csrf-token=([^;]+)/)?.[1];
     if (csrfToken && !['GET','HEAD','OPTIONS'].includes(config.method?.toUpperCase() || '')) {
       config.headers['X-CSRF-Token'] = csrfToken;
     }
     ```

#### Step 2.6 — 前端路由守卫适配（0.5h）
- **文件:** `apps/web/src/routes/ProtectedRoute.tsx`
- **动作:**
  1. 不再检查 localStorage token，改为检查 `user` 状态或尝试调用 `GET /auth/me`
  2. 若 `GET /auth/me` 返回 401，则跳转登录页

#### Step 2.7 — Electron 安全验证（1h）
- **文件:** `apps/web/electron/main.ts`
- **动作:**
  1. 确认 `webSecurity: true`
  2. 测试 Cookie 在 Electron 内是否随请求正确发送
  3. 若 `file://` 协议下 Cookie 行为异常，考虑在开发环境使用 `http://localhost:5173`（Electron loadURL）

#### Step 2.8 — 废弃 localStorage 双模式清理（0.5h）
- **文件:** `apps/web/src/lib/auth-store.ts`, `apps/web/src/lib/api.ts`
- **动作:**
  1. 确认新流程稳定后，移除 `Authorization: Bearer` 兼容逻辑
  2. 编写清理脚本提示用户清除旧 localStorage（可选）

### 验收标准
- [ ] 登录后 `localStorage` 中无 `token` / `refreshToken`
- [ ] DevTools Application → Cookies 中可见 `access_token`/`refresh_token`，标记 httpOnly
- [ ] 刷新页面后仍保持登录状态（Cookie 自动携带）
- [ ] 写操作（POST/PUT/PATCH/DELETE）缺少 `X-CSRF-Token` 时后端返回 403
- [ ] E2E 测试（auth.e2e-spec.ts）全部通过
- [ ] Electron 打包后登录/鉴权正常

---

## T3: Service 层引入 Repository 接口

### 目标
解耦业务 Service 与 `DbService` 具体实现，提升可测试性和未来数据库替换能力。

### 为什么重要但非最高优先级
- 当前项目规模下，DbService 抽象程度尚可（统一 SQL 构建）
- 直接全量重构成本高，收益对当前单诊所场景不明显
- 建议采用"先试点、后推广"策略

### 详细步骤

#### Step 3.1 — 定义 Repository 接口（0.5h）
- **新建文件:** `apps/api/src/db/repository.interface.ts`
- **内容:**
  ```typescript
  export interface IRepository<T> {
    findById(id: string): Promise<T | null>;
    findMany(options: QueryOptions): Promise<Pagination<T>>;
    create(data: Partial<T>): Promise<T>;
    update(id: string, data: Partial<T>): Promise<T>;
    delete(id: string): Promise<void>;
    softDelete(id: string): Promise<void>;
  }
  ```

#### Step 3.2 — 实现 BaseRepository（1h）
- **新建文件:** `apps/api/src/db/base.repository.ts`
- **动作:** 将 `BaseService` 中的数据库操作逻辑下沉到 `BaseRepository<T>`，Service 通过构造函数注入 `IRepository<T>`
- **注意:** `BaseService` 目前同时承担业务协调 + 数据访问，需分离

#### Step 3.3 — 试点模块：patients（1h）
- **文件:** `apps/api/src/modules/patients/patients.service.ts`
- **动作:**
  1. 创建 `PatientRepository extends BaseRepository<Patient>`
  2. 修改 `PatientsService` 构造函数为 `constructor(private repo: PatientRepository)`
  3. 验证单元测试可用 MockRepository 替换

#### Step 3.4 — 逐步推广（按需）
- 每修改一个模块，同步补充该模块的单元测试
- 新模块强制使用 Repository 模式

### 验收标准
- [ ] `patients` 模块完成 Repository 拆分
- [ ] `patients.service.spec.ts` 可用纯 Mock Repository 运行，不依赖 DbService
- [ ] 无循环依赖

---

## T4: 日志统一 traceId

### 目标
让所有日志条目（包括非请求上下文的后台任务、Service 内部日志）都携带一致的 traceId。

### 详细步骤

#### Step 4.1 — 引入 AsyncLocalStorage（0.5h）
- **新建文件:** `apps/api/src/common/utils/async-context.ts`
- **内容:**
  ```typescript
  import { AsyncLocalStorage } from 'async_hooks';
  export const als = new AsyncLocalStorage<{ traceId: string; userId?: string }>();
  ```

#### Step 4.2 — 请求拦截器注入 traceId（0.5h）
- **文件:** `apps/api/src/common/interceptors/logging.interceptor.ts`（或新建）
- **动作:**
  1. 在拦截器中生成 traceId（`req.headers['x-request-id'] || crypto.randomUUID()`）
  2. 使用 `als.run({ traceId, userId: req.user?.id }, () => next.handle())` 包裹请求处理

#### Step 4.3 — 修改 Logger 自动读取 traceId（0.5h）
- **文件:** `apps/api/src/common/services/logger.service.ts`
- **动作:**
  1. 在 `writeLog` 方法中，若传入的 entry 无 traceId，自动从 `als.getStore()` 读取
  2. 确保后台任务（定时清理、批量写入）也能显式传入 traceId 或生成独立 traceId

#### Step 4.4 — 验证（0.5h）
- 发起一个请求，检查控制台/日志文件中所有相关日志是否携带相同 traceId
- 验证并发请求 traceId 不串线

### 验收标准
- [ ] 单次请求的所有日志（请求日志、Service 日志、数据库日志）traceId 一致
- [ ] 并发 10 次请求，traceId 无串线
- [ ] 后台定时任务也有独立 traceId

---

## T5: 动态 UPDATE 公共 Builder（P2）

### 目标
消除各 Service 中重复的 "动态 UPDATE 拼接 + updatedAt" 代码。

### 详细步骤

#### Step 5.1 — 创建 UpdateBuilder（0.5h）
- **新建文件:** `apps/api/src/common/utils/sql-builder.ts`
- **内容:**
  ```typescript
  export class UpdateBuilder {
    private updates: string[] = [];
    private params: unknown[] = [];

    set(field: string, value: unknown, condition = true) {
      if (condition && value !== undefined) {
        this.updates.push(`${field} = ?`);
        this.params.push(value);
      }
      return this;
    }

    setUpdatedAt() {
      this.updates.push('updatedAt = ?');
      this.params.push(new Date().toISOString());
      return this;
    }

    build(id: string) {
      if (this.updates.length === 0) return null;
      this.params.push(id);
      return {
        sql: `UPDATE ... SET ${this.updates.join(', ')} WHERE id = ?`,
        params: this.params,
      };
    }
  }
  ```

#### Step 5.2 — 试点替换（1h）
- 选择 `registrations.service.ts` 或 `auth.service.ts` 中的 `updateUser` 进行替换
- 验证 SQL 输出一致

#### Step 5.3 — 逐步推广（按需）
- 新代码强制使用 Builder
- 旧代码在修改时顺带替换

---

## T6: 数据备份自动校验与恢复演练（P2）

### 目标
确保备份文件可恢复，避免"有备份但无法还原"的灾难场景。

### 详细步骤

#### Step 6.1 — 备份校验（1h）
- **文件:** `apps/api/src/modules/system/backups/backups.service.ts`
- **动作:**
  1. 备份完成后，校验文件大小 > 0
  2. 尝试打开 SQLite 文件并执行 `PRAGMA integrity_check`
  3. 将校验结果写入 `BackupRecord` 表（新增 `integrityCheck` 字段）

#### Step 6.2 — 恢复演练接口（1h）
- **新建文件:** `apps/api/src/modules/system/backups/backups.controller.ts` 新增端点
- **动作:**
  1. `POST /api/backups/:id/verify` — 将备份文件复制到临时路径，执行 `PRAGMA integrity_check` 后删除，不破坏当前数据库
  2. 返回校验结果

#### Step 6.3 — 定期自动校验（0.5h）
- **文件:** 新增定时任务（可用 `@nestjs/schedule`）
- **动作:** 每周日凌晨自动执行一次最新备份的校验，异常时通过日志/操作日志告警

---

## 执行顺序建议

```
Week 1
├── T4 日志 traceId（低复杂度，提升排障能力）
├── T1 单元测试（从 charge-v2 开始，逐步覆盖财务模块）
│
Week 2
├── T2 httpOnly Cookie（分阶段上线：先双模式，后废弃 localStorage）
│
Week 3
├── T3 Repository 接口（以 patients 试点，新模块强制使用）
├── T5 UPDATE Builder（随日常开发逐步替换）
│
Week 4
├── T6 备份校验与恢复演练
└── 全面回归测试（E2E + 单元测试）
```

---

## 通用原则

1. **测试先行:** 每个修改必须先有红色测试（失败），再实现代码变绿
2. **渐进式重构:** T2/T3 不要一次性全改，先试点再推广
3. **文档同步:** 每次修改后更新本计划中的验收状态
4. **回滚准备:** T2 涉及协议变更，保留分支以便紧急回滚到 localStorage 模式

---

*本计划由第十二轮审计报告生成，执行过程中可根据实际情况调整优先级。*
