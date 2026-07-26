# SQLite 优化配置指南

本文档详细说明 SQLite 数据库的性能优化配置、最佳实践和常见陷阱。

## 1. PRAGMA 优化配置

项目已在 `src/db/database.ts` 的 `applyPragmas()` 函数中应用以下优化配置，可通过环境变量覆盖。

### 1.1 journal_mode = WAL

```sql
PRAGMA journal_mode = WAL;
```

**WAL (Write-Ahead Logging) 模式**是 SQLite 最重要的性能优化配置。

**优势**：
- 读写不互斥：读操作不会阻塞写，写操作也不会阻塞读
- 显著提升并发读性能
- 写入性能更平滑，减少突发延迟
- 崩溃恢复更快

**注意事项**：
- 会产生 `-wal` 和 `-shm` 两个额外文件
- 需要定期 checkpoint（将 WAL 写回主数据库）
- 只读网络文件系统上可能不兼容
- 旧版 SQLite（< 3.7.0）不支持

**项目配置**：环境变量 `SQLITE_JOURNAL_MODE`，默认 `WAL`

### 1.2 synchronous = NORMAL

```sql
PRAGMA synchronous = NORMAL;
```

| 级别 | 说明 | 性能 | 安全性 |
|------|------|------|--------|
| `FULL` | 每次写入都 fsync，最安全 | 最慢 | 最高，断电不丢数据 |
| `NORMAL` | WAL 模式下足够安全 | 中等 | 应用崩溃不丢，断电可能丢最近事务 |
| `OFF` | 完全不同步 | 最快 | 崩溃可能损坏数据库 |

**推荐**：WAL 模式下使用 `NORMAL`，在性能和安全性间取得良好平衡。

**项目配置**：环境变量 `SQLITE_SYNCHRONOUS`，默认 `NORMAL`

### 1.3 cache_size = -50000

```sql
PRAGMA cache_size = -50000;
```

设置页面缓存大小。负值表示 KB 数，正值表示页数。

| 配置 | 约等于 | 适用场景 |
|------|--------|---------|
| `-20000` | 20 MB | 小型数据库（< 100MB） |
| `-50000` | 50 MB | 中型数据库（100MB - 1GB） |
| `-200000` | 200 MB | 大型数据库（> 1GB） |

**建议**：缓存大小设置为数据库大小的 10%-25%。

**项目配置**：环境变量 `SQLITE_CACHE_SIZE`，默认 `-50000`（约 50MB）

### 1.4 temp_store = MEMORY

```sql
PRAGMA temp_store = MEMORY;
```

临时表和索引的存储位置：

| 值 | 说明 |
|----|------|
| `DEFAULT` | 默认，通常是文件 |
| `FILE` | 使用临时文件 |
| `MEMORY` | 存放在内存中 |

**建议**：使用 `MEMORY`，临时表操作更快。注意如果临时表很大，会占用更多内存。

**项目配置**：环境变量 `SQLITE_TEMP_STORE`，默认 `MEMORY`

### 1.5 mmap_size = 268435456

```sql
PRAGMA mmap_size = 268435456; -- 256 MB
```

使用内存映射 I/O 读取数据库文件。

**优势**：
- 减少 read() 系统调用开销
- 大数据库读性能提升明显
- 利用操作系统页缓存

**注意事项**：
- 仅影响读操作，写入仍走正常路径
- 32 位系统地址空间有限，不宜设太大
- 设置为 0 表示禁用 mmap

**建议**：
- 64 位系统：设置为 256MB 或更大
- 32 位系统：设置为 64MB 或禁用

**项目配置**：环境变量 `SQLITE_MMAP_SIZE`，默认 `268435456`（256MB）

### 1.6 busy_timeout = 5000

```sql
PRAGMA busy_timeout = 5000;
```

锁等待超时时间（毫秒）。当数据库被锁定时，SQLite 会等待直到超时或获取锁。

**建议**：设置 3000-10000ms，避免锁竞争时立即失败。

**项目配置**：环境变量 `SQLITE_BUSY_TIMEOUT_MS`，默认 `5000`

### 1.7 wal_autocheckpoint = 1000

```sql
PRAGMA wal_autocheckpoint = 1000;
```

WAL 自动检查点阈值（页数）。当 WAL 文件页数超过此值时，自动触发 checkpoint。

