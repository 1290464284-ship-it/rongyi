# 日志系统配置与使用指南

## 概述

本项目使用自定义的结构化日志系统 `AppLogger`，支持：

- 结构化 JSON 日志（生产环境）
- 人类可读的彩色日志（开发环境）
- 请求链路追踪（traceId / X-Request-Id）
- 用户上下文自动注入（userId、clinicId）
- 敏感信息自动脱敏
- 日志文件轮转与自动清理
- 可配置的日志级别

## 1. 日志级别

### 级别说明

| 级别     | 数值 | 说明                                      |
| -------- | ---- | ----------------------------------------- |
| `debug`  | 0    | 调试信息，开发时使用，生产环境默认关闭    |
| `verbose`| 0    | 详细信息，同 debug 级别                   |
| `info`   | 1    | 一般信息，默认级别                        |
| `log`    | 1    | 同 info 级别（NestJS 兼容）               |
| `warn`   | 2    | 警告信息，需要关注但不影响正常运行        |
| `error`  | 3    | 错误信息，影响功能正常运行                |

### 配置方式

通过环境变量 `LOG_LEVEL` 配置，默认值为 `info`：

```bash
# 开发环境开启 debug 日志
LOG_LEVEL=debug npm run dev

# 生产环境只输出 warn 和 error
LOG_LEVEL=warn node dist/src/main.js
```

支持的取值：`debug`、`verbose`、`info`、`log`、`warn`、`error`（不区分大小写）。

## 2. 日志格式

### 开发环境格式

人类可读格式，带上下文信息：

```
2024-01-15 10:30:45.123 INFO  [AuthService] (trace:abc12345) (user:user-001) (clinic:clinic-001) User login successful
```

格式说明：
- 时间戳（ISO 格式，简化显示）
- 日志级别（5 字符右对齐）
- 上下文标签 `[ContextName]`
- 追踪 ID `(trace:前8位)`
- 用户 ID `(user:xxx)`（如有）
- 诊所 ID `(clinic:xxx)`（如有）
- 日志消息

### 生产环境格式

JSON 格式，便于 ELK、Loki、Sentry 等日志系统解析：

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "traceId": "abc12345-defg-6789-hijk-lmnopqrstuvw",
  "message": "User login successful",
  "context": "AuthService",
  "userId": "user-001",
  "clinicId": "clinic-001",
  "data": {
    "ip": "127.0.0.1"
  }
}
```

字段说明：

| 字段        | 类型   | 说明                              |
| ----------- | ------ | --------------------------------- |
| `timestamp` | string | ISO 8601 格式时间戳               |
| `level`     | string | 日志级别：debug/info/warn/error   |
| `traceId`   | string | 请求追踪 ID（请求上下文中才有）   |
| `message`   | string | 日志消息                          |
| `context`   | string | 日志来源上下文（类名/模块名）     |
| `userId`    | string | 当前用户 ID（已登录时才有）       |
| `clinicId`  | string | 当前诊所 ID（多诊所场景下才有）   |
| `data`      | object | 附加的结构化数据                  |

## 3. 请求追踪链路

### 工作原理

请求追踪基于 `X-Request-Id` 头部和 `AsyncLocalStorage` 实现：

1. **TraceMiddleware**：
   - 从请求头 `X-Request-Id` 提取 traceId
   - 如无有效 ID 则生成新的 UUID
   - 设置到 `req.traceId` 和响应头
   - 检测慢请求（>1s）并记录警告

2. **TraceIdInterceptor**：
   - 将 traceId 存入 `AsyncLocalStorage`
   - 提取用户信息并存入上下文
   - 记录请求完成日志（含耗时）
   - 统一设置响应头 `X-Request-Id`

3. **ClinicContextInterceptor**：
   - 提取 clinicId 并设置到请求上下文
   - 日志自动包含 clinicId

### 分布式追踪

- 上游服务调用时，在请求头中携带 `X-Request-Id`
- 系统会透传该 ID，便于跨服务链路追踪
- 响应头中同样返回 `X-Request-Id`，供客户端排查问题

### 使用示例

**前端/调用方传递 traceId：**

```typescript
// Axios 示例
axios.get('/api/users', {
  headers: {
    'X-Request-Id': 'your-trace-id-uuid',
  },
});
```

**后端代码中获取 traceId：**

```typescript
import { getTraceId, getCurrentUserId, getCurrentClinicId } from '@/common/utils/context';

export function someFunction() {
  const traceId = getTraceId();
  const userId = getCurrentUserId();
  const clinicId = getCurrentClinicId();
  // ...
}
```

## 4. 日志使用指南

### 基本用法

**推荐：直接实例化 AppLogger**

```typescript
import { AppLogger } from '@/common/services/logger.service';

@Injectable()
export class MyService {
  private readonly logger = new AppLogger(MyService.name);

