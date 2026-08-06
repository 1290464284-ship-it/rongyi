import type Database from 'better-sqlite3';
import { SystemClock } from '../clock';
import { tenantAnd } from '../tenant';
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
  ProcessingOrderItemRecord,
  ProcessingOrderRecord,
  ProcessingOrderRepository,
  PurchaseOrderItemRecord,
  PurchaseOrderRecord,
  PurchaseOrderRepository,
  WechatMessageRepository,
} from '../../application/ports';

export class SqliteMemberCardRepository implements MemberCardRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: MemberCardRecord): void {
    this.db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.patientId,
      input.cardNo,
      input.balance,
      input.totalRecharge,
      input.totalConsume,
      input.status,
      input.points,
      input.totalPoints,
      input.level,
      input.createdAt,
      input.updatedAt,
    );
  }

  findById(id: string, clinicId?: string | null): MemberCardRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM MemberCard WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as MemberCardRecord | undefined) ?? null;
  }

  findByPatient(patientId: string, clinicId?: string | null): MemberCardRecord | null {
    const params = clinicId ? [patientId, 'ACTIVE', clinicId] : [patientId, 'ACTIVE'];
    return (this.db.prepare(`SELECT * FROM MemberCard WHERE patientId = ? AND status = ? AND deletedAt IS NULL${tenantAnd(clinicId)} LIMIT 1`).get(...params) as MemberCardRecord | undefined) ?? null;
  }

  findByPatientForRefund(patientId: string, clinicId?: string | null): MemberCardRecord | null {
    const params = clinicId ? [patientId, clinicId] : [patientId];
    return (this.db.prepare(`SELECT * FROM MemberCard WHERE patientId = ? AND deletedAt IS NULL${tenantAnd(clinicId)} LIMIT 1`).get(...params) as MemberCardRecord | undefined) ?? null;
  }

  updateBalanceRefund(id: string, balance: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [balance, updatedAt, id, clinicId] : [balance, updatedAt, id];
    this.db.prepare(`UPDATE MemberCard SET balance = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).run(...params);
  }

  updateRecharge(id: string, balance: number, amount: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [balance, amount, updatedAt, id, clinicId] : [balance, amount, updatedAt, id];
    this.db.prepare(`UPDATE MemberCard SET balance = ?, totalRecharge = totalRecharge + ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`)
      .run(...params);
  }

  updateConsume(id: string, balance: number, amount: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [balance, amount, updatedAt, id, clinicId] : [balance, amount, updatedAt, id];
    this.db.prepare(`UPDATE MemberCard SET balance = ?, totalConsume = totalConsume + ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`)
      .run(...params);
  }

  updatePoints(id: string, points: number, totalPoints: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [points, totalPoints, updatedAt, id, clinicId] : [points, totalPoints, updatedAt, id];
    this.db.prepare(`UPDATE MemberCard SET points = ?, totalPoints = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`)
      .run(...params);
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

  findItem(id: string, clinicId?: string | null): InventoryItemRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM InventoryItem WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as InventoryItemRecord | undefined) ?? null;
  }

  updateStock(id: string, stock: number, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [stock, updatedAt, id, clinicId] : [stock, updatedAt, id];
    this.db.prepare(`UPDATE InventoryItem SET stock = ?, updatedAt = ? WHERE id = ?${tenantAnd(clinicId)}`).run(...params);
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

  lowStock(clinicId?: string | null): InventoryItemRecord[] {
    const params = clinicId ? [clinicId] : [];
    return this.db.prepare(
      `SELECT * FROM InventoryItem WHERE deletedAt IS NULL AND stock <= minStock${tenantAnd(clinicId)} ORDER BY stock ASC LIMIT 100`,
    ).all(...params) as InventoryItemRecord[];
  }
}

export class SqliteDebtRepository implements DebtRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): DebtRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM Debt WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as DebtRecord | undefined) ?? null;
  }

  findByCharge(chargeId: string, clinicId?: string | null): DebtRecord | null {
    const params = clinicId ? [chargeId, clinicId] : [chargeId];
    return (this.db.prepare(`SELECT * FROM Debt WHERE chargeId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as DebtRecord | undefined) ?? null;
  }

  updatePaid(id: string, paidAmount: number, status: string, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [paidAmount, status, updatedAt, id, clinicId] : [paidAmount, status, updatedAt, id];
    this.db.prepare(`UPDATE Debt SET paidAmount = ?, status = ?, updatedAt = ? WHERE id = ?${tenantAnd(clinicId)}`)
      .run(...params);
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

  findByRefreshTokenHash(tokenHash: string): AuthUserRecord | null {
    const row = this.db.prepare('SELECT * FROM User WHERE refreshToken = ? AND deletedAt IS NULL').get(tokenHash) as
      | Record<string, unknown>
      | undefined;
    return row ? this.map(row) : null;
  }

  isRefreshTokenUsed(tokenHash: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM UsedRefreshToken WHERE tokenHash = ?').get(tokenHash));
  }

  findUsedRefreshToken(tokenHash: string): { userId: string } | null {
    const row = this.db.prepare('SELECT userId FROM UsedRefreshToken WHERE tokenHash = ?').get(tokenHash) as
      | { userId: string }
      | undefined;
    return row ?? null;
  }

  revokeSessionFamily(userId: string, updatedAt: string): void {
    this.db.prepare(
      `UPDATE User SET refreshToken = NULL, refreshTokenExpiresAt = NULL,
         tokenVersion = tokenVersion + 1, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL`,
    ).run(updatedAt, userId);
  }

  cleanupUsedRefreshTokens(before: string): number {
    return this.db.prepare('DELETE FROM UsedRefreshToken WHERE usedAt < ?').run(before).changes;
  }

  insertUser(input: AuthUserRecord): void {
    this.db.prepare(
      `INSERT INTO User (
         id, clinicId, currentClinicId, username, passwordHash, name, role, phone, active,
         loginAttempts, lockedUntil, tokenVersion, refreshToken, refreshTokenExpiresAt,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL, NULL, ?, ?, NULL)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.currentClinicId ?? input.clinicId ?? null,
      input.username,
      input.passwordHash,
      input.name,
      input.role,
      input.phone ?? null,
      input.active ? 1 : 0,
      input.createdAt,
      input.updatedAt,
    );
  }

  clinicMemberships(userId: string): Array<{ clinicId: string; name: string; role: string }> {
    return this.db.prepare(
      `SELECT UC.clinicId, C.name, UC.role
       FROM UserClinic UC
       LEFT JOIN Clinic C ON C.id = UC.clinicId
       WHERE UC.userId = ? AND UC.deletedAt IS NULL AND C.deletedAt IS NULL
       ORDER BY C.name ASC`,
    ).all(userId) as Array<{ clinicId: string; name: string; role: string }>;
  }

  setCurrentClinic(userId: string, clinicId: string, updatedAt: string): void {
    this.db.prepare('UPDATE User SET currentClinicId = ?, updatedAt = ? WHERE id = ?')
      .run(clinicId, updatedAt, userId);
  }

  addClinicMembership(userId: string, clinicId: string, role: string, createdAt: string, updatedAt: string): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(userId, clinicId, role, createdAt, updatedAt);
  }

  updateUser(
    id: string,
    fields: { name?: string; phone?: string | null; role?: string; active?: boolean },
    updatedAt: string,
    clinicId?: string | null,
  ): number {
    const sets: string[] = ['updatedAt = ?'];
    const params: unknown[] = [updatedAt];
    if (fields.name !== undefined) {
      sets.push('name = ?');
      params.push(fields.name);
    }
    if (fields.phone !== undefined) {
      sets.push('phone = ?');
      params.push(fields.phone);
    }
    if (fields.role !== undefined) {
      sets.push('role = ?');
      params.push(fields.role);
    }
    if (fields.active !== undefined) {
      sets.push('active = ?');
      params.push(fields.active ? 1 : 0);
    }
    params.push(id);
    if (clinicId) params.push(clinicId);
    return this.db.prepare(
      `UPDATE User SET ${sets.join(', ')} WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params).changes;
  }

  resetPassword(id: string, passwordHash: string, updatedAt: string, clinicId?: string | null): number {
    const params = clinicId ? [passwordHash, updatedAt, id, clinicId] : [passwordHash, updatedAt, id];
    return this.db.prepare(
      `UPDATE User SET passwordHash = ?, tokenVersion = tokenVersion + 1, refreshToken = NULL, refreshTokenExpiresAt = NULL, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params).changes;
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

  updateRefreshToken(id: string, tokenHash: string, expiresAt: string, updatedAt: string): void {
    this.db.prepare('UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ?, updatedAt = ? WHERE id = ?')
      .run(tokenHash, expiresAt, updatedAt, id);
  }

  clearRefreshToken(id: string, updatedAt: string): void {
    this.db.prepare('UPDATE User SET refreshToken = NULL, refreshTokenExpiresAt = NULL, updatedAt = ? WHERE id = ?')
      .run(updatedAt, id);
  }

  markRefreshTokenUsed(tokenHash: string, userId: string, usedAt: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO UsedRefreshToken (tokenHash, userId, usedAt) VALUES (?, ?, ?)',
    ).run(tokenHash, userId, usedAt);
  }

  private map(row: Record<string, unknown>): AuthUserRecord {
    return {
      id: String(row.id),
      clinicId: row.clinicId ? String(row.clinicId) : null,
      currentClinicId: row.currentClinicId ? String(row.currentClinicId) : null,
      username: String(row.username),
      passwordHash: String(row.passwordHash),
      name: String(row.name),
      role: String(row.role),
      active: Number(row.active) === 1,
      loginAttempts: Number(row.loginAttempts ?? 0),
      lockedUntil: row.lockedUntil ? String(row.lockedUntil) : null,
      tokenVersion: Number(row.tokenVersion ?? 0),
      refreshToken: row.refreshToken ? String(row.refreshToken) : null,
      refreshTokenExpiresAt: row.refreshTokenExpiresAt ? String(row.refreshTokenExpiresAt) : null,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      deletedAt: row.deletedAt ? String(row.deletedAt) : null,
    };
  }
}

export class SqlitePurchaseOrderRepository implements PurchaseOrderRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): PurchaseOrderRecord | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM PurchaseOrder WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as PurchaseOrderRecord | undefined) ?? null;
  }

  itemsByOrder(orderId: string, clinicId?: string | null): PurchaseOrderItemRecord[] {
    const params = clinicId ? [orderId, clinicId] : [orderId];
    return this.db.prepare(`SELECT * FROM PurchaseOrderItem WHERE orderId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).all(...params) as PurchaseOrderItemRecord[];
  }

  createOrder(input: PurchaseOrderRecord): void {
    this.db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.clinicId ?? null, input.createdAt, input.updatedAt, input.number, input.supplierId ?? null, input.totalAmount, input.status, input.reviewStatus ?? 'PENDING');
  }

  createItem(input: PurchaseOrderItemRecord): void {
    this.db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.clinicId ?? null, input.createdAt, input.updatedAt, input.orderId, input.itemId ?? null, input.name, input.quantity, input.unitPrice, input.subtotal);
  }

  markReceived(id: string, receivedAt: string, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [receivedAt, updatedAt, id, clinicId] : [receivedAt, updatedAt, id];
    this.db.prepare(`UPDATE PurchaseOrder SET status = 'RECEIVED', receivedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`)
      .run(...params);
  }
}

