# API 认证说明文档

## 1. 认证方式总览

系统采用 **JWT (JSON Web Token) + Refresh Token** 的双 Token 认证机制，支持 HttpOnly Cookie 和 Authorization Header 两种方式传递 Token。

### 1.1 认证方式对比

| 方式 | 安全性 | 使用场景 | 说明 |
|------|--------|---------|------|
| **HttpOnly Cookie** | 高 | Web 前端 | 防止 XSS 窃取，推荐使用 |
| **Authorization Header** | 中 | 移动端 / API 调用 | Bearer Token，兼容传统方式 |

> **推荐**：Web 前端使用 HttpOnly Cookie 方式，安全性更高。

### 1.2 认证流程总览

```mermaid
flowchart TD
    A[用户输入账号密码] --> B[POST /auth/login]
    B --> C{认证成功?}
    C -->|否| D[返回 401 错误]
    C -->|是| E[生成 Access Token + Refresh Token]
    E --> F[设置 HttpOnly Cookie]
    F --> G[返回用户信息]
    G --> H[后续请求自动携带 Cookie]
    H --> I[Access Token 过期]
    I --> J[POST /auth/refresh 刷新 Token]
    J --> K[刷新成功，返回新 Token]
    K --> H
    J -->|刷新失败| L[返回 401，跳转登录]
```

---

## 2. JWT 认证流程

### 2.1 登录流程图

```mermaid
sequenceDiagram
    participant Client as 前端
    participant Server as API 服务
    participant DB as 数据库

    Client->>Server: POST /auth/login<br/>{ username, password }
    Server->>DB: SELECT * FROM User WHERE username = ?
    alt 用户不存在或已禁用
        DB-->>Server: 返回空
        Server-->>Client: 401 用户名或密码错误
    else 用户存在
        DB-->>Server: 返回用户信息（含 passwordHash）
        Server->>Server: bcrypt.compare(password, hash)
        alt 密码错误
            Server->>DB: loginAttempts + 1
            Server-->>Client: 401 用户名或密码错误
            Note over Server,Client: 失败5次锁定账户30分钟
        else 密码正确
            Server->>Server: 生成 Access Token (30min)
            Server->>Server: 生成 Refresh Token (24h)
            Server->>Server: SHA-256 哈希 Refresh Token
            Server->>DB: UPDATE User SET refreshToken, refreshTokenExpiresAt<br/>loginAttempts=0, lockedUntil=NULL
            Server->>DB: INSERT INTO AuditLog (LOGIN)
            Server-->>Client: 设置 HttpOnly Cookie<br/>access_token, refresh_token<br/>返回 { user, needChangePassword }
        end
    end
```

### 2.2 Token 结构

#### Header（头部）

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

| 字段 | 说明 |
|------|------|
| `alg` | 签名算法：HS256（HMAC-SHA256） |
| `typ` | Token 类型：JWT |

#### Payload（载荷）

```json
{
  "sub": "user-uuid-123",
  "username": "doctor1",
  "role": "DOCTOR",
  "tv": 0,
  "cid": "clinic-uuid-456",
  "iss": "dental-api",
  "aud": "dental-web",
  "iat": 1704067200,
  "exp": 1704069000
}
```

| 字段 | 说明 | 示例 |
|------|------|------|
| `sub` | Subject：用户 ID（主键） | `"user-uuid-123"` |
| `username` | 用户名 | `"doctor1"` |
| `role` | 用户角色 | `"DOCTOR"` |
| `tv` | Token Version：令牌版本号，用于吊销 | `0` |
| `cid` | Clinic ID：诊所 ID，多租户隔离 | `"clinic-uuid-456"` |
| `iss` | Issuer：签发者 | `"dental-api"` |
| `aud` | Audience：受众 | `"dental-web"` |
| `iat` | Issued At：签发时间（Unix 时间戳） | `1704067200` |
| `exp` | Expiration：过期时间（Unix 时间戳） | `1704069000` |