  doSomething() {
    this.logger.log('Starting operation...');
    this.logger.debug('Debug details:', { data: 'value' });
    this.logger.warn('Something might be wrong');
    this.logger.error('Operation failed', error);
  }
}
```

**通过依赖注入使用（需要在模块中提供）：**

```typescript
@Module({
  providers: [AppLogger, MyService],
})
export class MyModule {}
```

### 日志方法

| 方法      | 级别  | 参数说明                                  |
| --------- | ----- | ----------------------------------------- |
| `debug()` | debug | `debug(message, context?)`                |
| `log()`   | info  | `log(message, context?)`                  |
| `warn()`  | warn  | `warn(message, context?)`                 |
| `error()` | error | `error(message, error?, context?)`        |

### 记录结构化数据

传入对象会自动序列化为 JSON，并添加到 `data` 字段：

```typescript
this.logger.log({
  message: 'User registered',
  userId: 'user-001',
  email: 'user@example.com',
});
```

### 请求日志

HTTP 请求日志由 `TraceIdInterceptor` 自动记录，格式为：

```
INFO  [HTTP] (trace:abc12345) GET /api/users 200 45ms
```

包含字段：方法、路径、状态码、耗时。

### 异常日志

全局异常过滤器 `AllExceptionsFilter` 自动记录所有异常：

- 包含 traceId、请求方法、路径、状态码
- 包含错误堆栈（开发环境响应体也会返回）
- 自动脱敏敏感信息
- 5xx 错误自动上报到 Sentry（如已启用）

## 5. 敏感信息脱敏

### 自动脱敏

日志系统自动对以下场景进行脱敏：

1. **对象字段**：识别常见敏感字段名，替换为 `***`
2. **JSON 字符串**：自动扫描 `"key":"value"` 格式的敏感字段
3. **嵌套对象**：支持深度嵌套对象脱敏（最大深度可配置）

### 敏感字段

敏感字段定义在 `src/common/utils/security/sensitive-fields.ts`，包括：

- 密码类：password、pwd、oldPassword、newPassword 等
- Token 类：token、accessToken、refreshToken、jwt 等
- 身份信息：idCard、idNumber、ssn、phone、mobile、email 等
- 支付信息：cardNumber、creditCard、cvv、bankAccount 等
- 其他：secret、privateKey、apiKey 等

**注意**：字段匹配不区分大小写，支持下划线和驼峰命名变体。

### 最佳实践

1. 不要手动拼接包含敏感信息的字符串，直接传对象让系统自动脱敏
2. 自定义敏感字段在 `sensitive-fields.ts` 中统一添加
3. 日志中避免记录完整的请求/响应体，只记录必要字段

## 6. 日志文件

### 文件位置

日志文件位于 `{DATA_DIR}/logs/` 目录下：

- 未设置 `DATA_DIR` 时，默认为项目目录下的 `data/logs/`

### 文件命名

```
app-2024-01-15.log
app-2024-01-15.1.log
app-2024-01-15.2.log
```

- 按日期分割，每天生成新文件
- 单文件超过大小限制时自动编号滚动

### 配置参数

| 参数                        | 默认值        | 说明                  |
| --------------------------- | ------------- | --------------------- |
| `MAX_LOG_FILE_SIZE`         | 20 MB         | 单个日志文件最大大小  |
| `MAX_LOG_FILES_PER_DAY`     | 5             | 每天最多文件数        |
| `LOG_RETENTION_DAYS`        | 30            | 日志保留天数          |
| `LOG_FLUSH_BUFFER_INTERVAL_MS` | 1000 ms    | 日志缓冲刷新间隔      |
| `MAX_LOG_BUFFER_SIZE`       | 100 条        | 缓冲触发刷新阈值      |
| `MAX_LOG_TOTAL_BUFFER_SIZE` | 10000 条      | 最大缓冲数量（丢弃）  |
| `MAX_SANITIZE_DEPTH`        | 10 层         | 脱敏最大嵌套深度      |

### 自动清理

- 每天凌晨 2:00 自动清理超过保留天数的日志文件
- 清理失败不影响主流程

## 7. 日志最佳实践

### 该记录什么

✅ **应该记录：**
- 服务启动/关闭等生命周期事件
- 用户登录、登出等关键操作
- 重要业务状态变更
- 外部服务调用（请求参数、响应状态、耗时）
- 异常和错误堆栈
- 慢查询、慢请求
- 配置变更、参数调整

❌ **不应该记录：**
- 用户密码、Token 等敏感信息（系统会自动脱敏）
- 完整的请求/响应体（体积大，无用信息多）
- 循环内的高频调试日志
- 仅用于开发调试的临时日志（提交前删除）
- 二进制数据、大文件内容

### 日志规范

1. **使用有意义的上下文**：使用类名或模块名作为 logger 上下文
2. **消息简洁明确**：一眼能看懂发生了什么
3. **关键操作带标识**：记录 userId、orderId 等业务标识
4. **错误日志要完整**：包含错误对象，保留堆栈信息
5. **异步操作要追踪**：在回调、定时器中确保 traceId 传递

### 性能考虑

1. 生产环境设置合适的日志级别（`info` 或 `warn`）
2. 避免在循环中打大量 debug 日志
3. 复杂的日志参数组装使用 `if (this.logger.debug)` 包裹
4. 大对象只记录关键字段，不要整个 dump

### 排查问题流程

1. 从前端/客户端获取 `X-Request-Id`
2. 在日志中搜索该 traceId
3. 查看该请求的完整链路日志
4. 结合 userId、clinicId 等上下文信息定位问题

## 8. 相关文件

- 日志服务：`src/common/services/logger.service.ts`
- Trace 中间件：`src/common/middleware/trace.middleware.ts`
- Trace 拦截器：`src/common/interceptors/trace-id.interceptor.ts`
- 异步上下文：`src/common/utils/context/async-context.ts`
- 异常过滤器：`src/common/filters/all-exceptions.filter.ts`
- 敏感字段：`src/common/utils/security/sensitive-fields.ts`
- 诊所上下文：`src/common/services/clinic-context.service.ts`
- 诊所拦截器：`src/common/interceptors/clinic-context.interceptor.ts`