export class SqliteProcessingOrderRepository implements ProcessingOrderRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): { id: string; status: string; deletedAt?: string | null } | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT id, status, deletedAt FROM ProcessingOrder WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as
      | { id: string; status: string; deletedAt?: string | null }
      | undefined) ?? null;
  }

  updateStatus(id: string, status: string, updatedAt: string, clinicId?: string | null): void {
    const params = clinicId ? [status, updatedAt, id, clinicId] : [status, updatedAt, id];
    this.db.prepare(`UPDATE ProcessingOrder SET status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).run(...params);
  }

  createOrder(input: ProcessingOrderRecord): void {
    this.db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, factoryId, doctorId, number, shade,
         teethNumbers, totalFee, status, settleStatus, expectedAt, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.patientId,
      input.visitId ?? null,
      input.factoryId ?? null,
      input.doctorId ?? null,
      input.number,
      input.shade ?? null,
      JSON.stringify(input.teethNumbers),
      input.totalFee,
      input.status,
      input.settleStatus ?? 'UNSETTLED',
      input.expectedAt ?? null,
      input.remark ?? null,
    );
  }

  createItem(input: ProcessingOrderItemRecord): void {
    this.db.prepare(
      `INSERT INTO ProcessingOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, name, spec, quantity, unitPrice, subtotal, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.orderId,
      input.name,
      input.spec ?? null,
      input.quantity,
      input.unitPrice,
      input.subtotal,
      input.status,
    );
  }
}