| 值 | 说明 |
|----|------|
| 小值（100） | WAL 文件小，但 checkpoint 频繁，写入抖动 |
| 大值（10000）| WAL 文件可能很大，但写入更平滑 |

**建议**：
- 写入频繁：1000-10000 页
- 写入很少：100-1000 页

**项目配置**：环境变量 `SQLITE_WAL_AUTOCHECKPOINT`，默认 `1000`

### 完整配置参考

```sql
PRAGMA encoding = "UTF-8";
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -50000;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA foreign_keys = ON;
```

---

## 2. 连接配置

### 2.1 只读连接

对于纯查询场景，使用只读连接：

```typescript
const db = new Database(path, { readonly: true });
```

**优势**：
- 不会获取写锁，不影响其他连接
- 更安全，防止误写
- 可打开已被其他进程以只读方式锁定的数据库

**项目使用**：`DbService.openReadonly()` 方法，用于备份校验等场景。

### 2.2 超时设置

```typescript
const db = new Database(path, {
  timeout: 5000, // 锁等待超时（毫秒）
});
```

与 `PRAGMA busy_timeout` 等效，但在创建连接时设置。

### 2.3 verbose 模式（仅开发环境）

```typescript
const db = new Database(path, {
  verbose: (msg) => console.log('[SQL]', msg),
});
```

开发环境可启用 verbose 模式输出所有 SQL 语句，便于调试和发现 N+1 查询。

**注意**：生产环境务必关闭，严重影响性能且产生大量日志。

---

## 3. 索引最佳实践

### 3.1 索引创建原则

**1. 为 WHERE、JOIN、ORDER BY 字段创建索引**

```sql
-- WHERE 字段
CREATE INDEX idx_patient_clinic ON Patient(clinicId);

-- ORDER BY 字段
CREATE INDEX idx_patient_created ON Patient(createdAt DESC);

-- 复合索引（最左前缀原则）
CREATE INDEX idx_patient_clinic_deleted_created ON Patient(clinicId, deletedAt, createdAt DESC);
```

**2. 使用复合索引替代多个单列索引**

```sql
-- ❌ 多个单列索引，查询时通常只能用一个
CREATE INDEX idx_a ON t(a);
CREATE INDEX idx_b ON t(b);

-- ✅ 复合索引，可同时用于 a 和 a+b 查询
CREATE INDEX idx_a_b ON t(a, b);
```

**3. 选择性高的字段放前面**

复合索引中，选择性高（distinct 值多）的字段放前面。

**4. 使用部分索引减小索引体积**

```sql
-- 只索引未删除的记录（软删除表）
CREATE INDEX idx_charge_active ON Charge(clinicId, paidAt)
WHERE deletedAt IS NULL;
```

项目已广泛使用部分索引（见 `src/db/schema/indexes.ts`）。

**5. 使用覆盖索引避免回表**

如果查询只需要索引中的字段，SQLite 可以直接从索引返回数据，无需回表查询。

```sql
-- 覆盖索引：查询 name 时直接从索引返回
CREATE INDEX idx_patient_clinic_name ON Patient(clinicId, name);

-- 以下查询可直接走覆盖索引
SELECT name FROM Patient WHERE clinicId = ?;
```

### 3.2 索引检查方法

```sql
-- 查看表的索引
PRAGMA index_list('table_name');

-- 查看索引详情
PRAGMA index_info('index_name');

-- 分析查询是否使用索引
EXPLAIN QUERY PLAN SELECT * FROM Patient WHERE name = ?;

-- 统计信息（帮助查询优化器选择索引）
ANALYZE;
```

### 3.3 避免索引失效的场景

| 场景 | 示例 | 建议 |
|------|------|------|
| 索引列上用函数 | `WHERE LOWER(name) = ?` | 存小写版本，或用表达式索引 |
| 前导通配符 LIKE | `WHERE name LIKE '%xx%'` | 考虑 FTS5 全文搜索 |
| 隐式类型转换 | `WHERE id = '123'` (id是数字) | 保持类型一致 |
| OR 连接非索引列 | `WHERE a = ? OR b = ?` (b无索引) | 给 b 加索引，或拆分查询 |
| NOT / != | `WHERE status != 'done'` | 多数情况用不上索引 |

