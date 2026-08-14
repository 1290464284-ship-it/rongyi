# OPS.md — 无人维护多机部署运维手册

版本：适用于 Dental Clinic V2 2.2.0（内部发布链 `v2-internal-*`）。
定位：A-P2.3（恢复 SOP）+ A-P4.3（部署/证书再生成/恢复/巡检/故障排查）合并成
一本手册。目标是把一台干净 Windows 机器变成「90 天零人工干预」的受控节点。

---

## 1. 部署（新电脑一键，A-P4.1）

前置条件：

- Windows 10/11 x64，当前用户可写 `%LOCALAPPDATA%\Programs` 与 `%APPDATA%`。
- 拿到内部版安装包（`Dental-Clinic-V2-Setup-<version>-internal.<ts>.exe`）。
- 需要异地备份时，先准备可达的镜像目录（NAS/SMB/本机第二块盘）。

一键部署（目标机器上执行）：

```powershell
powershell -ExecutionPolicy Bypass -File deploy-fleet.ps1 `
  -InstallerPath "C:\deploy\Dental-Clinic-V2-Setup-2.2.0-internal.20260815.exe" `
  -MirrorDir "\\nas\clinic-backups\machine-01" `
  -MirrorKeep 30 `
  -BackupKey "<离线保管的备份密钥>"
```

脚本行为（全部幂等可重跑，除安装目录已存在时拒绝覆盖）：

1. NSIS `/S` 静默安装（per-user，`/D` 指定目录）；
2. 校验 `Dental Clinic V2.exe`、`app.asar`、legacy 资源；
3. 把包内 `resources\app.asar.unpacked\build\internal-signing.pfx.cer`
   导入 CurrentUser `Root` + `TrustedPublisher`（应用首启也会自动做，这里是
   提前信任，保证首启即可通过更新签名校验）；
4. `-UserDataSeedDir`（可选）整体预置到 `%APPDATA%\Dental Clinic V2`；
5. 写 User 级环境变量（见 §7 变量表）；未提供 `-BackupKey`/`-JwtSecret` 时
   随机生成并落 `%APPDATA%\Dental Clinic V2\logs\deploy-fleet-credentials.txt`；
6. 写部署报告 `%APPDATA%\Dental Clinic V2\logs\deploy-fleet.json`；
7. 默认启动应用一次——首启自动开启开机自启（A-P1.2，标记文件
   `.auto-launch-initialized` 落盘后不再强制，用户可在设置页自由开关）；
   `-NoStart` 可跳过启动（无桌面会话的 SSH 部署场景）。

`deploy-fleet.ps1` 必须保持 CRLF + PowerShell 5.1 兼容（不引入 `??`、
三元表达式、`ForEach-Object -Parallel`）。改动后运行：

```powershell
powershell -ExecutionPolicy Bypass -File apps/v2/scripts/deploy-fleet.ps1 -?
```

### 静默安装验证（A-P4.2）

CI `V2 Windows Installer Smoke`（`v2-windows-smoke.yml`）每轮都在干净 runner
上构建 NSIS 安装包并执行 `installer-smoke.ps1`：`/S` 静默安装 → 安装产物
校验 → 拉起 installed API 健康检查 → `/S` 静默卸载 → 目录清理。本地复验：

```powershell
pnpm --filter @dental/v2 electron:dist
pnpm --filter @dental/v2 run installer:smoke
```

升级演练（真实旧版 → 新版，`workflow_dispatch` 传入 `previous_installer_url`）：

```powershell
pnpm --filter @dental/v2 run upgrade:smoke `
  -CurrentInstallerPath <new.exe> -PreviousInstallerPath <previous.exe>
