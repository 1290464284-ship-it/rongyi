# ADR-0008: 认证方案 - JWT

## 状态
已采纳

## 日期
2026-07-24

## 背景
口腔诊所管理系统需要一套认证方案，需满足：
1. **无状态**：桌面应用场景下服务端不维护 Session 存储，简化部署
2. **多端适配**：除 Web 前端外，未来可能支持移动端访问
3. **安全性**：医疗数据敏感，需防止 Token 被盗用后长期有效
4. **可控吊销**：用户登出、改密、禁用账号时，已签发的 Token 应能失效

## 决策
使用 **JWT (Access Token) + Refresh Token 轮换** 的双 Token 方案。

- **Access Token**：JWT，有效期 1 小时，携带 `sub`(用户ID)、`role`、`cid`(诊所ID)、`tv`(tokenVersion)
- **Refresh Token**：随机 48 字节 hex 字符串（非 JWT），有效期 24 小时，存储于数据库 `User.refreshToken`（SHA-256 哈希存储）
- **轮换机制**：每次刷新时签发新的 Refresh Token，旧 Token 标记为已用（写入 `UsedRefreshToken` 表）

## 替代方案

### Session + Cookie
- 优点：服务端可控、可即时吊销
- 缺点：需维护服务端 Session 存储；桌面应用无状态部署场景下增加复杂度
- 结论：不适合无状态部署形态

### OAuth2
- 优点：标准化、支持第三方登录
- 缺点：诊所内部系统无需第三方授权；引入授权服务器过于复杂
- 结论：过度设计

## 后果

### 正面
- **无状态**：服务端无需存储 Session，Access Token 自包含用户信息
- **易于扩展**：未来多实例部署或移动端接入无需共享 Session 存储
- **支持移动端**：Token 方案天然适配非浏览器客户端
- **可检测重放攻击**：Refresh Token 一次性使用，检测到旧 Token 被再次使用时，立即吊销该用户所有 Token

### 负面
- **Token 吊销困难**：JWT 签发后无法主动失效（无状态的本质代价）
  - 缓解：通过 `tokenVersion` 字段实现批量吊销——改密/登出/禁用时递增 `tokenVersion`，校验时比对不通过即拒绝
- **Token 有效期权衡**：Access Token 太短则刷新频繁，太长则被盗风险高
  - 当前选择：1 小时 Access + 24 小时 Refresh，平衡体验与安全
- **Refresh Token 存储开销**：需维护 `UsedRefreshToken` 表用于重放检测（已实现定时清理，保留 25 小时）

## 实施
- 依赖：`@nestjs/jwt` + `passport-jwt` + `bcryptjs`
- 密码哈希：bcrypt，默认 10 轮，可通过 `BCRYPT_ROUNDS` 环境变量调整（范围 4-15，生产建议 12）
- 文件：
  - `src/modules/auth/auth.service.ts`：登录、刷新、登出、改密、用户管理
  - `src/modules/auth/jwt.strategy.ts`：JWT 校验策略，校验 `tokenVersion`
  - `src/modules/auth/jwt-auth.guard.ts`：全局认证守卫（`@Public()` 装饰器可豁免）
- 安全策略：
  - 登录失败 5 次锁定 30 分钟（`loginAttempts` / `lockedUntil`）
  - Refresh Token 哈希存储（SHA-256），重放检测后立即吊销全部 Token
  - 临时密码（4 位 PIN）登录后强制改密（`needChangePassword` / `isTempPassword`）
  - 轮换操作三步 DB 操作原子化（事务内完成：标记旧 Token 已用 → 写入新 Token → 清理过期记录）
- 配置常量：`src/config/constants.ts`（`ACCESS_TOKEN_EXPIRES_IN` / `REFRESH_TOKEN_TTL_MS` 等）