---

## 4. 查询优化技巧

### 4.1 使用预编译语句

```typescript
// ✅ 预编译 + 参数绑定（可复用执行计划）
const stmt = db.prepare('SELECT * FROM Patient WHERE id = ?');
const result = stmt.get(id);

// ❌ 字符串拼接（SQL 注入风险 + 每次重新编译）
const result = db.prepare(`SELECT * FROM Patient WHERE id = ${id}`).get();
```

项目的 `DbService` 已实现 LRU 语句缓存（最大 100 条），使用 `dbService.prepare()` 自动复用。

### 4.2 LIMIT 比 COUNT 更高效

判断是否存在时，用 `LIMIT 1` 而不是 `COUNT(*)`：

```sql
-- ❌ 全表计数
SELECT COUNT(*) FROM table WHERE condition;

-- ✅ 找到第一个就停
SELECT 1 FROM table WHERE condition LIMIT 1;
```

### 4.3 避免 SELECT *

只查询需要的字段：
- 减少数据传输和内存使用
- 更有机会走覆盖索引

```sql
-- ❌
SELECT * FROM Patient WHERE clinicId = ?;

-- ✅
SELECT id, name, phone FROM Patient WHERE clinicId = ?;
```

### 4.4 批量操作使用事务

```typescript
// ✅ 事务包裹批量操作
const insertMany = db.transaction((items) => {
  const stmt = db.prepare('INSERT INTO t (a, b) VALUES (?, ?)');
  for (const item of items) {
    stmt.run(item.a, item.b);
  }
});
insertMany(items);
```

**原理**：SQLite 每个事务默认同步一次磁盘，批量操作放在一个事务里可以显著减少 fsync 次数。

**性能提升**：批量插入可提升 10-100 倍。

### 4.5 分页优化

大偏移量的 `OFFSET` 效率低，因为需要扫描并跳过前面的行。

**基于游标的分页（推荐）**：

```sql
-- 第一页
SELECT * FROM Patient WHERE clinicId = ? ORDER BY id DESC LIMIT 20;

-- 下一页（用最后一条的 id 作为游标）
SELECT * FROM Patient 
WHERE clinicId = ? AND id < ? 
ORDER BY id DESC 
LIMIT 20;
```

### 4.6 避免 N+1 查询

```typescript
// ❌ N+1：列表循环查详情
const patients = this.list(query);
for (const p of patients) {
  p.lastVisit = this.visitService.getByPatientId(p.id);
}

// ✅ 批量查询
const patientIds = patients.map(p => p.id);
const visits = this.visitService.getByPatientIds(patientIds);
// 然后关联到 patient
```

---

## 5. 备份策略

### 5.1 SQLite 备份 API

better-sqlite3 提供在线备份 API：

```typescript
// 异步备份（不阻塞）
const backup = await db.backup('backup.sqlite');
backup.transfer(-1); // -1 表示全部传输
backup.close();
```

**优势**：
- 备份期间数据库仍可正常读写
- 不需要关闭数据库
- 进度可监控

项目 `DbService.backup()` 方法和自动备份功能使用此 API。

### 5.2 备份最佳实践

1. **备份前执行 WAL checkpoint**
   ```sql
   PRAGMA wal_checkpoint(TRUNCATE);
   ```

2. **验证备份完整性**
   ```sql
   -- 打开备份文件
   PRAGMA integrity_check;
   ```

3. **定期备份**
   - 项目配置自动备份：每 6 小时一次，保留 7 份
   - 重要操作前手动备份

4. **异地备份**
   - 通过 `BACKUP_REMOTE_DIR` 环境变量配置

### 5.3 数据库维护

**定期 VACUUM**（数据大量删除后）：

```sql
VACUUM;
```

- 重建数据库文件，回收未使用空间
- 减小文件大小
- 优化索引布局
- 注意：执行期间数据库锁定，大库需要时间

**建议**：数据量大删除后执行，或每月执行一次。

---

## 6. 常见性能陷阱

### 6.1 大量小事务

**问题**：每条 INSERT/UPDATE 都在单独事务里，每次都 fsync。

**解决**：批量操作包裹在事务中。

### 6.2 未使用预编译语句

**问题**：每次查询都重新编译 SQL 字符串。

