# 故障排查手册

## 1. 故障排查总览

### 1.1 排查方法论

#### 自底向上法（推荐用于基础设施类问题）

从底层基础设施开始，逐层向上排查：

```
操作系统 → 网络 → 数据库 → 应用服务 → 业务接口
```

**适用场景：** 服务完全不可用、大面积故障、疑似基础设施问题

**排查步骤：**
1. 检查服务器是否存活（ping、ssh）
2. 检查磁盘、CPU、内存使用情况
3. 检查网络连通性（DNS、端口、防火墙）
4. 检查数据库是否正常运行
5. 检查应用进程是否存活
6. 检查应用日志错误
7. 检查具体接口响应

#### 自顶向下法（推荐用于应用层问题）

从用户感知的现象开始，逐层向下定位：

```
业务现象 → 接口响应 → 应用日志 → 数据库查询 → 基础设施
```

**适用场景：** 单个功能异常、特定接口报错、性能问题

**排查步骤：**
1. 确认问题现象和影响范围
2. 复现问题，获取错误信息和 traceId
3. 查看应用日志，定位错误堆栈
4. 分析 SQL 查询是否正常
5. 检查资源使用是否异常
6. 确认是否为基础设施问题

### 1.2 排查工具集

| 类别 | 工具 | 用途 |
|------|------|------|
| 系统监控 | `top` / `htop` | CPU、内存、进程查看 |
| 系统监控 | `df -h` / `du -sh` | 磁盘空间检查 |
| 系统监控 | `free -m` | 内存使用检查 |
| 网络工具 | `ping` / `traceroute` | 网络连通性 |
| 网络工具 | `telnet` / `nc` | 端口连通性 |
| 网络工具 | `nslookup` / `dig` | DNS 解析检查 |
| 网络工具 | `netstat` / `ss` | 连接状态查看 |
| HTTP 工具 | `curl` | 接口测试 |
| HTTP 工具 | Postman / Apifox | 接口调试 |
| 日志查看 | `tail` / `grep` / `awk` | 日志分析 |
| 进程工具 | `ps` / `kill` | 进程管理 |
| 数据库 | `sqlite3` CLI | 数据库直接操作 |
| Node.js | `node --inspect` | 调试模式 |
| Node.js | `clinic.js` | 性能剖析 |
| 浏览器 | DevTools Network | 前端请求分析 |

**Windows 等效工具：**
- 任务管理器（替代 top）
- Resource Monitor（资源监视器）
- PowerShell 命令：`Get-Process`、`Get-NetTCPConnection`、`Test-NetConnection`

---

## 2. 常见故障分类

| 故障类型 | 典型现象 | 常见原因 |
|----------|----------|----------|
| 应用启动失败 | 进程启动后立即退出、端口监听失败 | 配置错误、端口占用、依赖缺失、数据库连接失败 |
| 响应缓慢 | 接口耗时明显增加、页面加载慢 | 慢查询、内存不足、事件循环阻塞、缓存失效 |
| 接口报错 | 5xx 错误、业务异常 | 代码 bug、数据异常、依赖服务不可用 |
| 数据库问题 | 查询超时、锁等待、连接失败 | 锁冲突、连接耗尽、磁盘 I/O 高、数据损坏 |
| 内存泄漏 | 内存持续增长、OOM 崩溃 | 未释放的引用、缓存无限增长、闭包泄漏 |
| CPU 飙高 | CPU 使用率 100%、系统卡顿 | 死循环、密集计算、大量并发请求 |
| 磁盘空间不足 | 写入失败、服务异常退出 | 日志未清理、备份堆积、数据快速增长 |
| 认证授权问题 | 登录失败、401/403 错误 | Token 过期、权限不足、密码错误 |
| 网络问题 | 连接超时、CORS 错误、DNS 解析失败 | 防火墙、DNS、跨域配置、网络中断 |

---

## 3. 应用启动故障

### 3.1 症状

- 执行 `npm start` 后进程立即退出
- 日志显示启动失败错误
- 端口无法访问，健康检查无响应
- 启动过程中抛出异常堆栈

### 3.2 可能原因