#### Signature（签名）

使用 `JWT_SECRET` 密钥对 Header + Payload 进行 HMAC-SHA256 签名，确保 Token 不被篡改。

### 2.3 Access Token 与 Refresh Token

| 特性 | Access Token | Refresh Token |
|------|-------------|---------------|
| **有效期** | 30 分钟 | 24 小时 |
| **用途** | 接口访问认证 | 刷新 Access Token |
| **存储方式** | HttpOnly Cookie | HttpOnly Cookie |
| **数据库存储** | 不存储（无状态） | SHA-256 哈希后存储 |
| **泄露风险** | 低（有效期短） | 高（有效期长，需轮换） |
| **吊销方式** | Token Version 机制 | 从数据库删除 |

> **设计说明**：Access Token 采用短有效期（30 分钟），即使泄露也只能在短时间内使用。Refresh Token 采用轮换机制，每次刷新都会生成新的 Refresh Token，旧的立即失效。

---

## 3. 获取 Token

### 3.1 密码登录

#### 请求

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "doctor1",
  "password": "your-password"
}
```

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | 用户名 |
| `password` | string | 是 | 密码 |

#### 响应（成功）

```json
{
  "user": {
    "id": "user-uuid-123",
    "username": "doctor1",
    "name": "张医生",
    "role": "DOCTOR",
    "clinicId": "clinic-uuid-456"
  },
  "needChangePassword": false
}
```

> **注意**：Token 通过 HttpOnly Cookie 返回，不在响应体中。Cookie 名称：`access_token` 和 `refresh_token`。

#### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `user.id` | string | 用户 ID |
| `user.username` | string | 用户名 |
| `user.name` | string | 用户姓名 |
| `user.role` | string | 用户角色 |
| `user.clinicId` | string | 所属诊所 ID |
| `needChangePassword` | boolean | 是否需要修改密码（初始密码或临时密码时为 true） |

#### Cookie 设置

| Cookie 名称 | HttpOnly | Secure | SameSite | Max-Age | 说明 |
|-------------|----------|--------|----------|---------|------|
| `access_token` | ✓ | 生产环境启用 | strict | 1 小时 | Access Token |
| `refresh_token` | ✓ | 生产环境启用 | strict | 7 天 | Refresh Token |

### 3.2 短信验证码登录

> **当前状态**：暂未实现，预留扩展点。

未来可能支持的登录方式：
- 手机号 + 短信验证码登录
- 微信扫码登录
- 企业微信登录

### 3.3 响应格式说明

#### 成功响应

```json
{
  "success": true,
  "data": {
    "user": { ... },
    "needChangePassword": false
  }
}
```

#### 失败响应

```json
{
  "success": false,
  "statusCode": 401,
  "errorCode": 2001,
  "message": "用户名或密码错误",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "path": "/api/auth/login",
  "traceId": "abc123-def456"
}
```

---

## 4. 使用 Token

### 4.1 请求头格式（Bearer Token 方式）

如果不使用 Cookie 方式，可以通过 Authorization 头传递 Token：

```http
GET /api/patients
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> **注意**：Web 前端推荐使用 HttpOnly Cookie 方式，无需手动设置请求头。

### 4.2 Cookie 方式（推荐）

使用 Cookie 方式时，浏览器会自动携带 Cookie，前端无需额外处理：

```http
GET /api/patients
Cookie: access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...; refresh_token=...
```

### 4.3 过期时间说明

| Token 类型 | 有效期 | 过期前行为 |
|-----------|--------|-----------|
| Access Token | 30 分钟 | 过期后返回 401，前端自动调用刷新接口 |
| Refresh Token | 24 小时 | 过期后返回 401，需重新登录 |

### 4.4 Token 提取顺序

服务端验证时按以下顺序提取 Token：

1. **Cookie**：`req.cookies.access_token`（优先）
2. **Authorization Header**：`Bearer <token>`（向后兼容）

---

## 5. 刷新 Token

### 5.1 刷新机制

