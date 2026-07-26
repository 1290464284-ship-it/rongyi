# 监控告警指南

## 1. 监控体系总览

### 1.1 监控分层

本系统采用三层监控架构，从基础设施到业务应用全面覆盖：

| 层级 | 监控对象 | 监控目的 |
|------|----------|----------|
| 基础设施层 | CPU、内存、磁盘、网络、操作系统 | 确保硬件和系统层面稳定运行 |
| 应用层 | 服务状态、请求量、响应时间、错误率、资源使用 | 确保 API 服务正常提供能力 |
| 业务层 | 患者数、收费额、预约数、库存预警 | 确保业务流程正常运转 |

### 1.2 监控工具栈

| 工具 | 用途 | 部署方式 |
|------|------|----------|
| 内置 Metrics 模块 | 应用指标采集（Prometheus 格式） | 应用内置，`/metrics` 端点 |
| Sentry | 错误追踪与性能监控 | 第三方 SaaS 或自建 |
| 内置 AlertService | 系统告警管理 | 应用内置，数据库存储 |
| 健康检查端点 | 服务存活探测 | `/health`、`/health/info`、`/health/detail` |
| ELK / Loki | 日志聚合与分析 | 可选，外部部署 |
| Prometheus + Grafana | 指标存储与可视化 | 可选，外部部署 |

---

## 2. 应用监控指标

### 2.1 系统指标

通过 `/health/info` 和 `/metrics` 端点可获取以下系统指标：

| 指标名 | 类型 | 说明 |
|--------|------|------|
| `nodejs_heap_used_bytes` | Gauge | 已使用堆内存（字节） |
| `nodejs_heap_total_bytes` | Gauge | 总堆内存（字节） |
| `nodejs_rss_bytes` | Gauge | 常驻内存集（字节） |
| `nodejs_external_bytes` | Gauge | 外部内存（字节） |
| `nodejs_event_loop_delay_ms` | Gauge | 事件循环延迟（毫秒） |
| `http_active_requests` | Gauge | 当前活跃请求数 |

**查看命令：**
```bash
# 查看应用基本信息和内存使用
curl http://localhost:3001/health/info

# 查看完整 Prometheus 格式指标
curl http://localhost:3001/metrics
```

### 2.2 应用指标

| 指标名 | 类型 | 标签 | 说明 |
|--------|------|------|------|
| `http_requests_total` | Counter | method, path, status_code | HTTP 请求总数 |
| `http_request_duration_ms` | Histogram | method, path | HTTP 请求耗时分布（毫秒） |
| `db_queries_total` | Counter | operation | 数据库查询总数 |
| `db_connections_total` | Counter | - | 数据库连接总数 |

**分桶配置：**
- `http_request_duration_ms` 分桶：5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ms

### 2.3 业务指标

| 指标名 | 类型 | 说明 |
|--------|------|------|
| `business_patients_total` | Gauge | 患者总数 |
| `business_appointments_total` | Gauge | 预约总数 |
| `business_revenue_total_cents` | Gauge | 总营收（分） |

**更新机制：** 业务指标通过 `MetricsService.setBusinessMetrics()` 方法定期更新，可结合定时任务实现。

### 2.4 数据库指标

数据库使用 SQLite (better-sqlite3)，相关监控：

| 指标 | 获取方式 | 说明 |
|------|----------|------|
| 慢查询日志 | 应用日志（WARN 级别） | 超过 100ms 的查询自动记录 |
| 数据库大小 | `/health/detail` | 数据库文件及 WAL 文件大小 |
| 连接数 | `db_connections_total` | 数据库连接计数 |
| 表记录数 | `/health/detail` | 各表记录数统计 |
| WAL 检查点 | 每分钟自动执行 | PASSIVE 模式检查点 |

**慢查询阈值：** 100ms（定义于 `src/db/db.service.ts:8`）

---

## 3. 告警策略

### 3.1 告警级别

| 级别 | 名称 | 响应时间 | 示例场景 |
|------|------|----------|----------|
| P0 | 紧急（Critical） | 立即响应（5分钟内） | 服务宕机、数据库不可用、数据丢失 |
| P1 | 严重（Error） | 30分钟内响应 | 接口大面积报错、性能严重下降、磁盘空间不足 |
| P2 | 警告（Warning） | 2小时内响应 | 单个接口异常、内存使用率偏高、备份超时 |
| P3 | 提示（Info） | 工作日内处理 | 配置变更提醒、非关键指标异常 |