| 原因类别 | 具体原因 | 检查点 |
|----------|----------|--------|
| 配置问题 | 缺少必要环境变量 | JWT_SECRET、ENCRYPTION_KEY 是否配置 |
| 配置问题 | 端口被占用 | 3001 端口是否被其他进程占用 |
| 配置问题 | 生产环境未配置 CORS_ORIGIN | 生产环境必须显式配置 CORS_ORIGIN |
| 数据库问题 | 数据库文件不存在 | DB_PATH 路径是否正确 |
| 数据库问题 | 数据库文件权限 | 进程是否有读写权限 |
| 数据库问题 | 数据库损坏 | 数据库文件是否完整 |
| 依赖问题 | Node.js 版本不兼容 | 检查 package.json 引擎要求 |
| 依赖问题 | node_modules 损坏 | 重新安装依赖 |
| 代码问题 | 启动阶段异常 | 查看启动日志中的错误堆栈 |

### 3.3 排查步骤

**步骤 1：查看启动日志**
```bash
# 查看完整启动输出
npm start 2>&1 | head -100

# 或查看日志文件
tail -f /path/to/data/logs/app-$(date +%Y-%m-%d).log
```

**步骤 2：检查环境配置**
```bash
# 检查 .env 文件是否存在
ls -la .env

# 检查关键配置项
grep -E "^(JWT_SECRET|ENCRYPTION_KEY|NODE_ENV|CORS_ORIGIN|DB_PATH|PORT)" .env
```

**步骤 3：检查端口占用**
```bash
# Linux/macOS
lsof -i :3001
netstat -tlnp | grep 3001

# Windows PowerShell
netstat -ano | findstr :3001
Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
```

**步骤 4：检查数据库连接**
```bash
# 检查数据库文件是否存在
ls -la /path/to/data/dental.sqlite

# 测试数据库完整性
sqlite3 /path/to/data/dental.sqlite "PRAGMA integrity_check;"

# 检查磁盘空间
df -h /path/to/data
```

**步骤 5：检查依赖完整性**
```bash
# 重新安装依赖
rm -rf node_modules
npm install

# 检查 Node.js 版本
node --version
```

### 3.4 解决方案

#### 端口被占用
```bash
# 查找占用进程
lsof -ti :3001 | xargs kill -9  # Linux/macOS

# Windows
taskkill /F /PID <进程ID>
```

#### 缺少配置项
```bash
# 生成密钥
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 复制示例配置并修改
cp .env.example .env
# 编辑 .env 文件，填写必要配置
```

#### 数据库文件损坏
```bash
# 尝试从备份恢复
# 详见备份恢复文档 docs/operations/backup-restore.md

# 或尝试修复（风险操作，务必备份）
sqlite3 damaged.db ".recover" | sqlite3 recovered.db
```

#### 生产环境 CORS 配置错误
```bash
# 在 .env 中添加
CORS_ORIGIN=https://your-domain.com
```

---

## 4. 接口响应缓慢

### 4.1 症状

- 接口响应时间超过预期（正常 < 100ms，缓慢 > 500ms）
- 前端页面加载卡顿
- 日志中出现 `Slow request` 或 `Slow query` 警告
- 并发请求时整体性能下降

### 4.2 可能原因

| 原因类别 | 具体原因 | 排查方向 |
|----------|----------|----------|
| 数据库 | 慢查询 | 查看慢查询日志，分析 SQL |
| 数据库 | 缺少索引 | 检查查询条件字段是否有索引 |
| 数据库 | N+1 查询 | 循环中执行数据库查询 |
| 数据库 | 锁等待 | 写操作阻塞读操作 |
| 缓存 | 缓存未命中 | 缓存命中率低 |
| 缓存 | 缓存失效 | 缓存被频繁清理 |
| 应用 | 事件循环阻塞 | CPU 密集型计算、同步 I/O |
| 应用 | 内存不足 | GC 频繁、内存交换 |
| 网络 | 网络延迟 | 跨地域访问、带宽不足 |
| 资源 | 连接池耗尽 | 数据库连接、HTTP 连接 |

### 4.3 排查步骤

#### 步骤 1：定位慢接口

```bash
# 查看日志中的 Slow request（Linux）
grep "Slow request" /path/to/data/logs/app-$(date +%Y-%m-%d).log | tail -20

# Windows PowerShell
Get-Content "D:\dental-data\logs\app-$(Get-Date -Format 'yyyy-MM-dd').log" |
  Select-String "Slow request" |
  Select-Object -Last 20
```