当 Access Token 过期时，使用 Refresh Token 获取新的 Token 对。

#### 刷新流程

```mermaid
sequenceDiagram
    participant Client as 前端
    participant Server as API 服务
    participant DB as 数据库

    Client->>Server: POST /auth/refresh<br/>Cookie: refresh_token=xxx
    Server->>Server: SHA-256 哈希 refresh_token
    Server->>DB: SELECT * FROM UsedRefreshToken WHERE tokenHash = ?
    alt Token 已被使用过（重放检测）
        DB-->>Server: 找到记录
        Server->>DB: 递增 tokenVersion（吊销所有 Token）
        Server-->>Client: 401 登录已过期，请重新登录
    else Token 未使用过
        DB-->>Server: 未找到
        Server->>DB: SELECT * FROM User WHERE refreshToken = ? AND active = 1
        alt Token 有效且未过期
            DB-->>Server: 返回用户
            Server->>Server: 生成新 Access Token (30min)
            Server->>Server: 生成新 Refresh Token (24h)
            Server->>DB: 事务内执行：<br/>1. 标记旧 Token 为已用<br/>2. 写入新 Token 哈希
            Server-->>Client: 设置新 Cookie<br/>返回 { ok: true }
        else Token 无效或已过期
            DB-->>Server: 未找到用户
            Server-->>Client: 401 登录已过期，请重新登录
        end
    end
```

### 5.2 刷新接口说明

#### 请求

```http
POST /api/auth/refresh
Content-Type: application/json
Cookie: refresh_token=xxx

{
  "refreshToken": "可选，Cookie 优先"
}
```

#### 响应（成功）

```json
{
  "ok": true
}
```

> **注意**：新的 Token 通过 Set-Cookie 响应头设置，不在响应体中。

### 5.3 刷新注意事项

1. **Refresh Token 轮换**：每次刷新都会生成新的 Refresh Token，旧的立即失效
2. **重放检测**：如果检测到 Refresh Token 被重复使用，立即吊销该用户所有 Token（安全措施）
3. **Cookie 优先**：优先从 Cookie 读取 Refresh Token，Body 中的参数作为备选
4. **刷新频率限制**：每 IP 每分钟最多 10 次刷新请求（限流保护）
5. **使用过的 Token 保留**：已使用的 Refresh Token 记录保留 25 小时，用于重放检测

---

## 6. 登出

### 6.1 服务端登出

#### 请求

```http
POST /api/auth/logout
Cookie: access_token=xxx
```

#### 服务端操作

1. 递增用户的 `tokenVersion`（使所有 Access Token 失效）
2. 清除数据库中的 `refreshToken` 和 `refreshTokenExpiresAt`
3. 记录登出审计日志
4. 清除响应中的 Cookie

#### 响应

```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

### 6.2 客户端清理

登出成功后客户端需要：

1. Cookie 会被服务端通过 `Set-Cookie` 自动清除
2. 清除本地存储的用户信息
3. 跳转到登录页面
4. 清除相关的前端缓存

---

## 7. 多端登录

### 7.1 多设备登录策略

| 策略 | 当前实现 | 说明 |
|------|---------|------|
| **并发登录** | 支持 | 同一账号可在多个设备同时登录 |
| **Token 独立** | 是 | 每个设备有独立的 Token |
| **统一吊销** | 是 | 修改密码/强制下线时吊销所有设备 Token |

> **实现原理**：通过 `tokenVersion` 机制实现。每次登出或修改密码时递增 `tokenVersion`，所有旧 Token 的 `tv` 字段与数据库不匹配，验证失败。

### 7.2 强制下线机制

#### 触发场景

| 场景 | 触发方式 | 说明 |
|------|---------|------|
| 修改密码 | 主动操作 | 修改密码后所有设备需重新登录 |
| 主动登出 | 主动操作 | 当前设备登出，同时所有 Token 失效 |
| 管理员禁用用户 | 管理员操作 | 禁用用户后所有 Token 失效 |
| Refresh Token 重放 | 安全检测 | 检测到 Token 被盗用，自动吊销 |

#### 实现机制

```mermaid
graph TD
    A[触发吊销] --> B[递增 tokenVersion]
    B --> C[数据库: User.tokenVersion += 1]
    C --> D[后续请求验证 Token]
    D --> E{JWT 中的 tv 与<br/>数据库 tokenVersion 是否一致?}
    E -->|是| F[认证通过]
    E -->|否| G[返回 401，Token 无效]
