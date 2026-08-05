# 2026-08-05 全面审计修复计划（Dental Clinic V2）

> **For agentic workers:** Implement this plan task-by-task, with a review gate between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-08-05 深度审计发现的全部问题：门禁红态、3 个严重可靠性缺陷、FTS 写放大性能地雷、3 个高危安全缺陷、边界/异常/日志缺口与代码卫生问题，使 `pnpm verify` 全绿并恢复可发布状态。

**Architecture:** 修复按 6 个阶段推进：先恢复门禁与基线（修红测试 + 提交在途变更），再按 可靠性 → 性能 → 安全 → 边界/日志 → 代码卫生 的顺序逐项修复。数据库改动全部走**新增迁移**（118+），不修改已应用的迁移（1-117）；前端重构保持最小侵入；每个任务独立可测试、独立提交。

**Tech Stack:** TypeScript 5.7 / React 19 + react-router 8 / Express 5 / better-sqlite3（同步 API）/ Electron 43 / vitest 4 / pnpm 11。

## Global Constraints

- 所有命令在 `D:/Desktop/rongyi/source/` 下执行：`pnpm --filter @dental/v2 <script>`。
- 数据库只允许 better-sqlite3 + 参数化 SQL；禁止 ORM、新框架、新依赖（本计划不引入任何新包）。
- 迁移**只增不改**：已有迁移（≤117）不得编辑；新迁移从 118 开始编号，名称 `v2-<kebab-name>`。
- 提交信息必须符合 conventional commits（仓库配置了 commitlint + husky）。
- 每次提交前必须通过：`pnpm --filter @dental/v2 typecheck` + 相关测试文件。
- 软删除资源所有列表路径保留 `deletedAt IS NULL` 过滤。
- 业务路径禁止生产 `any` 与静默吞错。
- 生产环境 `V2_JWT_SECRET` 必须 ≥32 字符（main.ts 已强制）。
- Windows PowerShell 环境；bash 可用但文档命令以 pnpm 为准。

---

## Phase 0 — 门禁恢复与基线提交

### Task 0.1: QueryBoundary 增加 data 守卫，修复 7 个失败测试

**Files:**
- Modify: `src/web/components.tsx:70-86`（QueryBoundary）
- Modify: `src/web/DashboardPage.tsx:20-26` 及所有使用 `QueryBoundary` + `data!` 的页面
- Test: `src/web/DashboardPage.spec.tsx`（已存在，当前失败）

**Interfaces:**
- Produces: `QueryBoundary` 新增可选 prop `data?: unknown`；当 `data === undefined` 且无 error 时渲染 `PageError`，不再渲染 children。

**背景：** 7 个失败测试根因是 `DashboardPage.tsx:27` 的 `data!.patients` 在 `data === undefined` 时抛 TypeError；`QueryBoundary`（`components.tsx:83-85`）只检查 `isLoading` 与 `error`，不检查 `data === undefined`。所有新页面模板共用此模式。

- [ ] **Step 1: 确认失败基线**

```bash
pnpm --filter @dental/v2 exec vitest run src/web/DashboardPage.spec.tsx src/web/ClinicOverviewPage.spec.tsx src/web/ResourceHub.spec.tsx
```
Expected: 7 个 FAIL（`TypeError: Cannot read properties of undefined (reading 'patients')`）。

- [ ] **Step 2: 修改 QueryBoundary**

`src/web/components.tsx`：

```tsx
export function QueryBoundary({
  isLoading,
  error,
  data,
  loadingLabel,
  errorLabel,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  data?: unknown;
  loadingLabel?: string;
  errorLabel?: string;
  children: ReactNode;
}) {
  if (isLoading) return <LoadingState label={loadingLabel} />;
  if (error) return <PageError message={errorLabel ?? (error instanceof Error ? error.message : String(error))} />;
  if (data === undefined) return <PageError message={errorLabel ?? '数据加载失败'} />;
  return <>{children}</>;
}
```

- [ ] **Step 3: 找出所有缺 data 传参的 QueryBoundary 调用**

```bash
grep -rn "QueryBoundary" src/web --include="*.tsx" -A 6 | grep -B 1 "isLoading" | head -80
```

对每个调用点，把 `data` 传入：`<QueryBoundary isLoading={isLoading} error={error} data={data} ...>`。重点文件：`DashboardPage.tsx`、`ClinicOverviewPage.tsx`、`AnalyticsDashboardPage.tsx`、以及 hub 内所有新页面（`FirstExamsPage`、`PrescriptionsPage`、`TreatmentPlansPage`、`ImagingPage`、`CephalometricPage`、`MedicalRecordsPage`、`MemberCardsPage`、`PatientsPage`、`ProcessingOrdersPage`、`PurchaseOrdersPage` 等）。

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm --filter @dental/v2 test
```
Expected: 462 个测试全部 PASS（0 failed）。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "fix(v2): guard QueryBoundary against undefined data to fix dashboard crash"
```

---

### Task 0.2: 提交在途变更集（162 个文件）

**Files:** 整个 `source/` 工作树（115 modified + 47 untracked）。

**背景：** 工作树有 +5140/-1810 行未提交修改与 47 个未跟踪新文件（14 个新页面 + spec、`files.ts`、`scheduler.ts`、`ui-meta.ts` 等），CI 不覆盖未提交代码。先跑全量门禁确认绿，再整体提交建立检查点。

- [ ] **Step 1: 跑全量门禁**

```bash
pnpm --filter @dental/v2 typecheck && pnpm --filter @dental/v2 test && pnpm --filter @dental/v2 run knip && pnpm --filter @dental/v2 run lint
```
Expected: 全部通过。若 knip 报告未使用项（当前已知 `test-utils.tsx`、`fromNativeError`、`tenantWhereStrict`），先记录，Task 5.1 统一清理，**不要**在本任务删除（保持本任务只做提交）。

- [ ] **Step 2: 全量提交**

```bash
git add -A
git status --short | head -30   # 确认无敏感文件（*.enc、certs/、data/ 已被 .gitignore 覆盖）
git commit -m "feat(v2): deliver analytics hub pages, imaging/records/first-exams CRUD, files API and clinic overview"
```

- [ ] **Step 3: 验证提交干净**

```bash
git status --porcelain | wc -l   # Expected: 0
git log --oneline -1
```

---

### Task 0.3: 行尾符归一（.gitattributes）

**Files:**
- Create: `source/.gitattributes`
- 无代码改动。

**背景：** `core.autocrlf=true` 且无 `.gitattributes`，每次 diff 刷满 LF/CRLF 警告，污染评审。仓库文件当前以 LF 提交（git 警告"LF will be replaced by CRLF"）。

- [ ] **Step 1: 创建 .gitattributes**

`source/.gitattributes`：

```gitattributes
* text=auto eol=lf
*.bat text eol=crlf
*.ps1 text eol=crlf
*.ico binary
*.png binary
*.jpg binary
*.sqlite binary
*.sqlite-wal binary
*.sqlite-shm binary
*.blockmap binary
```

- [ ] **Step 2: 重新归一化工作树（如 git 提示需刷新）**

```bash
git add --renormalize .
git status --short | head -20
```
若出现大量仅行尾差异的 staged 文件，说明归一化生效；提交它们。

- [ ] **Step 3: 提交**

```bash
git commit -m "chore(v2): add .gitattributes with LF normalization"
```

---

## Phase 1 — 可靠性严重项

### Task 1.1: 迁移前数据修复 + 迁移前快照（C1）

**Files:**
- Modify: `src/server/infrastructure/migrations.ts`（`runMigrations` + `ensureForeignKeys`，691-724 行）
- Test: `src/server/infrastructure/migrations.spec.ts`

**Interfaces:**
- Produces: `runMigrations(db)` 内新增两个行为：(1) 应用任何迁移前执行 `snapshotDatabase(db, snapshotDir)`（VACUUM INTO）；(2) `ensureForeignKeys` 在 `INSERT INTO newTable SELECT` 之前执行 `repairLegacyData(db, table)`。
- Consumes: 无外部依赖；`db` 为 better-sqlite3 实例。

**背景：** 迁移 116 重建 6 张表（MemberCard/Refund/ChargeItem/PurchaseOrderItem/InventoryTransaction/ProcessingOrder）时，旧数据违反新 CHECK/UNIQUE/FK 约束 → INSERT SELECT 抛错 → 迁移回滚 → 启动崩溃循环。修复必须发生在迁移机制内（不能只加新迁移，因为 116 会在旧库上直接失败）。

- [ ] **Step 1: 写失败测试**