**内置告警级别（AlertService）：**
- `INFO` - 信息提示
- `WARNING` - 警告
- `ERROR` - 错误
- `CRITICAL` - 严重

对应关系：P0 → CRITICAL，P1 → ERROR，P2 → WARNING，P3 → INFO

### 3.2 告警阈值建议

#### 基础设施

| 指标 | P2 阈值 | P1 阈值 | P0 阈值 | 持续时间 |
|------|---------|---------|---------|----------|
| CPU 使用率 | > 70% | > 85% | > 95% | 5分钟 |
| 内存使用率 | > 75% | > 85% | > 95% | 5分钟 |
| 磁盘剩余空间 | < 20% | < 10% | < 5% | 立即 |
| 磁盘剩余空间（绝对） | < 5GB | < 2GB | < 1GB | 立即 |

#### 应用

| 指标 | P2 阈值 | P1 阈值 | P0 阈值 | 持续时间 |
|------|---------|---------|---------|----------|
| HTTP 错误率（5xx） | > 5% | > 10% | > 30% | 1分钟 |
| 平均响应时间 | > 500ms | > 1s | > 3s | 5分钟 |
| 慢请求比例 | > 10% | > 20% | > 40% | 5分钟 |
| 事件循环延迟 | > 100ms | > 500ms | > 1000ms | 1分钟 |
| 活跃请求数 | > 100 | > 200 | > 500 | 1分钟 |

#### 数据库

| 指标 | P2 阈值 | P1 阈值 | P0 阈值 | 持续时间 |
|------|---------|---------|---------|----------|
| 慢查询频率 | > 10次/分钟 | > 50次/分钟 | > 100次/分钟 | 5分钟 |
| 数据库大小增长 | 日增 > 10% | 日增 > 30% | - | 每日 |
| WAL 文件大小 | > 100MB | > 500MB | > 1GB | 立即 |

#### 业务

| 指标 | P2 阈值 | P1 阈值 | P0 阈值 | 说明 |
|------|---------|---------|---------|------|
| 日预约数同比 | 下降 > 30% | 下降 > 50% | - | 与昨日/上周同期比较 |
| 日收费额同比 | 下降 > 30% | 下降 > 50% | - | 与昨日/上周同期比较 |
| 库存预警项数 | > 10项 | > 30项 | - | 低于安全库存的物料数 |

### 3.3 告警收敛和静默规则

**告警收敛：**
- 同一告警 5 分钟内重复触发，只发送一次通知
- 连续失败达到阈值（默认 3 次）自动升级级别
- 同类告警按维度聚合（如同一接口的多个错误）

**静默规则：**
- 计划内维护可设置静默窗口
- 已知问题可临时静默（最长 24 小时）
- P0 级告警不可静默，只能确认

**内置连续失败升级机制：**
- `AlertService.recordFailure()` 自动跟踪连续失败次数
- 连续失败达到 3 次自动从 ERROR 升级为 CRITICAL
- 成功后自动重置计数器（`recordSuccess()`）

---

## 4. Prometheus 指标接入

### 4.1 /metrics 端点说明

**端点地址：** `GET /metrics`

**认证方式：** 公开访问（`@Public()` 装饰器），建议通过反向代理限制访问

**响应格式：** Prometheus 文本格式（`text/plain; version=0.0.4`）

**重置端点：** `GET /metrics/reset`（需要 BOSS 角色）

### 4.2 核心指标列表

#### Counter 类型

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/v1/patients",status_code="200"} 1234

# HELP db_queries_total Total database queries
# TYPE db_queries_total counter
db_queries_total{operation="SELECT"} 5678

# HELP db_connections_total Total database connections
# TYPE db_connections_total counter
db_connections_total 1
```

#### Histogram 类型

```
# HELP http_request_duration_ms HTTP request duration in milliseconds
# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{method="GET",path="/api/v1/patients",le="50"} 100
http_request_duration_ms_bucket{method="GET",path="/api/v1/patients",le="100"} 150
http_request_duration_ms_bucket{method="GET",path="/api/v1/patients",le="250"} 180
http_request_duration_ms_bucket{method="GET",path="/api/v1/patients",le="500"} 195
http_request_duration_ms_bucket{method="GET",path="/api/v1/patients",le="+Inf"} 200
http_request_duration_ms_sum{method="GET",path="/api/v1/patients"} 25000
http_request_duration_ms_count{method="GET",path="/api/v1/patients"} 200
```

#### Gauge 类型

```
# HELP http_active_requests Number of active HTTP requests
# TYPE http_active_requests gauge
http_active_requests 15

