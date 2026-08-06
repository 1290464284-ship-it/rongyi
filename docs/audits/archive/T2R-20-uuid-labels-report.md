# T2R-20 子项 3 — UUID 列显示修复 + 预约看板日期缺口（审计报告）

分支 `codex/v2-full-optimization`，工作区位于 `source/`（未提交任何改动，仅工作区修改）。

## 1. 研究结论

### 1.1 裸 UUID 列（无 labelField 渲染）— 共 20 列

| 页面 | 列 |
|---|---|
| AppointmentsPage | patientId, doctorId |
| CephalometricPage | patientId |
| FirstExamsPage | patientId, doctorId |
| ImagingPage | patientId, doctorId |
| MedicalRecordsPage | patientId, doctorId |
| MemberCardsPage | patientId |
| PrescriptionsPage | patientId, doctorId |
| ProcessingOrdersPage | patientId |
| PurchaseOrdersPage | supplierId |
| TreatmentPlansPage | patientId, doctorId |
| TreatmentsPage | patientId, doctorId |
| VisitsPage | patientId, doctorId |

关系目标：`patientId → patients.name`、`doctorId → users.name`、`supplierId → suppliers.name`。

原因：`repository.ts` 的通用 list 为 `SELECT *` 原样返回；`legacy-resources.generated.ts` 无关系字段；页面列定义均为 `key:` + 直接输出 `row.XxxId`。全 web 代码此前无任何 `XxxLabel` 消费。

### 1.2 方案选择：服务端 LEFT JOIN（任务推荐方向）

- 共享导出助手 `buildRelationLabelJoins(resource)`（`repository.ts`）：仅从资源元数据白名单（`resources.ts` 的 relation.resource → 目标表、relation.labelField → 标签列）生成片段，不拼接用户输入，无注入面。
- 生成 `<field>Label` 附加列：`relN.<labelField> AS <field>Label`，`LEFT JOIN <target> relN ON relN.id = t.<fk> AND relN.deletedAt IS NULL AND relN.clinicId = t.clinicId`（同诊所、未软删）。
- `findMany` 主表别名 `t`，全部 where/sort 列加 `t.` 前缀；租户条件用 `tenantAnd(context.clinicId, 't.clinicId')`（不出现字面量 `clinicId = ?`，通过 architecture 守卫）；count 查询同样别名，LEFT JOIN 不产生行倍增。
- 前端统一渲染 `row.XxxLabel ?? row.XxxId ?? ''`，关联目标缺失（孤儿行）时安全回退显示原 UUID。

### 1.3 预约看板日期缺口（真缺口）

`AppointmentBoardPage` 无默认日期时回退 `/resources/appointments?page=1&pageSize=200`（混合日期、状态计数无意义）。修复：默认日期 = 今天（新增导出助手 `todayLocalDate()`，本地时区 YYYY-MM-DD），看板恒走 `/appointments/by-date?date=...`；该路由同样接入 label join（`SELECT t.*,<labels> FROM Appointment t <joins> ... tenantAnd(clinicId,'t.clinicId')`）。卡片显示 `patientIdLabel ?? patientId ?? '未填写患者'`、`doctorIdLabel ?? doctorId ?? '未分配医生'`。

## 2. 变更文件（20 个，全部仅工作区，未提交）

**服务端（4）**
- `apps/v2/src/server/infrastructure/repository.ts` — `RelationLabelJoin` + `buildRelationLabelJoins()`；findMany 别名 `t` + label joins + tenantAnd 自定义列名
- `apps/v2/src/server/http/read-routes.ts` — by-date 路由加 label join、`t.` 前缀、`tenantAnd(clinicId,'t.clinicId')`
- `apps/v2/src/server/infrastructure/repository.spec.ts` — 新测试：join 标签列、孤儿行 null 回退、计数不受 JOIN 影响
- `apps/v2/src/server/http/app.spec.ts` — 扩展 by-date 测试：断言 patientIdLabel/doctorIdLabel

**前端页面（12）**
- `AppointmentsPage.tsx`、`CephalometricPage.tsx`、`FirstExamsPage.tsx`、`ImagingPage.tsx`、`MedicalRecordsPage.tsx`、`MemberCardsPage.tsx`、`PrescriptionsPage.tsx`、`ProcessingOrdersPage.tsx`、`PurchaseOrdersPage.tsx`、`TreatmentPlansPage.tsx`、`TreatmentsPage.tsx`、`VisitsPage.tsx` — 行类型加 `XxxLabel?: string | null;`，列渲染改 `row.XxxLabel ?? row.XxxId ?? ''`
- `AppointmentBoardPage.tsx` — 默认日期今天、恒走 by-date、卡片显示标签

**前端工具/测试（4）**
- `apps/v2/src/web/format.ts` — 新增 `todayLocalDate()`
- `apps/v2/src/web/AppointmentBoardPage.spec.tsx` — 更新 3 个 no-date 回退断言为 by-date（今日），新增标签优先测试（共 6 个）
- `apps/v2/src/web/AppointmentsPage.spec.tsx` — 新增标签渲染测试（共 8 个）

## 3. 验证结果

- `pnpm run typecheck`（tsc server + web）✅ 通过
- 受影响测试单独运行 ✅：repository.spec (20)、app.spec (47)、architecture.spec (5)、coverage-boundaries.spec (11)、AppointmentBoardPage.spec (6)、AppointmentsPage.spec (8)
- 全量 `pnpm run test` ✅：**76 文件 / 582 测试全部通过**（基线 579 → +3：repository.spec +1、AppointmentBoardPage.spec +1、AppointmentsPage.spec +1；app.spec 为就地扩展不计新测试）

## 4. 风险与遗留

- CSV 导出 `toCsv` 按 `Object.keys(row)` 建表头，列表导出将新增 `<field>Label` 列（无 spec 断言精确表头；patients 等无关系的资源不受影响）。如需隐藏可后续在导出层过滤。
- `findById` 及自定义端点（如 by-date 之外的专用路由）未 join，detail 场景仍显示 UUID（本次范围仅为列表列渲染）。
- 看板由「无日期回退全量列表」改为「默认今天 by-date」：未预约在更早/更晚日期的预约不再出现在默认视图（符合看板语义；`/appointments/by-date` 无分页，单日数据量有限）。
- 工作区文件行尾：12 个页面为 CRLF 文件，插入行以 LF 写入（混合 EOL 仅在本地可见）；`.gitattributes`（`* text=auto eol=lf`）保证提交后统一 LF，git diff 已确认无整文件行尾噪声。
- 未执行任何 git 写操作；未触碰 node_modules/.vite；无进程被终止。