在 `migrations.spec.ts` 增加：构造含脏数据的库（负余额 MemberCard、amount=0 的 Refund、重复 cardNo、孤儿 FK），跑 `runMigrations`，断言：
1. 不抛异常；
2. 脏数据被修复（balance=0、refund amount=1、cardNo 去重）；
3. `MigrationRepairLog` 表存在且有记录。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/migrations.spec.ts
```
Expected: 新测试 FAIL（当前 ensureForeignKeys 直接抛错）。

- [ ] **Step 3: 在 runMigrations 前加快照**

`migrations.ts` 的 `runMigrations(db)` 开头（应用第一个迁移之前）：

```ts
function snapshotDatabase(db: Database.Database, snapshotDir: string): void {
  const dir = path.join(snapshotDir, 'pre-migration');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `pre-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  // VACUUM INTO 不能在事务内执行；runMigrations 开始时无事务，安全。
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
}
```
在 `runMigrations(db, { snapshotDir })` 中，应用迁移前调用 `snapshotDatabase(db, snapshotDir)`；`main.ts:58` 调用处传 `{ snapshotDir: dataDir }`。快照失败仅 `console.warn` 不阻断启动。

- [ ] **Step 4: 实现 repairLegacyData 并在 ensureForeignKeys 中调用**

`ensureForeignKeys(db, table, createSql)` 在 `INSERT INTO "${newTable}" ...` 之前插入：

```ts
function repairLegacyData(db: Database.Database, table: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS MigrationRepairLog (
    id TEXT PRIMARY KEY,
    tableName TEXT NOT NULL,
    field TEXT NOT NULL,
    recordId TEXT,
    beforeValue TEXT,
    afterValue TEXT,
    reason TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const log = (tableName: string, field: string, recordId: string, beforeValue: unknown, afterValue: unknown, reason: string): void => {
    db.prepare(
      `INSERT INTO MigrationRepairLog (id, tableName, field, recordId, beforeValue, afterValue, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), tableName, field, recordId, String(beforeValue ?? ''), String(afterValue ?? ''), reason);
  };
  const repairs: Record<string, Array<[string, string, string]>> = {
    MemberCard: [
      ['balance', 'UPDATE MemberCard SET balance = 0 WHERE balance < 0', '负余额钳为 0'],
      ['totalRecharge', 'UPDATE MemberCard SET totalRecharge = 0 WHERE totalRecharge < 0', '负充值额钳为 0'],
      ['totalConsume', 'UPDATE MemberCard SET totalConsume = 0 WHERE totalConsume < 0', '负消费额钳为 0'],
    ],
    Refund: [
      ['amount', 'UPDATE Refund SET amount = 1 WHERE amount IS NULL OR amount <= 0', '退款金额置为 1 分'],
    ],
    ChargeItem: [
      ['price', 'UPDATE ChargeItem SET price = 0 WHERE price IS NULL OR price < 0', '单价钳为 0'],
      ['quantity', 'UPDATE ChargeItem SET quantity = 1 WHERE quantity IS NULL OR quantity < 1', '数量置为 1'],
      ['subtotal', 'UPDATE ChargeItem SET subtotal = 0 WHERE subtotal IS NULL OR subtotal < 0', '小计钳为 0'],
    ],
    PurchaseOrderItem: [
      ['quantity', 'UPDATE PurchaseOrderItem SET quantity = 1 WHERE quantity IS NULL OR quantity <= 0', '数量置为 1'],
      ['unitPrice', 'UPDATE PurchaseOrderItem SET unitPrice = 0 WHERE unitPrice IS NULL OR unitPrice < 0', '单价钳为 0'],
    ],
    ProcessingOrder: [
      ['status', "UPDATE ProcessingOrder SET status = 'SENT' WHERE status IS NULL OR status NOT IN ('PENDING','DRAFT','SENT','IN_PROGRESS','COMPLETED','RECEIVED','CANCELLED')", '非法状态置为 SENT'],
    ],
  };
  for (const [field, sql, reason] of repairs[table] ?? []) {
    const rows = db.prepare(`SELECT id, ${field} AS beforeValue FROM "${table}" WHERE ${sql.split('WHERE ')[1]}`).all() as Array<{ id: string; beforeValue: unknown }>;
    db.exec(sql);
    for (const row of rows) log(table, field, row.id, row.beforeValue, null, reason);
  }
  // 唯一键去重：MemberCard(clinicId, cardNo) / ProcessingOrder(clinicId, number)
  const uniquePairs: Record<string, [string, string]> = {
    MemberCard: ['cardNo', 'cardNo'],
    ProcessingOrder: ['number', 'number'],
  };
  const pair = uniquePairs[table];
  if (pair) {
    const [column] = pair;
    const dups = db.prepare(
      `SELECT id, ${column} AS value, clinicId FROM "${table}"
       WHERE id IN (
         SELECT MAX(id) FROM "${table}"
         GROUP BY clinicId, ${column} HAVING COUNT(*) > 1
       )`,
    ).all() as Array<{ id: string; value: string; clinicId: string | null }>;
    let n = 1;
    for (const dup of dups) {
      const after = `${dup.value}-dup-${n++}`;
      db.prepare(`UPDATE "${table}" SET ${column} = ? WHERE id = ?`).run(after, dup.id);
      log(table, column, dup.id, dup.value, after, '重复唯一键追加后缀');
    }
  }
  // 孤儿外键：可空列置 NULL（日志记录）；NOT NULL 列移入隔离表
  const orphanFkRepairs: Record<string, Array<[string, string, boolean]>> = {
    ProcessingOrder: [['visitId', 'Visit', true], ['factoryId', 'ProcessingFactory', true], ['doctorId', 'User', true], ['chargeId', 'Charge', true], ['patientId', 'Patient', false]],
    ChargeItem: [['treatmentId', 'Treatment', true], ['inventoryItemId', 'InventoryItem', true]],
    Refund: [['chargeId', 'Charge', false], ['patientId', 'Patient', false]],
    MemberCard: [['patientId', 'Patient', false]],
    ChargeItemCharge: [['chargeId', 'Charge', false]],
  };
  for (const [fkColumn, refTable, nullable] of orphanFkRepairs[table] ?? []) {
    const orphans = db.prepare(
      `SELECT id, ${fkColumn} AS refId FROM "${table}"
       WHERE ${fkColumn} IS NOT NULL
         AND ${fkColumn} NOT IN (SELECT id FROM "${refTable}")`,
    ).all() as Array<{ id: string; refId: string }>;
    if (nullable) {
      for (const o of orphans) {
        db.prepare(`UPDATE "${table}" SET ${fkColumn} = NULL WHERE id = ?`).run(o.id);
        log(table, fkColumn, o.id, o.refId, null, '孤儿外键置 NULL');
      }
    } else {
      // NOT NULL 外键孤儿：整行移入隔离表，INSERT SELECT 时排除
      db.exec(`CREATE TABLE IF NOT EXISTS MigrationRepairQuarantine (
        id TEXT PRIMARY KEY,
        tableName TEXT NOT NULL,
        recordJson TEXT NOT NULL,
        reason TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      for (const o of orphans) {
        const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(o.id) as Record<string, unknown>;
        db.prepare(
          `INSERT INTO MigrationRepairQuarantine (id, tableName, recordJson, reason) VALUES (?, ?, ?, ?)`,
        ).run(randomUUID(), table, JSON.stringify(row), `孤儿外键 ${fkColumn}=${o.refId}`);
      }
    }
  }
}
```

注意：`ChargeItemCharge` 是示意键名——**实现时以 `ensureForeignKeys` 各表实际定义的 FK 为准**（Refund 有 chargeId/patientId/operatorId；ChargeItem 有 chargeId/treatmentId/inventoryItemId；PurchaseOrderItem 有 orderId/itemId；InventoryTransaction 有 itemId/supplierId/operatorId/purchaseOrderId；ProcessingOrder 有 patientId/visitId/factoryId/doctorId/chargeId；MemberCard 有 patientId）。对 NOT NULL 外键孤儿行，在 `ensureForeignKeys` 的 INSERT SELECT 前先从源表删除（数据已入隔离表）：

```ts
db.prepare(`DELETE FROM "${table}" WHERE id IN (SELECT id FROM MigrationRepairQuarantine WHERE tableName = ?)`).run(table);
```

- [ ] **Step 5: 运行测试验证**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/migrations.spec.ts
pnpm --filter @dental/v2 typecheck
```
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/server/infrastructure/migrations.ts src/server/infrastructure/migrations.spec.ts src/server/main.ts
git commit -m "fix(v2): repair legacy constraint violations before table rebuilds and snapshot DB pre-migration"
```

---

### Task 1.2: 恢复 marker 校验失败安全降级 + 备份临时文件清理（C2 + M5）

**Files:**
- Modify: `src/server/infrastructure/restore-apply.ts:28-33`
- Modify: `src/server/application/service-modules/backup.ts`（create 的 finally 清理 + cleanup 清理 .tmp/.staged-*）
- Test: `src/server/infrastructure/restore-apply.spec.ts`（存在）与 backup 相关 spec

**Interfaces:**
- Produces: `applyStagedRestore` 不再对"stagedPath 非法或文件缺失"抛错；改为把 marker 改名保留为 `.restore-pending.invalid-<ts>.json`、`logger.warn`、返回 `{ applied: false }`。

- [ ] **Step 1: 写失败测试**

在 `restore-apply.spec.ts` 增加：marker 指向不存在文件 → `applyStagedRestore` 返回 `{ applied: false }` 且不抛错、marker 被改名（目录中无 `.restore-pending.json`）。

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/restore-apply.spec.ts
```

- [ ] **Step 3: 修改 applyStagedRestore**

`restore-apply.ts` 中，把抛错分支替换为：

```ts
const stagedPath = typeof marker.stagedPath === 'string' ? marker.stagedPath : '';
const resolvedStaged = path.resolve(stagedPath);
const allowed = allowedDirs.map((dir) => path.resolve(dir));
if (!allowed.some((dir) => resolvedStaged === dir || resolvedStaged.startsWith(dir + path.sep)) || !fs.existsSync(resolvedStaged)) {
  const invalidPath = `${markerPath}.invalid-${Date.now()}`;
  try {
    fs.renameSync(markerPath, invalidPath);
  } catch {
    fs.rmSync(markerPath, { force: true });
  }
  logger?.warn('staged restore marker is invalid or staged file is missing; skipping restore', {
    action: 'restore-apply',
    markerPath: invalidPath,
    stagedPath: resolvedStaged,
  });
  return { applied: false };
}
```

- [ ] **Step 4: backup.ts 临时文件清理**

`backup.ts` `create()`：用 try/finally 包裹，finally 中清理 tempPath：

```ts
async create(options: BackupCreateOptions = {}): Promise<Record<string, unknown>> {
  fs.mkdirSync(this.backupDir, { recursive: true });
  const encrypted = options.encrypted ?? Boolean(process.env.V2_BACKUP_KEY);
  const base = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const filename = encrypted ? `${base}.enc` : `${base}.sqlite`;
  const tempPath = path.join(this.backupDir, `${base}.tmp`);
  const finalPath = path.join(this.backupDir, filename);
  try {
    await this.db.backup(tempPath);
    if (encrypted) {
      await this.encryptFile(tempPath, finalPath);
      fs.unlinkSync(tempPath);
    } else {
      fs.renameSync(tempPath, finalPath);
    }
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw error;
  }
  // ...原有 fileSize / BackupRecord 逻辑不变
}
```

`cleanup()` 在保留逻辑后追加：

```ts
for (const name of fs.readdirSync(this.backupDir)) {
  if (name.startsWith('.staged-') || name.endsWith('.tmp')) {
    const ageMs = Date.now() - fs.statSync(path.join(this.backupDir, name)).mtimeMs;
    if (ageMs > 24 * 60 * 60 * 1000) fs.rmSync(path.join(this.backupDir, name), { force: true });
  }
}
```

- [ ] **Step 5: 运行测试验证**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/restore-apply.spec.ts
pnpm --filter @dental/v2 test
```

- [ ] **Step 6: 提交**

```bash
git add src/server/infrastructure/restore-apply.ts src/server/application/service-modules/backup.ts
git commit -m "fix(v2): degrade gracefully on invalid restore marker and clean backup temp files"
```

---

### Task 1.3: DebtService.pay 事务化（C3）

**Files:**
- Modify: `src/server/application/service-modules/financial.ts:686-719`
- Test: `src/server/application/workflow-services.spec.ts` 或 `services.spec.ts`（pay 相关用例）

**Interfaces:**
- Produces: `pay()` 内部两次写库（Debt.updatePaid + Charge UPDATE）包进 `db.transaction`，失败整体回滚。

- [ ] **Step 1: 写失败测试**

在既有 pay 测试文件中增加用例：mock `debtRepository.updatePaid` 成功后让 Charge UPDATE 抛错（如传入不存在的 chargeId 触发 0 行更新不算失败——改为在事务外构造：把 Charge 表删除后调用 pay？不可行）。**可行方案**：用 `db.transaction` 嵌套错误注入——直接对真实库构造：`debt.pay` 后断言 Debt 与 Charge 一致性；再用一个 `{ chargeId: 不存在 }` 的 debt 场景验证不抛错即可（当前实现 charge 查询不到时静默跳过，事务化后行为不变）。真正的回归测试：**让第二步失败**，方法是在 `pay` 执行前用 `db.prepare('DROP TABLE Charge').run()` 制造失败（测试用临时库，可接受）：

```ts
it('rolls back debt payment when charge update fails', async () => {
  // 构造 debt + charge
  db.prepare('DROP TABLE Charge').run();
  await expect(service.pay(debtId, 100, ctx)).rejects.toThrow();
  const debt = db.prepare('SELECT paidAmount FROM Debt WHERE id = ?').get(debtId);
  expect(debt.paidAmount).toBe(0); // 回滚：欠费未被标记已收
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/application/services.spec.ts src/server/application/workflow-services.spec.ts
```

- [ ] **Step 3: 事务化实现**

`financial.ts` `pay()` 内：

```ts
const executePay = this.db.transaction((debtId: string, amount: number, context: AppContext) => {
  const debt = this.debtRepository.findById(debtId, context.clinicId);
  if (!debt) throw new NotFoundError('Debt record not found');
  const remaining = Number(debt.totalAmount) - Number(debt.paidAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) throw new ValidationError('Invalid debt payment amount');
  const paid = Number(debt.paidAmount) + amount;
  const status = paid >= Number(debt.totalAmount) ? 'PAID' : 'PARTIAL';
  this.debtRepository.updatePaid(debtId, paid, status, context.now().toISOString(), context.clinicId);
  const charge = this.db.prepare(
    `SELECT id, totalAmount, paidAmount
     FROM Charge WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
  ).get(debt.chargeId, ...tenantParams(context.clinicId)) as {
    id: string; totalAmount: number; paidAmount: number;
  } | undefined;
  if (charge) {
    const chargePaid = Math.min(Number(charge.totalAmount), Number(charge.paidAmount) + amount);
    const chargeStatus = chargePaid >= Number(charge.totalAmount) ? 'PAID' : chargePaid > 0 ? 'PARTIAL' : 'UNPAID';
    this.db.prepare(
      `UPDATE Charge SET paidAmount = ?, status = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(chargePaid, chargeStatus, context.now().toISOString(), charge.id, ...tenantParams(context.clinicId));
  }
  return { id: debtId, paidAmount: paid, status };
});
return await withIdempotency(this.db, {
  operation: 'debt.pay',
  userId: context.userId,
  clinicId: context.clinicId,
  requestId: requestId ?? '',
}, () => executePay(debtId, amount, context));
```

- [ ] **Step 4: 运行测试验证**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/application/services.spec.ts src/server/application/workflow-services.spec.ts
pnpm --filter @dental/v2 typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/server/application/service-modules/financial.ts
git commit -m "fix(v2): make debt payment atomic with charge update"
```

---

### Task 1.4: Electron 重启策略修正 + 首启失败窗口（H1）

**Files:**
- Modify: `electron/main.cjs`（184-205 行 exit 处理、120-147 waitForApi、575 附近 whenReady）
- 新建: `electron/error.html`（打包 files 已含 `electron/**/*`）

**Interfaces:**
- Produces: `waitForApi(port, timeoutMs = 30000)`；`API_MAX_RESTARTS` 语义改为"应用生命周期内总重启上限"（不再按 60s 窗口重置）；`whenReady` 中 `startApi()` 失败也创建窗口并展示错误页。

- [ ] **Step 1: 修改重启计数（去掉 60s 窗口重置）**

`main.cjs` exit 处理：

```js
apiProcess.on('exit', (code, signal) => {
  apiProcess = null;
  if (_isQuitting || startedProcess.manualStop) return;
  apiLastCrashAt = Date.now();
  apiRestartCount += 1;
  crashLog('api-exit', new Error(`code=${code} signal=${String(signal)}`));
  if (apiRestartCount >= API_MAX_RESTARTS) {
    sendApiStatus({ status: 'crashed', code });
    notify('本地服务异常', 'API 连续启动失败，请检查数据目录或联系管理员。');
    showApiErrorWindow(`API 连续失败 ${API_MAX_RESTARTS} 次（最近错误 code=${code}）。请检查数据目录权限或恢复备份。`);
    return;
  }
  sendApiStatus({ status: 'restarting', code });
  const backoffStep = Math.min(apiRestartCount - 1, 4);
  const delayMs = Math.min(API_BACKOFF_BASE_MS * Math.pow(2, backoffStep), API_BACKOFF_MAX_MS);
  setTimeout(() => {
    startApi().catch((error) => {
      crashLog('api-restart-failed', error);
      sendApiStatus({ status: 'crashed', message: error.message });
      showApiErrorWindow(error instanceof Error ? error.message : String(error));
    });
  }, delayMs);
});
```

同时删除 `API_RESTART_WINDOW_MS` 常量的使用（保留定义或删除均可，建议删除并去掉 `apiLastCrashAt` 重置逻辑）。`ensureApiServerRunning()` 里 `apiRestartCount = 0` 的调用点**保留**（用户主动激活窗口时的重试应重置）。

- [ ] **Step 2: 新建 error.html**

`electron/error.html`（最小内联页，不依赖 dist-web）：

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Dental Clinic V2 - 服务异常</title>
<style>body{font-family:'Microsoft YaHei',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1e1e1e;color:#eee} .box{max-width:560px;padding:32px;background:#2a2a2a;border-radius:12px} h1{font-size:20px} pre{white-space:pre-wrap;font-size:13px;color:#bbb} button{margin-top:16px;padding:8px 20px;font-size:14px;border-radius:6px;border:0;background:#3b82f6;color:#fff;cursor:pointer}</style>
</head>
<body>
<div class="box">
  <h1>本地服务启动失败</h1>
  <pre id="msg">正在加载错误信息…</pre>
  <button id="retry">重试启动</button>
  <button id="quit">退出应用</button>
</div>
<script>
  const { desktop } = window;
  window.desktopVersion = () => desktop.version();
  document.getElementById('msg').textContent = sessionStorage.getItem('apiError') || '未知错误';
  document.getElementById('retry').onclick = async () => {
    await desktop.restartApi();
    location.reload();
  };
  document.getElementById('quit').onclick = () => window.close();
</script>
</body>
</html>
```

`main.cjs` 新增：

```js
function showApiErrorWindow(message) {
  if (BrowserWindow.getAllWindows().length > 0) return;
  const win = new BrowserWindow({ ...DEFAULT_WINDOW_STATE, ...secureWindowPreferences(), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, 'error.html')).then(() => {
    win.webContents.executeJavaScript(`sessionStorage.setItem('apiError', ${JSON.stringify(String(message))});`);
  });
}
```

注意 `error.html` 中的 preload 只暴露了 `desktop` 桥接；`restartApi`/`version` 已存在于 `preload.cjs`，无需改 preload。

- [ ] **Step 3: whenReady 首启失败也建窗口**

```js
setupTray();
try {
  await startApi();
} catch (error) {
  crashLog('api-initial-start-failed', error);
  showApiErrorWindow(error instanceof Error ? error.message : String(error));
  return; // 不继续加载主窗口与自动更新
}
createWindow();
```

同时把 `waitForApi` 默认超时从 15000 改为 30000（`function waitForApi(port, timeoutMs = 30000)`），给大库启动留余量（配合 Task 2.4 的 quick_check）。

- [ ] **Step 4: 验证**

```bash
pnpm --filter @dental/v2 typecheck   # main.cjs 是 CJS，eslint 校验
pnpm --filter @dental/v2 run lint
node -e "require('./electron/main.cjs')" 2>&1 | head -3   # 仅验证语法可加载（会因缺 electron 运行时而报错属预期；改为：）
```
语法验证用：`node --check electron/main.cjs && node --check electron/preload.cjs`。

- [ ] **Step 5: 提交**

```bash
git add electron/main.cjs electron/error.html
git commit -m "fix(v2): cap API restart attempts per app lifetime and show error window on startup failure"
```

---

## Phase 2 — 性能

### Task 2.1: 移除 FTS 触发器，改为启动/导入后重建索引（S1 + L3）

**Files:**
- Modify: `src/server/infrastructure/migrations.ts`（新增迁移 118）
- Create: `src/server/infrastructure/search-index.ts`
- Modify: `src/server/main.ts`（启动时重建）
- Modify: `src/server/application/service-modules/clinical-ops.ts`（批量导入完成后重建）
- Modify: `src/server/application/read-services.ts`（SearchService.search 空查询返回 []）
- Test: `src/server/infrastructure/search-index.spec.ts`（新建）、`migrations.spec.ts`

**Interfaces:**
- Produces: `rebuildSearchIndex(db: Database.Database): void` —— 清空 SearchIndex 并用 6 条 INSERT…SELECT 重建（SQL 与迁移 115 回填段完全一致）；幂等、无事务外副作用。
- Produces: `buildFtsQuery(query: string): string` —— 从 `SearchService.search` 提取的 FTS 转义函数（Task 2.2 复用）。

**背景：** 19 个触发器（`migrations.ts:293-353`）在 SearchIndex 的 UNINDEXED 列上做非 MATCH DELETE，每写一行代价 ∝ FTS 总行数（实测 200k 行时 35.6ms/行）。实测全量重建 200k 行仅 692ms。

- [ ] **Step 1: 写失败测试**

`search-index.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { rebuildSearchIndex } from './search-index';

describe('rebuildSearchIndex', () => {
  it('rebuilds SearchIndex content for all six resources', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE Patient (id TEXT PRIMARY KEY, clinicId TEXT, name TEXT, code TEXT, phone TEXT, deletedAt TEXT);
      CREATE VIRTUAL TABLE SearchIndex USING fts5(resource UNINDEXED, recordId UNINDEXED, clinicId UNINDEXED, content);`);
    db.prepare(`INSERT INTO Patient (id, clinicId, name, code, phone) VALUES ('p1', 'c1', '张三', 'P001', '13800000000')`).run();
    db.prepare(`INSERT INTO SearchIndex(resource, recordId, clinicId, content) VALUES ('Patient', 'stale', 'c1', '旧数据')`).run();
    rebuildSearchIndex(db);
    const rows = db.prepare(`SELECT resource, recordId FROM SearchIndex WHERE recordId = 'stale'`).all();
    expect(rows).toHaveLength(0);
    const fresh = db.prepare(`SELECT recordId FROM SearchIndex WHERE resource = 'Patient' AND recordId = 'p1'`).all();
    expect(fresh).toHaveLength(1);
    db.close();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/search-index.spec.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 创建 search-index.ts**

```ts
import type Database from 'better-sqlite3';

export function buildFtsQuery(query: string): string {
  return query.split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' ');
}

export function rebuildSearchIndex(db: Database.Database): void {
  db.exec('DELETE FROM SearchIndex');
  db.exec(`
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'Patient', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, ''))
    FROM Patient WHERE deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'InventoryItem', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(category, ''))
    FROM InventoryItem WHERE deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'Supplier', id, clinicId, trim(COALESCE(name, '') || ' ' || COALESCE(code, '') || ' ' || COALESCE(phone, ''))
    FROM Supplier WHERE deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'Appointment', A.id, A.clinicId,
           trim(COALESCE(P.name, '') || ' ' || COALESCE(A.startTime, '') || ' ' || COALESCE(A.status, ''))
    FROM Appointment A LEFT JOIN Patient P ON P.id = A.patientId
    WHERE A.deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'Charge', C.id, C.clinicId,
           trim(COALESCE(P.name, '') || ' ' || COALESCE(C.number, '') || ' ' || COALESCE(C.status, ''))
    FROM Charge C LEFT JOIN Patient P ON P.id = C.patientId
    WHERE C.deletedAt IS NULL;
    INSERT INTO SearchIndex(resource, recordId, clinicId, content)
    SELECT 'FollowUp', F.id, F.clinicId,
           trim(COALESCE(P.name, '') || ' ' || COALESCE(F.content, '') || ' ' || COALESCE(F.status, '') || ' ' || COALESCE(F.planDate, ''))
    FROM FollowUp F LEFT JOIN Patient P ON P.id = F.patientId
    WHERE F.deletedAt IS NULL;
  `);
}
```

