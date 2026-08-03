import type Database from 'better-sqlite3';
import type {
  AlertRepository,
  AnalyticsRepository,
  AuthRepository,
  AuthUserRecord,
  ClinicalWorkflowRepository,
  DebtRecord,
  DebtRepository,
  FollowUpRepository,
  FollowUpRecord,
  HrRepository,
  InventoryItemRecord,
  InventoryRepository,
  InventoryTransactionRecord,
  MemberCardRecord,
  MemberCardRepository,
  PatientRiskRepository,
  ProcessingOrderRepository,
  PurchaseOrderItemRecord,
  PurchaseOrderRecord,
  PurchaseOrderRepository,
  WechatMessageRepository,
} from '../../application/ports';

export class SqliteMemberCardRepository implements MemberCardRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): MemberCardRecord | null {
    return (this.db.prepare('SELECT * FROM MemberCard WHERE id = ?').get(id) as MemberCardRecord | undefined) ?? null;
  }

  findByPatient(patientId: string): MemberCardRecord | null {
    return (this.db.prepare('SELECT * FROM MemberCard WHERE patientId = ? AND status = ? LIMIT 1').get(patientId, 'ACTIVE') as MemberCardRecord | undefined) ?? null;
  }

  updateBalanceRefund(id: string, balance: number, updatedAt: string): void {
    this.db.prepare('UPDATE MemberCard SET balance = ?, updatedAt = ? WHERE id = ?').run(balance, updatedAt, id);
  }

  updateRecharge(id: string, balance: number, amount: number, updatedAt: string): void {
    this.db.prepare('UPDATE MemberCard SET balance = ?, totalRecharge = totalRecharge + ?, updatedAt = ? WHERE id = ?')
      .run(balance, amount, updatedAt, id);
  }

  updateConsume(id: string, balance: number, amount: number, updatedAt: string): void {
    this.db.prepare('UPDATE MemberCard SET balance = ?, totalConsume = totalConsume + ?, updatedAt = ? WHERE id = ?')
      .run(balance, amount, updatedAt, id);
  }

  updatePoints(id: string, points: number, totalPoints: number, updatedAt: string): void {
    this.db.prepare('UPDATE MemberCard SET points = ?, totalPoints = ?, updatedAt = ? WHERE id = ?')
      .run(points, totalPoints, updatedAt, id);
  }

  insertLog(input: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT INTO MemberCardLog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         cardId, type, amount, balanceAfter, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.cardId,
      input.type,
      input.amount,
      input.balanceAfter,
      input.remark ?? null,
    );
  }

  insertPointLog(input: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT INTO MemberPointLog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         cardId, type, points, pointsAfter, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.cardId,
      input.type,
      input.points,
      input.pointsAfter,
    );
  }
}

export class SqliteInventoryRepository implements InventoryRepository {
  constructor(private readonly db: Database.Database) {}

  findItem(id: string): InventoryItemRecord | null {
    return (this.db.prepare('SELECT * FROM InventoryItem WHERE id = ? AND deletedAt IS NULL').get(id) as InventoryItemRecord | undefined) ?? null;
  }

  updateStock(id: string, stock: number, updatedAt: string): void {
    this.db.prepare('UPDATE InventoryItem SET stock = ?, updatedAt = ? WHERE id = ?').run(stock, updatedAt, id);
  }

  createTransaction(record: InventoryTransactionRecord): void {
    this.db.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt,
         itemId, type, quantity, beforeStock, afterStock, operatorId, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.clinicId ?? null,
      record.createdAt,
      record.updatedAt,
      record.itemId,
      record.type,
      record.quantity,
      record.beforeStock,
      record.afterStock,
      record.operatorId ?? null,
      record.remark ?? null,
    );
  }

  lowStock(): InventoryItemRecord[] {
    return this.db.prepare(
      'SELECT * FROM InventoryItem WHERE deletedAt IS NULL AND stock <= minStock ORDER BY stock ASC LIMIT 100',
    ).all() as InventoryItemRecord[];
  }
}

