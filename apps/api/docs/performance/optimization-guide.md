# 性能优化指南

本文档记录了 API 项目的性能基准测试方法、优化建议和监控指标。

## 1. 性能基准测试结果（示例）

以下结果基于 100 次迭代、10 次预热的本地测试环境（Windows x64, 16核 CPU, SQLite WAL 模式）：

### 数据库性能

| 测试项 | 平均(ms) | 中位(ms) | P95(ms) | P99(ms) | 最小(ms) | 最大(ms) |
|--------|---------|---------|---------|---------|---------|---------|
| 单条插入 | 0.06 | 0.05 | 0.10 | 0.12 | 0.03 | 0.15 |
| 批量插入(100条) | 0.38 | 0.38 | 0.54 | 0.60 | 0.30 | 0.80 |
| 主键查询 | 0.03 | 0.03 | 0.06 | 0.08 | 0.02 | 0.10 |
| 分页查询(LIMIT 20) | 0.03 | 0.03 | 0.06 | 0.07 | 0.02 | 0.10 |
| 模糊查询(LIKE) | 0.18 | 0.18 | 0.37 | 0.45 | 0.10 | 0.50 |
| 事务处理(3操作) | 0.20 | 0.20 | 0.36 | 0.42 | 0.15 | 0.50 |

### 内存使用

| 指标 | 值 |
|------|-----|
| 启动后 RSS | ~38 MB |
| 数据库初始化后 RSS | ~41 MB |
| 1000次查询后增长 | ~3 MB |

> 运行基准测试：`node scripts/performance/benchmark.js --iterations 100 --warmup 10`

---

## 2. 数据库性能优化

### 2.1 索引优化建议

#### 已覆盖的索引

项目已配置以下核心索引（见 `src/db/schema/indexes.ts`）：

- **多租户复合索引**：所有高频查询表均有 `clinicId` 前缀的复合索引
- **部分索引**：`deletedAt IS NULL` 的部分索引，减小索引体积
- **复合索引**：高频查询字段组合（如 `clinicId + deletedAt + createdAt`）

#### 索引检查清单

1. **确保 WHERE 子句字段有索引**
   ```sql
   -- 检查：EXPLAIN QUERY PLAN SELECT * FROM Patient WHERE name LIKE '%张%' AND clinicId = ?
   ```

2. **避免索引列上使用函数**
   ```sql
   -- ❌ 索引失效
   WHERE LOWER(name) = 'john'
   
   -- ✅ 可利用索引（如果有 name 索引）
   WHERE name = 'John'
   ```

3. **LIKE 查询注意事项**
   ```sql
   -- ✅ 前缀匹配可利用索引
   WHERE name LIKE '张%'
   
   -- ❌ 前后模糊无法利用索引，需走全表扫描
   WHERE name LIKE '%张%'
   ```

4. **定期检查索引使用情况**
   ```sql
   PRAGMA index_list('table_name');
   PRAGMA index_info('index_name');
   ```

### 2.2 查询优化建议

#### 使用预编译语句

better-sqlite3 同步驱动，使用 `prepare()` 预编译语句可复用执行计划：

```typescript
// ✅ 推荐：预编译 + 参数绑定
const stmt = db.prepare('SELECT * FROM Patient WHERE id = ?');
const result = stmt.get(id);

// ❌ 避免：每次都拼接 SQL
const result = db.prepare(`SELECT * FROM Patient WHERE id = ${id}`).get();
```

项目的 `DbService` 已实现 LRU 语句缓存（`statementCache`，最大 100 条），推荐通过 `prepare()` 方法获取语句。

#### 分页查询优化

```sql
-- ✅ 基于游标的分页（比 OFFSET 高效）
SELECT * FROM Patient 
WHERE clinicId = ? AND id < ? 
ORDER BY id DESC 
LIMIT 20;

-- ⚠️ OFFSET 分页在大偏移量时效率低
SELECT * FROM Patient WHERE clinicId = ? ORDER BY id LIMIT 20 OFFSET 1000;
```

#### COUNT 查询优化

```sql
-- ✅ 估算（更快，但可能不准）
SELECT COUNT(*) FROM table WHERE deletedAt IS NULL;

-- ⚠️ 避免：无条件 COUNT(*) 走全表扫描
SELECT COUNT(*) FROM table;
```

### 2.3 N+1 查询识别

#### 常见 N+1 场景

1. **列表查询后逐条加载关联数据**
   ```typescript
   // ❌ N+1 问题
   const patients = this.findMany(query);
   for (const p of patients) {
     p.lastVisit = this.visitService.getLastVisit(p.id); // 每条都查一次
   }
   
   // ✅ 批量加载
   const patientIds = patients.map(p => p.id);
   const lastVisits = this.visitService.getLastVisitsForPatients(patientIds);
   ```