# HELP nodejs_heap_used_bytes Used heap size in bytes
# TYPE nodejs_heap_used_bytes gauge
nodejs_heap_used_bytes 52428800

# HELP nodejs_event_loop_delay_ms Event loop delay in milliseconds
# TYPE nodejs_event_loop_delay_ms gauge
nodejs_event_loop_delay_ms 5.23

# HELP business_patients_total Total number of patients
# TYPE business_patients_total gauge
business_patients_total 1250

# HELP business_revenue_total_cents Total revenue in cents
# TYPE business_revenue_total_cents gauge
business_revenue_total_cents 12500000
```

### 4.3 Grafana 看板配置建议

#### 推荐面板布局

**行1：服务概览**
- 服务状态（健康检查结果）
- 请求量 QPS 折线图
- 错误率折线图
- 平均响应时间折线图

**行2：资源使用**
- CPU 使用率（通过 Node.js 指标或 node_exporter）
- 内存使用率（堆内存、RSS）
- 事件循环延迟
- 磁盘使用率

**行3：请求详情**
- 按路径的 Top 10 慢接口
- HTTP 状态码分布饼图
- 按方法的请求量分布
- 活跃请求数

**行4：数据库**
- 数据库文件大小趋势
- WAL 文件大小
- 慢查询数量
- 查询量 QPS

**行5：业务指标**
- 患者总数趋势
- 日预约数
- 日收费额
- 会员卡数量

#### Prometheus 配置示例

```yaml
scrape_configs:
  - job_name: 'dental-api'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['localhost:3001']
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
```

---

## 5. 日志监控

### 5.1 日志级别说明

| 级别 | 用途 | 生产环境默认开启 |
|------|------|-----------------|
| `debug` | 调试信息，详细的执行流程 | 否 |
| `info` | 一般信息，请求完成、操作记录 | 是 |
| `warn` | 警告信息，慢查询、异常但可恢复 | 是 |
| `error` | 错误信息，接口异常、操作失败 | 是 |

**配置方式：** 环境变量 `LOG_LEVEL`（默认 `info`）

```bash
# .env 中设置
LOG_LEVEL=debug
```

### 5.2 关键日志关键字

| 关键字 | 级别 | 说明 | 告警建议 |
|--------|------|------|----------|
| `Slow query` | WARN | 数据库慢查询 | P2（频繁时） |
| `Slow request` | WARN | HTTP 慢请求 | P2（频繁时） |
| `Unhandled Promise Rejection` | ERROR | 未处理的 Promise 异常 | P1 |
| `Uncaught Exception` | ERROR | 未捕获的异常 | P0 |
| `[BACKUP]` 失败 | ERROR | 备份失败 | P1 |
| `[DATABASE]` 错误 | ERROR | 数据库错误 | P1 |
| `Request completed` | INFO | 请求完成日志 | - |
| `[CRITICAL]` | ERROR | 严重告警 | P0 |

**日志格式（生产环境）：** JSON 格式，便于 ELK/Loki 解析

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "error",
  "traceId": "abc123def456",
  "message": "Database query failed",
  "context": "DbService",
  "userId": "user-001",
  "clinicId": "clinic-001",
  "data": {
    "errorMessage": "SQLITE_BUSY",
    "stack": "..."
  }
}
```

### 5.3 日志聚合配置

#### 日志文件位置

- 目录：`{DATA_DIR}/logs/`
- 命名格式：`app-YYYY-MM-DD.log`（轮转时为 `app-YYYY-MM-DD.N.log`）
- 单文件大小限制：50MB
- 每日最大文件数：10个
- 保留天数：30天

#### ELK 配置示例（Filebeat）

```yaml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/dental-data/logs/app-*.log
    json.keys_under_root: true
    json.add_error_key: true
    fields:
      service: dental-api
      environment: production

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "dental-api-logs-%{+yyyy.MM.dd}"
```

#### Loki 配置示例（Promtail）

