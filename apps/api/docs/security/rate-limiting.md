# API 限流配置文档

## 1. 限流架构说明

### 1.1 两层限流架构

本项目采用**两层限流**架构，兼顾全局防护和细粒度控制：

```
客户端请求
    ↓
┌─────────────────────────┐
│  全局限流中间件          │  滑动窗口算法
│  (RateLimitMiddleware)  │  按 IP + 角色限流
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│  细粒度限流守卫          │  令牌桶算法
│  (RateLimitGuard)       │  按 IP/用户/诊所限流
└─────────────────────────┘
    ↓
业务逻辑
```

### 1.2 两种限流算法对比

| 特性 | 滑动窗口（中间件） | 令牌桶（守卫） |
|------|-------------------|---------------|
| **实现位置** | 全局中间件 | 控制器/方法级守卫 |
| **适用场景** | 全局防护、基础限流 | 特定接口精细控制 |
| **突发流量** | 不支持（均匀分布） | 支持（桶容量决定突发量） |
| **内存占用** | 较高（存储时间戳列表） | 较低（仅存当前令牌数） |
| **配置粒度** | 按角色 + IP | 按 IP/用户/诊所/自定义 |
| **配置方式** | 硬编码 + 环境变量 | 装饰器 + 元数据 |

### 1.3 限流粒度支持

细粒度限流守卫支持以下限流维度：

- **IP 限流**：按客户端 IP 地址限流（默认）
- **用户限流**：按用户 ID 限流（需认证）
- **诊所限流**：按诊所 ID 限流（多租户）
- **自定义限流**：通过 keyGenerator 函数自定义限流 key

---

## 2. 令牌桶算法原理

### 2.1 基本概念

令牌桶算法是一种常用的限流算法，其核心思想是：

1. 系统以**恒定速率**（rate）向桶中放入令牌
2. 桶有**最大容量**（capacity），放满后多余的令牌被丢弃
3. 每个请求到来时，尝试从桶中**取出一个令牌**
4. 如果能取出令牌，请求通过；否则请求被拒绝

### 2.2 算法优势

**支持突发流量**：
- 当系统空闲时，桶中会积累令牌
- 突发请求到来时，可以一次性消耗积累的令牌
- 桶的容量决定了最大突发量

**平滑限流**：
- 长期来看，请求速率不会超过填充速率
- 比滑动窗口更节省内存（每个 key 只需存少量状态）

### 2.3 参数说明

| 参数 | 说明 | 示例 |
|------|------|------|
| `capacity` | 桶的容量（最大令牌数） | 100 |
| `ratePerSecond` | 每秒填充的令牌数 | 10 |
| `tokensPerRequest` | 每个请求消耗的令牌数 | 1 |

**示例理解**：
- capacity=100, ratePerSecond=10
- 表示：每秒最多处理 10 个请求，但可以承受最多 100 个请求的突发流量
- 突发后需要 10 秒（100/10）才能恢复到满容量

---

## 3. 默认限流配置

### 3.1 全局限流中间件（滑动窗口）

配置位置：`src/common/middleware/rate-limit.middleware.ts`

| 角色 | 每分钟请求数 | 说明 |
|------|------------|------|
| BOSS（老板） | 300 | 最高权限 |
| DOCTOR（医生） | 200 | 高频操作 |
| RECEPTIONIST（前台） | 150 | 日常操作 |
| NURSE（护士） | 150 | 日常操作 |
| TECHNICIAN（技师） | 150 | 日常操作 |
| 匿名用户 | 120 | 未登录状态 |

**特殊接口限流**：

| 接口 | 限制 | 窗口 | 维度 |
|------|------|------|------|
| 登录 (/api/auth/login) | 10 次 | 5 分钟 | IP + 用户名 |
| 登录（用户维度） | 5 次 | 5 分钟 | 用户名 |
| 刷新 Token (/api/auth/refresh) | 10 次 | 1 分钟 | IP |

### 3.2 细粒度限流守卫（令牌桶）

配置位置：通过 `@RateLimit()` 装饰器配置