export class SqliteFollowUpRepository implements FollowUpRepository {
  constructor(private readonly db: Database.Database) {}

  reminders(clinicId?: string | null): Array<Record<string, unknown>> {
    const future = new SystemClock().clinicDate(Date.now() + 14 * 86_400_000);
    const params = clinicId ? [future, clinicId] : [future];
    return this.db.prepare(
      `SELECT F.id, F.patientId, F.planDate, F.content, F.status,
              P.name AS patientName, P.phone AS patientPhone
       FROM FollowUp F
       LEFT JOIN Patient P ON P.id = F.patientId
       WHERE F.status = 'PENDING' AND F.deletedAt IS NULL AND F.planDate <= ?${tenantAnd(clinicId, 'F.clinicId')}
       ORDER BY F.planDate ASC
       LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  insert(record: FollowUpRecord): void {
    this.db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status, assigneeId, templateId
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.clinicId ?? null,
      record.createdAt,
      record.updatedAt,
      record.patientId,
      record.planDate,
      record.content ?? null,
      record.status,
      record.assigneeId ?? null,
      record.templateId ?? null,
    );
  }

  complete(id: string, completedAt: string, updatedAt: string, clinicId?: string | null, result?: string | null): number {
    const params = clinicId
      ? [completedAt, updatedAt, result ?? null, id, clinicId]
      : [completedAt, updatedAt, result ?? null, id];
    return this.db.prepare(
      `UPDATE FollowUp SET status = 'COMPLETED', completedAt = ?, updatedAt = ?, result = ?
       WHERE id = ? AND deletedAt IS NULL AND status IN ('PENDING', 'IN_PROGRESS')${tenantAnd(clinicId)}`,
    ).run(...params).changes;
  }
}

export class SqliteWechatMessageRepository implements WechatMessageRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): {
    id: string;
    status: string;
    clinicId?: string | null;
    patientId?: string | null;
    type?: string | null;
    content?: string | null;
    templateId?: string | null;
  } | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT id, status, clinicId, patientId, type, content, templateId FROM WechatMessage WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as
      | {
          id: string;
          status: string;
          clinicId?: string | null;
          patientId?: string | null;
          type?: string | null;
          content?: string | null;
          templateId?: string | null;
        }
      | undefined) ?? null;
  }

  markSent(id: string, sentAt: string, updatedAt: string, clinicId?: string | null): number {
    return this.db.prepare(
      `UPDATE WechatMessage SET status = ?, sentAt = ?, result = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND status IN ('PENDING', 'DRAFT', 'IN_PROGRESS')${tenantAnd(clinicId)}`,
    ).run('SENT', sentAt, null, updatedAt, id, ...(clinicId ? [clinicId] : [])).changes;
  }
}

export class SqliteAlertRepository implements AlertRepository {
  constructor(private readonly db: Database.Database) {}

  open(clinicId?: string | null): Array<Record<string, unknown>> {
    const params = clinicId ? [clinicId] : [];
    return this.db.prepare(
      `SELECT * FROM BusinessAlert WHERE status = 'OPEN' AND deletedAt IS NULL${tenantAnd(clinicId)} ORDER BY createdAt DESC LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  setStatus(id: string, status: string, userId: string | null, now: string, clinicId?: string | null): number {
    const params = clinicId ? [status, userId, now, now, id, clinicId] : [status, userId, now, now, id];
    return this.db.prepare(
      `UPDATE BusinessAlert SET status = ?, acknowledgedBy = ?, acknowledgedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND status IN ('OPEN', 'ACKNOWLEDGED')${tenantAnd(clinicId)}`,
    ).run(...params).changes;
  }
}

export class SqlitePatientRiskRepository implements PatientRiskRepository {
  constructor(private readonly db: Database.Database) {}

  treatmentCount(patientId: string, clinicId?: string | null): number {
    const params = clinicId ? [patientId, clinicId] : [patientId];
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM Treatment WHERE patientId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as { c: number }).c;
  }

  periodontalCount(patientId: string, clinicId?: string | null): number {
    const params = clinicId ? [patientId, clinicId] : [patientId];
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM PeriodontalRecord WHERE patientId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as { c: number }).c;
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

  rfm(clinicId: string | null): Array<Record<string, unknown>> {
    const patientClause = tenantAnd(clinicId, 'P.clinicId');
    const chargeClause = tenantAnd(clinicId, 'C.clinicId');
    const params: unknown[] = clinicId ? [clinicId, clinicId] : [];
    return this.db.prepare(
      `SELECT P.id AS patientId, P.name,
              COUNT(C.id) AS frequency,
              COALESCE(SUM(C.paidAmount - C.refundedAmount), 0) AS monetary,
              COALESCE(MAX(C.paidAt), P.createdAt) AS lastPaidAt
       FROM Patient P
       LEFT JOIN Charge C ON C.patientId = P.id AND C.deletedAt IS NULL AND C.paidAt IS NOT NULL${chargeClause}
       WHERE P.deletedAt IS NULL${patientClause}
       GROUP BY P.id, P.name
       ORDER BY monetary DESC
       LIMIT 200`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  churn(clinicId: string | null): Array<Record<string, unknown>> {
    const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const patientClause = tenantAnd(clinicId, 'P.clinicId');
    const visitClause = tenantAnd(clinicId, 'V.clinicId');
    const params: unknown[] = clinicId ? [clinicId, clinicId, cutoff] : [cutoff];
    return this.db.prepare(
      `SELECT P.id, P.name, P.phone,
              COALESCE(MAX(V.createdAt), '1970-01-01T00:00:00.000Z') AS lastVisitAt
       FROM Patient P
       LEFT JOIN Visit V ON V.patientId = P.id AND V.deletedAt IS NULL${visitClause}
       WHERE P.deletedAt IS NULL${patientClause}
       GROUP BY P.id, P.name, P.phone
       HAVING lastVisitAt < ?
       ORDER BY lastVisitAt ASC
       LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  doctorAnomalies(clinicId: string | null): Array<Record<string, unknown>> {
    const userClause = tenantAnd(clinicId, 'U.clinicId');
    const chargeClause = tenantAnd(clinicId, 'C.clinicId');
    const params: unknown[] = clinicId ? [clinicId, clinicId] : [];
    return this.db.prepare(
      `SELECT U.id AS doctorId, U.name AS doctorName,
              COUNT(C.id) AS chargeCount,
              COALESCE(AVG(C.paidAmount - C.refundedAmount), 0) AS avgCharge
       FROM User U
       LEFT JOIN Charge C ON C.doctorId = U.id AND C.deletedAt IS NULL${chargeClause}
       WHERE U.role IN ('DOCTOR', 'BOSS')${userClause}
       GROUP BY U.id, U.name
       HAVING chargeCount > 0
       ORDER BY avgCharge DESC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }
}

export class SqliteHrRepository implements HrRepository {
  constructor(private readonly db: Database.Database) {}

  attendance(workDate?: string, clinicId?: string | null): Array<Record<string, unknown>> {
    if (workDate) {
      const params = clinicId ? [workDate, clinicId] : [workDate];
      return this.db.prepare(`SELECT * FROM Attendance WHERE workDate = ? AND deletedAt IS NULL${tenantAnd(clinicId)} ORDER BY checkIn`).all(...params) as Array<Record<string, unknown>>;
    }
    const params = clinicId ? [clinicId] : [];
    return this.db.prepare(`SELECT * FROM Attendance WHERE deletedAt IS NULL${tenantAnd(clinicId)} ORDER BY workDate DESC LIMIT 200`).all(...params) as Array<Record<string, unknown>>;
  }

  approveLeave(id: string, status: string, reviewerId: string, now: string, clinicId?: string | null): number {
    const params = clinicId ? [status, reviewerId, now, now, id, clinicId] : [status, reviewerId, now, now, id];
    return this.db.prepare(
      `UPDATE LeaveRequest SET status = ?, reviewerId = ?, reviewedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND status = 'PENDING'${tenantAnd(clinicId)}`,
    )
      .run(...params).changes;
  }
}

export class SqliteClinicalWorkflowRepository implements ClinicalWorkflowRepository {
  constructor(private readonly db: Database.Database) {}

  getRow(table: string, id: string, clinicId?: string | null): Record<string, unknown> | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as Record<string, unknown> | undefined) ?? null;
  }

  updateStatus(table: string, id: string, status: string, now: string, extra: Record<string, unknown> = {}, clinicId?: string | null): void {
    const setClause = Object.keys(extra).map((key) => `${key} = ?`).join(', ');
    const params = Object.values(extra).map((value) => value ?? null);
    const sql = `UPDATE ${table} SET status = ?, updatedAt = ?${setClause ? `, ${setClause}` : ''} WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`;
    this.db.prepare(sql).run(status, now, ...params, id, ...(clinicId ? [clinicId] : []));
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

  lockMedicalRecord(id: string, locked: boolean, userId: string, now: string, clinicId?: string | null): void {
    /* v8 ignore start -- V8 does not report the false ternary branches inside this params literal despite direct coverage. */
    const params = clinicId ? [locked ? 1 : 0, locked ? now : null, locked ? userId : null, now, id, clinicId] : [locked ? 1 : 0, locked ? now : null, locked ? userId : null, now, id];
    /* v8 ignore stop */
    this.db.prepare(
      `UPDATE MedicalRecord SET isLocked = ?, lockedAt = ?, lockedBy = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params);
  }
}