#### 步骤 2：检查慢查询

```bash
# 查看慢查询日志
grep "Slow query" /path/to/data/logs/app-$(date +%Y-%m-%d).log | tail -20
```

#### 步骤 3：使用 EXPLAIN 分析 SQL

```sql
-- 查看查询执行计划
EXPLAIN QUERY PLAN
SELECT * FROM Patient WHERE name LIKE '%张三%';

-- 查看索引使用情况
EXPLAIN QUERY PLAN
SELECT * FROM Patient WHERE phone = '13800138000';
```

#### 步骤 4：检查事件循环延迟

```bash
# 查看 /metrics 中的事件循环延迟
curl -s http://localhost:3001/metrics | grep nodejs_event_loop_delay
```

#### 步骤 5：检查资源使用

```bash
# 查看进程 CPU 和内存
top -p $(pgrep -f "node.*main.js")

# 查看内存使用
curl -s http://localhost:3001/health/info | jq .memory
```

### 4.4 解决方案

#### 慢查询优化

**添加索引：**
```sql
-- 为常用查询字段添加索引
CREATE INDEX IF NOT EXISTS idx_patient_phone ON Patient(phone);
CREATE INDEX IF NOT EXISTS idx_patient_clinic ON Patient(clinicId);
CREATE INDEX IF NOT EXISTS idx_appointment_date ON Appointment(appointmentDate);
```

**优化 LIKE 查询：**
```sql
-- 避免前导通配符（无法使用索引）
-- 不好：WHERE name LIKE '%张三%'
-- 稍好：WHERE name LIKE '张三%'

-- 使用 FTS5 全文搜索替代（如已配置）
```

#### N+1 查询优化

**问题代码模式：**
```typescript
// ❌ N+1 问题
const patients = await this.dbService
  .prepare('SELECT * FROM Patient LIMIT 10')
  .all();

for (const patient of patients) {
  const records = await this.dbService
    .prepare('SELECT * FROM MedicalRecord WHERE patientId = ?')
    .all(patient.id);
  patient.records = records;
}
```

**优化后：**
```typescript
// ✅ 使用 JOIN 或批量查询
const patients = await this.dbService
  .prepare('SELECT * FROM Patient LIMIT 10')
  .all();

const patientIds = patients.map(p => p.id);
const records = await this.dbService
  .prepare(
    `SELECT * FROM MedicalRecord 
     WHERE patientId IN (${patientIds.map(() => '?').join(',')})`
  )
  .all(...patientIds);

// 手动组装
const recordsMap = new Map();
for (const record of records) {
  if (!recordsMap.has(record.patientId)) {
    recordsMap.set(record.patientId, []);
  }
  recordsMap.get(record.patientId).push(record);
}

for (const patient of patients) {
  patient.records = recordsMap.get(patient.id) || [];
}
```

#### 缓存优化

**使用内置缓存服务：**
```typescript
// 参考 src/common/services/cache.service.ts
const cacheKey = `patient:${id}`;
const cached = await this.cacheService.get(cacheKey);
if (cached) return cached;

const patient = await this.findPatient(id);
await this.cacheService.set(cacheKey, patient, 300000); // 5分钟
return patient;
```

#### 事件循环阻塞优化

**常见原因：**
- 大文件同步读写 → 使用流式处理
- 大量 JSON 序列化/反序列化 → 分批处理
- 复杂计算 → 使用 worker threads
- 正则表达式回溯 → 优化正则或限制输入长度

---

## 5. 数据库故障

### 5.1 数据库锁定

**症状：**
- 写入操作超时或失败
- 日志中出现 `SQLITE_BUSY` 错误
- 读操作正常但写操作卡住

**可能原因：**
- 长事务持有锁未释放
- 大量并发写入
- 备份操作占用锁

**排查：**
```sql
-- 查看当前是否有活跃事务
-- SQLite 没有直接的查询，但可以通过以下方式判断

-- 检查 WAL 文件大小（大表示有未提交事务）
-- 查看文件系统
ls -la /path/to/data/dental.sqlite-wal
```