```yaml
scrape_configs:
  - job_name: dental-api
    static_configs:
      - targets:
          - localhost
        labels:
          job: dental-api
          __path__: /var/dental-data/logs/app-*.log
          environment: production
    pipeline_stages:
      - json:
          expressions:
            level: level
            traceId: traceId
            context: context
      - labels:
          level:
          context:
```

---

## 6. 告警通知

### 6.1 通知渠道

| 渠道 | 适用级别 | 配置方式 |
|------|----------|----------|
| 系统内通知 | 所有级别 | 内置 AlertService，前端页面展示 |
| 邮件 | P1、P0 | 需配置 SMTP 服务 |
| 短信 | P0 | 需配置短信网关 |
| 飞书/钉钉机器人 | P1、P0 | Webhook 集成 |
| Sentry 告警 | Error 以上 | 配置 Sentry DSN 后自动上报 |

**Sentry 配置：**
```bash
# .env 中设置
SENTRY_DSN=https://your-sentry-dsn@o000000.ingest.sentry.io/000000
SENTRY_ENV=production
SENTRY_RELEASE=v1.0.0
```

### 6.2 值班机制

| 角色 | 职责 | 响应要求 |
|------|------|----------|
| 一线运维 | 日常巡检、告警确认、初步排查 | 工作日工作时间 15 分钟内响应 |
| 二线技术 | 深度排查、故障修复、升级处理 | 7x24 小时，30 分钟内响应 |
| 三线研发 | 代码级问题定位、紧急修复 | 工作时间 1 小时内响应 |

### 6.3 告警升级流程

```
告警触发
    ↓
一线确认（5分钟内）
    ↓
┌─ 能处理？─ 是 → 解决 → 记录归档
│    ↓ 否
│ 二线介入（30分钟内）
│    ↓
├─ 能处理？─ 是 → 解决 → 记录归档
│    ↓ 否
│ 三线介入（1小时内）
│    ↓
└─ 能处理？─ 是 → 解决 → 记录归档
         ↓ 否
    紧急会议 → 制定方案
```

**升级时间线（P0 告警）：**
- 0-5分钟：一线确认，启动应急流程
- 5-30分钟：二线介入，排查定位
- 30分钟未解决：三线介入，启动紧急预案
- 1小时未解决：通知管理层，启动业务连续性计划

---

## 7. 日常巡检清单

### 7.1 每日巡检项

| 序号 | 检查项 | 检查方法 | 正常标准 |
|------|--------|----------|----------|
| 1 | 服务存活状态 | `curl /health` | 返回 `status: ok` |
| 2 | 应用详细健康 | `curl /health/detail`（BOSS权限） | 所有检查项 ok |
| 3 | 错误日志检查 | 查看最近 24 小时 error 日志 | 无新增未知错误 |
| 4 | 慢查询检查 | 搜索 `Slow query` 日志 | 无频繁慢查询 |
| 5 | 备份状态 | 检查备份记录 | 24小时内有成功备份 |
| 6 | 磁盘空间 | `df -h` 或健康检查 | 剩余 > 20% |
| 7 | 内存使用 | 查看 `/metrics` 或进程监控 | 使用率 < 80% |
| 8 | 系统告警 | 查看系统告警列表 | 无未处理的 P1/P0 告警 |

**快速检查命令：**
```bash
# 检查服务状态
curl -s http://localhost:3001/health | jq .

# 检查最近的错误日志（Linux）
tail -n 100 /path/to/data/logs/app-$(date +%Y-%m-%d).log | grep '"level":"error"'

# Windows PowerShell
Get-Content "D:\dental-data\logs\app-$(Get-Date -Format 'yyyy-MM-dd').log" -Tail 100 | Select-String '"level":"error"'
```

### 7.2 每周巡检项

| 序号 | 检查项 | 检查方法 | 正常标准 |
|------|--------|----------|----------|
| 1 | 数据库完整性 | 运行 `db-consistency` 检查 | 所有检查通过 |
| 2 | 备份验证 | 恢复测试（或验证脚本） | 备份文件可正常恢复 |
| 3 | 性能趋势 | 查看一周指标趋势 | 无明显性能下降 |
| 4 | 磁盘趋势 | 对比一周磁盘使用量 | 增长率合理 |
| 5 | 错误统计 | 统计一周错误类型和数量 | 无新增高频错误 |
| 6 | 安全审计 | 检查操作日志、登录记录 | 无异常操作 |
| 7 | 日志清理 | 确认日志自动清理正常 | 30天前日志已清理 |