2. **检查方式**
   - 启用 SQLite verbose 模式（开发环境）
   - 使用 `DbService.timedQuery()` 包裹查询，观察慢查询日志
   - 日志中短时间内大量相似 SQL 即为 N+1 信号

### 2.4 WAL 模式配置

项目已默认启用 WAL 模式（`SQLITE_JOURNAL_MODE = 'WAL'`）：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA wal_autocheckpoint = 1000;
```

**WAL 模式优势**：
- 读操作与写操作互不阻塞
- 显著提升并发读性能
- 写入性能更稳定

**定期 Checkpoint**：
- 项目 `DbService` 已配置每分钟 `wal_checkpoint(PASSIVE)`
- 关闭连接时执行 `wal_checkpoint(TRUNCATE)`

### 2.5 PRAGMA 优化参数

| 参数 | 当前值 | 说明 |
|------|--------|------|
| `journal_mode` | WAL | 日志模式，WAL 提升并发性能 |
| `synchronous` | NORMAL | 同步级别，WAL 模式下 NORMAL 足够安全 |
| `cache_size` | -50000 | 页缓存大小（负数值=KB），约 50MB |
| `temp_store` | MEMORY | 临时表存储位置，内存比磁盘快 |
| `mmap_size` | 268435456 | mmap 大小（256MB），大数据库可提升读性能 |
| `busy_timeout` | 5000 | 锁等待超时（毫秒） |
| `wal_autocheckpoint` | 1000 | WAL 自动检查点阈值（页） |

环境变量可覆盖默认值（见 `.env.example`）。

---

## 3. 缓存策略

### 3.1 缓存层级

```
┌─────────────────────────────────────┐
│  L1: 内存缓存 (CacheService)        │  最快，进程内，容量有限（1000条）
├─────────────────────────────────────┤
│  L2: SQLite 页缓存 (PRAGMA cache)   │  数据库级，自动管理
├─────────────────────────────────────┤
│  L3: 磁盘 (SQLite 数据文件)         │  持久化，最慢
└─────────────────────────────────────┘
```

### 3.2 内存缓存使用（CacheService）

项目内置 `CacheService`（`src/common/services/cache.service.ts`），基于 LRU + TTL 策略。

**已缓存的业务数据**：
- 统计仪表盘数据（60秒 TTL）
- 搜索结果（30秒 TTL）
- 诊所信息（5分钟 TTL）
- 药品目录（30分钟 TTL）

**使用模式**：

```typescript
const cacheKey = `stats:revenue:${clinicId}:${period}`;
return this.cacheService.getOrSet(cacheKey, () => {
  return this.calculateRevenue(clinicId, period);
}, STATS_REVENUE_CACHE_TTL_MS);
```

### 3.3 缓存失效策略

| 策略 | 适用场景 | 实现方式 |
|------|---------|---------|
| TTL 过期 | 可容忍短暂不一致的读多写少数据 | `CacheService.set(key, value, ttl)` |
| 主动删除 | 更新后立即失效 | `CacheService.del(key)` / `delPattern(prefix)` |
| 前缀批量删除 | 某类数据整体失效 | `CacheService.delPattern('stats:')` |

### 3.4 缓存穿透/击穿/雪崩防护

#### 缓存穿透（查询不存在的数据）

- **现象**：大量请求查询不存在的 key，直接打到数据库
- **防护**：
  - 缓存空值（短 TTL）
  - 参数校验，提前拦截无效查询

#### 缓存击穿（热点 key 过期）

- **现象**：某个热点 key 过期瞬间，大量并发请求打到数据库
- **防护**：
  - 热点数据永不过期（主动更新）
  - 互斥锁重建（单进程内可使用 Promise 复用）

#### 缓存雪崩（大量 key 同时过期）

- **现象**：大量缓存同时过期，数据库压力骤增
- **防护**：
  - TTL 加随机偏移
  - 分批次过期
  - 确保数据库有足够承载能力

---

## 4. 应用层优化

### 4.1 连接池配置

better-sqlite3 是同步驱动，单连接即可。但需注意：

- **读密集场景**：Node.js 单线程 + SQLite 单连接足够，无需连接池
- **写密集场景**：SQLite 串行化写操作，连接池无帮助
- **Electron 多窗口**：每个窗口是独立进程，各自有独立连接，由 WAL 模式处理并发

### 4.2 异步处理

#### 适合异步的操作

1. **日志写入**：项目使用 `BufferedWriter` 批量刷盘
2. **备份操作**：`db.backup()` 是异步 API
3. **通知/消息推送**：异步发送不阻塞主流程

#### 不适合异步的操作

- SQLite 查询是同步的，包装成 Promise 没有性能收益
- 不要为了 "异步" 而用 `setImmediate` 包装同步 DB 调用

### 4.3 批量操作

#### 批量插入

```typescript
// ✅ 使用事务包裹批量插入
const insertMany = db.transaction((items) => {
  const stmt = db.prepare('INSERT INTO ... VALUES (?, ?, ?)');
  for (const item of items) {
    stmt.run(item.a, item.b, item.c);
  }
});
insertMany(items);
```

#### 批量更新

```typescript
// ✅ 用事务 + 预编译语句
const updateTx = db.transaction((ids) => {
  const stmt = db.prepare('UPDATE table SET status = ? WHERE id = ?');
  for (const id of ids) {
    stmt.run('done', id);
  }
});
updateTx(ids);
```

---

## 5. 部署优化

### 5.1 Node.js 运行参数

```bash
# 生产环境推荐
node --expose-gc --max-old-space-size=512 dist/src/main.js
```

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `--max-old-space-size` | 256-512 MB | 根据数据量调整，SQLite 数据在堆外 |
| `--expose-gc` | 可选 | 暴露 `global.gc()`，用于性能测试 |
| `NODE_ENV=production` | 必设 | 关闭 verbose SQL 日志等开发功能 |

### 5.2 集群模式

**不推荐 Node.js cluster 模式**：
- SQLite 单文件数据库，多进程写竞争会增加锁等待
- better-sqlite3 同步 API 不适合跨 worker 共享
- 单进程 + WAL 模式通常已足够

**适用场景**：
- 读极多、写极少的场景可考虑只读副本
- Electron 多窗口场景（天然多进程，WAL 可处理）

### 5.3 反向代理配置

如使用 Nginx 等反向代理：

```nginx
# 启用 gzip 压缩
gzip on;
gzip_types application/json;