**解决**：使用 `prepare()` + 参数绑定，利用 DbService 的语句缓存。

### 6.3 N+1 查询

**问题**：列表接口循环查询关联数据。

**解决**：批量查询，用 IN 条件一次性查出。

**排查方法**：
- 开发环境启用 SQLite verbose 日志
- 观察日志中是否短时间内大量相似 SQL

### 6.4 无索引的 LIKE '%xx%'

**问题**：前后通配符的模糊查询走全表扫描。

**解决**：
- 改用前缀匹配（`'xx%'`）可走索引
- 大数据量考虑 FTS5 全文搜索
- 搜索字段单独建索引 + 前缀匹配

### 6.5 忘记加复合索引的最左前缀

**问题**：有 `(a, b, c)` 索引，但查询只用到 `b`。

**解决**：查询条件必须包含索引的最左前缀。

```sql
-- 索引 (a, b, c)
WHERE a = ? AND b = ? AND c = ?; -- ✅ 完全命中
WHERE a = ? AND b = ?;           -- ✅ 命中前两列
WHERE a = ?;                      -- ✅ 命中第一列
WHERE b = ? AND c = ?;            -- ❌ 未命中（缺 a）
```

### 6.6 大量 OFFSET 深分页

**问题**：`LIMIT 20 OFFSET 10000` 慢。

**解决**：改用基于游标的分页（见 4.5 节）。

### 6.7 每次查询都 COUNT(*)

**问题**：列表接口总是同时查总数。

**优化**：
- 只返回是否有下一页（`LIMIT pageSize + 1`）
- 总数缓存
- 提供「是否需要总数」的参数

### 6.8 滥用子查询

**问题**：复杂子查询导致优化器选错执行计划。

**优化**：
- 优先用 JOIN
- 复杂查询使用 `EXPLAIN QUERY PLAN` 分析
- 适当拆分为多次查询

---

## 7. 性能诊断工具

### 7.1 EXPLAIN QUERY PLAN

```sql
EXPLAIN QUERY PLAN SELECT * FROM Patient WHERE clinicId = ? ORDER BY createdAt DESC;
```

输出示例：
```
SCAN Patient USING INDEX idx_patient_clinic_created (clinicId=?)
```

- `SCAN TABLE` = 全表扫描（性能差）
- `SEARCH TABLE ... USING INDEX` = 使用索引（好）
- `USING COVERING INDEX` = 覆盖索引（最好）

### 7.2 SQLite 状态 PRAGMA

```sql
-- 页缓存命中率
PRAGMA cache_hit;
PRAGMA cache_miss;

-- 数据库大小
PRAGMA page_count;
PRAGMA page_size;

--  freelist 页数（可回收空间）
PRAGMA freelist_count;

-- 表大小估算
ANALYZE;
SELECT stat FROM sqlite_stat1 WHERE tbl = 'table_name';
```

### 7.3 慢查询日志

项目 `DbService.timedQuery()` 方法会自动记录超过 100ms 的查询：

```typescript
const rows = this.dbService.timedQuery(
  'SELECT * FROM Patient WHERE ...',
  () => stmt.all(...params),
);
```

超过阈值会输出 warn 级别日志，包含 SQL 和耗时。

---

## 8. 根据场景调整配置

### 8.1 读多写少

```sql
PRAGMA journal_mode = WAL;
PRAGMA cache_size = -200000; -- 更大缓存
PRAGMA mmap_size = 536870912; -- 512MB mmap
PRAGMA wal_autocheckpoint = 100; -- 更频繁 checkpoint
```

### 8.2 写多读少

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA wal_autocheckpoint = 5000; -- 更大 WAL，减少 checkpoint 频率
PRAGMA cache_size = -50000;
```

### 8.3 嵌入式 / 低内存设备

```sql
PRAGMA cache_size = -8000;  -- 8MB 缓存
PRAGMA mmap_size = 0;       -- 禁用 mmap
PRAGMA temp_store = FILE;   -- 临时表用文件
```

---

## 相关文档

- [性能优化指南](../performance/optimization-guide.md)
- `src/db/database.ts` - 数据库连接与 PRAGMA 配置
- `src/db/db.service.ts` - 数据库服务封装
- `src/db/schema/indexes.ts` - 索引定义