```

---

## 8. 权限验证

### 8.1 角色说明

系统采用 RBAC（基于角色的访问控制）权限模型。

#### 角色列表

| 角色代码 | 角色名称 | 权限等级 | 说明 |
|---------|---------|---------|------|
| `BOSS` | 老板 | 3 | 最高权限，可管理所有功能和用户 |
| `DOCTOR` | 医生 | 2 | 临床操作、患者管理、病历书写 |
| `RECEPTIONIST` | 前台 | 1 | 预约挂号、收费、患者建档 |

#### 角色层级

```mermaid
graph TD
    BOSS --> DOCTOR
    DOCTOR --> RECEPTIONIST
```

> **说明**：高权限角色自动拥有低权限角色的所有权限。例如 BOSS 可以执行 DOCTOR 和 RECEPTIONIST 的所有操作。

### 8.2 资源所有权验证

除了角色权限外，系统还通过 `clinicId` 实现多租户数据隔离。

#### 验证层级

```mermaid
graph TD
    A[请求到达] --> B[JWT 认证]
    B --> C{认证通过?}
    C -->|否| D[401 未授权]
    C -->|是| E[角色权限校验]
    E --> F{角色匹配?}
    F -->|否| G[403 权限不足]
    F -->|是| H[资源所有权校验]
    H --> I{clinicId 匹配?}
    I -->|否| J[403 资源所有权违规]
    I -->|是| K[执行业务逻辑]
```

#### 关键保障

- 所有业务表都包含 `clinicId` 字段
- 查询时自动带上 `clinicId` 过滤条件
- 越权访问其他诊所数据返回 403 错误（错误码 3004）

---

## 9. 常见认证错误

### 9.1 错误码说明

| 错误码 | HTTP 状态 | message | 原因 |
|--------|----------|---------|------|
| **1002** | 401 | 未授权访问 | 未提供 Token 或 Token 格式错误 |
| **2001** | 401 | 用户名或密码错误 | 登录失败，用户名不存在或密码错误 |
| **2002** | 401 | 令牌已过期 | Access Token 已过期，需要刷新 |
| **2003** | 401 | 令牌无效 | Token 签名不匹配或被篡改 |
| **2004** | 429 | 尝试次数过多 | 登录尝试次数超限，限流中 |
| **2005** | 401 | 账户已锁定 | 登录失败次数过多，账户被锁定 |
| **1003** | 403 | 权限不足 | 角色不满足接口要求 |
| **3004** | 403 | 资源所有权违规 | 访问不属于当前诊所的资源 |

### 9.2 前端处理方式

| 错误场景 | 前端处理 |
|---------|---------|
| **401 Token 过期** | 自动调用刷新接口，刷新成功后重试原请求 |
| **401 刷新失败** | 清除本地状态，跳转登录页 |
| **401 登录失败** | 提示用户名或密码错误，显示剩余尝试次数 |
| **401 账户锁定** | 提示账户已锁定，显示解锁倒计时 |
| **403 权限不足** | 提示无权限，隐藏无权限的功能按钮 |
| **429 请求频繁** | 显示重试倒计时，禁用提交按钮 |

#### 自动刷新 Token 示例（Axios）

```typescript
let isRefreshing = false;
let failedQueue: ((token: string) => void)[] = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom(error as any);
    } else {
      prom(token as any);
    }
  });
  failedQueue = [];
};

