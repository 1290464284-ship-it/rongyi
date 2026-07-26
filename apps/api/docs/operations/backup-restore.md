# 数据库备份与恢复指南

## 目录

1. [备份策略说明](#备份策略说明)
2. [手动备份步骤](#手动备份步骤)
3. [自动备份配置](#自动备份配置)
4. [恢复步骤](#恢复步骤)
5. [备份验证方法](#备份验证方法)
6. [备份清理策略](#备份清理策略)
7. [灾难恢复流程](#灾难恢复流程)
8. [常见问题](#常见问题)

---

## 备份策略说明

### 1. 备份方式

本项目使用 SQLite 数据库，提供两种备份方式：

- **应用内自动备份**：系统内置自动备份功能，每 24 小时执行一次，保留最近 7 个自动备份
- **命令行手动备份**：提供独立的备份脚本，支持自定义备份目录、保留策略、压缩等功能

### 2. 备份存储位置

- 默认数据库路径：`data/dental.sqlite`
- 默认备份目录：`backups/`
- 可通过环境变量 `DATA_DIR` 或 `DB_PATH` 自定义数据库位置

### 3. 备份文件命名

- 应用内备份：`dental-YYYY-MM-DDTHH-MM-SS.sssZ.sqlite`
- 命令行备份：`backup-YYYYMMDD-HHmmss.sqlite`
- 压缩备份：`backup-YYYYMMDD-HHmmss.sqlite.gz`

### 4. 备份内容

备份文件包含完整的 SQLite 数据库，包括：
- 所有业务数据
- 系统配置
- 用户数据
- 审计日志
- 备份记录

---

## 手动备份步骤

### 使用 npm 命令

```bash
# 基本备份（使用默认配置）
npm run backup

# 查看备份列表
npm run backup:verify

# 清理旧备份（保留最近 30 个）
npm run backup:cleanup
```

### 使用原始脚本

```bash
# 进入项目目录
cd apps/api

# 基本备份
node scripts/backup/backup.js

# 指定数据库路径和备份目录
node scripts/backup/backup.js --db-path ./data/dental.sqlite --backup-dir ./my-backups

# 保留最近 50 个备份
node scripts/backup/backup.js --keep 50

# 启用 gzip 压缩
node scripts/backup/backup.js --compress

# 查看帮助
node scripts/backup/backup.js --help
```

### 备份验证

备份完成后会自动进行以下验证：

1. **文件完整性检查**：验证文件大小大于 0
2. **数据库完整性检查**：执行 `PRAGMA integrity_check`
3. **表结构验证**：确认所有用户表存在
4. **记录统计**：统计总记录数
5. **元数据记录**：生成 `backup-meta.json`

---

## 自动备份配置

### 应用内自动备份

应用内置自动备份功能，默认配置：

- 备份间隔：每 24 小时
- 验证间隔：每 12 小时
- 保留数量：最近 7 个自动备份
- 手动备份保留：30 天
- 备份目录最大大小：500MB

配置常量位于 `src/config/constants.ts`：

```typescript
BACKUP_AUTO_INTERVAL_MS      // 自动备份间隔
BACKUP_VERIFY_INTERVAL_MS    // 自动验证间隔
BACKUP_MAX_AUTO_BACKUPS      // 最大自动备份数
BACKUP_MANUAL_RETENTION_DAYS // 手动备份保留天数
BACKUP_MAX_DIR_BYTES         // 备份目录最大大小
```

### 系统级定时任务（cron）

如需在系统层面配置定时备份，可使用 cron：

#### Linux / macOS

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 2 点执行备份
0 2 * * * cd /path/to/project/apps/api && /usr/bin/node scripts/backup/backup.js >> /var/log/backup.log 2>&1

# 每周日凌晨 3 点清理旧备份
0 3 * * 0 cd /path/to/project/apps/api && /usr/bin/node scripts/backup/cleanup.js --keep 30 >> /var/log/backup-cleanup.log 2>&1
```

#### Windows 任务计划程序

1. 打开"任务计划程序"
2. 创建基本任务
3. 设置触发器（每天凌晨 2 点）
4. 设置操作：启动程序
   - 程序：`node`
   - 参数：`scripts\backup\backup.js`
   - 起始于：`D:\path\to\project\apps\api`

### 使用 Docker 环境

如使用 Docker 部署，可在容器内配置 cron 或使用外部调度器。

---

## 恢复步骤

> ⚠️ **重要警告**：
> - 恢复操作将覆盖当前数据库
> - 恢复前务必停止应用服务
> - 恢复脚本会自动备份当前数据库

### 准备工作

1. **停止应用服务**：确保没有进程正在访问数据库
2. **确认备份文件**：验证要恢复的备份文件存在且完整

### 使用恢复脚本

```bash
# 查看可用备份
npm run backup:verify

# 恢复指定备份（需要确认）
node scripts/backup/restore.js --backup-file backup-20240101-120000.sqlite

# 跳过确认提示（脚本模式）
node scripts/backup/restore.js --backup-file backup-20240101-120000.sqlite -y

# 指定数据库路径
node scripts/backup/restore.js --db-path ./data/dental.sqlite --backup-file backup-20240101-120000.sqlite

# 恢复压缩备份
node scripts/backup/restore.js --backup-file backup-20240101-120000.sqlite.gz
```

### 手动恢复

如需手动恢复，按以下步骤操作：

```bash
# 1. 停止应用服务
# （根据实际部署方式停止服务）

# 2. 备份当前数据库（以防万一）
cp data/dental.sqlite data/dental.sqlite.bak-$(date +%Y%m%d%H%M%S)

# 3. 解压备份（如果是压缩文件）
gunzip backups/backup-20240101-120000.sqlite.gz

# 4. 复制备份文件到数据库位置
cp backups/backup-20240101-120000.sqlite data/dental.sqlite

# 5. 验证数据库完整性
sqlite3 data/dental.sqlite "PRAGMA integrity_check;"

# 6. 启动应用服务
```

### 恢复后验证

恢复完成后，请执行以下验证：

1. **数据库完整性检查**
   ```bash
   node scripts/backup/verify.js --backup-file data/dental.sqlite
   ```

2. **启动应用并检查**
   - 确认服务正常启动
   - 检查关键功能是否正常
   - 验证数据完整性

3. **应用内验证**
   - 登录系统
   - 检查患者、收费等关键数据
   - 执行一次完整的健康检查

---

## 备份验证方法

### 列出所有备份

```bash
# 文本格式
npm run backup:verify

# 或使用原始命令
node scripts/backup/verify.js --list

# JSON 格式输出
node scripts/backup/verify.js --list --output json
```

### 验证单个备份

```bash
# 验证指定备份文件
node scripts/backup/verify.js --backup-file backup-20240101-120000.sqlite

# 验证最新备份
node scripts/backup/verify.js

# JSON 格式输出
node scripts/backup/verify.js --backup-file backup-20240101-120000.sqlite --output json
```

### 验证内容

验证脚本会检查以下项目：

| 检查项 | 说明 |
|--------|------|
| 文件存在性 | 确认备份文件存在 |
| 文件大小 | 确认文件大小大于 0 |
| 完整性检查 | 执行 `PRAGMA integrity_check` |
| 表数量 | 统计用户表数量 |
| 关键表检查 | 验证 User、Patient、Charge、Appointment 等核心表存在 |
| 记录总数 | 统计所有表的总记录数 |

### 应用内备份验证

通过 API 或管理界面也可以验证备份：

- 进入系统设置 → 备份管理
- 查看备份列表和状态
- 点击"验证"按钮检查特定备份

---

## 备份清理策略

### 自动清理

备份脚本在每次备份后会自动执行清理，保留指定数量的最新备份。

### 手动清理

```bash
# 按数量保留（默认 30 个）
npm run backup:cleanup

# 保留最近 50 个备份
node scripts/backup/cleanup.js --keep 50

# 按天数保留（保留最近 30 天）
node scripts/backup/cleanup.js --keep-days 30

# 试运行（查看将删除哪些文件，不实际删除）
node scripts/backup/cleanup.js --dry-run --keep 10

# 指定备份目录
node scripts/backup/cleanup.js --backup-dir ./my-backups --keep-days 7
```

### 清理规则

| 规则类型 | 命令 | 说明 |
|---------|------|------|
| 按数量 | `--keep N` | 保留最近 N 个备份 |
| 按天数 | `--keep-days N` | 保留最近 N 天内的备份 |

### 应用内清理策略

应用内置的自动清理策略：

- **自动备份**：保留最近 7 个
- **手动备份**：保留最近 30 天
- **目录大小限制**：最大 500MB，超限自动清理最旧备份
- **孤儿文件清理**：清理数据库中无记录的备份文件

---

## 灾难恢复流程

### 场景 1：数据库损坏

**症状**：
- 应用无法启动
- 数据库报错 "database disk image is malformed"
- `PRAGMA integrity_check` 返回错误

**恢复步骤**：

1. 立即停止应用服务
2. 重命名损坏的数据库（保留现场）
   ```bash
   mv data/dental.sqlite data/dental.sqlite.corrupted
   ```
3. 从最近的有效备份恢复
   ```bash
   node scripts/backup/verify.js --list
   node scripts/backup/restore.js --backup-file backup-xxxxxx.sqlite -y
   ```
4. 验证恢复后的数据库
5. 启动应用并验证功能
6. 调查损坏原因

### 场景 2：误删除数据

**症状**：
- 重要数据被误删除
- 需要回退到某个时间点

**恢复步骤**：

1. 停止应用服务
2. 备份当前数据库（保留最新数据）
   ```bash
   node scripts/backup/backup.js --backup-dir ./recovery-temp
   ```
3. 恢复到误删除前的备份
   ```bash
   node scripts/backup/restore.js --backup-file backup-before-delete.sqlite -y
   ```
4. 导出需要的数据
5. 如有需要，可考虑部分数据恢复

### 场景 3：服务器故障

**症状**：
- 服务器硬件故障
- 系统无法启动
- 数据存储介质损坏

**恢复步骤**：

1. 在新服务器上部署应用环境
2. 从异地备份（如有）或最新备份恢复数据
3. 配置应用并启动服务
4. 完整验证所有功能

### 定期演练

建议每季度进行一次备份恢复演练，确保：
- 备份文件完整可用
- 恢复流程顺畅
- 团队成员熟悉操作步骤

---

## 常见问题

### Q1: 备份时数据库正在使用，会有问题吗？

**A:** 备份脚本使用 better-sqlite3 的备份 API（优先）或先执行 WAL checkpoint 再复制文件，能保证数据的一致性快照。但仍建议在业务低峰期进行备份。

### Q2: 备份文件可以直接用 sqlite3 打开吗？

**A:** 命令行脚本生成的备份文件可以直接用 sqlite3 打开。但应用内备份的文件可能经过加密，需要通过应用内的恢复功能进行恢复。

### Q3: 如何异地备份？

**A:** 可以通过以下方式实现异地备份：
1. 设置 `BACKUP_REMOTE_DIR` 环境变量，应用内自动备份会同步到该目录
2. 使用 rsync 同步备份目录到远程服务器
3. 使用云存储客户端同步备份文件
4. 配置 cron 定期上传备份到对象存储

### Q4: 备份文件太大怎么办？

**A:** 可以采取以下措施：
1. 使用 `--compress` 参数启用 gzip 压缩
2. 适当减少保留数量
3. 定期执行 `VACUUM` 优化数据库
4. 归档历史数据

### Q5: 如何验证备份是完整的？

**A:** 使用验证脚本：
```bash
node scripts/backup/verify.js --backup-file backup-xxx.sqlite
```
验证通过 `integrity_check` 说明数据库文件结构完整。建议恢复后再进行业务数据抽样验证。

### Q6: 应用内备份和命令行备份有什么区别？

| 特性 | 应用内备份 | 命令行备份 |
|------|-----------|-----------|
| 触发方式 | 自动 / API / 界面 | 命令行 / cron |
| 备份加密 | 是（默认加密） | 否（默认不加密） |
| 备份记录 | 写入数据库 | 写入 backup-meta.json |
| 多租户支持 | 支持（按诊所隔离） | 单库备份 |
| 审计日志 | 有 | 无 |
| 适用场景 | 日常自动备份 | 运维操作、迁移 |

### Q7: 恢复失败怎么办？

**A:** 按以下顺序排查：
1. 检查备份文件是否完整
2. 检查磁盘空间是否充足
3. 检查文件权限是否正确
4. 确认 better-sqlite3 可用
5. 查看错误日志定位具体问题
6. 尝试更早的备份文件

### Q8: 如何监控备份状态？

**A:** 可以通过以下方式：
- 查看应用日志中的备份相关日志
- 检查 `backup-meta.json` 中的备份记录
- 配置告警通知（应用内的 AlertService）
- 使用监控系统检查备份目录的文件变化

---

## 相关文件

- 备份脚本：`scripts/backup/backup.js`
- 验证脚本：`scripts/backup/verify.js`
- 清理脚本：`scripts/backup/cleanup.js`
- 恢复脚本：`scripts/backup/restore.js`
- 备份服务：`src/modules/system/backups/`
- 数据库配置：`src/db/paths.ts`
- 常量配置：`src/config/constants.ts`
