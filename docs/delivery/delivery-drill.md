# 真实数据演练

## 覆盖场景

演练脚本 `apps/v2/scripts/delivery-drill.mjs` 自动覆盖：

1. 旧库导入。
2. 登录和建档。
3. 创建加密备份。
4. 验证备份完整性。
5. 模拟数据库损坏。
6. 使用备份恢复目标库。
7. 校验恢复库完整性。
8. 重启 API 并确认患者数据存在。

## 执行

```powershell
pnpm --filter @dental/v2 build
pnpm --filter @dental/v2 electron:compile
pnpm --filter @dental/v2 delivery:drill
```

脚本成功输出：

```text
Delivery drill passed: legacy import -> create data -> encrypted backup -> verify -> corrupt -> restore -> restart -> consistency check.
```

## 结果归档

演练成功后，将输出中的备份文件名和数据库路径记录到交付记录。真实诊所演练还应在隔离机器上手工执行“应用内恢复 -> 重启 -> 核对摘要”流程。