- [ ] **Step 4: 新增迁移 118 删除全部 19 个触发器**

`migrations.ts` 追加（版本号按仓库当前最大 117 递增）：

```ts
{
  version: 118,
  name: 'v2-drop-search-triggers',
  up(db) {
    db.exec(`
      DROP TRIGGER IF EXISTS search_patient_ai;
      DROP TRIGGER IF EXISTS search_patient_au;
      DROP TRIGGER IF EXISTS search_patient_ad;
      DROP TRIGGER IF EXISTS search_patient_child_update;
      DROP TRIGGER IF EXISTS search_inventory_item_ai;
      DROP TRIGGER IF EXISTS search_inventory_item_au;
      DROP TRIGGER IF EXISTS search_inventory_item_ad;
      DROP TRIGGER IF EXISTS search_supplier_ai;
      DROP TRIGGER IF EXISTS search_supplier_au;
      DROP TRIGGER IF EXISTS search_supplier_ad;
      DROP TRIGGER IF EXISTS search_appointment_ai;
      DROP TRIGGER IF EXISTS search_appointment_au;
      DROP TRIGGER IF EXISTS search_appointment_ad;
      DROP TRIGGER IF EXISTS search_charge_ai;
      DROP TRIGGER IF EXISTS search_charge_au;
      DROP TRIGGER IF EXISTS search_charge_ad;
      DROP TRIGGER IF EXISTS search_followup_ai;
      DROP TRIGGER IF EXISTS search_followup_au;
      DROP TRIGGER IF EXISTS search_followup_ad;
    `);
  },
},
```

- [ ] **Step 5: 接入启动与导入**

`main.ts` 在 `runMigrations(db)` 后：

```ts
import { rebuildSearchIndex } from './infrastructure/search-index';
// ...
runMigrations(db);
try {
  rebuildSearchIndex(db);
} catch (error) {
  logger.error('search index rebuild failed at startup', { action: 'search-index-rebuild', error });
}
```

`clinical-ops.ts` 批量导入主流程成功返回前（分片循环结束后）：

```ts
import { rebuildSearchIndex } from '../../infrastructure/search-index';
// 在导入函数 return 之前：
rebuildSearchIndex(this.db);
```

- [ ] **Step 6: SearchService 空查询防护**

`read-services.ts` `SearchService.search` 开头：

```ts
search(query: string, context: AppContext): Array<Record<string, unknown>> {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];
  // ...原有逻辑，把内联的 ftsQuery 构造替换为 buildFtsQuery(query)
```

（删除原内联 `query.split(/\s+/)...` 五行，改用 import 的 `buildFtsQuery`。）

- [ ] **Step 7: 验证**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/search-index.spec.ts src/server/infrastructure/migrations.spec.ts
pnpm --filter @dental/v2 test
pnpm --filter @dental/v2 typecheck
```

- [ ] **Step 8: 提交**

```bash
git add src/server/infrastructure/migrations.ts src/server/infrastructure/search-index.ts src/server/main.ts src/server/application/service-modules/clinical-ops.ts src/server/application/read-services.ts
git commit -m "perf(v2): replace FTS write triggers with on-demand index rebuild"
```

---

### Task 2.2: 搜索防抖 + 资源列表走 FTS（H2）

**Files:**
- Create: `src/web/use-debounce.ts`
- Modify: `src/web/PatientsPage.tsx:75,83-86,240-241`、`src/web/SystemOperationsPage.tsx:47-49`
- Modify: `src/server/infrastructure/repository.ts:86-95`（search 分支）
- Modify: `src/domain/resources.ts`（给可搜索资源标注 `searchIndexResource`）
- Test: `src/web/PatientsPage.spec.tsx`、`src/server/infrastructure/repository.spec.ts`

**Interfaces:**
- Consumes: `buildFtsQuery`（Task 2.1 产出）。
- Produces: `useDebouncedValue<T>(value: T, delayMs: number): T`；`ResourceDefinition.searchIndexResource?: string`。

- [ ] **Step 1: 写前端防抖 hook 测试（随 PatientsPage.spec 断言）**

`src/web/use-debounce.ts`：

```ts
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