```

---

## 2. 证书信任链与再生成（A-P0.2）

- 内部版用自签名 PFX 打包（`apps/v2/build/internal-signing.pfx.cer` 是导出公钥），
  更新安装包签名校验走 Windows Authenticode，信任点 = CurrentUser
  `Root` + `TrustedPublisher`。
- 应用首启自动执行同一导入逻辑；`V2_DISABLE_CERT_TRUST=1` 可在受控环境关闭。
- 干净机验证步骤：

```powershell
# 1) 安装后检查证书确实在 CurrentUser 信任区
Get-ChildItem Cert:\CurrentUser\Root, Cert:\CurrentUser\TrustedPublisher |
  Where-Object Subject -like "*Dental Clinic V2*" |
  Select-Object Thumbprint, Subject, NotAfter

# 2) 安装包签名链验证
Get-AuthenticodeSignature "Dental Clinic V2.exe" |
  Select-Object Status, StatusMessage, SignerCertificate
```

**证书再生成 = 全舰队重导信任**：新 PFX 的 thumbprint 变化后，旧机器上已下载
的新版安装包会因签名不受信而拒绝安装。处理顺序必须是：

1. 发布新版安装包（新证书签名）；
2. 在**每台机器**上重新执行 `deploy-fleet.ps1 -RefreshCertTrust`（先删同
   Subject 旧证书再导入新证书），或至少启动一次新版应用让它自动导入；
3. 全舰队导完之前不要停用旧版分发渠道。

`V2_EXPECTED_INTERNAL_CERT_THUMBPRINT` 可注入预期指纹，不匹配时拒绝导入。

---

## 3. 自动更新链验证（A-P0.1/A-P1）

内部发布入口：Actions → `V2 Internal Release` → `workflow_dispatch`，
`version` 必须与 `apps/v2/package.json` 完全一致，`run_installer_smoke`
默认开启。一次成功运行依次完成：

Verify 门禁（lint/knip/typecheck/test/coverage/mutation/quality/security/license
/build/compile）→ simulated-data → `smoke:all` → 构建内部安装器 →
校验 `latest.yml` 版本 → 发布 prerelease `v2-internal-<version>`（含
`Setup-*.exe`、`.blockmap`、`latest.yml`）→ `verify:remote` 远端复验。

发布后人工/自动确认清单：

```powershell
gh api repos/1290464284-ship-it/rongyi/releases/tags/v2-internal-2.2.0 `
  --jq '{prerelease, assets: [.assets[].name]}'
pnpm --filter @dental/v2 run verify:remote   # V2_RELEASE_TAG=v2-internal-2.2.0
```

客户端行为（A-P1，已合并 main）：

- 启动即查 + 每 24h 复查；发现新版自动下载（`autoDownload=true`），
  退出应用时自动安装（`autoInstallOnAppQuit=true`），下次启动即新版。
- 检查失败按 1min/5min/30min/1h/4h/12h 退避，连续失败满 24h 才弹系统通知。
- 设置页可见：上次检查/可用版本/失败原因。
- 开关：`V2_DISABLE_AUTO_UPDATE=1` 整体关闭；`V2_DISABLE_AUTO_LAUNCH=1`
  关闭首启强制开机自启。

失败模式（计划原文）：更新中断→断点续传；签名失败不安装。

---

## 4. 备份与恢复 SOP（A-P2）

### 4.1 目录与产物

| 项 | 路径/变量 |
|---|---|
| 本机备份目录 | `%APPDATA%\Dental Clinic V2\backups` |
| 异地镜像目录 | `V2_BACKUP_MIRROR_DIR`（未配置 = 不镜像） |
| 镜像保留份数 | `V2_BACKUP_MIRROR_KEEP`（缺省同 `V2_AUTO_BACKUP_KEEP`） |
| 加密密钥 | `V2_BACKUP_KEY`（User 级环境变量） |
| 自动备份周期 | `V2_AUTO_BACKUP_INTERVAL_MS`（≥60s，默认 24h） |
| 自动备份保留 | `V2_AUTO_BACKUP_KEEP`（1–365，默认 30） |