axios.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config;
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise(function(resolve, reject) {
          failedQueue.push((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(axios(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await axios.post('/api/auth/refresh');
        isRefreshing = false;
        processQueue(null);
        return axios(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError as Error, null);
        isRefreshing = false;
        // 跳转登录页
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
```

---

## 10. 安全最佳实践

### 10.1 前端安全

1. **使用 HttpOnly Cookie**：Token 存储在 HttpOnly Cookie 中，防止 XSS 窃取
2. **启用 Secure Cookie**：生产环境使用 HTTPS，启用 Secure 标志
3. **设置 SameSite=Strict**：防止 CSRF 攻击
4. **不要在 localStorage 存储 Token**：localStorage 容易被 XSS 窃取
5. **登出时清除状态**：清除所有用户相关的本地存储和缓存
6. **敏感操作重新认证**：修改密码、删除数据等操作要求重新输入密码

### 10.2 密码安全

1. **使用 bcrypt 哈希**：密码使用 bcrypt 哈希存储，默认 10 轮
2. **密码强度要求**：建议至少 8 位，包含大小写字母和数字
3. **初始密码强制修改**：首次登录或管理员重置密码后强制修改
4. **登录失败锁定**：连续 5 次失败锁定账户 30 分钟
5. **密码定期更换**：建议 90 天更换一次密码

### 10.3 Token 安全

1. **短有效期**：Access Token 有效期 30 分钟，降低泄露风险
2. **Refresh Token 轮换**：每次刷新生成新的 Refresh Token
3. **重放检测**：检测到 Refresh Token 被复用，立即吊销所有 Token
4. **Token Version 机制**：修改密码/登出时通过递增版本号使所有 Token 失效
5. **签名验证**：严格验证 JWT 签名、签发者、受众、过期时间

### 10.4 传输安全

1. **强制 HTTPS**：生产环境强制使用 HTTPS
2. **HSTS 头**：配置 HTTP Strict Transport Security
3. **安全响应头**：配置 X-Content-Type-Options、X-Frame-Options 等
4. **CORS 配置**：严格限制允许的跨域来源

### 10.5 审计与监控

1. **登录日志**：记录所有登录和登出事件
2. **敏感操作审计**：密码修改、权限变更等操作留痕
3. **异常登录检测**：异地登录、异常时间登录告警
4. **Token 异常监控**：监控 Token 验证失败率

---

## 11. 相关 API 清单

| 方法 | 路径 | 说明 | 是否需要认证 |
|------|------|------|-------------|
| `POST` | `/auth/login` | 密码登录 | 否 |
| `POST` | `/auth/refresh` | 刷新 Token | 否（需要 Refresh Token） |
| `POST` | `/auth/logout` | 登出 | 是 |
| `GET` | `/auth/me` | 获取当前用户信息 | 是 |
| `POST` | `/auth/change-password` | 修改密码 | 是 |
| `GET` | `/auth/users` | 用户列表 | 是（BOSS） |
| `POST` | `/auth/users` | 创建用户 | 是（BOSS） |
| `PATCH` | `/auth/users/:id` | 更新用户 | 是（BOSS） |
| `DELETE` | `/auth/users/:id` | 删除用户 | 是（BOSS） |

---

## 12. 相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/modules/auth/auth.service.ts` | 认证服务 |
| `src/modules/auth/auth.controller.ts` | 认证控制器 |
| `src/modules/auth/jwt.strategy.ts` | JWT 认证策略 |
| `src/modules/auth/jwt-auth.guard.ts` | JWT 认证守卫 |
| `src/common/guards/roles.guard.ts` | 角色权限守卫 |
| `src/common/guards/resource-owner.guard.ts` | 资源所有权守卫 |
| `src/common/decorators/roles.decorator.ts` | 角色装饰器 |
| `src/common/decorators/public.decorator.ts` | 公开接口装饰器 |
| `src/common/constants/roles.ts` | 角色常量定义 |
| `src/config/constants.ts` | 配置常量（Token 有效期等） |