`PatientsPage.tsx`：把搜索输入拆为 `searchInput`（受控）与 `search`（防抖值），`useQuery` 的 queryKey 与请求使用 `search`：

```tsx
const [searchInput, setSearchInput] = useState('');
const search = useDebouncedValue(searchInput, 300);
// queryFn: apiRequest(`/resources/patients?page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ''}`)
```
`SystemOperationsPage.tsx` 的全局搜索输入同样接入。

- [ ] **Step 2: repository.ts 增加 FTS 分支**

`repository.ts` `findMany` 中 search 处理替换为：

```ts
if (query.search && this.resource.searchIndexResource) {
  const ftsQuery = buildFtsQuery(query.search);
  if (ftsQuery) {
    where.push(`id IN (SELECT recordId FROM SearchIndex WHERE SearchIndex MATCH ? AND resource = ?)`);
    params.push(ftsQuery, this.resource.searchIndexResource);
  }
} else if (query.search && (this.resource.searchableFields?.length ?? 0) > 0) {
  const searchClauses = this.resource.searchableFields!.map((field) => `${field} LIKE ? ESCAPE '\\'`);
  where.push(`(${searchClauses.join(' OR ')})`);
  const escaped = query.search.replace(/[\\%_]/g, '\\$&');
  for (let i = 0; i < searchClauses.length; i += 1) params.push(`%${escaped}%`);
}
```

`resources.ts` 中为六个资源定义增加 `searchIndexResource`：Patient→`'Patient'`、Appointment→`'Appointment'`、Charge→`'Charge'`、FollowUp→`'FollowUp'`、InventoryItem→`'InventoryItem'`、Supplier→`'Supplier'`（在各自 ResourceDefinition 上）。

- [ ] **Step 3: 写后端测试**

`repository.spec.ts` 增加：带 `searchIndexResource` 的资源 `findMany({ search: '张三' })` 返回 MATCH 命中行；不带该字段的资源仍走 LIKE 分支。

- [ ] **Step 4: 验证**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/repository.spec.ts src/web/PatientsPage.spec.tsx
pnpm --filter @dental/v2 typecheck
```

- [ ] **Step 5: 提交**

```bash
git add src/web/use-debounce.ts src/web/PatientsPage.tsx src/web/SystemOperationsPage.tsx src/server/infrastructure/repository.ts src/domain/resources.ts
git commit -m "perf(v2): debounce search input and route resource search through FTS index"
```

---

### Task 2.3: 幂等清理索引化并移出热路径（H3-perf）

**Files:**
- Modify: `src/server/infrastructure/migrations.ts`（迁移 119 加索引）
- Modify: `src/server/infrastructure/idempotency.ts`（导出清理函数，热路径只保留 expiresAt 清理）
- Modify: `src/server/main.ts`（每日清理调用）
- Test: `src/server/infrastructure/idempotency.spec.ts`

**Interfaces:**
- Produces: `cleanupIdempotencyRecords(db): { deleted: number }`。

- [ ] **Step 1: 迁移 119 加索引**

```ts
{
  version: 119,
  name: 'v2-perf-indexes',
  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_idempotency_status_updated ON IdempotencyRecord(status, updatedAt);
      CREATE INDEX IF NOT EXISTS idx_charge_item_clinic_category_name ON ChargeItem(clinicId, category, name);
    `);
  },
},
```

- [ ] **Step 2: 重构 idempotency.ts**

新增导出函数；`withIdempotency` 热路径删除 `status != 'COMPLETED'` 那条 DELETE（保留 expiresAt 清理，其已有索引）：

```ts
export function cleanupIdempotencyRecords(db: Database.Database): { deleted: number } {
  const staleBefore = new Date(Date.now() - IDEMPOTENCY_PROCESSING_TIMEOUT_MS).toISOString();
  const result = db.prepare(
    "DELETE FROM IdempotencyRecord WHERE status != 'COMPLETED' AND updatedAt IS NOT NULL AND updatedAt <= ?",
  ).run(staleBefore);
  return { deleted: result.changes };
}
```

`main.ts` 每日任务块（在 `cleanupAuditLogs` 的 setInterval 旁）：

```ts
import { cleanupIdempotencyRecords } from './infrastructure/idempotency';
setInterval(() => {
  try {
    const { deleted } = cleanupIdempotencyRecords(db);
    if (deleted > 0) logger.info('idempotency cleanup completed', { action: 'idempotency-cleanup', deleted });
  } catch (error) {
    logger.error('idempotency cleanup failed', { action: 'idempotency-cleanup', error });
  }
}, 24 * 60 * 60 * 1000).unref();
```

- [ ] **Step 3: 测试更新**

`idempotency.spec.ts`：断言 `withIdempotency` 不再删除 PROCESSING 超时记录（该职责移交 `cleanupIdempotencyRecords`）；新增 `cleanupIdempotencyRecords` 删除过期 PROCESSING 记录的用例。

- [ ] **Step 4: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/idempotency.spec.ts src/server/infrastructure/migrations.spec.ts
git add src/server/infrastructure/idempotency.ts src/server/infrastructure/migrations.ts src/server/main.ts
git commit -m "perf(v2): index idempotency cleanup and move it off the write hot path"
```

---

### Task 2.4: 启动完整性检查分级（H4-perf）

**Files:**
- Modify: `src/server/infrastructure/database.ts:310-312`
- Modify: `src/server/main.ts`（干净退出标记）
- Test: `src/server/infrastructure/database.spec.ts`

**Interfaces:**
- Produces: `createDatabase(dataDir, dbPath, options?: { fullIntegrityCheck?: boolean })`；标记文件 `data/.clean-exit`。

- [ ] **Step 1: database.ts 分级检查**

把 `integrity_check` 调用改为：

```ts
const fullCheck = options?.fullIntegrityCheck ?? false;
const result = db.pragma(fullCheck ? 'integrity_check' : 'quick_check') as Array<{ [key: string]: string }>;
if (result.length !== 1 || result[0][fullCheck ? 'integrity_check' : 'quick_check'] !== 'ok') {
  throw new Error('SQLite integrity check failed');
}
```

- [ ] **Step 2: main.ts 标记逻辑**

启动时（createDatabase 之前）：

```ts
const cleanExitMarker = path.join(dataDir, '.clean-exit');
const wasCleanExit = fs.existsSync(cleanExitMarker);
if (fs.existsSync(cleanExitMarker)) fs.rmSync(cleanExitMarker, { force: true });
const db = createDatabase(dataDir, dbPath, { fullIntegrityCheck: !wasCleanExit });
```

`shutdown()` 中，checkpoint 成功后：

```ts
try {
  fs.writeFileSync(cleanExitMarker, new Date().toISOString(), 'utf8');
} catch { /* best effort */ }
```

- [ ] **Step 3: 测试**

`database.spec.ts`：`createDatabase(..., { fullIntegrityCheck: true })` 对损坏库（写入垃圾字节）抛错；`quick_check` 路径对正常库通过。

- [ ] **Step 4: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/database.spec.ts
git add src/server/infrastructure/database.ts src/server/main.ts
git commit -m "perf(v2): run full integrity check only after unclean shutdown"
```

---

### Task 2.5: 前端代码分割（H5-perf）

**Files:**
- Modify: `src/web/hub-tabs.tsx`（34 个页面静态 import → React.lazy）
- Modify: `src/web/ResourceHub.tsx`（Suspense 包裹）
- Modify: `vite.config.ts`（manualChunks）
- Test: `src/web/ResourceHub.spec.tsx`、`src/web/Layout.spec.tsx`

- [ ] **Step 1: 引入 lazyNamed 助手**

`hub-tabs.tsx` 顶部：

```tsx
import { lazy, type ComponentType } from 'react';

function lazyNamed<T extends ComponentType<unknown>>(factory: () => Promise<{ [K in keyof T]: unknown } & { default?: never } & Record<string, unknown> }) {
  return factory as unknown as T;
}
```

**简化做法（推荐）**：直接为每个页面写：

```tsx
const PatientsPage = lazy(() => import('./PatientsPage').then((m) => ({ default: m.PatientsPage })));
const AppointmentsPage = lazy(() => import('./AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })));
// ... 其余 32 个页面同构替换静态 import
```

`hub-tabs.tsx` 中所有 `PatientsPage` 等标识符保持同名（tab 定义处引用不变），仅把 `import { X } from './X'` 换成上面的 lazy 形式。

- [ ] **Step 2: ResourceHub 加 Suspense**

`ResourceHub.tsx` 渲染 tab 内容的组件处：

```tsx
import { Suspense } from 'react';
import { LoadingState } from './components';
// tab 内容渲染处：
<Suspense fallback={<LoadingState label="页面加载中" />}>
  {activeTab.component}
</Suspense>
```

（如 ResourceHub 内部用 `<component />` 渲染，包一层即可；具体以 `ResourceHub.tsx` 现有渲染结构为准。）

- [ ] **Step 3: vite.config.ts 拆 vendor chunk**

`vite.config.ts` build 段：

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'react-vendor': ['react', 'react-dom', 'react-router'],
        'query-vendor': ['@tanstack/react-query'],
      },
    },
  },
},
```

（保留现有配置其余部分；如有 `plugins` 等不要覆盖。）

- [ ] **Step 4: 验证**

```bash
pnpm --filter @dental/v2 exec vitest run src/web/ResourceHub.spec.tsx src/web/Layout.spec.tsx
pnpm --filter @dental/v2 typecheck
pnpm --filter @dental/v2 build
```
Expected: 构建产物出现多个 chunk（dist-web/assets 下多个 js 文件）。

- [ ] **Step 5: 提交**

```bash
git add src/web/hub-tabs.tsx src/web/ResourceHub.tsx vite.config.ts
git commit -m "perf(v2): code-split hub pages with React.lazy and vendor chunks"
```

---

### Task 2.6: 仪表盘/统计端点 TTL 缓存（H1-perf）

**Files:**
- Modify: `src/server/application/read-services.ts`（StatsService 各方法包缓存）
- Test: `src/server/application/services.spec.ts`

**Interfaces:**
- Produces: `StatsService` 内部 `private statsCache = new Map<string, { at: number; data: unknown }>()`；`getCached<T>(key: string, ttlMs: number, compute: () => T): T`。

- [ ] **Step 1: 实现缓存助手**

`read-services.ts` `StatsService` 内：

```ts
private readonly statsCache = new Map<string, { at: number; data: unknown }>();

private getCached<T>(key: string, ttlMs: number, compute: () => T): T {
  const now = Date.now();
  const hit = this.statsCache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.data as T;
  const data = compute();
  this.statsCache.set(key, { at: now, data });
  if (this.statsCache.size > 200) {
    const oldest = this.statsCache.keys().next().value;
    if (oldest !== undefined) this.statsCache.delete(oldest);
  }
  return data;
}
```

在 `dashboard(context)`、`revenue(context, from, to)`、`patientGrowth(...)`、`clinicOverview` 等聚合方法外包一层：`return this.getCached(`dashboard:${context.clinicId ?? 'none'}`, 30_000, () => { /* 原逻辑 */ })`。TTL 30 秒；写路径无需失效（可接受 30s 陈旧）。

- [ ] **Step 2: 测试**

`services.spec.ts`：mock db 计数调用次数——连续两次 `dashboard()` 只执行一次聚合 SQL（第二次命中缓存）；模拟 `Date.now` 前进 31 秒后重新计算。

- [ ] **Step 3: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/application/services.spec.ts
git add src/server/application/read-services.ts
git commit -m "perf(v2): add TTL cache for dashboard and analytics aggregation endpoints"
```

---

## Phase 3 — 安全

### Task 3.1: NULL clinicId 回填 + 严格租户隔离（H2-sec）

**Files:**
- Modify: `src/server/infrastructure/migrations.ts`（迁移 120）
- Modify: `src/server/infrastructure/tenant.ts`（`tenantWhere` 改为严格匹配）
- Modify: `src/server/application/service-modules/auth.ts:139-143`（`resolveClinicId` 为 null 时拒绝签发）
- Test: `src/server/infrastructure/tenant.spec.ts`、`src/server/application/services-edge.spec.ts`

**Interfaces:**
- Produces: `tenantWhere(clinicId)` 语义变为 `clinicId = ?`（无 OR NULL）；`resolveClinicId` 无诊所时抛 `AppError('FORBIDDEN', 'No clinic scope', 403)`。

- [ ] **Step 1: 迁移 120 回填 NULL clinicId**

