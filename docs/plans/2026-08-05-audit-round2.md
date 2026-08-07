# 2026-08-05 第二轮审计修复计划（Dental Clinic V2）

> **For agentic workers:** Implement this plan task-by-task, with a review gate between tasks. Steps use checkbox (`- [x]`) syntax for tracking.
>
> **执行模型：** 沿用选项 A（Subagent-Driven）——每个任务派发独立子代理 + 调用方评审门禁 + 独立提交；全量测试由调用方串行复验；子代理只读审计、禁止 git 操作。

**Goal:** 修复第二轮深度审计确认的 3 个 P0（CORS 打包阻断、FTS 运行期索引不维护、迁移 121 撞索引条件风险）、dental.sqlite PII 出库，以及 P1 数据正确性/审计/同步缺陷；承接第一轮计划未完成的 T3.2–T3.7、Phase 4、Phase 5；最终以打包实测门收尾。

**Architecture:** 按 6 个波次推进：Wave 0 先修打包可用性（CORS），Wave 1 修数据正确性与审计（新 P0/P1），Wave 2 承接第一轮安全任务（T3.2–T3.7），Wave 3 承接边界/异常/日志（Phase 4）+ 新中危项，Wave 4 承接卫生/文档（Phase 5）+ 出库与文档同步，Wave 5 打包实测门。数据库改动走**新迁移（122 起）**；已应用迁移（≤121）一律不编辑。

**Tech Stack:** TypeScript 5.7 / React 19 / Express 5 / better-sqlite3（同步 API）/ Electron 43 / vitest 4 / pnpm 11。

## Global Constraints

- 所有命令在 `D:/Desktop/rongyi/source/` 下执行：`pnpm --filter @dental/v2 <script>`。
- 迁移**只增不改**：已有迁移（≤121）不得编辑；新迁移从 **122** 开始编号，名称 `v2-<kebab-name>`；写新迁移前先 `grep 'version:' src/server/infrastructure/migrations.ts | tail` 确认最大号。
- 数据库只允许 better-sqlite3 + 参数化 SQL；**本计划不引入任何新依赖**。
- 提交信息符合 conventional commits（commitlint + husky）；husky 会自动跑全量测试（约 15s），提交前先手动跑目标测试。
- 每次提交前必须通过：`pnpm --filter @dental/v2 typecheck` + 目标测试文件；改动涉及仓库级行为时跑全量 `pnpm --filter @dental/v2 test`。
- 软删除资源所有列表路径保留 `deletedAt IS NULL` 过滤。
- 业务路径禁止生产 `any` 与静默吞错；禁止编辑已应用迁移；禁止删除他人未提交的工作。
- Windows：better-sqlite3 抛错前 `db.close()`；git 输出用 `2>/dev/null` 过滤；**本机 3180 端口在 Windows 排除范围（3170–3269）内，本地起服务用 `V2_PORT=3980`**。
- 真实旧库样本不可得：R2-P0-03（迁移 121 兜底）以构造数据的测试为准，发布前需真实升级演练（见 T2R-22）。

---

## 承接清单（第一轮计划未完成任务 → 波次映射）

> 以下任务在 `docs/plans/2026-08-05-audit-fixes.md` 中已有完整定义（含代码步骤），**执行时以该文档对应 Task 为准**，本计划只登记执行顺序、优先级调整与新增协同要求。任务编号沿用第一轮。

| 承接任务 | 目标（第一轮定义） | 波次 | 协同/备注 |
|---|---|---|---|
| T3.2 | 备份/恢复按诊所隔离（H1-sec） | Wave 2 | 关联 R2-P2-17 BackupRecord 隔离 |
| T3.3 | IPC sender 校验 + 密钥白名单 + CORS 收紧 + 登录 IP 限流（H3-sec） | Wave 2 | **CORS 收紧必须在 T2R-01 之上实现**：白名单之外必须继续放行 `file://` 与 `'null'`（打包版渲染器），并在 app.spec.ts 补充回归 |
| T3.4 | 密钥 safeStorage 落盘 + 备份默认加密（M1/M2-sec） | Wave 2 | 关联 R2-P1-13 backup-key 静默重生成：改为显式报错并要求确认后再生成 |
| T3.5 | CSV 公式注入 + 敏感字段掩码扩展（M3/M4-sec） | Wave 2 | 注意：导出已有 BOM（`router.ts:99`），**缺的是 `=`/`+`/`-`/`@` 前缀转义**；phone 加入 SENSITIVE_FIELDS（R2-P2-17） |
| T3.6 | 上传配额 + dev seed 显式开关（M5/M6-sec） | Wave 2 | seed 门覆盖 R2-P2-16：非 production 下默认**不**重置 admin123，仅当 `V2_ALLOW_DEV_SEED=1` 时重置/播种 demo |
| T3.7 | Electron 加固：崩溃上报最小化 + 更新签名校验 + token 内存回退（L1/L2/L3-sec） | Wave 2 | 关联 R2-P1-14 |
| T4.1 | sync pull 游标修正 + push 事务批（H2-edge + M3-perf） | Wave 3 | 关联 R2-P2-05 push 逐条无事务 |
| T4.2 | 预约看板本地日期 + 按日期服务端查询（H3-edge + L4-edge） | Wave 3 | 关联 R2-P1-17 看板 3/6 截断 |
| T4.3 | 分页参数非法返回 400（H4-edge） | **Wave 1（提前）** | 覆盖 R2-P1-01：`Number()` 产生 NaN 时当前 `LIMIT NULL` 全表返回 |
| T4.4 | 微信发送错误明细 + 批量并发（H5-edge + L2-perf） | Wave 3 | — |
| T4.5 | 登录审计 + 请求日志 userId（H6-edge + L6-edge） | Wave 3 | 与 T2R-09 审计中间件顺序调整协同 |
| T4.6 | logger Error 序列化 + 错误文案翻译（M2-edge + L5-edge） | Wave 3 | — |
| T4.7 | datetime 输入归一化为 UTC ISO（M3-edge） | Wave 3 | 关联 R2-P2-09 |
| T4.8 | 幂等覆盖扩展（M1-edge） | Wave 3 | 关联 R2-P2-07 refund 未接幂等 |
| T4.9 | 批量导入系统性错误分类（M4-edge） | Wave 3 | — |
| T4.10 | 审计 flush 重试与关闭冲刷（M6-edge） | Wave 3 | 关联 R2-P2-11 批量 flush 失败丢行 + flushAudit 无消费者 |
| T4.11 | 金额溢出防护（L2-edge） | Wave 3 | — |
| T5.1 | 死代码清理（knip 清单） | Wave 4 | 与 T2R-18 合并执行（清单合并） |
| T5.2 | 定时任务收敛到 scheduler.ts（消除双份实现） | Wave 4 | — |
| T5.3 | 脚本去重（run-smokes 复用 wait-for-services） | Wave 4 | — |
| T5.4 | 文档与版本号同步 | Wave 4 | 与 T2R-19 合并执行 |
| T5.5 | CRUD 页面模板收敛（独立子计划大纲） | Wave 4 | 保持大纲形态，单独立项 |