**默认值**（如未指定）：
- 限流粒度：IP
- 每个请求消耗令牌数：1
- 最大存储条目：10000

---

## 4. 自定义限流配置方法（装饰器）

### 4.1 基本用法

在控制器类或方法上使用 `@RateLimit()` 装饰器：

```typescript
import { RateLimit } from '@/common/decorators/rate-limit.decorator';

@Controller('auth')
export class AuthController {
  @RateLimit({ capacity: 10, ratePerSecond: 1 })
  @Post('login')
  login() {
    // 登录接口：每秒最多 1 次，最多承受 10 次突发
  }
}
```

### 4.2 控制器级限流

控制器级配置会应用到该控制器的所有方法：

```typescript
@RateLimit({ capacity: 100, ratePerSecond: 10 })
@Controller('users')
export class UsersController {
  // 所有方法默认使用 100 容量，10/秒 的限流
}
```

### 4.3 方法级限流

方法级配置会覆盖控制器级配置：

```typescript
@RateLimit({ capacity: 100, ratePerSecond: 10 })
@Controller('users')
export class UsersController {
  @RateLimit({ capacity: 50, ratePerSecond: 5 })
  @Get(':id')
  findOne() {
    // 此方法使用 50 容量，5/秒 的限流
  }

  @Post()
  create() {
    // 继承控制器级配置：100 容量，10/秒
  }
}
```

### 4.4 按用户 ID 限流

```typescript
@RateLimit({
  capacity: 50,
  ratePerSecond: 5,
  granularity: 'user',
})
@Controller('orders')
export class OrdersController {
  // 每个用户每秒最多 5 个请求，最多 50 个突发
}
```

### 4.5 按诊所 ID 限流（多租户）

```typescript
@RateLimit({
  capacity: 200,
  ratePerSecond: 20,
  granularity: 'clinic',
})
@Controller('reports')
export class ReportsController {
  // 每个诊所每秒最多 20 个请求，最多 200 个突发
}
```

### 4.6 自定义 key 生成策略

```typescript
@RateLimit({
  capacity: 10,
  ratePerSecond: 1,
  granularity: 'custom',
  keyGenerator: (req) => {
    const request = req as Request;
    const phone = request.body?.phone;
    return `sms:${phone}`;
  },
})
@Post('send-sms')
sendSms() {
  // 按手机号限流，每个手机号每秒最多发 1 条短信
}
```

### 4.7 多令牌消耗

对于计算密集型或资源消耗大的接口，可以消耗多个令牌：

```typescript
@RateLimit({
  capacity: 10,
  ratePerSecond: 0.5,
  tokensPerRequest: 2,
})
@Post('export')
exportData() {
  // 导出接口：每次消耗 2 个令牌
  // 每 2 秒生成 1 个新令牌（0.5/秒）
  // 最大突发 5 次（10 / 2）
}
```

---

## 5. 白名单配置

### 5.1 环境变量配置

在 `.env` 文件中配置白名单 IP（逗号分隔）：

```env
RATE_LIMIT_WHITELIST=127.0.0.1,::1,192.168.1.100
```

### 5.2 白名单说明

- 白名单内的 IP 不受细粒度限流守卫限制
- 全局限流中间件的白名单请直接修改中间件代码
- 建议将内部服务、监控系统、健康检查等 IP 加入白名单
- 本地开发时，`127.0.0.1` 和 `::1` 默认不受限流（需配置）

---

## 6. 响应头说明

限流相关的响应头：

| 响应头 | 说明 | 示例 |
|--------|------|------|
| `X-RateLimit-Limit` | 限制的请求数（容量） | 100 |
| `X-RateLimit-Remaining` | 剩余可用请求数 | 95 |
| `X-RateLimit-Reset` | 重置时间（Unix 时间戳） | 1700000000 |
| `Retry-After` | 限流时需等待的秒数 | 5 |

### 6.1 正常响应

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1700000000
```

### 6.2 限流响应

```
HTTP/1.1 429 Too Many Requests
Retry-After: 5
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700000005