```ts
{
  version: 120,
  name: 'v2-backfill-null-clinic-ids',
  up(db) {
    const tables = ['User', 'Patient', 'Appointment', 'Charge', 'Refund', 'MemberCard', 'ChargeItem',
      'Treatment', 'Visit', 'FollowUp', 'InventoryItem', 'InventoryTransaction', 'Supplier',
      'PurchaseOrder', 'PurchaseOrderItem', 'ProcessingOrder', 'Debt', 'OperationLog', 'Alert', 'Notification'];
    const defaultClinic = db.prepare(`SELECT id FROM Clinic ORDER BY createdAt ASC LIMIT 1`).get() as { id: string } | undefined;
    if (!defaultClinic) return; // 无诊所数据时跳过
    for (const table of tables) {
      const cols = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);
      if (!cols.includes('clinicId')) continue;
      db.prepare(`UPDATE "${table}" SET clinicId = ? WHERE clinicId IS NULL`).run(defaultClinic.id);
    }
    // 用户特殊处理：优先取 UserClinic 第一个成员关系
    db.prepare(`UPDATE User SET clinicId = COALESCE(
      (SELECT clinicId FROM UserClinic WHERE userId = User.id AND deletedAt IS NULL LIMIT 1), ?
    ) WHERE clinicId IS NULL`).run(defaultClinic.id);
    // 记录修复
    db.exec(`CREATE TABLE IF NOT EXISTS MigrationRepairLog (id TEXT PRIMARY KEY, tableName TEXT NOT NULL, field TEXT NOT NULL, recordId TEXT, beforeValue TEXT, afterValue TEXT, reason TEXT NOT NULL, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
  },
},
```

- [ ] **Step 2: tenant.ts 严格化**

```ts
export function tenantWhere(clinicId: string | null | undefined, column = 'clinicId'): TenantFilter {
  return clinicId
    ? { sql: `(${column} = ?)`, params: [clinicId] }
    : { sql: '', params: [] };
}
```
删除 `tenantWhereStrict`（Task 5.1 一并清理引用）。`tenantMatches` 同步改为 `rowClinicId === clinicId`。

- [ ] **Step 3: auth.ts resolveClinicId 拒绝 null**

`auth.ts` 登录/刷新签发 token 前（`resolveClinicId` 返回 null 时）：

```ts
if (!clinicId) {
  throw new AppError('FORBIDDEN', 'No clinic scope assigned to this account', 403);
}
```

- [ ] **Step 4: 测试**

`tenant.spec.ts`：`tenantWhere(null)` 返回空过滤（保持）；`tenantWhere('c1')` 的 SQL 不含 `IS NULL`；`tenantMatches(null, 'c1')` 为 false。`services-edge.spec.ts`：无诊所用户登录被 403。

- [ ] **Step 5: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/infrastructure/tenant.spec.ts src/server/application/services-edge.spec.ts src/server/infrastructure/migrations.spec.ts
git add src/server/infrastructure/migrations.ts src/server/infrastructure/tenant.ts src/server/application/service-modules/auth.ts
git commit -m "fix(v2): backfill null clinic rows and enforce strict tenant isolation"
```

---

### Task 3.2: 备份/恢复按诊所隔离（H1-sec）

**Files:**
- Modify: `src/server/application/service-modules/backup.ts`（filename 前缀 + list/verify/stageRestore/cleanup 过滤）
- Modify: `src/server/http/routes/system.ts:76-99`（传入 clinicId）
- Modify: `src/server/http/route-policy.ts`（如需要）
- Test: `src/server/application/services.spec.ts`、`src/server/http/app.spec.ts`

**Interfaces:**
- Produces: 备份文件名格式 `clinic-<clinicId>-backup-<ts>-<rand>.<enc|sqlite>`；`BackupService` 方法签名增加 `clinicId: string`（或沿用 context）；`list(clinicId)` 只返回本诊所前缀。

- [ ] **Step 1: 修改 BackupService**

- `create(options)`：`const clinicPrefix = options.clinicId ? `clinic-${options.clinicId}-` : 'clinic-null-'; const base = `${clinicPrefix}backup-${...}``。
- `list(clinicId)`：`filter((name) => (clinicId ? name.startsWith(`clinic-${clinicId}-backup-`) : name.startsWith('clinic-null-backup-')))`。
- `verify(filename, clinicId)`、`stageRestore(filename, clinicId)`、`cleanup(maxKeep, clinicId)`：同样按前缀过滤；`stageRestore` 若 filename 前缀与 clinicId 不符 → `throw new AppError('FORBIDDEN', 'Backup belongs to another clinic', 403)`。
- `main.ts` 的自动备份调用处传 `clinicId: null`（系统级 AUTO 备份保留全局前缀 `clinic-null-`）。

- [ ] **Step 2: 路由传入 clinicId**

`system.ts` 各备份端点：`backups.create({ type: 'MANUAL', clinicId: req.context.clinicId })`、`backups.list(req.context.clinicId)`、`backups.verify(filename, req.context.clinicId)`、`backups.stageRestore(filename, req.context.clinicId)`、`backups.cleanup(keep, req.context.clinicId)`。

- [ ] **Step 3: 测试**

`app.spec.ts`：诊所 A 的 ADMIN 调 `GET /api/v2/backups` 只看到 A 前缀；对 B 前缀文件名调 restore → 403。

- [ ] **Step 4: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/app.spec.ts src/server/application/services.spec.ts
git add src/server/application/service-modules/backup.ts src/server/http/routes/system.ts src/server/main.ts
git commit -m "fix(v2): scope backups and restore to the operator's clinic"
```

---

### Task 3.3: IPC sender 校验 + 密钥白名单 + CORS 收紧 + 登录 IP 限流（H3-sec）

**Files:**
- Modify: `electron/main.cjs`（517-542 行 secrets IPC、isAllowedNavigation 295-318）
- Modify: `src/server/http/app.ts:200-228`（CORS）
- Modify: `src/server/http/rate-limit.ts`（登录加 IP 维度）
- Test: `src/server/http/rate-limit.spec.ts`、`src/server/http/app.spec.ts`

- [ ] **Step 1: main.cjs 增加 sender 校验**

```js
const ALLOWED_SECRET_KEYS = new Set(['v2.token', 'v2.refreshToken']);
const TRUSTED_RENDERER_PATTERN = /(^file:\/\/.*dist-web[\\/]index\.html$)|(^http:\/\/localhost:5173\/?$)/;

function assertTrustedRenderer(event) {
  const url = event.senderFrame?.url ?? '';
  if (!TRUSTED_RENDERER_PATTERN.test(url)) {
    throw new Error('Untrusted IPC sender');
  }
}
```

三个 secret handler 开头调用 `assertTrustedRenderer(_event)`；`desktop:secret:get` 额外校验 `ALLOWED_SECRET_KEYS.has(key)`，`set`/`delete` 同样只允许白名单 key：

```js
ipcMain.handle('desktop:secret:get', (event, key) => {
  assertTrustedRenderer(event);
  if (!ALLOWED_SECRET_KEYS.has(String(key))) return null;
  // ...原有解密逻辑
});
ipcMain.handle('desktop:secret:set', (event, key, value) => {
  assertTrustedRenderer(event);
  if (!ALLOWED_SECRET_KEYS.has(String(key))) return false;
  // ...
});
ipcMain.handle('desktop:secret:delete', (event, key) => {
  assertTrustedRenderer(event);
  if (!ALLOWED_SECRET_KEYS.has(String(key))) return false;
  // ...
});
```

`restartApi`、`set-auto-launch`、`check-updates`、`install-update` 也加 `assertTrustedRenderer`。

- [ ] **Step 2: isAllowedNavigation 收紧**

`main.cjs` `isAllowedNavigation`：把 `parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'` 改为仅允许当前 API 端口：

```js
if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === String(apiPort)) return true;
```

- [ ] **Step 3: CORS 收紧**

`app.ts` origin 回调中，把 loopback 放行改为仅精确端口：

```ts
const _apiPort = Number(process.env.V2_PORT ?? 3180);
const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
if (isLoopback && url.protocol === 'http:' && (Number(url.port) === _apiPort || Number(url.port) === _viteDevPort)) {
  callback(null, true);
  return;
}
```
`file://` 分支保留（打包渲染器来源），`!origin` 保留。

- [ ] **Step 4: 登录 IP 维度限流**

`rate-limit.ts` 在 `createRateLimit` 之外新增导出：

```ts
export function createIpRateLimit({ windowMs, max }: RateLimitOptions) {
  return createRateLimit({ windowMs, max }); // 复用同构实现：key 只含 req.ip
}
```
在 `app.ts` 登录路由前挂 `createIpRateLimit({ windowMs: 60_000, max: 10 })`（与现有用户名维度限流叠加）。若实现复用同一 Map，注意 key 前缀区分：在 `createRateLimit` 中把 `base` 改为 `ip:${req.ip}:${req.method}:${routePath}`（现有实现已含 ip），另加一个仅含 ip 的实例即可：

```ts
app.use('/api/v2/auth/login', createRateLimit({ windowMs: 60_000, max: 10 }));
```
（`createRateLimit` 现有 key 已含 `req.ip`，再包一层仅 IP 的实例需要 key 不含 username——直接新增一个 `createLoginIpRateLimit` 简单实现：Map<ip, count>，窗口 60s，max 10。）

- [ ] **Step 5: 测试**

`rate-limit.spec.ts`：同一 IP 不同 username 连续 11 次登录 → 第 11 次 429。`app.spec.ts`：`Origin: http://127.0.0.1:9999` 请求被 CORS 拒绝。

- [ ] **Step 6: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/rate-limit.spec.ts src/server/http/app.spec.ts
node --check electron/main.cjs
git add electron/main.cjs src/server/http/app.ts src/server/http/rate-limit.ts
git commit -m "fix(v2): validate IPC sender, whitelist secret keys, tighten CORS and login rate limit"
```

---

### Task 3.4: 密钥 safeStorage 落盘 + 备份默认加密（M1/M2-sec）

**Files:**
- Modify: `electron/main.cjs`（`getOrCreateSecret` 72-85）
- Modify: `src/server/application/service-modules/backup.ts:47`（默认加密策略）
- Test: `src/server/application/services.spec.ts`

- [ ] **Step 1: main.cjs 密钥加密落盘**

```js
function getOrCreateSecret(fileName = 'jwt-secret') {
  const secretsDir = path.join(app.getPath('userData'), 'secrets');
  const secretPath = path.join(secretsDir, fileName);
  fs.mkdirSync(secretsDir, { recursive: true });
  try {
    const existing = fs.readFileSync(secretPath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const plain = safeStorage.decryptString(existing);
        if (plain.length >= 32) return plain;
      } catch {
        // 旧明文文件，落到下方重新加密
        const plain = existing.toString('utf8').trim();
        if (plain.length >= 32) {
          fs.writeFileSync(secretPath, safeStorage.encryptString(plain));
          return plain;
        }
      }
    } else {
      const plain = existing.toString('utf8').trim();
      if (plain.length >= 32) return plain;
    }
  } catch {
    // first run or unreadable secret; create a fresh one below
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(secret) : secret);
  return secret;
}
```
注意 `backup-key` 走同一函数，同样加密。若 `safeStorage.isEncryptionAvailable()` 为 false，`console.warn('safeStorage unavailable; secrets stored in plaintext')`。

- [ ] **Step 2: backup.ts 默认加密**

`create()` 中：

```ts
const allowPlaintext = process.env.NODE_ENV === 'test' || process.env.V2_ALLOW_PLAINTEXT_BACKUP === '1';
const encrypted = options.encrypted ?? Boolean(process.env.V2_BACKUP_KEY) ?? !allowPlaintext;
if (!encrypted && !allowPlaintext) {
  throw new Error('Refusing to create plaintext backup: set V2_BACKUP_KEY or V2_ALLOW_PLAINTEXT_BACKUP=1');
}
```

（Electron 打包路径始终注入 V2_BACKUP_KEY，不受影响。）

- [ ] **Step 3: 测试 + 验证 + 提交**

`services.spec.ts`：`create({ encrypted: false })` 在 NODE_ENV=test 下仍允许（测试环境）；对 `NODE_ENV=production` 且无 key 时抛错（用 process.env 临时覆盖）。

```bash
pnpm --filter @dental/v2 exec vitest run src/server/application/services.spec.ts
node --check electron/main.cjs
git add electron/main.cjs src/server/application/service-modules/backup.ts
git commit -m "fix(v2): encrypt on-disk secrets with safeStorage and refuse plaintext backups"
```

---

### Task 3.5: CSV 公式注入 + 敏感字段掩码扩展（M3/M4-sec）

**Files:**
- Modify: `src/server/http/router.ts:157-161`（csvCell）
- Modify: `src/server/infrastructure/security.ts`（SENSITIVE_FIELDS 扩展 + 递归掩码）
- Test: `src/server/http/router.spec.ts`、`src/server/infrastructure/security.spec.ts`（如存在）

- [ ] **Step 1: csvCell 防公式注入**

```ts
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}
```

- [ ] **Step 2: 掩码扩展与递归**

`security.ts`：

```ts
const SENSITIVE_FIELDS = new Set([
  // ...原有字段
  'phoneNumber', 'email', 'phone', 'mobile', 'cardNo', 'idCardNo', 'wechatId',
  'medicalRecordNo', 'insuranceNo',
]);