---

## Wave 0 — 打包可用性

### Task T2R-01: CORS `'null'` origin 放行 + files 路由 CORP 作用域化（R2-P0-01 / R2-P1-06）

**Files:**
- Modify: `src/server/http/app.ts:199`（helmet）、`app.ts:206-227`（cors origin 回调）、files 路由挂载前（新增 CORP 覆盖中间件）
- Test: `src/server/http/app.spec.ts`（已有 CORS 用例附近新增）

**Interfaces:**
- Consumes: 现有 `configuredCorsOrigins`（`V2_CORS_ORIGIN` 白名单）
- Produces: 无新导出；行为契约——`Origin: null` 与 `Origin: file://*` 均返回 `Access-Control-Allow-Origin` 回显；其他非白名单 origin 继续拒绝

**背景（已实测坐实）：** Chromium file:// 页面跨域请求发送 `Origin: null`，当前 `new URL('null')` 抛错落入拒绝分支 → 打包版渲染器所有 API 调用 500/被浏览器拦截。同时 helmet 默认 `Cross-Origin-Resource-Policy: same-origin` 会阻断 file:// 页面以 `<img>` 加载 API 图片资源。

- [x] **Step 1: 写失败测试**

在 `app.spec.ts` 新增（沿用现有 supertest 模式）：

```ts
it('allows the null origin used by packaged file:// renderers', async () => {
  const res = await request(app)
    .get('/api/v2/health')
    .set('Origin', 'null');
  expect(res.status).toBe(200);
  expect(res.headers['access-control-allow-origin']).toBe('null');
});

it('allows file:// origins', async () => {
  const res = await request(app)
    .get('/api/v2/health')
    .set('Origin', 'file://C:/app/dist-web/index.html');
  expect(res.status).toBe(200);
  expect(res.headers['access-control-allow-origin']).toMatch(/^file:\/\//);
});

it('still rejects foreign web origins', async () => {
  const res = await request(app)
    .get('/api/v2/health')
    .set('Origin', 'https://evil.example');
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
});
```

- [x] **Step 2: 运行确认失败**

Run: `pnpm --filter @dental/v2 test src/server/http/app.spec.ts -t "null origin"`
Expected: 前两个用例 FAIL（当前 `Origin: null` → 500 无 ACAO），第三个 PASS。

- [x] **Step 3: 实现**

```ts
app.use(helmet()); // 保持全局默认 CORP same-origin

// cors 回调内，在 configuredCorsOrigins 检查之后、URL 解析之前插入：
if (origin === 'null' || origin.startsWith('file://')) {
  callback(null, true);
  return;
}
```

files 路由挂载前加 CORP 覆盖（仅静态资源类响应放开，其余保持 same-origin）：

```ts
app.use('/api/v2/files', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
```

（若 files 路由实际挂载路径不同，以 `registerFileRoutes` 的挂载点为准，保持中间件在路由前。）

- [x] **Step 4: 运行确认通过**

Run: `pnpm --filter @dental/v2 test src/server/http/app.spec.ts`
Expected: 新增 3 个用例 PASS，全文件无回归。

- [x] **Step 5: 手工实测（本机）**

```bash
cd apps/v2 && NODE_ENV=test V2_PORT=3980 pnpm exec tsx src/server/main.ts > /tmp/v2-api.log 2>&1 &
curl -s -i -H 'Origin: null' http://127.0.0.1:3980/api/v2/health | head -5   # 期望 200 + access-control-allow-origin: null
curl -s -i -H 'Origin: file://C:/x/index.html' http://127.0.0.1:3980/api/v2/health | head -5  # 期望 200 + ACAO file://
# 结束进程（只杀本次启动的 PID）
```

- [x] **Step 6: 提交**

```bash
git add apps/v2/src/server/http/app.ts apps/v2/src/server/http/app.spec.ts
git commit -m "fix(v2): allow null/file origins for packaged renderer and scope CORP to files"
```

**验收：** 测试通过 + 手工 curl 两条期望头出现；T3.3 合入后此行为不得回退（T3.3 需补回归）。

---

## Wave 1 — 数据正确性与审计（新 P0/P1）

### Task T2R-02: FTS 运行期索引维护（R2-P0-02）

**Files:**
- Modify: `src/server/infrastructure/search-index.ts`（新增 `upsertSearchRow` / `removeSearchRow` / `refreshPatientChildSearchRows`）
- Modify: `src/server/infrastructure/repository.ts`（insert / update / softDelete 写后维护）
- Test: `src/server/infrastructure/search-index.spec.ts`（新建）+ `src/server/infrastructure/repository.spec.ts`（写路径断言）

**Interfaces:**
- Produces:
  - `upsertSearchRow(db: Database.Database, resource: string, id: string): void` —— 按 resource 的单行 upsert（DELETE + INSERT，SQL 与 `rebuildSearchIndex` 同源表达式）
  - `removeSearchRow(db: Database.Database, resource: string, id: string): void`
  - `refreshPatientChildSearchRows(db: Database.Database, patientId: string): void` —— 重建 Appointment/Charge/FollowUp 中该患者的索引行