{
  "statusCode": 429,
  "message": "请求过于频繁，请稍后再试"
}
```

---

## 7. 监控与告警

### 7.1 日志

限流事件会记录警告日志：

```
[RateLimitMiddleware] Rate limit exceeded for IP=192.168.1.100 path=/api/auth/login key=...
[RateLimitGuard] Rate limit exceeded: key=rl:user:123 granularity=user capacity=100 rate=10/s
```

### 7.2 Sentry 集成

所有 429 错误会通过全局异常过滤器上报到 Sentry（如果配置了 Sentry）。

可在 Sentry 中配置告警规则：
- 5 分钟内 429 错误超过 100 次 → 警告
- 5 分钟内 429 错误超过 500 次 → 严重

### 7.3 监控指标（建议）

建议后续接入 Prometheus 等监控系统，采集以下指标：

- `rate_limit_requests_total`：限流请求总数（按 key 维度）
- `rate_limit_allowed_total`：通过的请求数
- `rate_limit_denied_total`：被拒绝的请求数
- `rate_limit_bucket_size`：当前令牌桶数量（用于内存监控）

---

## 8. 常见问题

### 8.1 为什么使用两层限流？

- **全局中间件**：作为第一道防线，防止整体系统过载，基于角色的粗粒度控制
- **细粒度守卫**：针对特定接口的精细化控制，支持多维度限流

两者配合使用，既能保护整体系统，又能灵活配置特定接口。

### 8.2 什么时候用滑动窗口，什么时候用令牌桶？

**滑动窗口适合**：
- 全局防护，需要精确控制单位时间内的请求数
- 不允许突发流量的场景
- 按时间窗口统计（如每分钟最多 N 次）

**令牌桶适合**：
- 特定接口，需要允许一定程度的突发流量
- 计算资源消耗不均衡的接口（可用 tokensPerRequest 调整）
- 需要更精细控制的场景

### 8.3 多实例部署时限流会失效吗？

**是的，当前实现会失效。**

当前实现使用内存存储（Map），仅适用于单实例部署。多实例部署时：
- 每个实例独立计数，实际限流阈值会被实例数放大
- 例如：限流 100/分钟，部署 3 个实例，实际可能达到 300/分钟

**解决方案**（TODO）：
- 迁移到 Redis 等共享存储
- 使用 Redis 的 token bucket 或 cell 模块
- 使用 Lua 脚本保证原子性

### 8.4 如何临时关闭限流？

**全局限流中间件**：
- 注释掉 `main.ts` 或模块中的中间件注册代码

**细粒度限流守卫**：
- 移除装饰器即可关闭对应接口的限流
- 或在守卫中添加全局开关配置

### 8.5 限流会影响性能吗？

影响很小。令牌桶算法：
- 时间复杂度：O(1)（每次请求只做简单计算）
- 空间复杂度：O(n)（n 为不同 key 的数量）
- 单节点轻松支持数十万 QPS

### 8.6 如何测试限流是否生效？

使用 `curl` 或压力测试工具：

```bash
# 连续请求 10 次测试
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/auth/login
done
```

或使用 `ab`、`wrk` 等工具进行压力测试。

---

## 9. 代码位置参考

| 组件 | 文件路径 |
|------|---------|
| 令牌桶算法 | `src/common/utils/rate-limit/token-bucket.ts` |
| 全局限流中间件 | `src/common/middleware/rate-limit.middleware.ts` |
| 细粒度限流守卫 | `src/common/guards/rate-limit.guard.ts` |
| 限流装饰器 | `src/common/decorators/rate-limit.decorator.ts` |
| 中间件测试 | `src/common/middleware/rate-limit.middleware.spec.ts` |
| 令牌桶测试 | `src/common/utils/rate-limit/token-bucket.spec.ts` |

---

## 10. 后续优化方向

1. **Redis 支持**：支持分布式部署，使用 Redis 共享限流状态
2. **动态配置**：通过配置中心动态调整限流参数，无需重启
3. **自适应限流**：根据系统负载自动调整限流阈值
4. **更丰富的监控**：Prometheus 指标、Grafana 看板
5. **降级策略**：限流时返回降级数据而非直接拒绝
6. **优先级队列**：重要用户/接口优先放行