镜像机制（A-P2.1）：自动备份完成后复制到镜像目录，先写 `.partial` 再
rename，复制后 sha256 与源文件比对，不一致即删除并告警；**镜像失败只告警
（告警表 `BACKUP_MIRROR` + 日志），主备份不受影响**。保留策略只清理文件名
含 `backup-` 的正式 `.enc/.sqlite`，按文件名时间戳保留最近 N 份。

### 4.2 恢复 SOP（A-P2.3）

**⚠️ 密钥丢失 = 数据不可恢复（设计如此）**。`V2_BACKUP_KEY` 不存在任何
找回通道，部署后必须离线保管；换机器重装时密钥不变。

正常恢复（本机备份）：

```powershell
$env:V2_BACKUP_KEY = "<同一密钥>"
pnpm --filter @dental/v2 restore:backup <backup.sqlite.enc> <target.sqlite>
pnpm --filter @dental/v2 verify:database
```

本机备份全丢，从镜像恢复（A-P2.4 演练路径）：

```powershell
# 把镜像目录里的 backup-*.enc 拷回本机任意位置，再走同一条恢复命令
$env:V2_BACKUP_KEY = "<同一密钥>"
pnpm --filter @dental/v2 restore:backup <copy-of-mirror-backup.enc> <target.sqlite>
pnpm --filter @dental/v2 verify:database
```

应用内恢复仍走「系统管理 → 备份 → 验证 → 恢复暂存 → 重启激活」。

恢复后核对：患者/收费/会员/库存/随访数量与备份摘要一致；登录、导航、备份、
日志功能正常。

### 4.3 恢复演练（A-P2.4）

```powershell
pnpm --filter @dental/v2 build
pnpm --filter @dental/v2 electron:compile
pnpm --filter @dental/v2 disaster:drill
```

覆盖：错密钥拒绝且不写目标库 → 损坏备份拒绝 → 正常恢复 + integrity →
自动备份镜像 sha256 一致 → **直接用镜像副本恢复** → 镜像目录不可达时主备份
照常完成。

`V2_AUTO_BACKUP_FIRST_DELAY_MS`（≥250ms，默认 5 分钟）供演练/soak 加速首备份。

---

## 5. 巡检（health.json，A-P3）

每台机器一个快照：`%APPDATA%\Dental Clinic V2\logs\health.json`。
启动时写一次，之后每 15 分钟刷新。固定 schema（巡检脚本按字段解析）：

```json
{
  "generatedAt": "ISO-8601",
  "version": "2.2.0",
  "uptimeSeconds": 12345,
  "db": { "quickCheck": "ok", "sizeBytes": 0, "walBytes": 0 },
  "backup": { "count": 30, "lastBackupAt": "ISO-8601|null", "lastBackupFile": "backup-*.enc|null" },
  "disk": [{ "dir": "...\\backups", "freeBytes": 0, "ok": true }],
  "logBytes": 0,
  "openAlerts": 0
}
```

dsh-ssh 批量巡检要点：

- `db.quickCheck != "ok"` → 立即停写并走恢复/修复；
- `backup.lastBackupAt` 超过 2 × `V2_AUTO_BACKUP_INTERVAL_MS` → 检查备份告警；
- `disk.ok = false` → 磁盘低于 `V2_DISK_THRESHOLD_BYTES`（默认 1GB）；
- `openAlerts > 0` → 拉取该机告警表核对（备份镜像/时钟漂移/磁盘/自动备份）；
- 时钟漂移（>72h）只告警不自动改时间（A-P3.3）。

日志目录治理：日志轮转 + 体积上限自动清理；`logBytes` 异常增长见 §6。

---

## 6. 自愈与故障排查

内建自愈：API 子进程孤儿保护（父进程死亡即退出）、supervisor 看门狗
（`V2_ENABLE_WATCHDOG=0` 关闭）、启动完整性检查、staged 恢复、紧急修复
（`attemptEmergencyRepair`）、SQLite `quick_check` + 每日/每周维护、休眠唤醒
强制健康检查。

