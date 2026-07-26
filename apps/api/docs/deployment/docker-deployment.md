# Docker 部署指南

本文档介绍如何使用 Docker 和 Docker Compose 部署牙科诊所管理系统 API 服务。

## 目录

1. [快速开始](#快速开始)
2. [docker-compose 配置说明](#docker-compose-配置说明)
3. [环境变量配置](#环境变量配置)
4. [数据持久化](#数据持久化)
5. [备份与恢复](#备份与恢复)
6. [升级指南](#升级指南)
7. [常见问题](#常见问题)

---

## 快速开始

### 前置要求

- Docker 20.10+
- Docker Compose v2.0+
- 至少 2GB 可用内存
- 至少 5GB 可用磁盘空间

### 一键启动

```bash
# 克隆项目
git clone <repository-url>
cd source

# 生成密钥（重要！生产环境必须修改）
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 启动服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f api
```

### 验证部署

服务启动后，可以通过以下方式验证：

```bash
# 健康检查
curl http://localhost:3001/api/v1/health

# 预期返回：{"status":"ok"}
```

API 文档（非生产环境）：http://localhost:3001/api/docs

---

## docker-compose 配置说明

### 服务列表

| 服务名 | 端口 | 说明 |
|--------|------|------|
| api | 3001 | NestJS API 服务 |

### 主要配置项

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: dental-clinic-api
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - dental-data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "..."]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

### 配置详解

#### restart 策略

- `unless-stopped`：容器退出时自动重启，除非手动停止
- 其他可选值：`no`、`always`、`on-failure`

#### 端口映射

```yaml
ports:
  - "3001:3001"  # 主机端口:容器端口
```

如需修改外部访问端口，只需修改左边的端口号：

```yaml
ports:
  - "8080:3001"  # 外部通过 8080 访问
```

#### 健康检查

- **interval**: 检查间隔（默认 30 秒）
- **timeout**: 超时时间（默认 10 秒）
- **retries**: 重试次数（默认 3 次）
- **start_period**: 启动宽限期（默认 15 秒）

---

## 环境变量配置

### 必需配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `JWT_SECRET` | JWT 签名密钥，至少 32 位随机字符串 | - |
| `ENCRYPTION_KEY` | 数据加密密钥，64 位十六进制字符串 | - |
| `CORS_ORIGIN` | 允许的前端域名，逗号分隔 | http://localhost:3000,http://localhost:5173 |

### 生成密钥

```bash
# 生成 JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 生成 ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 创建 .env 文件

在 docker-compose.yml 同级目录创建 `.env` 文件：

```env
# .env
JWT_SECRET=your-jwt-secret-key-at-least-32-characters-long
ENCRYPTION_KEY=your-64-character-hex-encryption-key-000000000000000000000000
CORS_ORIGIN=https://your-domain.com
NODE_ENV=production
PORT=3001
```

### 完整环境变量列表

#### 安全与认证

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `JWT_SECRET` | - | JWT 签名密钥（必填） |
| `JWT_EXPIRES_IN` | 7d | JWT 令牌过期时间 |
| `ENCRYPTION_KEY` | - | 数据加密密钥（生产环境必填） |
| `BCRYPT_ROUNDS` | 10 | bcrypt 密码哈希轮数 |

#### 服务器配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `NODE_ENV` | development | 运行环境（development/production/test） |
| `PORT` | 3001 | API 服务监听端口 |
| `CORS_ORIGIN` | - | CORS 允许的前端域名（生产环境必填） |
| `TRUST_PROXY` | 0 | 是否信任反向代理 |

#### 数据存储

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DATA_DIR` | ./data | 数据存储根目录 |
| `DB_PATH` | - | SQLite 数据库文件完整路径 |

#### SQLite 性能调优

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SQLITE_BUSY_TIMEOUT_MS` | 5000 | 数据库忙等待超时时间（毫秒） |
| `SQLITE_CACHE_SIZE` | -50000 | 页面缓存大小（约 50MB） |
| `SQLITE_JOURNAL_MODE` | WAL | 日志模式 |
| `SQLITE_SYNCHRONOUS` | NORMAL | 磁盘同步级别 |
| `SQLITE_TEMP_STORE` | MEMORY | 临时表存储位置 |
| `SQLITE_MMAP_SIZE` | 268435456 | mmap 大小（256MB） |
| `SQLITE_WAL_AUTOCHECKPOINT` | 1000 | WAL 自动检查点阈值 |

#### 备份配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `BACKUP_REMOTE_DIR` | - | 异地备份目录 |

#### 错误监控

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SENTRY_DSN` | - | Sentry DSN（留空不启用） |
| `SENTRY_ENV` | - | Sentry 环境标识 |
| `SENTRY_RELEASE` | - | Sentry 版本号 |

---

## 数据持久化

### 数据卷

Docker Compose 配置了名为 `dental-data` 的命名卷，用于持久化存储：

```yaml
volumes:
  dental-data:
    name: dental-clinic-data
```

### 数据内容

数据卷中包含以下重要文件：

| 文件/目录 | 说明 |
|-----------|------|
| `dental.sqlite` | 主数据库文件 |
| `dental.sqlite-wal` | WAL 日志文件 |
| `dental.sqlite-shm` | 共享内存文件 |
| `.env` | 自动生成的环境变量文件 |
| `backups/` | 备份文件目录 |
| `logs/` | 日志文件目录 |

### 查看数据卷位置

```bash
# 查看数据卷详情
docker volume inspect dental-clinic-data

# 查看数据卷中的文件
docker run --rm -v dental-clinic-data:/data alpine ls -la /data
```

### 使用主机目录挂载（可选）

如需将数据存储在主机指定目录，可修改 docker-compose.yml：

```yaml
services:
  api:
    volumes:
      - /path/to/your/data:/app/data
```

---

## 备份与恢复

### 手动备份

```bash
# 方法1：使用 API 备份接口（需要管理员权限）
curl -X POST http://localhost:3001/api/v1/backups \
  -H "Authorization: Bearer <your-token>"

# 方法2：直接复制数据库文件（确保服务已停止或使用备份接口）
docker-compose stop api
docker run --rm -v dental-clinic-data:/data -v $(pwd)/backups:/backup \
  alpine cp /data/dental.sqlite /backup/dental-$(date +%Y%m%d).sqlite
docker-compose start api
```

### 自动备份

系统内置自动备份功能，可通过环境变量配置备份策略。备份文件将存储在数据卷的 `backups/` 目录中。

### 数据恢复

```bash
# 1. 停止服务
docker-compose stop api

# 2. 恢复数据库文件
docker run --rm -v dental-clinic-data:/data -v $(pwd)/backups:/backup \
  alpine cp /backup/dental-20240101.sqlite /data/dental.sqlite

# 3. 启动服务
docker-compose start api

# 4. 验证数据
curl http://localhost:3001/api/v1/health
```

### 备份最佳实践

1. **定期备份**：建议至少每天备份一次
2. **异地备份**：配置 `BACKUP_REMOTE_DIR` 或定期将备份文件复制到其他位置
3. **备份验证**：定期验证备份文件的完整性
4. **保留策略**：建议保留最近 30 天的备份
5. **加密备份**：重要数据建议加密存储

---

## 升级指南

### 升级前准备

1. **备份数据**：升级前务必备份数据库
2. **查看变更日志**：了解新版本的变化
3. **测试环境验证**：建议先在测试环境验证

### 升级步骤

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 备份数据
docker-compose stop api
docker run --rm -v dental-clinic-data:/data -v $(pwd)/backups:/backup \
  alpine sh -c "cp /data/dental.sqlite /backup/dental-pre-upgrade-$(date +%Y%m%d%H%M).sqlite"
docker-compose start api

# 3. 重新构建镜像
docker-compose build --no-cache

# 4. 重启服务
docker-compose up -d

# 5. 验证升级
docker-compose ps
curl http://localhost:3001/api/v1/health
```

### 回滚步骤

如升级失败，可按以下步骤回滚：

```bash
# 1. 停止服务
docker-compose down

# 2. 恢复旧版代码
git checkout <previous-version-tag>

# 3. 恢复数据库
docker run --rm -v dental-clinic-data:/data -v $(pwd)/backups:/backup \
  alpine cp /backup/dental-pre-upgrade-xxxxxx.sqlite /data/dental.sqlite

# 4. 重新构建并启动
docker-compose build
docker-compose up -d
```

---

## 常见问题

### 1. 容器启动失败

**问题**：容器启动后立即退出

**排查步骤**：
```bash
# 查看容器日志
docker-compose logs api

# 查看容器状态
docker-compose ps
```

**常见原因**：
- JWT_SECRET 或 ENCRYPTION_KEY 未配置
- 端口被占用
- 数据卷权限问题

### 2. 数据库连接失败

**问题**：健康检查返回 down

**排查步骤**：
```bash
# 查看日志
docker-compose logs api | grep -i error

# 检查数据卷权限
docker run --rm -v dental-clinic-data:/data alpine ls -la /data
```

### 3. 端口被占用

**问题**：启动时提示端口已被占用

**解决方法**：
修改 docker-compose.yml 中的端口映射：
```yaml
ports:
  - "3002:3001"  # 左边修改为未被占用的端口
```

### 4. 性能优化建议

- 确保使用 SSD 存储数据库文件
- 根据服务器内存调整 `SQLITE_CACHE_SIZE`
- 生产环境建议配置反向代理（Nginx）
- 启用 gzip 压缩
- 配置 HTTPS

### 5. 如何查看应用日志

```bash
# 查看实时日志
docker-compose logs -f api

# 查看最近 100 行日志
docker-compose logs --tail=100 api

# 查看错误日志
docker-compose logs api | grep -i error
```

### 6. 如何进入容器

```bash
# 进入正在运行的容器
docker-compose exec api sh

# 以 root 身份进入
docker-compose exec -u root api sh
```

### 7. 数据卷权限问题

如果遇到数据卷权限问题：

```bash
# 修复数据卷权限
docker run --rm -v dental-clinic-data:/data alpine \
  chown -R 1001:1001 /data
```

### 8. 如何修改环境变量

```bash
# 1. 修改 .env 文件或 docker-compose.yml
# 2. 重启服务
docker-compose up -d
```

---

## 相关文档

- [API 文档](../../README.md)
- [数据库设计](../database/database-design.md)
- [性能优化指南](../performance/optimization-guide.md)