export class SqliteDebtRepository implements DebtRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): DebtRecord | null {
    return (this.db.prepare('SELECT * FROM Debt WHERE id = ? AND deletedAt IS NULL').get(id) as DebtRecord | undefined) ?? null;
  }

  findByCharge(chargeId: string): DebtRecord | null {
    return (this.db.prepare('SELECT * FROM Debt WHERE chargeId = ? AND deletedAt IS NULL').get(chargeId) as DebtRecord | undefined) ?? null;
  }

  updatePaid(id: string, paidAmount: number, status: string, updatedAt: string): void {
    this.db.prepare('UPDATE Debt SET paidAmount = ?, status = ?, updatedAt = ? WHERE id = ?')
      .run(paidAmount, status, updatedAt, id);
  }
}

export class SqliteAuthRepository implements AuthRepository {
  constructor(private readonly db: Database.Database) {}

  findByUsername(username: string): AuthUserRecord | null {
    const row = this.db.prepare('SELECT * FROM User WHERE username = ? AND deletedAt IS NULL').get(username) as
      | Record<string, unknown>
      | undefined;
    return row ? this.map(row) : null;
  }

  findById(id: string): AuthUserRecord | null {
    const row = this.db.prepare('SELECT * FROM User WHERE id = ? AND deletedAt IS NULL').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.map(row) : null;
  }

  updateLoginAttempts(id: string, attempts: number, lockedUntil: string | null, updatedAt: string): void {
    this.db.prepare('UPDATE User SET loginAttempts = ?, lockedUntil = ?, updatedAt = ? WHERE id = ?')
      .run(attempts, lockedUntil, updatedAt, id);
  }

  resetLoginAttempts(id: string, updatedAt: string): void {
    this.db.prepare('UPDATE User SET loginAttempts = 0, lockedUntil = NULL, updatedAt = ? WHERE id = ?')
      .run(updatedAt, id);
  }

  updatePassword(id: string, passwordHash: string, updatedAt: string): void {
    this.db.prepare('UPDATE User SET passwordHash = ?, tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')
      .run(passwordHash, updatedAt, id);
  }

  private map(row: Record<string, unknown>): AuthUserRecord {
    return {
      id: String(row.id),
      clinicId: row.clinicId ? String(row.clinicId) : null,
      username: String(row.username),
      passwordHash: String(row.passwordHash),
      name: String(row.name),
      role: String(row.role),
      active: Number(row.active) === 1,
      loginAttempts: Number(row.loginAttempts ?? 0),
      lockedUntil: row.lockedUntil ? String(row.lockedUntil) : null,
      tokenVersion: Number(row.tokenVersion ?? 0),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      deletedAt: row.deletedAt ? String(row.deletedAt) : null,
    };
  }
}

export class SqlitePurchaseOrderRepository implements PurchaseOrderRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): PurchaseOrderRecord | null {
    return (this.db.prepare('SELECT * FROM PurchaseOrder WHERE id = ? AND deletedAt IS NULL').get(id) as PurchaseOrderRecord | undefined) ?? null;
  }

  itemsByOrder(orderId: string): PurchaseOrderItemRecord[] {
    return this.db.prepare('SELECT * FROM PurchaseOrderItem WHERE orderId = ? AND deletedAt IS NULL').all(orderId) as PurchaseOrderItemRecord[];
  }

  createOrder(input: PurchaseOrderRecord): void {
    this.db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(input.id, input.clinicId ?? null, input.createdAt, input.updatedAt, input.number, input.supplierId ?? null, input.totalAmount, input.status);
  }

  createItem(input: PurchaseOrderItemRecord): void {
    this.db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.clinicId ?? null, input.createdAt, input.updatedAt, input.orderId, input.itemId ?? null, input.name, input.quantity, input.unitPrice, input.subtotal);
  }

  markReceived(id: string, receivedAt: string, updatedAt: string): void {
    this.db.prepare('UPDATE PurchaseOrder SET status = ?, receivedAt = ?, updatedAt = ? WHERE id = ?')
      .run('RECEIVED', receivedAt, updatedAt, id);
  }
}