- Consumes: `resource.searchIndexResource`（resources.ts 已定义 6 个：Patient/InventoryItem/Supplier/Appointment/Charge/FollowUp）

**背景（已坐实）：** T2.1 删除 19 个 FTS 触发器后，运行期 CRUD 不写 `SearchIndex`，仅启动 `rebuildSearchIndex`（`main.ts:62-66`）。`repository.ts:89-94` 的 FTS 检索将随数据变更失真。

- [x] **Step 1: 写失败测试（search-index.spec.ts）**

```ts
describe('runtime search index maintenance', () => {
  let db: Database.Database;
  // 用真实 schema 建库（runMigrations 到最新），插入 1 个 Patient，rebuildSearchIndex
  beforeEach(() => { /* mkdtemp + createDatabase + runMigrations + seed 最小数据 */ });

  it('upserts a row for a new patient', () => {
    // 直接 INSERT Patient 后调用 upsertSearchRow(db, 'Patient', id)
    upsertSearchRow(db, 'Patient', id);
    const row = db.prepare('SELECT content FROM SearchIndex WHERE resource = ? AND recordId = ?').get('Patient', id);
    expect(row?.content).toContain(name);
  });

  it('removes the row on soft delete', () => {
    removeSearchRow(db, 'Patient', id);
    expect(db.prepare('SELECT 1 FROM SearchIndex WHERE resource = ? AND recordId = ?').get('Patient', id)).toBeUndefined();
  });

  it('refreshes child rows when patient name changes', () => {
    // Appointment 存在且内容含旧患者名；更新 Patient.name 后 refreshPatientChildSearchRows
    // 断言 Appointment 索引行内容含新名
  });
});
```

- [x] **Step 2: 运行确认失败**

Run: `pnpm --filter @dental/v2 test src/server/infrastructure/search-index.spec.ts`
Expected: FAIL（函数不存在）。

- [x] **Step 3: 实现 search-index.ts**

```ts
const SEARCH_UPSERT_SQL: Record<string, string> = {
  Patient: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'Patient', id, clinicId, trim(COALESCE(name,'')||' '||COALESCE(code,'')||' '||COALESCE(phone,''))
            FROM Patient WHERE id = ? AND deletedAt IS NULL`,
  InventoryItem: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'InventoryItem', id, clinicId, trim(COALESCE(name,'')||' '||COALESCE(code,'')||' '||COALESCE(category,''))
            FROM InventoryItem WHERE id = ? AND deletedAt IS NULL`,
  Supplier: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'Supplier', id, clinicId, trim(COALESCE(name,'')||' '||COALESCE(code,'')||' '||COALESCE(phone,''))
            FROM Supplier WHERE id = ? AND deletedAt IS NULL`,
  Appointment: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'Appointment', A.id, A.clinicId,
                   trim(COALESCE(P.name,'')||' '||COALESCE(A.startTime,'')||' '||COALESCE(A.status,''))
            FROM Appointment A LEFT JOIN Patient P ON P.id = A.patientId
            WHERE A.id = ? AND A.deletedAt IS NULL`,
  Charge: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'Charge', C.id, C.clinicId,
                   trim(COALESCE(P.name,'')||' '||COALESCE(C.number,'')||' '||COALESCE(C.status,''))
            FROM Charge C LEFT JOIN Patient P ON P.id = C.patientId
            WHERE C.id = ? AND C.deletedAt IS NULL`,
  FollowUp: `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
            SELECT 'FollowUp', F.id, F.clinicId,
                   trim(COALESCE(P.name,'')||' '||COALESCE(F.content,'')||' '||COALESCE(F.status,'')||' '||COALESCE(F.planDate,''))
            FROM FollowUp F LEFT JOIN Patient P ON P.id = F.patientId
            WHERE F.id = ? AND F.deletedAt IS NULL`,
};

export function upsertSearchRow(db: Database.Database, resource: string, id: string): void {
  const sql = SEARCH_UPSERT_SQL[resource];
  if (!sql) return;
  db.prepare('DELETE FROM SearchIndex WHERE resource = ? AND recordId = ?').run(resource, id);
  db.prepare(sql).run(id);
}

export function removeSearchRow(db: Database.Database, resource: string, id: string): void {
  db.prepare('DELETE FROM SearchIndex WHERE resource = ? AND recordId = ?').run(resource, id);
}

