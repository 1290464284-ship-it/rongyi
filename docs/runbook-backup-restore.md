# Runbook：数据库备份恢复演练

> 首次演练日期：2026-07-29
> 演练环境：Windows 10 / Node.js 24 / better-sqlite3（隔离目录，未触碰生产数据）
> 结论：**备份 → 删库 → 恢复 → 验证 全流程通过，数据 100% 一致**

---

## 一、演练结果摘要

| 步骤 | 命令 | 耗时 | 结果 |
|------|------|------|------|
| 1. 准备测试库（生产结构 + seed） | `pnpm --filter @dental/api seed`（DB_PATH 指向隔离目录） | ~2.6s | 65 表 / 449 行 / integrity ok |
| 2. 执行备份 | `node scripts/backup/backup.js --db-path <db> --backup-dir <dir>` | 0.03s | 1.97MB，integrity ok，65 表 449 行 |
| 3. 模拟灾难 | 删除数据库文件（含 -wal/-shm） | — | 数据库完全丢失 |
| 4. 执行恢复 | `node scripts/backup/restore.js --backup-file <file> -y` | 0.15s | 恢复前后双重 integrity_check 均 ok |
| 5. 数据核对 | 逐表行数对比基线 | — | **零差异**（65 表、449 行、每表行数完全一致） |
| 6. 备份列表验证 | `pnpm --filter @dental/api backup:verify` | <1s | 备份文件标记"✓ 有效" |
| 7. 启动应用验证 | `pnpm dev`（DB_PATH 指向恢复后的库） | ~13s（含编译） | 正常启动，登录成功 |
| 8. db-consistency 检查 | `GET /api/v1/health/db-consistency`（BOSS 角色） | 9ms | 12 项检查全部执行；结构性检查（软删除/外键/clinicId/孤立记录）全部通过 |

> 说明：演练库约 2MB。真实诊所库更大时，备份/恢复耗时与文件大小近似线性（文件复制为主），预计百 MB 级库仍在秒级完成。

---

## 二、生产环境恢复步骤（照此执行）

前置知识：

- 生产数据库路径由 `DB_PATH` 环境变量决定；未设置时默认 `apps/api/data/dental.sqlite`（开发）或 Electron 数据目录（生产）
- 手动备份目录默认 `backups/`；应用内自动备份写入 `<数据目录>/backups/dental-<时间戳>.sqlite`（每 24h 一次，另有 `BACKUP_REMOTE_DIR` 异地副本）
- 恢复脚本会在覆盖前自动把当前库备份为 `<db>.restore-bak-<时间戳>`，失败可回滚

### 步骤

1. **停止应用服务**（Electron 退出应用 / 服务器停掉 API 进程）。恢复期间禁止任何进程持有数据库连接
2. **列出可用备份，确认要恢复的文件**：
   ```powershell
   cd apps/api
   node scripts/backup/verify.js --backup-dir <备份目录> --list
   ```
   只选择状态为"✓ 有效"的备份；优先选最近一次
3. **执行恢复**：
   ```powershell
   node scripts/backup/restore.js --db-path <生产库路径> --backup-dir <备份目录> --backup-file <备份文件名>
   ```
   交互式确认输入 `YES`（自动化场景加 `-y`）。脚本会自动：备份当前库 → 校验备份文件 integrity → 覆盖恢复 → 清理旧 -wal/-shm → 恢复后再次 integrity_check
4. **启动应用，业务验证**：
   - 登录成功
   - 患者列表 / 今日预约 / 收费单能正常打开，抽查几条近期数据
5. **运行一致性检查**（BOSS 账号登录后）：
   ```
   GET /api/v1/health/db-consistency
   ```
   重点关注结构性检查项：`soft_delete_foreign_key`、`clinic_id_consistency`、`orphan_records`、`soft_delete_cascade` 必须全为 ok
6. **确认无误后**，可删除脚本生成的 `*.restore-bak-*` 文件（建议保留 7 天再删）