export class SqliteProcessingOrderRepository implements ProcessingOrderRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): { id: string; status: string; deletedAt?: string | null } | null {
    return (this.db.prepare('SELECT id, status, deletedAt FROM ProcessingOrder WHERE id = ? AND deletedAt IS NULL').get(id) as
      | { id: string; status: string; deletedAt?: string | null }
      | undefined) ?? null;
  }

  updateStatus(id: string, status: string, updatedAt: string): void {
    this.db.prepare('UPDATE ProcessingOrder SET status = ?, updatedAt = ? WHERE id = ?').run(status, updatedAt, id);
  }
}

export class SqliteFollowUpRepository implements FollowUpRepository {
  constructor(private readonly db: Database.Database) {}

  reminders(): Array<Record<string, unknown>> {
    const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    return this.db.prepare(
      `SELECT F.id, F.patientId, F.planDate, F.content, F.status,
              P.name AS patientName, P.phone AS patientPhone
       FROM FollowUp F
       LEFT JOIN Patient P ON P.id = F.patientId
       WHERE F.status = 'PENDING' AND F.deletedAt IS NULL AND F.planDate <= ?
       ORDER BY F.planDate ASC
       LIMIT 100`,
    ).all(future) as Array<Record<string, unknown>>;
  }

  insert(record: FollowUpRecord): void {
    this.db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(record.id, record.clinicId ?? null, record.createdAt, record.updatedAt, record.patientId, record.planDate, record.content ?? null, record.status);
  }
}

export class SqliteWechatMessageRepository implements WechatMessageRepository {
  constructor(private readonly db: Database.Database) {}

  markSent(id: string, sentAt: string, updatedAt: string): void {
    this.db.prepare(
      'UPDATE WechatMessage SET status = ?, sentAt = ?, result = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL',
    ).run('SENT', sentAt, 'sent', updatedAt, id);
  }
}

export class SqliteAlertRepository implements AlertRepository {
  constructor(private readonly db: Database.Database) {}