export function refreshPatientChildSearchRows(db: Database.Database, patientId: string): void {
  for (const resource of ['Appointment', 'Charge', 'FollowUp'] as const) {
    const children = db.prepare(
      `SELECT id FROM ${resource === 'Appointment' ? 'Appointment' : resource} WHERE patientId = ? AND deletedAt IS NULL`,
    ).all(patientId) as Array<{ id: string }>;
    for (const child of children) upsertSearchRow(db, resource, child.id);
  }
}
```

- [x] **Step 4: repository 写路径接线**

`repository.ts` 的 `insert` 成功返回前、`update` 成功后、`softDelete` 成功后分别加：

```ts
if (this.resource.searchIndexResource) {
  if (operation === 'delete') removeSearchRow(this.db, this.resource.searchIndexResource, id);
  else upsertSearchRow(this.db, this.resource.searchIndexResource, id);
}
```

患者改名/软删的级联：`resource.name === 'patients'` 的 update 成功后调用 `refreshPatientChildSearchRows(this.db, id)`；softDelete 患者时对子资源行执行 `removeSearchRow`（子行按 `patientId` 查 `Appointment/Charge/FollowUp` 后逐个删除）。

- [x] **Step 5: repository.spec.ts 断言**

在现有 repository 写路径用例中补：`insert` 后 SearchIndex 有行、`update` 后内容更新、`softDelete` 后行被删；`patients` 改名后 Appointment 索引行含新名。

- [x] **Step 6: 运行确认通过**

Run: `pnpm --filter @dental/v2 test src/server/infrastructure/search-index.spec.ts src/server/infrastructure/repository.spec.ts`
Expected: 全 PASS。

- [x] **Step 7: 提交**

```bash
git add apps/v2/src/server/infrastructure/search-index.ts apps/v2/src/server/infrastructure/repository.ts apps/v2/src/server/infrastructure/search-index.spec.ts
git commit -m "fix(v2): maintain FTS search index on runtime CRUD writes"
```

**验收：** 写路径维护索引 + 患者改名级联刷新；全量测试无回归。

---

### Task T2R-03: 迁移 121 回填撞索引兜底（R2-P0-03）

**Files:**
- Modify: `src/server/infrastructure/migrations.ts`（`runMigrations` 内、应用 121 前插入 preflight；新增 `dedupNullClinicRows`）
- Test: `src/server/infrastructure/migrations.spec.ts`（沿用现有建库模式）

**Interfaces:**
- Produces: `dedupNullClinicRows(db: Database.Database, table: string, uniqueColumn: string): number` —— 对 `clinicId IS NULL` 的重复组保留 `MAX(id)`，其余追加 `-dup-N` 后缀并写 MigrationRepairLog；返回修复行数
- Consumes: `resourceRegistry`（唯一字段）、`repairLegacyData` 现有的 log 表/模式

**背景（已坐实）：** 118 建 `(clinicId, field) WHERE deletedAt IS NULL` 唯一索引时 NULL 行不冲突；121 把 NULL 统一回填为最早诊所后，旧库中 `(NULL, 同卡号/同单号)` 的重复行直接撞索引 → 迁移抛错 → 启动崩溃。`repairLegacyData` 去重只覆盖非 NULL 行（`migrations.ts:862-874`）。

- [x] **Step 1: 写失败测试**

```ts
it('preflight dedups NULL-clinic rows before migration 121 backfill', () => {
  // 建库并迁移到 120；手工向 MemberCard 插入两行 (clinicId NULL, cardNo 'CARD-1')；
  // 调用 runMigrations 的待应用列表 [121]（或直接调 dedupNullClinicRows + 121.up）
  // 断言：不抛错；两行 clinicId 均被回填且 cardNo 唯一（一行保留，一行 -dup-1）
});
```

- [x] **Step 2: 运行确认失败**

Expected: FAIL（当前 121 直接抛 UNIQUE constraint failed）。

- [x] **Step 3: 实现 preflight**

```ts
function dedupNullClinicRows(db: Database.Database, table: string, uniqueColumn: string): number {
  // 建 MigrationRepairLog（复用 repairLegacyData 的模式）
  const dupRows = db.prepare(
    `SELECT id, ${uniqueColumn} AS value FROM "${table}" t
     WHERE t.clinicId IS NULL
       AND EXISTS (SELECT 1 FROM "${table}" t2
                   WHERE t2.clinicId IS NULL AND t2.${uniqueColumn} = t.${uniqueColumn} AND t2.id != t.id)
       AND t.id != (SELECT MAX(id) FROM "${table}" t3
                    WHERE t3.clinicId IS NULL AND t3.${uniqueColumn} = t.${uniqueColumn})`,
  ).all() as Array<{ id: string; value: string }>;
  let n = 1;
  for (const dup of dupRows) {
    let after = `${dup.value}-dup-${n++}`;
    while (db.prepare(`SELECT 1 FROM "${table}" WHERE ${uniqueColumn} = ? AND id != ? LIMIT 1`).get(after, dup.id)) {
      after = `${dup.value}-dup-${n++}`;
    }
    db.prepare(`UPDATE "${table}" SET ${uniqueColumn} = ? WHERE id = ?`).run(after, dup.id);
    db.prepare(
      `INSERT INTO MigrationRepairLog (id, tableName, field, recordId, beforeValue, afterValue, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), table, uniqueColumn, dup.id, dup.value, after, 'NULL clinicId 重复键追加后缀（121 回填前）');
  }
  return dupRows.length;
}
```

`runMigrations` 中（迁移循环前）：

```ts
if (pendingVersions.includes(121)) {
  for (const resource of resourceRegistry.all()) {
    const uniqueField = resource.fields.find((f) => f.unique);
    if (!uniqueField) continue;
    const cols = db.prepare(`PRAGMA table_info("${resource.table}")`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'clinicId')) continue;
    dedupNullClinicRows(db, resource.table, uniqueField.name);
  }
}
```

（`pendingVersions` 以实际 runMigrations 的待应用列表变量为准；只针对唯一字段且带 clinicId 列的表。）

- [x] **Step 4: 运行确认通过**

Run: `pnpm --filter @dental/v2 test src/server/infrastructure/migrations.spec.ts`
Expected: 新用例 PASS，既有迁移用例无回归。

- [x] **Step 5: 提交**

```bash
git add apps/v2/src/server/infrastructure/migrations.ts
git commit -m "fix(v2): preflight dedup NULL-clinic rows before backfill migration 121"
```

**验收：** 构造库升级不崩、修复写入 MigrationRepairLog；真实旧库升级演练见 T2R-22。

---

### Task T2R-04（承接）: 分页参数非法返回 400（R2-P1-01）

**执行卡片：** 按第一轮 `docs/plans/2026-08-05-audit-fixes.md` **Task 4.3** 的完整定义执行（提前到 Wave 1）。
- 补证：`router.ts:33` `Number(req.query.pageSize ?? 20)` 对 `pageSize=abc` 得 NaN，`repository.ts:68` `Math.min(200, Math.max(1, NaN))` 仍是 NaN → `LIMIT NaN` 被 SQLite 视为 `LIMIT NULL` → **全表返回**（`page` 同理 → OFFSET NaN → 0）。
- 验收补充：`GET /api/v2/resources/patients?pageSize=abc` → 400；`pageSize=999999` → 钳到 200；负数/0 → 400 或钳 1（以 Task 4.3 定义为准）。
- 提交后在本计划 Wave 1 内继续下一任务。

---

### Task T2R-05: memberStats 漏软删过滤（R2-P1-02）

**Files:**
- Modify: `src/server/application/read-services.ts:142-148`
- Test: `src/server/application/services.spec.ts`（stats 用例）

**背景（已坐实）：** memberStats 的会员统计 COUNT 无 `deletedAt IS NULL`，已软删会员计入统计。

- [x] **Step 1: 写失败测试**：建 1 个会员 → 软删 → memberStats 计数应为 0（当前为 1）。
- [x] **Step 2: 运行确认失败**：FAIL。
- [x] **Step 3: 实现**：给该 COUNT 加 `AND deletedAt IS NULL`（如聚合中还包含其他表，逐表核对同列）。
- [x] **Step 4: 运行确认通过**：`pnpm --filter @dental/v2 test src/server/application/services.spec.ts` PASS。
- [x] **Step 5: 提交**

```bash
git add apps/v2/src/server/application/read-services.ts apps/v2/src/server/application/services.spec.ts
git commit -m "fix(v2): exclude soft-deleted members from member stats"
```

---

### Task T2R-06: FollowUpTemplate 小数默认值过不了整数校验（R2-P1-03）

**Files:**
- Modify: `src/server/http/validation.ts`（新增 `case 'decimal'`）
- Modify: `src/domain/resources.ts:527-544`（riskMultiplier* 改 `'decimal'`）
- Test: `src/server/http/validation.spec.ts` + `src/server/http/app.spec.ts`（CRUD 创建）

**背景（已坐实）：** `validatePayload` 对未提供字段套用默认值并过 `validateField`（`validation.ts:17-19`）；`'number'` 强制 `Number.isInteger`（`:60`）→ `riskMultiplierHigh: 0.75` / `riskMultiplierExtreme: 0.5` 默认值直接抛错 → **创建随访模板必 400**（显式传整数值可绕过）。

- [x] **Step 1: 写失败测试**

```ts
// validation.spec.ts
it('accepts fractional decimal values', () => {
  const out = validatePayload(/* followUpTemplates 资源定义 */, { riskMultiplierHigh: 0.75 });
  expect(out.riskMultiplierHigh).toBe(0.75);
});

// app.spec.ts
it('creates a follow-up template with fractional default multipliers', async () => {
  const res = await request(app)
    .post('/api/v2/resources/follow-up-templates')
    .set(authBoss)
    .send({ name: 'T1', daysAfter: 3, minIntervalDays: 7, recommendedIntervalDays: 14, maxIntervalDays: 30 });
  expect(res.status).toBe(201);
});
```

- [x] **Step 2: 运行确认失败**：两个用例 FAIL（当前抛 "must be an integer amount in cents"）。
- [x] **Step 3: 实现 validation.ts**

```ts
case 'decimal': {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) throw new ValidationError(`${field.name} must be a number`);
  if (field.min !== undefined && value < field.min) throw new ValidationError(`${field.name} must be >= ${field.min}`);
  if (field.max !== undefined && value > field.max) throw new ValidationError(`${field.name} must be <= ${field.max}`);
  return value;
}
```

`resources.ts`：`riskMultiplierLow/Medium/High/Extreme` 的 `f('...', 'number', ...)` 改为 `f('...', 'decimal', ...)`，默认值 1/1/0.75/0.5 不变。

- [x] **Step 4: 运行确认通过**：`pnpm --filter @dental/v2 test src/server/http/validation.spec.ts src/server/http/app.spec.ts` PASS。
- [x] **Step 5: 提交**

```bash
git add apps/v2/src/server/http/validation.ts apps/v2/src/domain/resources.ts apps/v2/src/server/http/validation.spec.ts apps/v2/src/server/http/app.spec.ts
git commit -m "fix(v2): add decimal field type so follow-up template multipliers validate"
```

---

### Task T2R-07: SyncChange 断链修复（R2-P1-04）

**Files:**
- Create: `src/server/infrastructure/sync-change.ts`
- Modify: `src/server/infrastructure/repository.ts`（insert/update/softDelete 调用 recorder）
- Modify: `src/server/application/service-modules/sync.ts`（`record()` 委托 helper，保持现有行为）
- Test: `src/server/infrastructure/repository.spec.ts` + `src/server/application/service-modules/sync.spec.ts`

**Interfaces:**
- Produces: `recordSyncChange(db: Database.Database, change: { tableName: string; recordId: string; operation: 'CREATE' | 'UPDATE' | 'DELETE'; clinicId: string }): void` —— 以 `deviceId = 'server'` 写入（SyncChange.deviceId NOT NULL，`database.ts:173-186`；`pull` 的 `deviceId != ?` 排除条件对哨兵值天然生效）
- Consumes: 无

**背景（已坐实）：** 本地 CRUD 不产生 SyncChange，唯一写点在 `SyncService.record`（`sync.ts:150`），而它只在 push 路径被调用 → 其他设备 pull 永远拿不到本机变更。

- [x] **Step 1: 写失败测试**

```ts
// repository.spec.ts：insert 患者后
it('records a sync change for repository writes', () => {
  // 断言 SyncChange 存在 (tableName='Patient', operation='CREATE', deviceId='server')
});
// sync.spec.ts：record 后 pull 排除自身设备但包含 server 变更
it('pulls server-originated changes to other devices', () => {
  // 直接调用 SyncService.record（现有行为）+ pull(deviceA) → 包含该行
});
```

- [x] **Step 2: 运行确认失败**：repository 用例 FAIL（无 SyncChange 行）。
- [x] **Step 3: 实现**

```ts
// sync-change.ts
export function recordSyncChange(db: Database.Database, change: {
  tableName: string; recordId: string; operation: 'CREATE' | 'UPDATE' | 'DELETE'; clinicId: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO SyncChange (id, clinicId, createdAt, updatedAt, deletedAt, tableName, recordId, operation, deviceId)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'server')`,
  ).run(randomUUID(), change.clinicId, now, now, change.tableName, change.recordId, change.operation);
}
```

`repository.ts`：insert/update/softDelete 成功后（有 clinicId 时）调用 `recordSyncChange(this.db, { tableName: this.resource.table, recordId: id, operation: 'CREATE'|'UPDATE'|'DELETE', clinicId: context.clinicId })`。
`sync.ts` 的 `record()` 改为内部调用 `recordSyncChange`（保留原签名与调用方，push 路径行为不变）。

- [x] **Step 4: 全服务直写扫描**：`grep -rn "INSERT INTO \|UPDATE " src/server/application/service-modules --include='*.ts' | grep -v spec`，对直写同步业务表的服务（Charge/ChargeItem/Treatment/Visit/FollowUp/Patient/Appointment/InventoryItem 等）逐个补 `recordSyncChange` 调用；本任务至少覆盖 Charge、Patient 两个高频路径，其余列入任务备注由 T4.1 统一兜底（T4.1 执行时同步完成全量接线）。
- [x] **Step 5: 运行确认通过**：`pnpm --filter @dental/v2 test src/server/infrastructure/repository.spec.ts src/server/application/service-modules/sync.spec.ts` PASS。
- [x] **Step 6: 提交**

```bash
git add apps/v2/src/server/infrastructure/sync-change.ts apps/v2/src/server/infrastructure/repository.ts apps/v2/src/server/application/service-modules/sync.ts
git commit -m "fix(v2): emit sync changes for local CRUD writes"
```

---

### Task T2R-08: 前端硬编码 demo ID 修复（R2-P1-05）

**Files:**
- Modify: `src/web/pages/InventoryPage.tsx:10`、`src/web/pages/PatientTimelinePage.tsx:16`
- Test: 对应页面 spec（如存在）或新增组件级测试

**背景（已坐实）：** `useState('inventory-demo-001')` / `useState('patient-demo-001')` 写死 demo 行 ID，真实部署（非 seed 环境）下页面永远查不到数据。

- [x] **Step 1: 写失败测试**：mock API 返回真实列表（无 demo ID）时，页面应显示首条数据而非空态。
- [x] **Step 2: 运行确认失败**：FAIL（固定 demo ID 查不到）。
- [x] **Step 3: 实现**：初始状态改为从路由参数（如 `?id=`）或列表首项派生：`useState<string | null>(null)` + 加载列表后 `setSelectedId(list[0]?.id ?? null)`；无数据时渲染空态文案。保持 URL 可直达（`useSearchParams` 读 id）。
- [x] **Step 4: 运行确认通过** + 全量 web 测试。
- [x] **Step 5: 提交**

```bash
git commit -m "fix(v2): derive inventory and patient timeline initial ids from data"
```

---

### Task T2R-09: 审计盲区修复：4xx 落库 + 403/401 不再短路（R2-P1-07）

**Files:**
- Modify: `src/server/http/app.ts:262-282`（中间件顺序与过滤条件）
- Test: `src/server/http/app.spec.ts`

**背景（已坐实）：** 审计中间件挂在角色中间件**之后**且跳过 `statusCode >= 400` → 403/401/4xx 全部无痕；越权尝试（最有审计价值的行为）不落库。

- [x] **Step 1: 写失败测试**

```ts
it('audits forbidden attempts', async () => {
  // RECEPTIONIST 访问 /api/v2/resources/member-cards → 403
  // 断言 OperationLog/审计表新增一行 action 含该请求、status 403
});
it('does not audit GET requests', () => { /* 现有行为保留 */ });
```

- [x] **Step 2: 运行确认失败**：403 用例 FAIL（无审计行）。
- [x] **Step 3: 实现**：将审计中间件移到角色中间件之前（认证之后），条件改为 `if (req.method === 'GET') return;`（记录全部非 GET 状态，含 4xx/5xx）；审计行记录 `statusCode`。注意 `req.context` 在认证后已可用；403 由后续中间件短路时 `res.on('finish')` 仍会触发。
- [x] **Step 4: 运行确认通过** + 全量测试（审计相关既有断言如"GET 不审计"需保持）。
- [x] **Step 5: 提交**

```bash
git commit -m "fix(v2): record failed and forbidden requests in audit log"
```

---

### Task T2R-10: 幂等记录 COMPLETED 更新原子化（R2-P1-08）

**Files:**
- Modify: 幂等中间件/服务实现（`src/server/http/` 或 `infrastructure/` 中 idempotency 相关文件，以 grep 定位）
- Test: 幂等相关 spec（`app.spec.ts` 或专门文件）

**背景（条件成立）：** 业务事务提交后单独 `UPDATE IdempotencyRecord SET status='COMPLETED'`，若该 UPDATE 失败则回退 `DELETE` 记录 → 客户端重试时业务重复执行。

- [x] **Step 1: 写失败测试**：模拟业务成功后幂等状态更新抛错（注入），断言业务事务回滚（记录不存在或 status=PENDING，业务副作用不存在）。
- [x] **Step 2: 运行确认失败**。
- [x] **Step 3: 实现**：把状态更新移入业务事务内（同一 `db.transaction`），删除提交后的 UPDATE + 失败 DELETE 回退逻辑；保持重试路径（PENDING/COMPLETED 判断）不变。
- [x] **Step 4: 运行确认通过** + 全量测试。
- [x] **Step 5: 提交**

```bash
git commit -m "fix(v2): mark idempotency records complete inside the business transaction"
```

---

## Wave 2 — 承接第一轮安全（T3.2–T3.7）

按承接清单顺序执行 T3.2 → T3.3（在 T2R-01 基础上收紧，保留 file:// 与 'null' 放行）→ T3.4（含 backup-key 静默重生成改显式确认）→ T3.5（含公式注入转义 + phone 入 SENSITIVE_FIELDS）→ T3.6（含 dev seed 门：非 production 默认不重置 admin123，`V2_ALLOW_DEV_SEED=1` 才重置）→ T3.7（含 updater 签名校验、token 内存回退、崩溃上报最小化）。

每任务结束：调用方评审门禁 + 全量测试 + 独立提交；迁移需求（如有）从 **122** 起编号。

## Wave 3 — 承接 Phase 4 + 新中危项

按承接清单执行 T4.1、T4.2、T4.4–T4.11（T4.3 已在 Wave 1 完成），并执行下列新任务：

### Task T2R-11: 通知/微信发送角色收窄（R2-P2-01）
- `resources.ts` notifications 资源 roles 收窄为 `['BOSS', 'ADMIN']`（或仅系统创建，以 T3.x 权限模型为准）；route-policy `wechat send-batch` 收窄为 `['BOSS', 'ADMIN']`。
- 测试：RECEPTIONIST 创建通知 → 403；发送微信批量 → 403。
- 提交：`fix(v2): narrow notification and wechat broadcast roles`。

### Task T2R-12: errorMiddleware details 收敛（R2-P2-02）
- `middleware.ts:51`：`details` 仅在 `status < 500` 且 code 属于白名单（如 `VALIDATION`）时返回；5xx 一律剥离。
- 测试：`middleware.spec.ts` 断言 5xx 响应无 details。
- 提交：`fix(v2): stop leaking internal error details on 5xx`。

### Task T2R-13: API 子进程孤儿化防护（R2-P1-09）
- `main.cjs`：主进程与 API 子进程间加心跳（子进程定期检查父进程存活，如 `process.ppid` 轮询或 IPC ping；超时自动退出）；主进程退出钩子确保 kill 子进程。
- 测试：脚本级验证（起子进程、杀父进程、断言子进程退出）。
- 提交：`fix(v2): guard api child process against orphaned writes`。

### Task T2R-14: ensureApiServerRunning 健康检查策略（R2-P1-11）
- 将 1.5s 固定窗口改为"首启放宽 + 后续严格"两级策略（首启允许更长，运行中缩短）；误杀时记录日志并保留现场。
- 提交：`fix(v2): relax api readiness window on first launch`。

### Task T2R-15: 64KB 导入启发式修正（R2-P1-12）
- `main.ts:30`：`size < 64 * 1024` 启发式改为"仅当 v2.sqlite 不存在时导入"；存在时校验完整性（quick_check），失败才提示走导入/恢复。
- 测试：main 级逻辑抽函数单测（构造存在/不存在的库）。
- 提交：`fix(v2): import legacy db only when v2 db is absent`。

### Task T2R-16: FTS 检索子查询 clinicId 过滤（R2-P2-04）
- `repository.ts:89-94`：`id IN (SELECT recordId FROM SearchIndex WHERE SearchIndex MATCH ? AND resource = ? AND clinicId = ?)`，补 `clinicId` 参数（tenantParams）。
- 测试：跨诊所数据不出现在对方检索结果。
- 提交：`fix(v2): scope FTS search subquery to the tenant`。

## Wave 4 — 卫生与交付

按承接清单执行 T5.1（与 T2R-18 合并）、T5.2、T5.3、T5.4（与 T2R-19 合并）、T5.5（独立子计划），并执行：

### Task T2R-17: dental.sqlite 出库（R2-P0-04）
- `git rm --cached apps/v2/legacy/dental.sqlite`（本地文件保留在磁盘）；`.gitignore:18` 删除 `!apps/v2/legacy/dental.sqlite` 例外。
- `main.ts:15-17`：`selfContainedLegacyDb` 回退删除，`legacyDbPath` 仅来自 `V2_LEGACY_DB_PATH`；`legacy/schema` 目录保留（schema SQL 无 PII）。
- README 迁移说明：老克隆升级者把旧 dental.sqlite 移到任意路径并用 `V2_LEGACY_DB_PATH` 指向。
- 提交：`chore(v2): remove legacy patient database from repository`。

### Task T2R-18: 死变量/死导出清理（R2-P2-10 本轮清单）
- 删除 `app.ts:205-206` `_configuredPort`/`_viteDevPort`；`AuthService.me`、`AuditService.log`、`fromNativeError`（先 grep 确认无引用，`fromNativeError` 若被 spec 引用则一并清理）；`test-utils.tsx` 死文件。
- 与 T5.1 的 knip 清单合并；`pnpm --filter @dental/v2 knip` 前后对比。
- 提交：`chore(v2): remove dead exports and unused test scaffolding`。

### Task T2R-19: .env.example + 版本统一 + 端口说明（R2-P2-14/15）
- 新建 `apps/v2/.env.example`：列出全部 `V2_*` 变量（以 `grep -rho 'V2_[A-Z_]*' src electron | sort -u` 为准，约 26 个）并逐项注释；与 T5.4 合并统一版本号 2.2.0。
- README 开发节注明：Windows 端口排除范围可能占用 3180，用 `V2_PORT=3980` 覆盖。
- 提交：`docs(v2): document environment variables and local port caveat`。

### Task T2R-20: 前端数据完整性批（R2-P1-16/17/18/19）
按子项分批提交（每批独立评审）：
1. 10 个无 loading/error 态的页面补 QueryBoundary/Skeleton/错误重试（复用现有模式）。
2. 22 处 `pageSize: 200` 下拉截断 → 改为服务端分页加载（`onLoadMore`/`onSearch` 重新查询）；列表页保留分页组件。
3. UUID 显示 → 用 labelField（资源元数据）渲染；看板 3/6 截断 → 服务端查询补足（协同 T4.2）。
4. 打印数据改 POST 打印接口（不塞 URL）；`requestId` 改 `crypto.randomUUID()`。
5. 401 全局登出；BackupsPage 恢复/cleanup 加 confirm；治疗计划/处方创建失败清理孤儿。
6. ErrorBoundary 下放到 hub 各页。
提交示例：`fix(v2): add loading and error states to remaining resource pages`（每子项独立提交）。

### Task T2R-21: CI 测试去重 + 审计报告副本补全（R2-P1-23）
- CI：同一份全量测试跑 3 遍 → 合并为 1 次（核对 CI 配置里各 job 的职责，仅保留唯一全量 job + 增量 job）。
- `docs/audits/性能审计报告-v2.md`：从仓库外完整版（16.5KB）补全仓库内副本（当前 6.3KB 截断）。
- 提交：`ci(v2): run full test suite once and restore performance audit report`。

## Wave 5 — 打包实测门

### Task T2R-22: 打包实测报告（R2-P0-01 终确认 + 第 7 节清单）

**前置：** T2R-01、T3.3、T3.4、T3.7 已合入。

- [x] 在合入最新代码的构建上执行：`pnpm --filter @dental/v2 electron:pack` 与安装包安装。
- [x] 实测清单（每项记录证据，输出 `docs/audits/打包实测报告-<date>.md`）：
  1. file:// 渲染器登录 → 列表/详情 API 正常（CORS 终确认；失败即回 T2R-01）。
  2. 图片/头像加载正常（CORP 终确认）。
  3. 自动更新：签名缺失/不符时的行为符合 T3.7 定义。
  4. 升级冒烟走主进程路径（installer-smoke/upgrade-smoke）。
  5. 错误窗 → 重试 → 主窗重建。
  6. 强杀主进程 → API 子进程在心跳窗口内退出（T2R-13 验证）。
- [x] 旧库升级演练：用含 NULL clinicId 重复行的旧版数据包升级 → 不崩溃（T2R-03 验证）。
- [x] 提交：`docs(v2): add packaging verification report`。

**验收：** 报告覆盖 7 项实测并给出 PASS/FAIL + 证据；FAIL 项转回对应任务修复后重测。

---

## 覆盖矩阵（第二轮审计发现 → 任务）

| 审计发现 | 任务 |
|---|---|
| R2-P0-01 CORS null origin | T2R-01（+T3.3 回归） |
| R2-P0-02 FTS 运行期不维护 | T2R-02 |
| R2-P0-03 迁移 121 撞索引 | T2R-03（+T2R-22 演练） |
| R2-P0-04 dental.sqlite PII | T2R-17 |
| R2-P0-05 计划文档失真 | 本次文档更新（T2R-00，见下） |
| R2-P1-01 pageSize NaN | T4.3（提前 Wave 1） |
| R2-P1-02 memberStats 软删 | T2R-05 |
| R2-P1-03 FollowUpTemplate 校验 | T2R-06 |
| R2-P1-04 SyncChange 断链 | T2R-07（+T4.1 兜底） |
| R2-P1-05 demo ID | T2R-08 |
| R2-P1-06 CORP 阻断 | T2R-01 |
| R2-P1-07 审计盲区 | T2R-09（+T4.5 协同） |
| R2-P1-08 幂等原子性 | T2R-10 |
| R2-P1-09 子进程孤儿化 | T2R-13 |
| R2-P1-10 uncaughtException 不退出 | T3.7（并入） |
| R2-P1-11 健康检查误杀 | T2R-14 |
| R2-P1-12 64KB 导入启发式 | T2R-15 |
| R2-P1-13 backup-key 静默重生成 | T3.4（并入） |
| R2-P1-14 签名/updater | T3.7（并入） |
| R2-P1-15 打包验证盲区 | T2R-22 |
| R2-P1-16/17/18/19 前端数据完整性 | T2R-20 |
| R2-P1-20 IPC/JWT/token | T3.3/T3.4/T3.7 |
| R2-P1-21 错误窗/渲染崩溃 | T3.7 + T2R-22 |
| R2-P1-22 UserClinic 成员 | T3.2 关联项（补 UserClinic 一致性） |
| R2-P1-23 CI 三遍/报告副本 | T2R-21 |
| R2-P2-01 通知/微信角色 | T2R-11 |
| R2-P2-02 details 透传 | T2R-12 |
| R2-P2-03 CSV 公式注入 | T3.5（并入） |
| R2-P2-04 FTS 租户过滤/表名白名单 | T2R-16（表名白名单并入 T5.1 安全审查） |
| R2-P2-05 sqlite-files/sync push | T4.1（并入） |
| R2-P2-06 唯一索引 NULL/备份清理 | T2R-03 + T3.2（并入） |
| R2-P2-07 退款 | T4.8（并入） |
| R2-P2-08 restore/updateUser/双点耦合 | T4.6/T3.3（并入） |
| R2-P2-09 datetime/churn/UTC/N+1 | T4.7 + T4.2（并入） |
| R2-P2-10 死代码 | T2R-18 + T5.1 |
| R2-P2-11 flushAudit | T4.10（并入） |
| R2-P2-12 前端杂项 | T2R-20 |
| R2-P2-13 Electron 杂项 | T3.3/T3.7（并入） |
| R2-P2-14/15 工程文档 | T2R-19 + T5.3/T5.4 |
| R2-P2-16 seed 重置 | T3.6（并入） |
| R2-P2-17 限流/掩码/BackupRecord | T3.2/T3.5/T3.3（并入） |

**T2R-00（本次一并完成）:** 更新第一轮计划文档状态——勾选已完成项（Phase 0/1/2 + T3.1）、迁移编号基准 118→122、标注 T2.1 引入的 FTS 副作用与对应修复引用。提交：`docs(v2): mark round-1 plan progress and refresh migration baseline`。

## Self-Review 记录

1. **Spec 覆盖**：第二轮报告 P0（5 项）→ T2R-01/02/03/17/00；P1 关键项全部映射；P2/P3 通过并入承接任务覆盖；无遗漏项。报告第 7 节 6 项实测全部进 T2R-22。
2. **Placeholder 扫描**：所有新任务含具体文件、代码或明确 grep 定位指令；承接任务明确指向第一轮文档对应 Task（唯一事实源，避免双份漂移）。
3. **类型一致性**：`recordSyncChange` 签名在 T2R-07 全篇一致；`upsertSearchRow/removeSearchRow/refreshPatientChildSearchRows` 在 T2R-02 内部一致；`SEARCH_UPSERT_SQL` 键与 `searchIndexResource` 取值（Patient/InventoryItem/Supplier/Appointment/Charge/FollowUp）一致。
4. **依赖顺序**：T2R-01 先于 T3.3；T4.3 提前到 Wave 1 不依赖他人；T2R-03 不修改 121 内容（runMigrations 层 preflight）；T2R-22 依赖 T2R-01/13、T3.3/3.4/3.7 合入。
5. **约束复核**：无新依赖；迁移改动全部走 122+ 或运行时代码（不动 ≤121）；husky/commitlint 约束写入 Global Constraints。
