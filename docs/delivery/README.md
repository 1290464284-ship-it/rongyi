# 口腔诊所管理系统内部受控交付

本目录是 V2 内部受控版正式交付文档。目标是让诊所人员不依赖开发者即可完成核心业务闭环，并能在故障时备份、恢复、升级和回滚。

## 文档索引

- `install-guide.md`：安装、首次启动、登录和基础验收。
- `admin-init.md`：管理员初始化、员工账号、权限和业务字典核对。
- `backup-restore.md`：备份、验证、恢复和数据一致性检查。
- `troubleshooting.md`：常见故障、日志位置和处置步骤。
- `rollback.md`：版本回滚和数据保留规则。
- `acceptance-checklist.md`：交付验收清单。
- `delivery-drill.md`：真实数据演练说明。
- `trial-run.md`：受控试运行记录与 2.2.0 冻结流程。
- `operations-runbook.md`：日常运维、备份制度、日志与支持交接。
- `production-simulation-2026-08-09.md`：生产环境模拟记录。
- `real-data-onboarding-plan.md`：真实数据迁移与试运行执行方案。

## 当前范围

- Windows 64 位单机版，中文界面。
- React + Express + SQLite + Electron。
- 微信通道保留；短信功能明确不纳入本版本。
- 公开 CA 签名、SmartScreen 白名单、公开更新渠道属于后续 P8，不阻塞内部受控交付。

## 交付结论判定

内部正式交付以 `acceptance-checklist.md` 全部通过为门槛。任何 P0 问题未关闭前不得交付。