export function maskSensitiveFields(row: unknown, depth = 0): unknown {
  if (depth > 5) return row;
  if (Array.isArray(row)) return row.map((item) => maskSensitiveFields(item, depth + 1));
  if (row && typeof row === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      result[key] = SENSITIVE_FIELDS.has(key)
        ? null
        : maskSensitiveFields(value, depth + 1);
    }
    return result;
  }
  return row;
}
```
注意 `maskSensitiveFields` 的调用点（`app.ts:282-284`）现在接收任意对象并返回对象，签名兼容（返回值类型从 `Record<string, unknown>` 变为 `unknown` 时，调用处加 `as Record<string, unknown>`）。

- [ ] **Step 3: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/router.spec.ts src/server/infrastructure/security.spec.ts
git add src/server/http/router.ts src/server/infrastructure/security.ts src/server/http/app.ts
git commit -m "fix(v2): prevent CSV formula injection and expand sensitive field masking"
```

---

### Task 3.6: 上传配额 + dev seed 显式开关（M5/M6-sec）

**Files:**
- Modify: `src/server/http/routes/files.ts`
- Modify: `src/server/infrastructure/database.ts:380-384`
- Modify: `README.md`（dev 说明）
- Test: `src/server/http/routes/files.spec.ts`

- [ ] **Step 1: 上传配额**

`files.ts` 上传 handler 内、写文件前：

```ts
const usage = this.db.prepare(
  `SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS totalBytes
   FROM FileRecord WHERE uploadedBy = ? AND deletedAt IS NULL`,
).get(req.context!.userId) as { count: number; totalBytes: number };
const MAX_FILES_PER_USER = 200;
const MAX_BYTES_PER_USER = 500 * 1024 * 1024;
if (usage.count >= MAX_FILES_PER_USER || Number(usage.totalBytes) + fileSize > MAX_BYTES_PER_USER) {
  throw new AppError('QUOTA_EXCEEDED', 'File quota exceeded for this user', 413);
}
```
（`FileRecord` 表结构以 `files.ts` 实际写入字段为准：`uploadedBy`/`size` 若字段名不同，按实际列名调整 SQL。）

- [ ] **Step 2: dev seed 显式开关**

`database.ts:380-384`：

```ts
} else if (process.env.NODE_ENV === 'development' && process.env.V2_ALLOW_DEV_SEED === '1') {
  const passwordHash = bcrypt.hashSync('admin123', 10);
  db.prepare('UPDATE User SET passwordHash = ?, active = 1, lockedUntil = NULL, updatedAt = ? WHERE id = ?')
    .run(passwordHash, now, userId);
}
```
同时把同文件 `if (isProduction)` 前的兜底逻辑确认：`NODE_ENV` 非 production 且非 development（如 test）时不做密码重置。`README.md` 的 Run 段增加：

```markdown
开发环境如需自动重置 admin/admin123，需显式设置 `V2_ALLOW_DEV_SEED=1`。
```

- [ ] **Step 3: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/routes/files.spec.ts src/server/infrastructure/database.spec.ts
git add src/server/http/routes/files.ts src/server/infrastructure/database.ts README.md
git commit -m "fix(v2): enforce file upload quota and gate dev admin seed behind explicit env"
```

---

### Task 3.7: Electron 加固：崩溃上报最小化 + 更新签名校验 + token 内存回退（L1/L2/L3-sec）

**Files:**
- Modify: `electron/main.cjs`（crashLog 38-70、autoUpdater）
- Modify: `src/web/api.ts:80-88,124-125`
- Test: `src/web/api.spec.ts`

- [ ] **Step 1: crashLog 最小化**

`crashLog` 的 HTTP 上报体改为只含 `{ timestamp, message, stack: stackLines.slice(0, 20) }`，且文档化 `V2_CRASH_REPORT_URL` 必须 HTTPS：

```js
const entry = {
  timestamp: new Date().toISOString(),
  message,
  stack: String(error?.stack ?? error).split('\n').slice(0, 20).join('\n'),
};
```
`README.md` 或 `docs/delivery/troubleshooting.md` 增加说明：`V2_CRASH_REPORT_URL` 仅接受 HTTPS 受信端点。

- [ ] **Step 2: 更新签名校验**

`main.cjs` 顶部（autoUpdater 初始化处）：

```js
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = false;
if (process.platform === 'win32') {
  autoUpdater.verifyUpdateCodeSignature = true;
}
```

- [ ] **Step 3: token 内存回退**

`api.ts` `loadTokens` 中 localStorage 分支（`store.get('v2.token') ?? localStorage.getItem('v2.token')` 之后的写回与读取）：

```ts
if (store) {
  memoryToken = (await store.get('v2.token')) ?? null;
  memoryRefreshToken = (await store.get('v2.refreshToken')) ?? null;
} else {
  // safeStorage 不可用时仅保持内存会话，不落 localStorage
  memoryToken = null;
  memoryRefreshToken = null;
  console.warn('desktop secret store unavailable; session will not persist across restarts');
}
```
（同步把原来 `localStorage.setItem` 的持久化路径删除；保存 token 时若 store 不可用则跳过持久化。）

- [ ] **Step 4: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/web/api.spec.ts
node --check electron/main.cjs
git add electron/main.cjs src/web/api.ts
git commit -m "fix(v2): minimize crash reports, enforce update signature check, keep tokens in memory when safeStorage is unavailable"
```

---

## Phase 4 — 边界、异常与日志

### Task 4.1: sync pull 游标修正 + push 事务批（H2-edge + M3-perf）

**Files:**
- Modify: `src/server/application/service-modules/sync.ts:41-48,73-122`
- Test: `src/server/application/services.spec.ts`

**Interfaces:**
- Produces: `pull()` 返回值增加 `cursor: string`（本批最后一条 createdAt，空批时等于入参 since）；`serverTime` 保持墙钟。`push()` 每 500 条一个事务。

- [ ] **Step 1: pull 游标**

```ts
const changes = this.db.prepare(
  `SELECT id, tableName, recordId, operation, deviceId, clinicId, createdAt
   FROM SyncChange
   WHERE createdAt > ? AND deviceId != ?${tenantAnd(context.clinicId)}
   ORDER BY createdAt ASC, rowid ASC
   LIMIT 1000`,
).all(since, deviceId, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
const cursor = changes.length > 0
  ? String(changes[changes.length - 1].createdAt)
  : since;
return { changes, cursor, serverTime: new Date().toISOString() };
```

- [ ] **Step 2: push 事务批**

`push()` 内循环改成分批事务（以 500 为一批）：

```ts
const applyBatch = this.db.transaction((batch: typeof payload.changes) => {
  let accepted = 0;
  for (const change of batch) {
    // ...原有逐条 apply 逻辑（保持不变），成功 accepted++
  }
  return accepted;
});
for (let i = 0; i < payload.changes.length; i += 500) {
  const batch = payload.changes.slice(i, i + 500);
  try {
    batchAccepted += applyBatch(batch);
  } catch (error) {
    // 系统性错误：记录并中止剩余批次
    const message = error instanceof Error ? error.message : String(error);
    for (const change of batch) errors.push({ recordId: change.recordId, error: message });
    break;
  }
}
```

- [ ] **Step 3: 测试**

`services.spec.ts`：插入 1001 条 SyncChange，`pull(since)` 返回 1000 条 + cursor 等于第 1000 条 createdAt；用 cursor 再 pull 返回剩余 1 条。push 300 条断言 accepted=300 且库中状态一致。

- [ ] **Step 4: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/application/services.spec.ts
git add src/server/application/service-modules/sync.ts
git commit -m "fix(v2): return stable sync pull cursor and apply push in transactional batches"
```

---

### Task 4.2: 预约看板本地日期 + 按日期服务端查询（H3-edge + L4-edge）

**Files:**
- Modify: `src/web/AppointmentBoardPage.tsx:30-33`
- Modify: `src/server/http/read-routes.ts`（新增按日期端点）
- Test: `src/web/AppointmentBoardPage.spec.tsx`、`src/server/http/app.spec.ts`

- [ ] **Step 1: 服务端按日期端点**

`read-routes.ts` 注册：

```ts
router.get('/appointments/by-date', wrapAsync(async (req, res, next) => {
  const date = String(req.query.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    next(new ValidationError('date must be YYYY-MM-DD'));
    return;
  }
  const from = `${date}T00:00:00.000+08:00`;
  const to = `${date}T23:59:59.999+08:00`;
  const rows = db.prepare(
    `SELECT * FROM Appointment
     WHERE startTime >= ? AND startTime <= ? AND deletedAt IS NULL${tenantAnd(req.context!.clinicId)}
     ORDER BY startTime ASC`,
  ).all(from, to, ...tenantParams(req.context!.clinicId));
  res.json({ success: true, data: { items: rows, total: rows.length } });
}));
```
（`ValidationError` 从 `../infrastructure/errors` 导入；`wrapAsync` 已存在。）

- [ ] **Step 2: 前端改用新端点**

`AppointmentBoardPage.tsx`：

```tsx
const query = useQuery({
  queryKey: ['appointment-board', date],
  queryFn: () => apiRequest<Page<AppointmentRow>>(
    date
      ? `/appointments/by-date?date=${encodeURIComponent(date)}`
      : '/resources/appointments?page=1&pageSize=200',
  ),
  enabled: true,
});
const rows = query.data?.items ?? [];
```
（删除本地 `filter` 与 UTC `slice(0,10)` 比较；未选日期时保留原 200 条最近数据。）

- [ ] **Step 3: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/web/AppointmentBoardPage.spec.tsx src/server/http/app.spec.ts
git add src/server/http/read-routes.ts src/web/AppointmentBoardPage.tsx
git commit -m "fix(v2): query appointments by local clinic date instead of UTC day slicing"
```

---

### Task 4.3: 分页参数非法返回 400（H4-edge）

**Files:**
- Modify: `src/server/http/router.ts:32-34`
- Test: `src/server/http/router.spec.ts`

- [ ] **Step 1: 参数校验**

`router.ts` GET `/:resource` 处理中：

```ts
const rawPage = req.query.page ?? 1;
const rawPageSize = req.query.pageSize ?? 20;
const page = typeof rawPage === 'string' && rawPage.trim() !== '' ? Number(rawPage) : 1;
const pageSize = typeof rawPageSize === 'string' && rawPageSize.trim() !== '' ? Number(rawPageSize) : 20;
if (!Number.isInteger(page) || page < 1) throw new ValidationError('page must be a positive integer');
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new ValidationError('pageSize must be an integer between 1 and 200');
```

- [ ] **Step 2: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/router.spec.ts
git add src/server/http/router.ts
git commit -m "fix(v2): reject invalid pagination parameters with 400 instead of 500"
```

---

### Task 4.4: 微信发送错误明细 + 批量并发（H5-edge + L2-perf）

**Files:**
- Modify: `src/server/application/service-modules/wechat.ts:55-70,105-130`
- Test: `src/server/application/services.spec.ts`

- [ ] **Step 1: provider 返回错误明细**

`wechat.ts` provider `send` 的 catch 分支：

```ts
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, result: `network_error`, detail };
}
```
非 2xx 分支：`return { ok: false, result: `http_${response.status}`, detail: `status ${response.status}` };`（`detail` 为可选字段，接口类型同步扩展 `detail?: string`）。

- [ ] **Step 2: 服务层记录失败原因**

`send`/`sendBatch` 失败时：

```ts
this.logger?.error('wechat send failed', {
  action: 'wechat-send',
  recordId,
  result: outcome.result,
  detail: outcome.detail,
  traceId: context.traceId,
});
```
（服务类若无 logger 字段，在构造函数中注入 `Logger`——参照其他 service-modules 的构造方式。）

- [ ] **Step 3: 批量并发 ≤10**

`sendBatch` 中把串行 `for` 改为：

```ts
const CONCURRENCY = 10;
const results = [];
for (let i = 0; i < records.length; i += CONCURRENCY) {
  const chunk = records.slice(i, i + CONCURRENCY);
  const chunkResults = await Promise.all(chunk.map((record) => this.sendOne(record, context)));
  results.push(...chunkResults);
}
```
（`sendOne` 为原单条发送逻辑的抽取；单条失败不再中断整批——保留失败记录在结果中。）

- [ ] **Step 4: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/application/services.spec.ts
git add src/server/application/service-modules/wechat.ts
git commit -m "fix(v2): record wechat failure details and send batches with bounded concurrency"
```

