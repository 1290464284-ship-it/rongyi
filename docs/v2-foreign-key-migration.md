# V2 外键迁移专项

## 现状

- 应用层已通过 relation 校验和 `verify:foreign-keys` 扫描孤儿数据。
- SQLite 当前启用 `foreign_keys = ON`，但核心表尚未真正声明 `FOREIGN KEY` 约束。

## 当前进度

- 已实现迁移 `116`：MemberCard、Refund 通过表重建启用真实 `FOREIGN KEY`。
- 重建过程保留原有索引，并在迁移后继续执行 `foreign_key_check`。
- Charge、ChargeItem、PurchaseOrderItem、InventoryTransaction、FollowUp、ProcessingOrder、Appointment 可按同一模式继续迁移。

## 风险

- SQLite 无法直接为已有表添加外键，需要重建表并复制数据。
- Charge、ChargeItem、MemberCard、InventoryTransaction、Refund 等表被索引、FTS 触发器和服务代码引用。
- 重建过程中必须保持 `clinicId`、`deletedAt`、软删除语义和唯一索引一致。
- 中途失败可能造成数据丢失或启动失败。

## 安全执行顺序

1. 在 CI 中先跑 `verify:database` 和 `verify:foreign-keys`，确保库完整且无孤儿。
2. 创建 `data/v2.sqlite.pre-fk-<timestamp>` 备份。
3. 对每张目标表：
   - 创建带 `FOREIGN KEY` 的 `_new` 表；
   - 复制现有数据；
   - 重建唯一索引、普通索引和 FTS 触发器；
   - 原子替换旧表；
   - 再次执行 `integrity_check` 和 `foreign_key_check`。
4. 跑 `smoke:all`、installer smoke、upgrade smoke。

## 验收标准

- `verify:database`：ok。
- `verify:foreign-keys`：全部 ok。
- 外键校验 `PRAGMA foreign_key_check`：无结果。
- 全量门禁、smoke、package 验证通过。