### 回滚（恢复后发现不对）

```powershell
# 停止应用后，用预恢复备份覆盖回去
Copy-Item <db>.restore-bak-<时间戳> <db> -Force
Remove-Item <db>-wal, <db>-shm -ErrorAction SilentlyContinue
```

---

## 三、注意事项

1. **恢复前必须停应用**：SQLite 单文件库，进程持连接时覆盖文件会导致损坏
2. **gzip 备份可直接恢复**：`--backup-file xxx.sqlite.gz` 会自动解压后恢复
3. **恢复的是备份时点的数据**：备份之后产生的业务数据会丢失，恢复前与诊所确认可接受的数据损失窗口（自动备份间隔 24h，最坏丢 1 天）
4. **异地备份**：若本地备份目录损坏，检查 `BACKUP_REMOTE_DIR` 指向的异地目录，用其中的 `dental-<时间戳>.sqlite` 作为 `--backup-file`（可用绝对路径）

---

## 四、演练发现的问题（待修复清单）

1. ~~**`backup.transfer is not a function`**~~：已修复。`scripts/backup/backup.js` 与 `src/db/database.ts` 均改用 `await db.backup(path)` 的 Promise 路径，不再调用已失效的同步式 `backup.transfer(-1)`，回退路径仍保留 `copyFileSync` 作为兆底。
2. ~~**`idx_treatment_catalog_clinic_deleted_code` 索引创建失败**~~：已修复。新增 v28 迁移为 `TreatmentCatalog` 与 `MedicalRecordTemplate` 补齐 `deletedAt` 列（与项目软删除规范对齐），同步更新 schema 表定义。
3. **seed 工厂数据不满足业务一致性**：`seed:fresh` 生成的收费单（折扣后 totalAmount 与 items 合计不一致）、会员卡余额、库存数量未按业务不变量生成，导致 db-consistency 的金额类检查在演示数据上报 189 个 issue。不影响生产（生产数据由业务流程写入），但会干扰用演示数据做的一致性验证。建议 seed 工厂按不变量生成金额

---

## 五、演练复现方法（下次演练照此执行）

```powershell
# 全程在仓库外隔离目录进行，不触碰真实数据
$drill = 'D:\backup-drill'

# 0. 强制校验：演练目录必须位于工作区/仓库外（校验失败立即中止，禁止继续）
# 背景：2026-07 曾因演练目录落在工作区内，导致含密钥的 .env 与库副本残留在仓库旁
$workspace = (Resolve-Path "$PSScriptRoot\..\..").Path  # 或手动指定工作区根目录
 if ($drill.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
   throw "演练目录 $drill 位于工作区 $workspace 内，违反隔离边界，中止演练"
 }
New-Item -ItemType Directory -Force -Path $drill\data | Out-Null

cd source
$env:DB_PATH = "$drill\data\dental.sqlite"
$env:ADMIN_INITIAL_PASSWORD = '<演练密码>'

# 1. 建库（会自动复制现有开发库结构 + 迁移 + seed）
pnpm --filter @dental/api seed

# 2. 备份
cd apps/api
node scripts/backup/backup.js --db-path $drill\data\dental.sqlite --backup-dir $drill\backups

# 3. 删库（模拟灾难）
Remove-Item $drill\data\dental.sqlite* -Force

# 4. 恢复
node scripts/backup/restore.js --db-path $drill\data\dental.sqlite --backup-dir $drill\backups --backup-file <备份文件名> -y

# 5. 验证：backup:verify --list + 启动 API（PORT=3999）+ GET /api/v1/health/db-consistency

# 6. 清理演练目录（必做收尾步骤，不得跳过：演练库含 seed 数据与 .env 密钥）
Remove-Item $drill -Recurse -Force
# 收尾复核：确认工作区内无演练残留（外层 git status 不应出现 .backup-drill/ 或其他演练产物）
```

> 建议频率：每季度或重大 schema 变更后演练一次，并更新本文档的耗时记录。
