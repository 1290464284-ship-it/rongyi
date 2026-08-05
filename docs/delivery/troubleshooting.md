# 常见故障排查

## 日志位置

```text
%APPDATA%/Dental Clinic V2/logs/desktop.log
%APPDATA%/Dental Clinic V2/logs/metrics.json
```

## API 无法启动

检查：

1. 是否同时打开多个实例，单实例锁已阻止。
2. `%APPDATA%/Dental Clinic V2/data` 是否可写。
3. 本地端口是否被占用；应用会自动换端口并重试。
4. `desktop.log` 中是否出现 `api-exit` 或 `api-restart-failed`。

连续启动失败时，桌面端会显示“本地服务异常”并弹出通知，请检查磁盘权限、杀毒软件拦截和数据目录完整性。

## 登录失败

- 确认账号未被禁用。
- 确认密码正确；忘记密码需由管理员通过员工管理重置。
- 若默认管理员无法登录，检查是否已修改密码或恢复过旧库。

## 数据库损坏

执行：

```powershell
pnpm --filter @dental/v2 verify:database
pnpm --filter @dental/v2 repair:database
```

如果修复不可行，使用最近一份通过验证的备份恢复。

## 微信发送失败

打开“随访与沟通 -> 微信发送”：

- 显示“未开通”且按钮禁用：尚未配置通道，属预期状态。
- 配置后发送失败：检查 `V2_WECHAT_API_URL` 可达性、AppId/Secret 是否正确、通道返回错误。

## 更新失败

进入“系统管理 -> 桌面端”，查看更新状态。若下载失败，可点击“检查更新”重试。安装失败时先确认旧版本数据已备份。

## 其他无法处理的问题

收集以下内容后联系实施方：

1. 版本号。
2. 操作步骤和截图。
3. `desktop.log`。
4. 最近一次成功备份文件名。
