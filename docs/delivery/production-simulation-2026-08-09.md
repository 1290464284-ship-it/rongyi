# 生产环境模拟报告 2026-08-09

- 模拟日期：2026-08-09
- 模拟机器：当前开发机（Windows，非全新物理机）
- 基线：`main` HEAD `293128f`
- 应用：`@dental/v2` 2.2.0，内部自签名发布路径
- 说明：本次为受控模拟，不等同于真实诊所试运行；CA 证书不作为评估项。

## 执行结果

| 项目 | 结果 |
|---|---|
| `electron:dist:internal` 内部安装包构建 | 通过 |
| `verify:package` 安装包校验 | 通过 |
| `update:metadata` + `verify:update` 更新元数据 | 通过 |
| `installer:smoke` 静默安装/健康检查/卸载 | 通过 |
| `upgrade:smoke` 上一版内部包覆盖升级 | 通过（userData 保留 + 升级后 API 健康） |
| `smoke:packaged-ui` 打包版 UI | 通过（含 userData 隔离修复） |
| `delivery:drill` 迁移/备份/损坏/恢复演练 | 通过 |
| `smoke:http-fuzz` 异常输入容错 | 通过（11 项 4xx） |
| `smoke:multi-instance` 双实例并发 | 通过 |
| `smoke:all` API + UI + 负载冒烟 | 通过 |
| `smoke:wechat-gateway` 本地 HTTPS 假网关 | 通过（发送落 SENT，网关 500 后保持 PENDING） |
| `benchmark:load` 10 万患者/10 万收费基准 | 通过 |
| typecheck / 1379 单测 / 覆盖率 / lint / knip / build / electron:compile | 通过 |

## 产物

- `apps/v2/release-v2/Dental-Clinic-V2-Setup-2.2.0-internal.20260809060235.exe`
- `apps/v2/release-v2/Dental-Clinic-V2-Setup-2.2.0-internal.20260809060235.exe.blockmap`
- `apps/v2/release-v2/latest.yml`
- `apps/v2/data/packaged-ui-smoke.png`

## 关键实测数据

- 工作台负载：100 次请求，avg 13.8ms，p95 16.2ms。
- 10 万患者插入：701ms；10 万收费插入：843ms；FTS 搜索：7ms；看板：47ms。
- 备份恢复演练：加密备份创建、校验、数据库损坏、恢复、重启后数据一致。

## 发现与修复

1. `smoke:packaged-ui` 未隔离 Electron `userData`，会继承本机残留登录态导致冒烟失败。已修改脚本传入临时 `--user-data-dir`，并兼容已登录状态。修复后冒烟通过。
2. `smoke:all` 首次运行因未设置 `V2_BACKUP_KEY` 失败，服务端对加密备份正确 fail-closed。补齐密钥后通过，属预期保护行为。

## 模拟边界

- 非全新物理机，未覆盖干净 Windows 装机。
- 未使用真实诊所数据，未做真实微信网关联调。
- 未覆盖连续多日使用、真实打印机/扫描仪/影像设备。
- 真实诊所 2-4 周试运行与冻结记录仍为正式交付前置条件。