  open(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT * FROM BusinessAlert WHERE status = 'OPEN' ORDER BY createdAt DESC LIMIT 100`,
    ).all() as Array<Record<string, unknown>>;
  }

  setStatus(id: string, status: string, userId: string | null, now: string): void {
    this.db.prepare(
      'UPDATE BusinessAlert SET status = ?, acknowledgedBy = ?, acknowledgedAt = ?, updatedAt = ? WHERE id = ?',
    ).run(status, userId, now, now, id);
  }
}

export class SqlitePatientRiskRepository implements PatientRiskRepository {
  constructor(private readonly db: Database.Database) {}

  treatmentCount(patientId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM Treatment WHERE patientId = ? AND deletedAt IS NULL').get(patientId) as { c: number }).c;
  }

  periodontalCount(patientId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM PeriodontalRecord WHERE patientId = ? AND deletedAt IS NULL').get(patientId) as { c: number }).c;
  }

  insert(input: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT INTO PatientRiskScore (
         id, clinicId, createdAt, updatedAt, deletedAt, patientId,
         cariesScore, periodontalScore, implantScore,
         cariesLevel, periodontalLevel, implantLevel,
         factorSnapshotJson, assessedById
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.patientId,
      input.cariesScore,
      input.periodontalScore,
      input.implantScore,
      input.cariesLevel,
      input.periodontalLevel,
      input.implantLevel,
      input.factorSnapshotJson,
      input.assessedById ?? null,
    );
  }
}

export class SqliteAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly db: Database.Database) {}

  rfm(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT P.id AS patientId, P.name,
              COUNT(C.id) AS frequency,
              COALESCE(SUM(C.paidAmount), 0) AS monetary,
              COALESCE(MAX(C.paidAt), P.createdAt) AS lastPaidAt
       FROM Patient P
       LEFT JOIN Charge C ON C.patientId = P.id AND C.deletedAt IS NULL AND C.paidAt IS NOT NULL
       WHERE P.deletedAt IS NULL
       GROUP BY P.id, P.name
       ORDER BY monetary DESC
       LIMIT 200`,
    ).all() as Array<Record<string, unknown>>;
  }

  churn(): Array<Record<string, unknown>> {
    const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
    return this.db.prepare(
      `SELECT P.id, P.name, P.phone,
              COALESCE(MAX(V.createdAt), '1970-01-01T00:00:00.000Z') AS lastVisitAt
       FROM Patient P
       LEFT JOIN Visit V ON V.patientId = P.id AND V.deletedAt IS NULL
       WHERE P.deletedAt IS NULL
       GROUP BY P.id, P.name, P.phone
       HAVING lastVisitAt < ?
       ORDER BY lastVisitAt ASC
       LIMIT 100`,
    ).all(cutoff) as Array<Record<string, unknown>>;
  }

  doctorAnomalies(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT U.id AS doctorId, U.name AS doctorName,
              COUNT(C.id) AS chargeCount,
              COALESCE(AVG(C.paidAmount), 0) AS avgCharge
       FROM User U
       LEFT JOIN Charge C ON C.doctorId = U.id AND C.deletedAt IS NULL
       WHERE U.role IN ('DOCTOR', 'BOSS')
       GROUP BY U.id, U.name
       HAVING chargeCount > 0
       ORDER BY avgCharge DESC`,
    ).all() as Array<Record<string, unknown>>;
  }
}

export class SqliteHrRepository implements HrRepository {
  constructor(private readonly db: Database.Database) {}

  attendance(workDate?: string): Array<Record<string, unknown>> {
    if (workDate) {
      return this.db.prepare('SELECT * FROM Attendance WHERE workDate = ? ORDER BY checkIn').all(workDate) as Array<Record<string, unknown>>;
    }
    return this.db.prepare('SELECT * FROM Attendance ORDER BY workDate DESC LIMIT 200').all() as Array<Record<string, unknown>>;
  }

  approveLeave(id: string, status: string, reviewerId: string, now: string): void {
    this.db.prepare('UPDATE LeaveRequest SET status = ?, reviewerId = ?, reviewedAt = ?, updatedAt = ? WHERE id = ?')
      .run(status, reviewerId, now, now, id);
  }
}

export class SqliteClinicalWorkflowRepository implements ClinicalWorkflowRepository {
  constructor(private readonly db: Database.Database) {}

  getRow(table: string, id: string): Record<string, unknown> | null {
    return (this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deletedAt IS NULL`).get(id) as Record<string, unknown> | undefined) ?? null;
  }

  updateStatus(table: string, id: string, status: string, now: string, extra: Record<string, unknown> = {}): void {
    const setClause = Object.keys(extra).map((key) => `${key} = ?`).join(', ');
    const params = Object.values(extra).map((value) => value ?? null);
    const sql = `UPDATE ${table} SET status = ?, updatedAt = ?${setClause ? `, ${setClause}` : ''} WHERE id = ?`;
    this.db.prepare(sql).run(status, now, ...params, id);
  }

  createVisit(input: Record<string, unknown>): string {
    this.db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'IN_PROGRESS')`,
    ).run(input.id, input.clinicId ?? null, input.createdAt, input.updatedAt, input.patientId, input.doctorId ?? input.userId, input.createdAt);
    return String(input.id);
  }

  lockMedicalRecord(id: string, locked: boolean, userId: string, now: string): void {
    this.db.prepare(
      'UPDATE MedicalRecord SET isLocked = ?, lockedAt = ?, lockedBy = ?, updatedAt = ? WHERE id = ?',
    ).run(locked ? 1 : 0, locked ? now : null, locked ? userId : null, now, id);
  }
}