**解决方案：**
```sql
-- 1. 增加忙等待超时时间（已默认 5000ms）
PRAGMA busy_timeout = 10000;

-- 2. 手动执行检查点（减少 WAL 大小）
PRAGMA wal_checkpoint(TRUNCATE);

-- 3. 优化事务：保持事务短小
-- 避免在事务中执行耗时操作
```

### 5.2 连接耗尽

**症状：**
- 新请求报错数据库连接失败
- 进程内存异常

**说明：**
better-sqlite3 是单连接同步驱动，不存在连接池概念。若出现"连接耗尽"，通常是：
1. 多进程同时访问同一数据库文件
2. 嵌套事务导致的问题
3. 备份操作长时间占用

**排查与解决：**
```bash
# 查看有多少进程打开了数据库文件
lsof /path/to/data/dental.sqlite  # Linux

# Windows
handle64.exe D:\dental-data\dental.sqlite  # 需要 Sysinternals 工具
```

### 5.3 磁盘 I/O 高

**症状：**
- 系统响应变慢
- 数据库查询耗时增加
- 磁盘写入频繁

**排查：**
```bash
# Linux
iostat -x 1 5
iotop

# Windows
# 使用资源监视器查看磁盘活动
```

**解决方案：**
1. 确保 WAL 模式已启用（默认已启用）
2. 调整缓存大小：`PRAGMA cache_size = -100000;`（约 100MB）
3. 合并小写入为批量事务
4. 将数据库放在 SSD 上
5. 定期执行 VACUUM 整理碎片

### 5.4 损坏修复

**症状：**
- 查询时报 `database disk image is malformed`
- 启动时数据库初始化失败
- `PRAGMA integrity_check` 返回错误

**排查：**
```sql
-- 完整性检查
PRAGMA integrity_check;

-- 快速检查
PRAGMA quick_check;
```

**修复步骤（风险操作，务必先备份）：**

```bash
# 1. 先备份损坏的数据库文件
cp dental.sqlite dental.sqlite.corrupted

# 2. 尝试 .recover 导出数据
sqlite3 dental.sqlite.corrupted ".recover" > recovered.sql

# 3. 创建新数据库并导入
sqlite3 dental.sqlite.recovered < recovered.sql

# 4. 验证新数据库
sqlite3 dental.sqlite.recovered "PRAGMA integrity_check;"

# 5. 如果恢复成功，替换原文件
# （确保应用已停止）
mv dental.sqlite.recovered dental.sqlite
```

**预防措施：**
- 定期备份（自动备份已内置）
- 突然断电后的完整性检查
- 避免在写入过程中强制终止进程
- 使用 UPS 防止意外断电

---

## 6. 内存问题

### 6.1 内存泄漏排查

**症状：**
- 内存使用持续上升，不下降
- 频繁 Full GC
- 最终 OOM（内存不足）崩溃

**排查工具：**

```bash
# 1. 启动时开启调试
node --inspect=0.0.0.0:9229 dist/src/main.js

# 2. 使用 Chrome DevTools 连接
# 打开 chrome://inspect，点击 inspect

# 3. 抓取 Heap Snapshot，对比差异
```

**使用 clinic.js 分析：**
```bash
# 安装
npm install -g clinic

# 运行并收集数据
clinic heapprofiler -- node dist/src/main.js

# 压测一段时间后停止，生成报告
```

**常见泄漏点：**

| 泄漏类型 | 原因 | 排查方法 |
|----------|------|----------|
| 缓存无限增长 | 缓存没有过期或淘汰机制 | 检查 CacheService，监控缓存大小 |
| 事件监听器未移除 | 添加了监听但未移除 | 搜索 `addEventListener` / `on` |
| 闭包引用 | 闭包持有大对象引用 | 代码审查 |
| 全局变量 | 挂载到 global 的对象不断增长 | 检查全局变量使用 |
| 定时器未清理 | setInterval 未清理 | 搜索 setInterval |

### 6.2 OOM 处理

**症状：**
- 进程突然退出
- 日志中出现 `JavaScript heap out of memory`
- 退出码 137（被系统 OOM killer 杀死）

**紧急处理：**
```bash
# 1. 增加堆内存上限（临时方案）
NODE_OPTIONS="--max-old-space-size=4096" npm start

# 2. 立即重启服务
systemctl restart dental-api  # 或使用进程管理器
```

