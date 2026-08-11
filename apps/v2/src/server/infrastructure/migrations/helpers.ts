import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// migrations 共享辅助函数（M-04：由 migrations.ts 拆分）
export function addColumns(db: Database.Database, table: string, columns: Array<[string, string]>): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name),
  );
  for (const [name, definition] of columns) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${definition}`);
  }
}

export function ensureForeignKeys(
  db: Database.Database,
  table: string,
  createSql: string,
): void {
  const existing = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
  if (existing.length > 0) return;

  const indexes = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
  ).all(table) as Array<{ sql: string }>;
  const newTable = `${table}_fk_new`;
  db.exec(createSql.replace(`"${table}"`, `"${newTable}"`));

  const oldColumns = new Set(
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name),
  );
  const newColumns = new Set(
    (db.prepare(`PRAGMA table_info("${newTable}")`).all() as Array<{ name: string }>).map((column) => column.name),
  );
  const missing = [...oldColumns].filter((column) => !newColumns.has(column));
  if (missing.length > 0) {
    throw new Error(`Migration for ${table} would drop columns: ${missing.join(', ')}`);
  }
  const columns = [...newColumns].filter((column) => oldColumns.has(column));
  const columnList = columns.map((column) => `"${column}"`).join(', ');
  repairLegacyData(db, table);
  db.prepare(
    `INSERT INTO "${newTable}" (${columnList})
     SELECT ${columnList} FROM "${table}"`,
  ).run();
  db.exec(`DROP TABLE "${table}"`);
  db.exec(`ALTER TABLE "${newTable}" RENAME TO "${table}"`);
  for (const index of indexes) db.exec(index.sql);
}

/**
 * Repair legacy rows that would violate the constraints of the rebuilt table
 * before `ensureForeignKeys` copies them over. Every change is recorded in
 * `MigrationRepairLog`; rows with orphan NOT NULL foreign keys are preserved
 * verbatim in `MigrationRepairQuarantine` and removed from the source table so
 * the INSERT SELECT cannot fail.
 */
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
  // 旧表未必含 116 新表的所有列（如 ChargeItem.inventoryItemId 只在新 DDL 里）；
  // 缺列时跳过对应修复，INSERT SELECT 会为其使用新表 DEFAULT（通常为 NULL）。
  const hasColumn = (t: string, c: string): boolean =>
    (db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string }>).some((column) => column.name === c);

  // 数值钳制：新表 CHECK/NOT NULL 约束要求的取值域。
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
    if (!hasColumn(table, field)) continue;
    const rows = db.prepare(`SELECT id, ${field} AS beforeValue FROM "${table}" WHERE ${sql.split('WHERE ')[1]}`).all() as Array<{ id: string; beforeValue: unknown }>;
    db.exec(sql);
    for (const row of rows) log(table, field, row.id, row.beforeValue, null, reason);
  }

  // 唯一键去重：保留组内插入顺序最新一行（rowid DESC），其余追加 -dup-N 后缀。
  const uniqueColumns: Record<string, string> = {
    MemberCard: 'cardNo',
    ProcessingOrder: 'number',
  };
  const uniqueColumn = uniqueColumns[table];
  if (uniqueColumn && hasColumn(table, uniqueColumn) && hasColumn(table, 'clinicId')) {
    const dupRows = db.prepare(
      `SELECT id, ${uniqueColumn} AS value, clinicId FROM "${table}" t
       WHERE t.clinicId IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM "${table}" t2
           WHERE t2.clinicId = t.clinicId AND t2.${uniqueColumn} = t.${uniqueColumn} AND t2.id != t.id
         )
         AND t.id != (
           SELECT t3.id FROM "${table}" t3
           WHERE t3.clinicId = t.clinicId AND t3.${uniqueColumn} = t.${uniqueColumn}
           ORDER BY t3.rowid DESC LIMIT 1
         )`,
    ).all() as Array<{ id: string; value: string; clinicId: string | null }>;
    let n = 1;
    for (const dup of dupRows) {
      let after = `${dup.value}-dup-${n++}`;
      // 避免后缀与同组既有值冲突（重复键组可能已有 -dup-N 形式的值）。
      while (db.prepare(`SELECT 1 FROM "${table}" WHERE clinicId IS ? AND ${uniqueColumn} = ? AND id != ? LIMIT 1`).get(dup.clinicId, after, dup.id)) {
        after = `${dup.value}-dup-${n++}`;
      }
      db.prepare(`UPDATE "${table}" SET ${uniqueColumn} = ? WHERE id = ?`).run(after, dup.id);
      log(table, uniqueColumn, dup.id, dup.value, after, '重复唯一键追加后缀');
    }
  }

  // 孤儿外键：以迁移 116 各表实际定义的 FK 为准（可空列 -> NULL，NOT NULL 列 -> 隔离）。
  const orphanFkRepairs: Record<string, Array<[string, string, boolean]>> = {
    MemberCard: [['patientId', 'Patient', false]],
    Refund: [['chargeId', 'Charge', false], ['patientId', 'Patient', false], ['operatorId', 'User', true]],
    ChargeItem: [['chargeId', 'Charge', false], ['treatmentId', 'Treatment', true], ['inventoryItemId', 'InventoryItem', true]],
    PurchaseOrderItem: [['orderId', 'PurchaseOrder', false], ['itemId', 'InventoryItem', true]],
    InventoryTransaction: [['itemId', 'InventoryItem', false], ['supplierId', 'Supplier', true], ['operatorId', 'User', true]],
    ProcessingOrder: [['patientId', 'Patient', false], ['visitId', 'Visit', true], ['factoryId', 'ProcessingFactory', true], ['doctorId', 'User', true], ['chargeId', 'Charge', true]],
  };
  for (const [fkColumn, refTable, nullable] of orphanFkRepairs[table] ?? []) {
    if (!hasColumn(table, fkColumn)) continue;
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
      // NOT NULL 外键孤儿：整行移入隔离表并立即从源表删除，INSERT SELECT 时不再复制。
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
        db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(o.id);
      }
    }
  }
}

/**
 * T2R-03 兜底：迁移 121 把 NULL clinicId 统一回填为最早诊所，旧库中
 * (NULL, 同唯一键) 的重复行回填后会撞 118 建立的 (clinicId, 唯一字段)
 * 唯一索引。在 121 之前把 NULL clinicId 组内除最新插入行（rowid DESC）外的重复行追加
 * -dup-N 后缀，模式与 repairLegacyData 的去重保持一致，每处修改留痕
 * MigrationRepairLog。返回修复行数。
 */
export function dedupNullClinicRows(db: Database.Database, table: string, uniqueColumn: string): number {
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
  const dupRows = db.prepare(
    `SELECT id, "${uniqueColumn}" AS value FROM "${table}" t
     WHERE t.clinicId IS NULL
       AND EXISTS (
         SELECT 1 FROM "${table}" t2
         WHERE t2.clinicId IS NULL AND t2."${uniqueColumn}" = t."${uniqueColumn}" AND t2.id != t.id
       )
       AND t.id != (
         SELECT t3.id FROM "${table}" t3
         WHERE t3.clinicId IS NULL AND t3."${uniqueColumn}" = t."${uniqueColumn}"
         ORDER BY t3.rowid DESC LIMIT 1
       )`,
  ).all() as Array<{ id: string; value: string }>;
  let repaired = 0;
  let n = 1;
  for (const dup of dupRows) {
    let after = `${dup.value}-dup-${n++}`;
    // 避免后缀与同组既有值冲突（重复键组可能已有 -dup-N 形式的值）。
    while (db.prepare(`SELECT 1 FROM "${table}" WHERE clinicId IS ? AND "${uniqueColumn}" = ? AND id != ? LIMIT 1`).get(null, after, dup.id)) {
      after = `${dup.value}-dup-${n++}`;
    }
    db.prepare(`UPDATE "${table}" SET "${uniqueColumn}" = ? WHERE id = ?`).run(after, dup.id);
    db.prepare(
      `INSERT INTO MigrationRepairLog (id, tableName, field, recordId, beforeValue, afterValue, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), table, uniqueColumn, dup.id, dup.value, after, 'NULL clinicId 重复键追加后缀（121 回填前）');
    repaired++;
  }
  return repaired;
}

export function snapshotDatabase(db: Database.Database, snapshotDir: string): void {
  const dir = path.join(snapshotDir, 'pre-migration');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `pre-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  // VACUUM INTO 不能在事务内执行；runMigrations 开始时无事务，安全。
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  // 只保留最近 SNAPSHOT_KEEP 份，避免长期运行累积磁盘占用。
  const SNAPSHOT_KEEP = 3;
  const snapshots = fs.readdirSync(dir)
    .filter((name) => name.startsWith('pre-') && name.endsWith('.sqlite'))
    .sort()
    .reverse();
  for (const stale of snapshots.slice(SNAPSHOT_KEEP)) {
    try {
      fs.rmSync(path.join(dir, stale), { force: true });
    } catch (error) {
      console.warn(`[migrations] failed to remove stale snapshot ${stale}`, error);
    }
  }
}

/**
 * Applies pending schema migrations and records them in schema_migrations.
 * Returns the number of migrations applied in this run (0 when the schema is
 * already up to date). The pre-migration snapshot is only taken when there is
 * actually something to migrate, and failures to snapshot never block startup.
 */