| 症状 | 先查 | 处置 |
|---|---|---|
| 应用不启动 | `logs/desktop.log`、`logs/v2.log` | 看门狗是否拉起；`V2_DISABLE_CERT_TRUST=1` 临时隔离证书问题 |
| 提示备份密钥缺失/备份失败 | `openAlerts`、`V2_BACKUP_KEY` 是否存在 | 用部署时保管的密钥重写 User 环境变量，重启应用 |
| 镜像告警 `BACKUP_MIRROR` | 镜像目录网络/权限/磁盘 | 修好目录即可；主备份不受影响，无需恢复操作 |
| 更新一直失败 | 设置页「上次检查/失败原因」 | 检查 `latest.yml` 可达性、证书信任区、代理；连续失败 24h 会弹通知 |
| 登录突然全部失效 | 时钟漂移告警 | 开启系统自动时间同步；JWT 密钥是否被重建（重建会踢掉全部会话） |
| 磁盘告警 | `health.json.disk` | 清日志/旧备份或调大 `V2_DISK_THRESHOLD_BYTES`（不推荐长期调大） |
| 数据库 quick_check 失败 | `v2.log`、备份新鲜度 | 停应用 → 从最新备份恢复 → `verify:database` |

上报问题最少携带：版本号、`desktop.log`/`v2.log`、最近备份文件名、
`health.json`、影响范围（登录/写入/备份恢复/升级）。

---

## 7. 环境变量速查

| 变量 | 含义 | 默认 |
|---|---|---|
| `V2_BACKUP_KEY` | 备份加密密钥（丢失不可恢复） | 无（生产必须配置） |
| `V2_JWT_SECRET` | API JWT 密钥（重建会踢掉全部会话） | 生产必配，dev 自动临时生成 |
| `V2_BACKUP_MIRROR_DIR` | 异地镜像目录 | 空 = 不镜像 |
| `V2_BACKUP_MIRROR_KEEP` | 镜像保留份数 | 同 `V2_AUTO_BACKUP_KEEP` |
| `V2_AUTO_BACKUP_INTERVAL_MS` | 自动备份周期（≥60000） | 24h |
| `V2_AUTO_BACKUP_FIRST_DELAY_MS` | 首备份延迟（≥250，演练可加速） | 5min |
| `V2_AUTO_BACKUP_KEEP` | 本机保留份数（1–365） | 30 |
| `V2_DISK_THRESHOLD_BYTES` | 磁盘告警阈值 | 1GB |
| `V2_DISABLE_AUTO_UPDATE` | 置 1 关闭自动更新 | 开启 |
| `V2_DISABLE_AUTO_LAUNCH` | 置 1 关闭首启强制自启 | 首启强制开 |
| `V2_DISABLE_CERT_TRUST` | 置 1 关闭自动证书导入 | 自动导入 |
| `V2_EXPECTED_INTERNAL_CERT_THUMBPRINT` | 证书指纹白名单 | 不校验 |
| `V2_DATA_DIR` / `V2_LOG_DIR` / `V2_BACKUP_DIR` | 运行目录覆盖（打包版默认全在 userData） | userData 下 |

## 8. 演练与验收清单

单机验收 = 部署 → 首启 → 备份 → 镜像 → 巡检 → 升级各环节全自动。
定期（建议每月，B-2.3）：

```powershell
pnpm verify                       # typecheck/lint/knip/test/coverage/mutation/quality
pnpm --filter @dental/v2 disaster:drill
pnpm --filter @dental/v2 delivery:drill
pnpm --filter @dental/v2 drill:crash
pnpm --filter @dental/v2 drill:environment
pnpm --filter @dental/v2 drill:corrupt-boot
```

部署脚本/手册变更时补跑 `installer:smoke` 与 `deploy-fleet.ps1 -?` 解析检查。