---

### Task 4.5: 登录审计 + 请求日志 userId（H6-edge + L6-edge）

**Files:**
- Modify: `src/server/http/app.ts`（审计中间件顺序 255-315、请求日志 232-244）
- Modify: `src/server/http/routes/auth-admin.ts`（login 成功/失败审计）
- Test: `src/server/http/app.spec.ts`

- [ ] **Step 1: app.locals 暴露 pushAudit**

`app.ts` 中 `pushAudit` 定义后：

```ts
app.locals.audit = pushAudit;
```

- [ ] **Step 2: login 审计**

`auth-admin.ts` login handler：

```ts
const audit = (req.app.locals.audit as typeof pushAudit) ?? (() => {});
// 成功路径（签发 token 后）：
audit({ action: 'LOGIN_SUCCESS', target: username, ip: req.ip ?? null, traceId: req.traceId, userId: user.id, userName: username });
// 失败路径（catch 中、next(error) 之前）：
audit({ action: 'LOGIN_FAILED', target: username, detail: error instanceof AppError ? error.message : 'login failed', ip: req.ip ?? null, traceId: req.traceId });
```

- [ ] **Step 3: 请求日志带 userId/clinicId**

`app.ts` `res.on('finish')` 的日志对象增加：

```ts
userId: req.context?.userId ?? null,
clinicId: req.context?.clinicId ?? null,
```

- [ ] **Step 4: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/app.spec.ts
git add src/server/http/app.ts src/server/http/routes/auth-admin.ts
git commit -m "feat(v2): audit login attempts and include operator identity in request logs"
```

---

### Task 4.6: logger Error 序列化 + 错误文案翻译（M2-edge + L5-edge）

**Files:**
- Modify: `src/server/infrastructure/logger.ts:50-61`
- Modify: `src/web/messages.ts`
- Test: `src/server/infrastructure/errors.spec.ts` 或新建 `logger.spec.ts`、`src/web/messages.spec.ts`

- [ ] **Step 1: logger 序列化 Error**

`logger.ts` 的 JSON 序列化处：

```ts
function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack,
      cause: value.cause instanceof Error ? serializeValue(value.cause) : value.cause,
    };
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = serializeValue(child);
    }
    return result;
  }
  return value;
}
// write 处：JSON.stringify(serializeValue(entry))
```

- [ ] **Step 2: messages.ts 补充翻译**

`messages.ts` translations 表追加（以现有表结构为准）：

```ts
'Insufficient permissions': '权限不足',
'Missing bearer token': '缺少登录凭证',
'Too many requests': '请求过于频繁，请稍后再试',
'Account is temporarily locked': '账号已临时锁定，请稍后再试',
'User is disabled': '账号已停用',
'Token is no longer valid': '登录状态已失效，请重新登录',
'No clinic scope assigned to this account': '账号未分配诊所，请联系管理员',
```

- [ ] **Step 3: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/web/messages.spec.ts
git add src/server/infrastructure/logger.ts src/web/messages.ts
git commit -m "fix(v2): serialize Error objects in logs and translate remaining user-facing errors"
```

---

### Task 4.7: datetime 输入归一化为 UTC ISO（M3-edge）

**Files:**
- Modify: `src/server/http/validation.ts:47-51`
- Test: `src/server/http/validation.spec.ts`

- [ ] **Step 1: 归一化**

`validation.ts` datetime 分支：

```ts
case 'datetime': {
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
    throw new ValidationError(`${field.name} must be a valid date-time`);
  }
  const normalized = new Date(raw).toISOString();
  if (Number.isNaN(new Date(normalized).getTime())) {
    throw new ValidationError(`${field.name} must be a valid date-time`);
  }
  return normalized;
}
```
这样 `2026-08-05T10:00:00+08:00` 与 `2026-08-05T02:00:00.000Z` 都归一为同一 UTC 字符串，预约冲突检测的字符串比较恢复正确。

- [ ] **Step 2: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/validation.spec.ts
git add src/server/http/validation.ts
git commit -m "fix(v2): normalize datetime inputs to UTC ISO so conflict comparison stays correct"
```

---

### Task 4.8: 幂等覆盖扩展（M1-edge）

**Files:**
- Modify: `src/server/http/router.ts:48-60`（通用资源 POST 支持 Idempotency-Key 头）
- Modify: `src/server/http/routes/workflow.ts`（appointments 创建、wechat send/sendBatch、purchase receive、processing transition、followUp complete/batchComplete）
- Test: `src/server/http/router.spec.ts`、`src/server/http/app.spec.ts`

- [ ] **Step 1: 通用 POST 支持 Idempotency-Key**

`router.ts` POST 处理：

```ts
const requestId = typeof req.header('idempotency-key') === 'string' ? req.header('idempotency-key')! : '';
const result = await withIdempotency(db, {
  operation: `resource.create.${resource.name}`,
  userId: req.context!.userId,
  clinicId: req.context!.clinicId,
  requestId,
}, () => { /* 原有创建逻辑 */ });
```

- [ ] **Step 2: workflow 路由透传**

`workflow.ts` 中 appointments 创建、wechat send/sendBatch、purchase receive、processing transition、followUp complete/batchComplete 的 handler 同样读取 `idempotency-key` 头并传给对应 service 方法（service 方法已有 `requestId?` 参数则直接传；没有的在调用处包 `withIdempotency`）。

- [ ] **Step 3: 测试**

`router.spec.ts`：带 `Idempotency-Key: abc` 连续 POST 两次同一 body → 第二次返回第一次结果且只插入一行。`app.spec.ts`：wechat send 带同一 key 两次 → 只发送一次（mock provider 计数）。

- [ ] **Step 4: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/router.spec.ts src/server/http/app.spec.ts
git add src/server/http/router.ts src/server/http/routes/workflow.ts
git commit -m "feat(v2): honor Idempotency-Key header on generic and workflow writes"
```

---

### Task 4.9: 批量导入系统性错误分类（M4-edge）

**Files:**
- Modify: `src/server/application/service-modules/clinical-ops.ts:121-167`
- Test: `src/server/application/services.spec.ts`

- [ ] **Step 1: 错误分类**

`clinical-ops.ts` 导入循环 catch 中：

```ts
function isSystematicError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '');
    if (/SQLITE_(FULL|BUSY|IOERR|CORRUPT|CANTOPEN|NOMEM)/.test(code)) return true;
  }
  return false;
}
```
循环中：

```ts
} catch (error) {
  if (isSystematicError(error)) {
    throw new AppError('IMPORT_SYSTEM_ERROR', `批量导入中止：${error instanceof Error ? error.message : String(error)}`, 500);
  }
  errors.push({ row: rowIndex, error: error instanceof Error ? error.message : String(error) });
  continue;
}
```
（`AppError` 从 `../../infrastructure/errors` 导入。）分片事务：若某分片 COMMIT 失败（系统性），抛 500 并提示"前 N 条已导入，请人工核对后重试"。

- [ ] **Step 2: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/application/services.spec.ts
git add src/server/application/service-modules/clinical-ops.ts
git commit -m "fix(v2): abort bulk import on systematic DB errors instead of misclassifying them"
```

---

### Task 4.10: 审计 flush 重试与关闭冲刷（M6-edge）

**Files:**
- Modify: `src/server/http/app.ts:101-157`
- Test: `src/server/http/app.spec.ts`

- [ ] **Step 1: flush 失败重试一次**

`flushAudit` catch 分支：

```ts
} catch (error) {
  if (logger) logger.error('audit batch flush failed', { error });
  else console.error('audit batch flush failed', error);
  // 重试一次：把行放回队列头部，1 秒后再刷
  setTimeout(() => {
    if (auditBuffer.length + rows.length <= AUDIT_BUFFER_MAX * 2) {
      auditBuffer.unshift(...rows);
      scheduleAuditFlush();
    }
  }, 1000).unref();
}
```

- [ ] **Step 2: shutdown 消息冲刷**

`app.ts` 导出 `flushAuditNow`（在 createApp 返回值或 app.locals 上暴露），`main.ts` 的 `process.on('message')` shutdown 分支中先调用：

```ts
process.on('message', (message) => {
  if (message === 'shutdown') {
    try {
      (app.locals.flushAuditNow as () => void)();
    } catch { /* best effort */ }
    shutdown();
  }
});
```

- [ ] **Step 3: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/http/app.spec.ts
git add src/server/http/app.ts src/server/main.ts
git commit -m "fix(v2): retry audit flush once and drain buffer on shutdown"
```

---

### Task 4.11: 金额溢出防护（L2-edge）

**Files:**
- Modify: `src/server/application/service-modules/financial.ts:89`
- Test: `src/server/application/services.spec.ts`

- [ ] **Step 1: 乘积校验**

`ChargeService.create` 计算 subtotal 处：

```ts
const subtotal = Math.round(item.price * item.quantity);
if (!Number.isSafeInteger(subtotal) || subtotal > 100_000_000_00) {
  throw new ValidationError(`Charge item subtotal exceeds maximum allowed amount`);
}
```
（`100_000_000_00` = 1 亿元（分），与 validation.ts 的 money 上限 1_000_000_00 分（100 万元）对齐——以 DTO 校验为准，此项为防御性兜底；同时给 `quantity` 加 `<= 1_000_000` 校验。）

- [ ] **Step 2: 测试 + 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/application/services.spec.ts
git add src/server/application/service-modules/financial.ts
git commit -m "fix(v2): guard charge subtotal against integer overflow"
```

---

## Phase 5 — 代码卫生与文档

### Task 5.1: 死代码清理（knip 清单）

**Files:**
- Delete: `src/web/test-utils.tsx`、`apps/v2/test-output.log`（如重新出现）
- Modify: `src/server/infrastructure/errors.ts:58`（删 `fromNativeError`）、`src/server/infrastructure/tenant.ts:23`（删 `tenantWhereStrict`，Task 3.1 后已与 `tenantWhere` 等价）
- Modify: `knip.json`（移除 `scripts/wait-for-services.mjs` 的 ignore 项）
- Modify: `docs/audits/`（把 4 份对象为已删除 apps/api 的报告移入 `docs/audits/archive/`）

- [ ] **Step 1: 删除/移动**

```bash
rm src/web/test-utils.tsx apps/v2/test-output.log
mkdir -p docs/audits/archive
git mv docs/audits/ARCHITECTURE_REVIEW.md docs/audits/architecture-audit-2026.md docs/audits/NEXT_STEPS.md docs/audits/ARCHITECTURE_CONSTRAINTS_ENFORCEMENT_STRATEGY.md docs/audits/archive/
```
（`git mv` 前确认这些文件已跟踪；若未跟踪用普通 mv。）

- [ ] **Step 2: 删未用导出**

`errors.ts` 删除 `fromNativeError` 函数及其唯一调用点（若有）；`tenant.ts` 删除 `tenantWhereStrict`（先确认 Task 3.1 已把 `tenantWhere` 改为严格版且无引用残留：`grep -rn "tenantWhereStrict" src/`）。

- [ ] **Step 3: knip.json**

```json
{
  "ignore": [
    "src/domain/contracts.ts",
    "legacy/schema/**",
    "electron/preload.cjs"
  ]
}
```

- [ ] **Step 4: 验证**

```bash
pnpm --filter @dental/v2 run knip
pnpm --filter @dental/v2 typecheck
```
Expected: 0 unused files / 0 unused exports。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore(v2): remove dead code and archive stale audits"
```

---

### Task 5.2: 定时任务收敛到 scheduler.ts（消除双份实现）

**Files:**
- Modify: `src/server/main.ts`（删除内联 runAutoBackup/cleanupAuditLogs，改用 `startSchedulers`）
- Modify: `src/server/scheduler.ts`（加入 idempotency 清理定时器）
- Test: `src/server/scheduler.spec.ts`

**Interfaces:**
- Consumes: `startSchedulers(options)`（现有签名），options 增加 `idempotencyCleanup?: () => { deleted: number }`。

