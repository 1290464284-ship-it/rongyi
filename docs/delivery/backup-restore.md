# 备份与恢复手册

## 备份方式

### 自动备份

系统默认每天执行一次自动备份，保留最近 30 份。备份文件默认加密。

### 手动备份

进入“系统管理 -> 备份”，点击创建备份，然后点击验证。验证通过后才认为备份有效。

## 备份文件

备份目录：

```text
%APPDATA%/Dental Clinic V2/backups
```

加密备份以 `.enc` 结尾，未加密备份以 `.sqlite` 结尾。不要只复制主数据库文件，必须使用系统备份或 CLI 恢复。

## 恢复流程（应用内）

1. 进入“系统管理 -> 备份”。
2. 选择备份并执行“验证”。
3. 确认备份摘要与当前库摘要。
4. 执行“恢复暂存”。
5. 按提示重启应用，应用会激活暂存恢复。

## 恢复流程（命令行）

```powershell
$env:V2_BACKUP_KEY = "<同一密钥>"
pnpm --filter @dental/v2 restore:backup <backup.sqlite.enc> <target.sqlite>
pnpm --filter @dental/v2 verify:database
```

## 数据一致性确认

恢复后应核对：

- 患者数量与备份摘要一致。
- 最近收费、会员、库存、随访记录可查询。
- 登录、导航、备份和日志功能正常。

## 交付演练

执行真实数据演练：

```powershell
pnpm --filter @dental/v2 build
pnpm --filter @dental/v2 electron:compile
pnpm --filter @dental/v2 delivery:drill
```

演练覆盖：旧库导入 -> 建档 -> 加密备份 -> 验证 -> 模拟损坏 -> 恢复 -> 重启 -> 数据一致性确认。