**数据库一致性检查：**
```bash
# 需要 BOSS 角色 Token
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/health/db-consistency
```

### 7.3 每月巡检项

| 序号 | 检查项 | 检查方法 | 正常标准 |
|------|--------|----------|----------|
| 1 | 容量规划 | 评估磁盘、内存、连接数容量 | 满足未来 3 个月需求 |
| 2 | 数据归档 | 检查历史数据量，评估归档需求 | 查询性能正常 |
| 3 | 安全检查 | 漏洞扫描、依赖安全更新 | 无高危漏洞 |
| 4 | 备份策略回顾 | 备份频率、保留周期、异地备份 | 符合业务要求 |
| 5 | 灾备演练 | 模拟故障恢复流程 | RTO/RPO 达标 |
| 6 | 性能优化 | 识别 Top N 慢查询并优化 | 关键查询 < 100ms |
| 7 | 告警回顾 | 调整告警阈值和规则 | 告警准确率 > 90% |

---

## 8. 附录：常用查询语句

### 8.1 PromQL 常用查询

#### 请求量

```promql
# 总 QPS（每秒请求数）
rate(http_requests_total[5m])

# 按路径的 QPS Top 10
topk(10, sum by (path) (rate(http_requests_total[5m])))

# 错误率（5xx 占比）
sum by (path) (rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum by (path) (rate(http_requests_total[5m]))
```

#### 响应时间

```promql
# 平均响应时间
rate(http_request_duration_ms_sum[5m])
/
rate(http_request_duration_ms_count[5m])

# 95 分位响应时间
histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))

# 99 分位响应时间
histogram_quantile(0.99, rate(http_request_duration_ms_bucket[5m]))
```

#### 资源使用

```promql
# 堆内存使用率
nodejs_heap_used_bytes / nodejs_heap_total_bytes

# 事件循环延迟
nodejs_event_loop_delay_ms

# 活跃请求数
http_active_requests
```

#### 数据库

```promql
# 查询 QPS
rate(db_queries_total[5m])

# 慢查询数（结合日志计数）
# 需要通过日志指标或自定义指标实现
```

### 8.2 SQL 查询慢查询

#### 查看慢查询日志

慢查询会以 WARN 级别写入应用日志，搜索关键字 `Slow query`：

```bash
# Linux
grep "Slow query" /path/to/data/logs/app-$(date +%Y-%m-%d).log | tail -20

# Windows PowerShell
Get-Content "D:\dental-data\logs\app-$(Get-Date -Format 'yyyy-MM-dd').log" |
  Select-String "Slow query" |
  Select-Object -Last 20
```

#### 表大小统计

```sql
-- 查看各表记录数（通过健康检查获取更方便）
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;

-- 逐个表统计
SELECT COUNT(*) FROM Patient;
SELECT COUNT(*) FROM Appointment;
SELECT COUNT(*) FROM Charge;
```

#### 数据库性能检查

```sql
-- 查看数据库版本
SELECT sqlite_version();

-- 查看当前 WAL 状态
PRAGMA journal_mode;

-- 查看缓存大小
PRAGMA cache_size;

-- 查看忙等待超时
PRAGMA busy_timeout;

-- 手动执行检查点
PRAGMA wal_checkpoint(TRUNCATE);

-- 查看数据库页大小
PRAGMA page_size;

-- 查看 freelist 页数
PRAGMA freelist_count;

-- 查看数据库大小（页数 * 页大小）
SELECT page_count * page_size AS total_bytes FROM pragma_page_count(), pragma_page_size();
```

#### 索引使用情况

```sql
-- 查看所有索引
SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name;

-- 使用 EXPLAIN QUERY PLAN 分析查询
EXPLAIN QUERY PLAN
SELECT * FROM Patient WHERE phone = '13800138000';

-- 查看表结构
PRAGMA table_info(Patient);
```

#### 常用维护语句

```sql
-- 分析表（更新查询优化器统计信息）
ANALYZE;

-- 重建数据库（碎片整理）
-- 注意：需要独占锁，可能需要较长时间
VACUUM;

-- 增量 vacuum（需要启用 auto_vacuum）
PRAGMA auto_vacuum(INCREMENTAL);
PRAGMA incremental_vacuum(100);

-- 检查数据库完整性
PRAGMA integrity_check;

-- 快速完整性检查
PRAGMA quick_check;
```