**根本解决：**
1. 定位内存泄漏源（见上节）
2. 优化内存使用
3. 增加物理内存或升级服务器
4. 设置内存监控告警

### 6.3 内存调优

**Node.js 内存参数：**
```bash
# 设置老生代堆大小（MB）
NODE_OPTIONS="--max-old-space-size=2048"

# 设置新生代堆大小
NODE_OPTIONS="--max-semi-space-size=128"
```

**SQLite 缓存调优：**
```sql
-- 设置页面缓存大小（KB，负数表示 KB）
PRAGMA cache_size = -50000;  -- 约 50MB

-- 使用 mmap 提升读性能
PRAGMA mmap_size = 268435456;  -- 256MB（已默认设置）
```

---

## 7. 认证授权问题

### 7.1 Token 无效

**症状：**
- 接口返回 401 Unauthorized
- 错误信息："Invalid token" 或 "Token expired"

**排查：**
```bash
# 1. 检查 Token 是否正确传递
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/v1/patients

# 2. 检查 Token 格式
# 应为 JWT 格式：header.payload.signature（三部分，两个点分隔）

# 3. 在 https://jwt.io 上解码 Token，检查：
# - exp 是否过期
# - 签发时间是否正确
# - 用户 ID 是否存在
```

**常见原因及解决：**

| 原因 | 解决方案 |
|------|----------|
| Token 已过期 | 使用 refresh token 刷新，或重新登录 |
| JWT_SECRET 变更 | 所有用户需要重新登录 |
| Token 被篡改 | 拒绝访问，记录安全事件 |
| Token 格式错误 | 检查前端是否正确拼接 "Bearer " 前缀 |
| 时钟偏移 | 检查服务器时间是否准确 |

### 7.2 权限不足

**症状：**
- 接口返回 403 Forbidden
- 错误信息："Permission denied" 或 "Insufficient role"

**排查：**
1. 确认用户角色（BOSS / DOCTOR / NURSE / RECEPTIONIST 等）
2. 检查接口要求的角色（`@Roles()` 装饰器）
3. 检查资源所有权（resource-owner 守卫）

**相关文件：**
- `src/common/guards/roles.guard.ts` - 角色守卫
- `src/common/guards/resource-owner.guard.ts` - 资源所有者守卫
- `src/common/constants/roles.ts` - 角色定义

### 7.3 登录失败

**症状：**
- 用户名或密码错误
- 账号被锁定
- 验证码错误

**排查：**
```bash
# 1. 检查用户是否存在
# 使用 sqlite3 直接查询
sqlite3 /path/to/data/dental.sqlite "SELECT id, username, isActive FROM User WHERE username='admin';"

# 2. 检查登录失败次数
# 超过 5 次会锁定 30 分钟（见 LOGIN_MAX_ATTEMPTS）
```

**重置密码：**
```bash
# 使用内置的密码重置 CLI
npm run reset-password -- <username> <new-password>
```

**解锁账号：**
```sql
-- 手动清除登录失败计数
UPDATE User SET loginAttempts = 0, lockedUntil = NULL WHERE username = 'admin';
```

---

## 8. 网络问题

### 8.1 连接超时

**症状：**
- 请求长时间无响应后超时
- 浏览器显示 "连接超时"
- curl 返回 "Connection timed out"

**排查步骤：**

```bash
# 1. 检查服务器是否可达
ping server-ip

# 2. 检查端口是否开放
telnet server-ip 3001
# 或
nc -zv server-ip 3001

# 3. 检查防火墙规则
iptables -L -n  # Linux
# Windows: 检查 Windows 防火墙高级设置

# 4. 检查服务是否在监听
netstat -tlnp | grep 3001
```

**常见原因：**
- 防火墙未开放端口
- 服务未启动或已崩溃
- 网络不通（路由问题）
- 安全组配置错误（云服务器）

### 8.2 DNS 问题

**症状：**
- 域名无法解析
- `getaddrinfo ENOTFOUND` 错误

**排查：**
```bash
# 1. 测试 DNS 解析
nslookup api.example.com
dig api.example.com

# 2. 使用 IP 直连测试
curl http://<ip-address>:3001/health

# 3. 检查 /etc/hosts (Linux) 或 hosts 文件 (Windows)
# C:\Windows\System32\drivers\etc\hosts
```