# 静态资源缓存
location /static/ {
  expires 7d;
  add_header Cache-Control "public, immutable";
}

# 连接池（如果是多实例部署）
upstream api_backend {
  server 127.0.0.1:3001;
  keepalive 32;
}
```

---

## 6. 性能监控

### 6.1 关键指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| API 平均响应时间 | < 100ms | 一般 CRUD 操作 |
| API P95 响应时间 | < 500ms | 95% 请求应在此时间内 |
| 慢请求率 | < 1% | 超过阈值的请求占比 |
| 数据库慢查询 | < 100ms | `DbService.timedQuery()` 阈值 |
| 缓存命中率 | > 80% | 可接受范围，依业务而定 |
| 内存使用 | < 200MB | 正常运行时 RSS |
| 数据库连接数 | 1 | 单进程单连接 |

### 6.2 告警阈值

| 指标 | 警告阈值 | 严重阈值 |
|------|---------|---------|
| P95 响应时间 | > 500ms | > 1000ms |
| 慢请求率 | > 5% | > 10% |
| 内存使用率 | > 70% | > 90% |
| 错误率 | > 1% | > 5% |

### 6.3 常用工具

#### 内置工具

1. **性能中间件**：`PerformanceMiddleware`（可插拔）
   - 响应时间统计
   - 慢请求日志
   - `X-Response-Time` 响应头
   - `getStats()` 获取统计数据

2. **Trace 中间件**：`TraceMiddleware`（已启用）
   - 请求 ID 追踪
   - 1000ms 慢请求日志

3. **慢查询日志**：`DbService.timedQuery()`
   - 超过 100ms 的 SQL 查询会输出 warn 日志

4. **基准测试脚本**：`scripts/performance/benchmark.js`
   ```bash
   node scripts/performance/benchmark.js --iterations 100 --warmup 10
   ```

#### 外部工具

| 工具 | 用途 |
|------|------|
| `clinic.js` | Node.js 性能剖析（CPU、内存、I/O） |
| `0x` | 火焰图生成 |
| `Sentry` | 错误与性能监控（项目已集成） |
| `sqlite3` CLI | 手动 `EXPLAIN QUERY PLAN` 分析 |
| `PRAGMA profile` | SQLite 内置性能分析 |

---

## 7. 性能排查步骤

当遇到性能问题时，按以下顺序排查：

1. **定位瓶颈**：是 API 响应慢还是特定操作慢？
   - 查看慢请求日志，确定慢接口
   - 查看慢查询日志，确定慢 SQL

2. **分析 SQL**：
   ```sql
   EXPLAIN QUERY PLAN SELECT ...; -- 看是否走索引
   ```

3. **检查索引**：确认 WHERE/ORDER BY 字段是否有合适索引

4. **检查缓存**：热点数据是否已缓存？缓存命中率如何？

5. **检查 N+1**：列表接口是否存在循环查询

6. **资源监控**：CPU、内存、磁盘 I/O 是否饱和

---

## 相关文档

- [SQLite 优化配置](../database/sqlite-optimization.md)
- `src/common/services/cache.service.ts` - 缓存服务
- `src/common/middleware/performance.middleware.ts` - 性能中间件
- `src/db/db.service.ts` - 数据库服务
