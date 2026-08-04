# V2 一次性优化计划

## 当前基线

- server/domain 覆盖率：100%
- Web 核心文件覆盖率：statements 99.21%、lines 100%
- 测试：30 个测试文件、181+ 个测试
- 门禁：typecheck、lint、knip、build、electron compile、security scan、license check 全部通过
- 验证：API/UI/load smoke、package verification 通过

## 评分

| 维度 | 得分 | 说明 |
|---|---:|---|
| 架构与模块化 | 8.0 | 分层清晰，大文件和 legacy 双模式仍需收敛 |
| 安全 | 7.5 | 权限、关系校验已加强，仍可继续收紧公开端点与存储 |
| 数据完整性 | 8.0 | 财务、软删除、唯一约束已加固，外键和会员卡链路待补 |
| 性能 | 6.5 | 索引已补，搜索和大型导入仍可优化 |
| 测试质量 | 7.5 | server 全覆盖，Web 覆盖率需要继续提升 |
| 可维护性 | 7.0 | 资源注册表和旧版生成资源仍有治理成本 |
| UX/UI | 6.0 | 角色导航和交互状态需要完善 |
| 运维与发布 | 7.5 | CI 与包验证完整，安装/升级验证需纳入常态 |
| 文档与治理 | 7.0 | 架构和迁移文档仍需补齐 |

## 执行顺序

1. 数据模型：Charge 记录 `memberCardId`，退款按原卡归还。
2. 幂等：处理中记录超过 30 分钟后允许重试。
3. 权限：API 默认拒绝，前端导航由服务端权限驱动。
4. 限流：refresh、sync、backup、bulk-import、财务/库存写操作增加速率限制。
5. 测试：Web 核心页面覆盖创建、编辑、删除、分页和只读状态。
6. 治理：增加资源写策略和 tenant 扫描架构测试。
7. 验证：完整 verify、smoke、package 后提交。

## 已完成

- Charge 记录实际使用的会员卡，退款优先按原卡归还。
- Idempotency 处理中记录超过 30 分钟后自动清理并允许重试。
- 新增 `/api/v2/auth/navigation`，前端按角色隐藏导航。
- refresh、sync、backup、bulk-import、财务/库存写操作增加限流。
- Web 核心页面补齐创建、编辑、删除、分页、枚举/关系/JSON 表单测试。
- 增加通用 CRUD 写策略和裸 `clinicId = ?` 架构扫描测试。
- 启动前执行数据库完整性预检，损坏库不再静默继续运行。
- 新增 `verify:database` 与 `repair:database`：可检查完整性，并在备份后执行 `REINDEX` 修复。
- `verify:database` 和 `repair:database` 同时执行 `PRAGMA foreign_key_check`。
- Electron 登录态迁移到 `safeStorage` 加密文件，Web 开发环境继续回退到 localStorage。
- 搜索切换到 FTS5 索引，覆盖患者、预约、收费、库存、供应商和随访。
- 新增 `verify:foreign-keys`，扫描核心业务关系中的孤儿数据。
- 新增 Windows installer smoke workflow，可在 CI 中构建并验证安装包。
- 新增 `verify:foreign-keys` 与 `v2-foreign-key-migration.md` 专项文档。
- 迁移 `116` 已为 MemberCard、Refund 启用真实外键约束。
- 迁移 `116` 已扩展至 ChargeItem、PurchaseOrderItem、InventoryTransaction、ProcessingOrder，并为重建 DDL 增加“禁止丢列”保护。
- `verify:foreign-keys` 已扩展至 19 条核心关系扫描。
- Charge 付款/退款更新、处方安全、治疗进度、头影测量写入均改为显式诊所范围，并补齐跨诊所测试。
- 管理员用户更新与重置密码在仓储层按诊所范围执行，并补充跨诊所回归测试。
- staged restore 会清理目标库遗留的 SQLite WAL/SHM 文件，避免恢复后索引损坏并触发启动完整性失败。
- 备份校验与 staged restore 会清理 SQLite 侧文件，保留期清理会同步删除 `BackupRecord` 记录。
- 备份文件名增加随机后缀，避免同一毫秒内创建互相覆盖；保留数在服务层统一限制为 `1..365`。
- 通用资源新增 CSV 导出接口，支持分页拉取全量数据，便于诊所自用备份与迁移。
- 经营分析新增固定月度收入报表，直接复用现有 revenue 统计接口。
- 经营分析新增库存汇总报表，直接复用现有 inventory 统计接口。
- staged restore 的恢复前备份改为 SQLite `VACUUM INTO`，当前库有效时会保留 WAL 中尚未落盘的数据；损坏/非 SQLite 文件仍回退为文件复制。
- legacy 导入复用同一 WAL-safe SQLite 备份 helper，源库写入目标与既有目标 pre-import 备份均不再只复制主文件。
- 同步删除与通用资源删除在报告成功前先确认目标存在，缺失记录统一按失败/404 返回。
- 预约状态流转改为通过共享 tenant helper 约束查询与更新，移除手工 clinicId 比较分支。
- `clean:generated` 改为自动识别任意 `dist-*` 输出目录，避免硬编码遗漏新构建目录。
- 新增 `benchmark:load`：生成 10 万患者与 10 万收费记录，测量 FTS 搜索和 dashboard。
- 基准结果：10 万患者/收费写入约 1.5s，FTS 搜索 10ms，dashboard 71ms。

## 后续建议

- 搜索量达到十万行级别后引入 FTS5。
- 大型 legacy 数据库迁移改为事务分片。
- Web 覆盖率目标提升到 statements/lines 80%。
- 安装器、升级器、备份恢复进入 CI 常态验证。