**解决方案：**
- 检查域名 DNS 配置是否正确
- 临时修改 hosts 文件进行验证
- 更换 DNS 服务器（如 8.8.8.8）

### 8.3 CORS 问题

**症状：**
- 浏览器控制台显示 CORS 错误
- 预检请求（OPTIONS）失败
- 前端能发请求但拿不到响应

**排查：**
```bash
# 测试 CORS 预检请求
curl -i -X OPTIONS http://localhost:3001/api/v1/patients \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET"

# 检查响应头是否包含：
# Access-Control-Allow-Origin
# Access-Control-Allow-Methods
# Access-Control-Allow-Credentials
```

**常见原因及解决：**

| 原因 | 解决方案 |
|------|----------|
| 前端域名不在 CORS_ORIGIN 列表 | 在 .env 中添加域名 |
| 生产环境未配置 CORS_ORIGIN | 必须显式配置，不能留空 |
| 携带 Cookie 但未开启 credentials | 确保 `credentials: true` |
| 自定义 Header 未在允许列表 | 根据需要配置 |

**配置示例：**
```bash
# .env 文件
CORS_ORIGIN=https://app.example.com,https://admin.example.com
```

---

## 9. 故障报告模板

### 9.1 故障时间线

```
故障开始时间：YYYY-MM-DD HH:MM:SS
发现时间：    YYYY-MM-DD HH:MM:SS
开始排查时间：YYYY-MM-DD HH:MM:SS
定位时间：    YYYY-MM-DD HH:MM:SS
修复时间：    YYYY-MM-DD HH:MM:SS
完全恢复时间：YYYY-MM-DD HH:MM:SS
总持续时间：  X 小时 X 分钟
```

### 9.2 影响范围

| 项 | 详情 |
|----|------|
| 影响业务 | （如：患者挂号、收费、预约） |
| 影响用户数 | （估算） |
| 影响诊所 | （所有/特定诊所） |
| 严重程度 | P0 / P1 / P2 / P3 |
| 数据丢失 | 有 / 无 / 待确认 |

### 9.3 根本原因

**直接原因：**
（描述直接导致故障的技术原因）

**根本原因：**
（描述更深层的原因，如架构设计、流程缺失、监控不足等）

**触发条件：**
（描述什么操作或事件触发了故障）

### 9.4 解决方案

**临时恢复措施：**
（为快速恢复业务采取的操作）

**根本修复方案：**
（彻底解决问题的方案）

**执行步骤：**
1. 步骤 1
2. 步骤 2
3. ...

### 9.5 预防措施

| 措施 | 负责人 | 截止时间 | 状态 |
|------|--------|----------|------|
| 添加监控告警 | （姓名） | YYYY-MM-DD | 待开始 |
| 代码修复与优化 | （姓名） | YYYY-MM-DD | 待开始 |
| 补充测试用例 | （姓名） | YYYY-MM-DD | 待开始 |
| 更新运维文档 | （姓名） | YYYY-MM-DD | 待开始 |
| 演练灾备方案 | （姓名） | YYYY-MM-DD | 待开始 |

---

## 附录：快速排查清单

### 服务不可用时快速检查

```bash
# 1. 进程是否存活
ps aux | grep "node.*main.js"

# 2. 端口是否监听
netstat -tlnp | grep 3001

# 3. 健康检查
curl -s http://localhost:3001/health

# 4. 最近的错误日志
tail -n 100 /path/to/data/logs/app-$(date +%Y-%m-%d).log | grep '"level":"error"'

# 5. 磁盘空间
df -h

# 6. 内存使用
free -m

# 7. 数据库文件
ls -lh /path/to/data/dental.sqlite*
```

### 信息收集清单

排查问题时，请先收集以下信息：

1. **问题描述：** 什么操作、出现什么现象
2. **影响范围：** 哪些功能、哪些用户、持续多久
3. **复现步骤：** 能否稳定复现，操作步骤
4. **错误信息：** 完整的错误提示、错误码
5. **Trace ID：** 请求的 traceId（从响应头或日志中获取）
6. **环境信息：** 生产/测试、版本号、部署方式
7. **最近变更：** 最近是否有发布、配置变更、数据迁移
8. **日志片段：** 相关时间段的错误日志