- [ ] **Step 1: scheduler.ts 扩展**

`scheduler.ts` 的 `StartSchedulersOptions` 增加 `idempotencyCleanup?: () => { deleted: number }`，`startSchedulers` 内新增每日定时器：

```ts
if (options.idempotencyCleanup) {
  const runCleanup = () => {
    try {
      const { deleted } = options.idempotencyCleanup!();
      if (deleted > 0) logger.info('idempotency cleanup completed', { action: 'idempotency-cleanup', deleted });
    } catch (error) {
      logger.error('idempotency cleanup failed', { action: 'idempotency-cleanup', error });
    }
  };
  runCleanup();
  const idempotencyTimer = setInterval(runCleanup, 24 * 60 * 60 * 1000);
  idempotencyTimer.unref?.();
  timers.push(idempotencyTimer);
}
```
（`timers` 数组收集所有 timer 供 `stop()` 清理——把现有 backupTimer/auditTimer 也放入该数组。）

- [ ] **Step 2: main.ts 改用 startSchedulers**

删除 `main.ts` 中 `runAutoBackup`、`cleanupAuditLogs`、两个 `setInterval` 与相关常量（`AUDIT_RETENTION_MS`、`_autoBackupRunning` 等），替换为：

```ts
import { startSchedulers } from './scheduler';
// ...
const schedulers = startSchedulers({
  backups,
  audit,
  autoBackupIntervalMs,
  autoBackupKeep,
  logger,
  onAlertCreate: (input) => alerts.create({ ...input, alertType: 'SCHEDULER_TASK_FAILURE' as const }),
  idempotencyCleanup: () => cleanupIdempotencyRecords(db),
});
// shutdown() 中：schedulers.stop();
```
注意：原 main.ts 的自动备份是 `setTimeout(5min)` 首次延迟 + `setInterval`；`startSchedulers` 现有实现是立即 `void runAutoBackup()`——保留其现有行为（启动即备份一次可接受；如需保留 5 分钟延迟，在 scheduler.ts 中把首次调用改为 `setTimeout(runAutoBackup, 5 * 60 * 1000)`）。

- [ ] **Step 3: 测试**

`scheduler.spec.ts`：断言 `startSchedulers` 返回对象的 `stop()` 后定时器不再触发（用 vi.useFakeTimers）；`idempotencyCleanup` 回调被每日调用。

- [ ] **Step 4: 验证 + 提交**

```bash
pnpm --filter @dental/v2 exec vitest run src/server/scheduler.spec.ts
pnpm --filter @dental/v2 typecheck
git add src/server/main.ts src/server/scheduler.ts
git commit -m "refactor(v2): unify scheduled tasks into scheduler module"
```

---

### Task 5.3: 脚本去重（run-smokes 复用 wait-for-services）

**Files:**
- Modify: `scripts/wait-for-services.mjs`（导出 `waitForService` 函数）
- Modify: `scripts/run-smokes.mjs:41-53`（删除内嵌 waitFor，改用 import）
- 可选: `scripts/verify-package.mjs` / `scripts/verify-update.mjs` 抽公共存在性检查

- [ ] **Step 1: wait-for-services.mjs 导出函数**

```js
export async function waitForService({ url, text = 'ok', timeoutMs = 30_000, intervalMs = 500 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const body = await response.text();
        if (body.includes(text)) return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Service did not become ready: ${url}`);
}
```
（保留 CLI 入口：文件末尾 `if (import.meta.url === ...)` 判断或继续由 `v2-ci.yml:73` 以 node 直接调用——若直接调用需保留原 `main` 逻辑，把原逻辑改为调用 `waitForService`。）

- [ ] **Step 2: run-smokes.mjs 复用**

`run-smokes.mjs` 删除内嵌 `waitFor()`，顶部 `import { waitForService } from './wait-for-services.mjs';`，调用点替换为 `await waitForService({ url, text: 'root' })`。

- [ ] **Step 3: 可选——verify 脚本公共函数**

`verify-package.mjs` 与 `verify-update.mjs` 共有的 `filesExist(paths)` 检查抽到 `scripts/lib/artifact-utils.mjs` 并让两脚本 import（约 15 行去重；如改动风险大可跳过，标记为可选）。

- [ ] **Step 4: 验证 + 提交**

```bash
node scripts/wait-for-services.mjs --help 2>&1 | head -5   # 语法可加载
node --check scripts/run-smokes.mjs
git add scripts/wait-for-services.mjs scripts/run-smokes.mjs scripts/lib/artifact-utils.mjs scripts/verify-package.mjs scripts/verify-update.mjs
git commit -m "refactor(v2): reuse wait-for-services helper across smoke scripts"
```

---

### Task 5.4: 文档与版本号同步

**Files:**
- Modify: `D:/Desktop/rongyi/AGENTS.md`（外层，目录树删掉 apps/api、apps/web、packages/shared 行）
- Modify: `source/apps/v2/README.md`（"约 20k 行"等过时描述、dev seed 说明已由 Task 3.6 加）
- Modify: `source/package.json`（root version 2.1.4 → 2.2.0，与 apps/v2 对齐）

- [ ] **Step 1: 外层 AGENTS.md**

把 19-28 行的目录树改为：

```text
d:\Desktop\rongyi\
├── source\           ← ✅ 真实项目（口腔诊所管理系统，独立 git 仓库）
│   ├── AGENTS.md     ← 项目级指引（模块映射、约束、验证命令）
│   └── apps\v2\      ← 唯一应用包（Electron + React + Express + SQLite）
├── .qoder\           ← Agent 规则（rules/）与技能（skills/）
├── source/docs/audits\  ← 历史审计报告（只读参考）
└── （根目录 git 树为陈旧遗留，勿以其内容为准）
```

- [ ] **Step 2: 版本号与 README**

```bash
cd D:/Desktop/rongyi/source
# package.json 中 "version": "2.1.4" → "2.2.0"
```
`apps/v2/README.md`：把 "约 20k 行" 类描述更新为当前实际规模（约 30k 行 TS/TSX，74 个测试文件）；确认 "Layout" 一节与现状一致。

- [ ] **Step 3: 验证 + 提交**

```bash
cd D:/Desktop/rongyi && git add AGENTS.md && git commit -m "docs: sync outer workspace tree with single-app layout"
cd source && git add package.json apps/v2/README.md && git commit -m "docs(v2): sync version and README with current app scale"
```

---

### Task 5.5: （独立子计划）CRUD 页面模板收敛 — 大纲

**建议另立子计划** `docs/plans/2026-08-05-crud-page-unification.md` 后单独执行，不并入本计划（独立子系统、体量大、有独立测试门禁）。

**范围：** 14 个相似度 0.55-0.78 的 CRUD 页面（FirstExams/Prescriptions/TreatmentPlans/Treatments/ProcessingOrders/PurchaseOrders/MedicalRecords/Imaging/Cephalometric/MemberCards/Patients/Visits/Charges/FollowUps）+ 14 个相似度 0.70-0.94 的模板 spec。

**方案（大纲）：**
1. 新建 `src/web/use-crud-resource.ts`：`useCrudResource({ resource, columns, formFields, validate, createPayload, updatePayload })` 封装 useQuery/useMutation/分页/搜索/表单状态。
2. 抽 `CrudPage` 通用组件（DataTable + Dialog + 分页 + 空态/错误态 + toast），每页收敛为 ~50-80 行配置。
3. 先迁移 2 个页面（如 Visits、Prescriptions）验证 hook 与组件契约，再批量迁移其余页面。
4. spec 收敛：为 `CrudPage` 与 hook 写深度断言测试（CRUD 全流程、错误态、分页），页面 spec 只保留差异化断言（字段、校验规则）。
5. 验收：`pnpm --filter @dental/v2 test` 全绿 + `test:coverage` 不降 + `knip` 干净。

---

## 覆盖矩阵（审计发现 → 任务）

| 审计发现 | 任务 |
|---|---|
| 7 个失败测试 / QueryBoundary 无 data 守卫 | T0.1 |
| 162 个未提交变更 / CI 盲区 | T0.2 |
| core.autocrlf 行尾噪音 | T0.3 |
| C1 迁移 116 崩溃循环 | T1.1 |
| C2 恢复 marker 卡死 | T1.2 |
| M5 备份 .tmp/.staged 泄漏 | T1.2 |
| C3 DebtService.pay 非原子 | T1.3 |
| H1 Electron 重启计数/首启失败无窗口 | T1.4 |
| S1 FTS 触发器写放大 | T2.1 |
| L3 FTS 空查询 500 | T2.1 |
| H2 搜索全表扫 + 无防抖 | T2.2 |
| H3 幂等清理全表 DELETE | T2.3 |
| H4 启动 integrity_check 挤占窗口 | T2.4 |
| H5 前端无代码分割 | T2.5 |
| H1 仪表盘全表聚合 | T2.6 |
| M5 索引缺失（ChargeItem 分组） | T2.3（迁移 119） |
| H2 安全：NULL clinicId 全库越权 | T3.1 |
| M1 性能：tenant OR NULL 削弱索引 | T3.1 |
| H1 安全：备份/恢复全局化 | T3.2 |
| H3 安全：IPC 无 sender 校验 + 密钥暴露 | T3.3 |
| M1 安全：密钥明文落盘 | T3.4 |
| M2 安全：备份默认不加密 | T3.4 |
| M3 安全/L1 边界：CSV 公式注入 | T3.5 |
| M4 安全：掩码缺 phone/cardNo + 不递归 | T3.5 |
| M5 安全：上传无配额 | T3.6 |
| M6 安全：dev seed 弱口令后门 | T3.6 |
| L1/L2/L3 安全：崩溃上报/更新签名/token 回退 | T3.7 |
| H2 边界：sync pull 游标丢变更 | T4.1 |
| M3 性能：sync push 无事务 | T4.1 |
| H3 边界：预约看板 UTC 错日 + L4 200 条上限 | T4.2 |
| H4 边界：分页 NaN 500 | T4.3 |
| H5 边界：微信错误吞掉 + L2 性能串行 | T4.4 |
| H6 边界：登录无审计 + L6 日志无 userId | T4.5 |
| M2 边界：logger Error 序列化 {} | T4.6 |
| L5 边界：英文错误提示 | T4.6 |
| M3 边界：datetime 格式混存 | T4.7 |
| M1 边界：幂等覆盖缺口 | T4.8 |
| M4 边界：批量导入系统性错误 | T4.9 |
| M6 边界：审计 flush 静默丢失 | T4.10 |
| L2 边界：金额溢出 | T4.11 |
| knip 死代码（test-utils/fromNativeError/tenantWhereStrict） | T5.1 |
| 过期审计报告堆积 | T5.1 |
| scheduler.ts 与 main.ts 双份定时任务 | T5.2 |
| run-smokes 内嵌 waitFor / verify 脚本重叠 | T5.3 |
| 外层 AGENTS.md 陈旧 / 版本号漂移 | T5.4 |
| 14 个 CRUD 页面复制粘贴 | T5.5（独立子计划） |

## Self-Review 记录

- **Spec 覆盖**：审计报告全部 3 严重 / 6 高 / 6 中 / 6 低（边界）+ 1 严重 / 5 高（性能）+ 3 高 / 6 中 / 5 低（安全）+ 代码卫生项均已映射到任务，无遗漏；仅性能 L1/L4/L5（relation 点查、审计缓冲、上传同步写）为可接受现状，不单列任务（L5 上传写文件在 T3.6 配额附近可顺带评估）。
- **Placeholder 扫描**：无 TBD/TODO；代码步骤均含具体实现；T3.2/T4.4/T5.3 中有"以实际字段为准/可选"标注的仅限字段名核对与可选优化，主路径完整。
- **类型一致性**：`buildFtsQuery`（T2.1 产出 → T2.2 消费）、`rebuildSearchIndex`（T2.1 产出 → T2.1 接入）、`useDebouncedValue`（T2.2 产出 → T2.2 消费）、`cleanupIdempotencyRecords`（T2.3 产出 → T5.2 消费）、`startSchedulers` 扩展（T5.2 消费 T2.3 产出）签名一致；`tenantWhereStrict` 在 T3.1 删除、T5.1 确认无引用，顺序正确（T3.1 先于 T5.1）。
- **依赖顺序**：T0.1→T0.2（先修测试再提交）；T1.1 依赖迁移机制而非新迁移号；T2.1 迁移 118 与 T2.3 迁移 119 与 T3.1 迁移 120 号段无冲突；T5.2 依赖 T2.3 的 `cleanupIdempotencyRecords`。
