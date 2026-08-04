import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../infrastructure/errors';
import { SqliteRepository } from '../infrastructure/repository';
import { stripProtectedWriteFields } from '../infrastructure/security';
import { validatePayload } from '../http/validation';
import { SqliteChargeRepository } from '../infrastructure/repositories/charge.repository';
import { SqliteUnitOfWork } from '../infrastructure/unit-of-work';
import {
  SqliteAuthRepository,
  SqliteAlertRepository,
  SqliteAnalyticsRepository,
  SqliteDebtRepository,
  SqliteFollowUpRepository,
  SqliteHrRepository,
  SqliteInventoryRepository,
  SqliteMemberCardRepository,
  SqlitePatientRiskRepository,
  SqliteProcessingOrderRepository,
  SqlitePurchaseOrderRepository,
} from '../infrastructure/repositories/core.repositories';
import { resourceRegistry } from '../../domain/resources';
import { withIdempotency } from '../infrastructure/idempotency';
import { SystemClock } from '../infrastructure/clock';
import type { AppContext, IUnitOfWork, Page, User } from '../../domain/contracts';
import type {
  AuthRepository,
  AuthUserRecord,
  AlertRepository,
  AnalyticsRepository,
  ChargeItemRecord,
  ChargeRepository,
  DebtRepository,
  FollowUpRepository,
  HrRepository,
  InventoryRepository,
  MemberCardRecord,
  MemberCardRepository,
  PatientRiskRepository,
  ProcessingOrderRepository,
  PurchaseOrderRepository,
} from './ports';

const JWT_SECRET = process.env.V2_JWT_SECRET ?? 'v2-local-secret-change-me';
const TOKEN_TTL = '8h';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BACKUP_MAGIC = Buffer.from('DENTALV2ENC1');
const FORBIDDEN_BULK_IMPORT_RESOURCES = new Set([
  'users',
  'charges',
  'chargeItems',
  'refunds',
  'memberCards',
  'memberCardLogs',
  'memberPointLogs',
  'inventoryItems',
  'inventoryTransactions',
  'debtRecords',
  'purchaseOrders',
  'processingOrders',
]);

interface TokenPayload {
  sub: string;
  clinicId: string | null;
  role: string;
  tokenVersion: number;
}

interface AuthSession {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: Omit<User, 'passwordHash'>;
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

function backupEncryptionKey(): Buffer {
  const key = process.env.V2_BACKUP_KEY;
  if (!key) {
    throw new Error('V2_BACKUP_KEY is required for encrypted backups');
  }
  return createHash('sha256').update(key).digest();
}

function rowToUser(row: AuthUserRecord | Record<string, unknown>): User {
  return {
    id: String(row.id),
    clinicId: row.clinicId ? String(row.clinicId) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    username: String(row.username),
    passwordHash: String(row.passwordHash),
    name: String(row.name),
    role: String(row.role) as User['role'],
    active: Number(row.active) === 1,
    loginAttempts: Number(row.loginAttempts ?? 0),
    lockedUntil: row.lockedUntil ? String(row.lockedUntil) : null,
    tokenVersion: Number(row.tokenVersion ?? 0),
  };
}

export class AuthService {
  private readonly db: Database.Database;
  private readonly authRepository: AuthRepository;

  constructor(db: Database.Database, authRepository?: AuthRepository) {
    this.db = db;
    this.authRepository = authRepository ?? new SqliteAuthRepository(db);
  }

  async login(username: string, password: string): Promise<AuthSession> {
    const row = this.authRepository.findByUsername(username);
    if (!row) throw new UnauthorizedError('Invalid username or password');
    const user = rowToUser(row);
    if (!user.active) throw new UnauthorizedError('User is disabled');
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      throw new UnauthorizedError('Account is temporarily locked');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const attempts = user.loginAttempts + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      this.authRepository.updateLoginAttempts(user.id, attempts, lockedUntil, new Date().toISOString());
      throw new UnauthorizedError('Invalid username or password');
    }
    this.authRepository.resetLoginAttempts(user.id, new Date().toISOString());
    const token = this.sign({ sub: user.id, clinicId: user.clinicId ?? null, role: user.role, tokenVersion: user.tokenVersion });
    const refreshToken = newRefreshToken();
    const now = new Date().toISOString();
    this.authRepository.updateRefreshToken(
      user.id,
      hashRefreshToken(refreshToken),
      new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
      now,
    );
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return { token, refreshToken, expiresIn: 8 * 60 * 60, user: safeUser };
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    if (!refreshToken) throw new UnauthorizedError('Refresh token is required');
    const tokenHash = hashRefreshToken(refreshToken);
    const row = this.authRepository.findByRefreshTokenHash(tokenHash);
    if (!row) throw new UnauthorizedError('Invalid refresh token');
    const user = rowToUser(row);
    if (!user.active) throw new UnauthorizedError('User is disabled');
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      throw new UnauthorizedError('Account is temporarily locked');
    }
    const expiresAt = row.refreshTokenExpiresAt ? new Date(row.refreshTokenExpiresAt).getTime() : 0;
    if (!expiresAt || expiresAt <= Date.now()) {
      this.authRepository.clearRefreshToken(user.id, new Date().toISOString());
      throw new UnauthorizedError('Refresh token has expired');
    }
    const now = new Date().toISOString();
    this.authRepository.markRefreshTokenUsed(tokenHash, user.id, now);
    const nextRefreshToken = newRefreshToken();
    this.authRepository.updateRefreshToken(
      user.id,
      hashRefreshToken(nextRefreshToken),
      new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
      now,
    );
    const token = this.sign({ sub: user.id, clinicId: user.clinicId ?? null, role: user.role, tokenVersion: user.tokenVersion });
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return { token, refreshToken: nextRefreshToken, expiresIn: 8 * 60 * 60, user: safeUser };
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = hashRefreshToken(refreshToken);
    const row = this.authRepository.findByRefreshTokenHash(tokenHash);
    if (!row) return;
    const now = new Date().toISOString();
    this.authRepository.markRefreshTokenUsed(tokenHash, row.id, now);
    this.authRepository.clearRefreshToken(row.id, now);
  }

  verifyToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as TokenPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  async me(payload: TokenPayload): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.getUserById(payload.sub);
    if (user.tokenVersion !== payload.tokenVersion) throw new UnauthorizedError('Token is no longer valid');
    return user;
  }

  async getUserById(userId: string): Promise<Omit<User, 'passwordHash'>> {
    const row = this.authRepository.findById(userId);
    if (!row) throw new UnauthorizedError('User not found');
    const user = rowToUser(row);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const row = this.authRepository.findById(userId);
    if (!row) throw new NotFoundError('User not found');
    const user = rowToUser(row);
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new UnauthorizedError('Old password is incorrect');
    }
    if (newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters');
    const hash = await bcrypt.hash(newPassword, 10);
    this.authRepository.updatePassword(userId, hash, new Date().toISOString());
    this.authRepository.clearRefreshToken(userId, new Date().toISOString());
  }

  private sign(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
  }
}

export interface AuditLogInput {
  userId?: string | null;
  userName?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
  traceId?: string | null;
  clinicId?: string | null;
}

export class AuditService {
  constructor(private readonly db: Database.Database) {}

  log(input: AuditLogInput): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO OperationLog (
         id, userId, userName, action, target, detail, ip, traceId,
         clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      randomUUID(),
      input.userId ?? null,
      input.userName ?? null,
      input.action,
      input.target ?? null,
      input.detail ?? null,
      input.ip ?? null,
      input.traceId ?? null,
      input.clinicId ?? null,
      now,
      now,
    );
  }
}

const APPOINTMENT_TRANSITIONS: Record<string, readonly string[]> = {
  BOOKED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_CHAIR', 'CANCELLED'],
  IN_CHAIR: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export class AppointmentService {
  constructor(private readonly db: Database.Database) {}

  async create(input: {
    patientId: string;
    doctorId: string;
    chairId?: string;
    startTime: string;
    endTime: string;
    type: string;
    remark?: string;
  }, context: AppContext): Promise<Record<string, unknown>> {
    this.assertTimeRange(input.startTime, input.endTime);
    this.assertNoConflict(input.doctorId, input.chairId, input.startTime, input.endTime);
    const now = context.now().toISOString();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, chairId, startTime, endTime, status, type, remark
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'BOOKED', ?, ?)`,
    ).run(
      id,
      context.clinicId ?? null,
      now,
      now,
      input.patientId,
      input.doctorId,
      input.chairId ?? null,
      input.startTime,
      input.endTime,
      input.type,
      input.remark ?? null,
    );
    return { id, status: 'BOOKED' };
  }

  async transition(id: string, nextStatus: string, context: AppContext): Promise<Record<string, unknown>> {
    const row = this.db.prepare('SELECT * FROM Appointment WHERE id = ? AND deletedAt IS NULL').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new NotFoundError('Appointment not found');
    if (row.clinicId && context.clinicId && String(row.clinicId) !== context.clinicId) {
      throw new NotFoundError('Appointment not found');
    }
    const current = String(row.status);
    if (!APPOINTMENT_TRANSITIONS[current]?.includes(nextStatus)) {
      throw new ConflictError(`Cannot transition appointment from ${current} to ${nextStatus}`);
    }
    this.db.prepare('UPDATE Appointment SET status = ?, updatedAt = ? WHERE id = ?')
      .run(nextStatus, context.now().toISOString(), id);
    return { id, status: nextStatus };
  }

  private assertTimeRange(startTime: string, endTime: string): void {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new ValidationError('endTime must be later than startTime');
    }
  }

  private assertNoConflict(doctorId: string, chairId: string | undefined, startTime: string, endTime: string): void {
    const rows = this.db.prepare(
      `SELECT id FROM Appointment
       WHERE deletedAt IS NULL
         AND status NOT IN ('CANCELLED', 'NO_SHOW')
         AND ((doctorId = ?) OR (chairId IS NOT NULL AND chairId = ?))
         AND startTime < ? AND endTime > ?`,
    ).all(doctorId, chairId ?? null, endTime, startTime) as Array<{ id: string }>;
    if (rows.length > 0) throw new ConflictError('Doctor or chair is already booked in this time range');
  }
}

export class ChargeService {
  private readonly db: Database.Database;
  private readonly chargeRepository: ChargeRepository;
  private readonly memberCardRepository: MemberCardRepository;
  private readonly debtRepository: DebtRepository;

  constructor(
    db: Database.Database,
    chargeRepository?: ChargeRepository,
    memberCardRepository?: MemberCardRepository,
    debtRepository?: DebtRepository,
  ) {
    this.db = db;
    this.chargeRepository = chargeRepository ?? new SqliteChargeRepository(db);
    this.memberCardRepository = memberCardRepository ?? new SqliteMemberCardRepository(db);
    this.debtRepository = debtRepository ?? new SqliteDebtRepository(db);
  }

  async create(input: {
    patientId: string;
    visitId?: string;
    doctorId?: string;
    items: Array<{ name: string; category: string; price: number; quantity: number; teethNumbers?: string[] }>;
    discount?: number;
    remark?: string;
  }, context: AppContext): Promise<Record<string, unknown>> {
    if (!input.items?.length) throw new ValidationError('At least one charge item is required');
    if (!input.patientId || typeof input.patientId !== 'string') {
      throw new ValidationError('patientId is required');
    }
    for (const item of input.items) {
      if (typeof item.name !== 'string' || !item.name.trim() || typeof item.category !== 'string' || !item.category.trim()) {
        throw new ValidationError('Charge item name and category are required');
      }
      if (!Number.isSafeInteger(item.price) || item.price <= 0) {
        throw new ValidationError('Charge item price must be a positive integer in cents');
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new ValidationError('Charge item quantity must be positive');
      }
    }
    const now = context.now().toISOString();
    const id = randomUUID();
    const number = `CHG-${Date.now().toString(36).toUpperCase()}`;
    const baseTotal = input.items.reduce((sum, item) => sum + Math.round(item.price * item.quantity), 0);
    const discount = Math.round(input.discount ?? 0);
    if (!Number.isInteger(input.discount ?? 0) || discount < 0 || discount > baseTotal) {
      throw new ValidationError('Discount must be a non-negative integer cents value not exceeding the charge total');
    }
    const totalAmount = baseTotal - discount;

    const chargeRun = this.db.transaction(() => {
      this.chargeRepository.create({
        id,
        clinicId: context.clinicId ?? null,
        createdAt: now,
        updatedAt: now,
        patientId: input.patientId,
        visitId: input.visitId ?? null,
        doctorId: input.doctorId ?? null,
        number,
        totalAmount,
        discount,
        status: 'UNPAID',
        remark: input.remark ?? null,
      });
      for (const item of input.items) {
        const subtotal = Math.round(item.price * item.quantity);
        const record: ChargeItemRecord = {
          id: randomUUID(),
          chargeId: id,
          name: item.name,
          category: item.category,
          price: item.price,
          quantity: item.quantity,
          teethNumbers: item.teethNumbers ?? [],
          subtotal,
          clinicId: context.clinicId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        this.chargeRepository.createItem(record);
      }
    });
    chargeRun();
    return { id, number, totalAmount, status: 'UNPAID' };
  }

  async pay(id: string, amount: number, method: string, requestId?: string, context?: AppContext): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, requestId, () => {
      const row = this.chargeRepository.findById(id);
      if (!row) throw new NotFoundError('Charge not found');
      if (row.clinicId && context?.clinicId && row.clinicId !== context.clinicId) {
        throw new NotFoundError('Charge not found');
      }
      const total = Number(row.totalAmount);
      const paid = Number(row.paidAmount);
      const refunded = Number(row.refundedAmount);
      const status = String(row.status);
      if (status === 'CANCELLED' || status === 'REFUNDED') throw new ConflictError('Charge cannot be paid');
      const remaining = total - paid;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
        throw new ValidationError('Payment amount must be a positive integer and not exceed the remaining balance');
      }
      const newPaid = paid + amount;
      const newStatus = newPaid >= total ? 'PAID' : 'PARTIAL';
      const now = context?.now().toISOString() ?? new Date().toISOString();
      const payRun = this.db.transaction(() => {
        this.chargeRepository.updatePayment(id, newPaid, newStatus, now, method);
        if (method === 'MEMBER_CARD') {
          const memberCard = this.memberCardRepository.findByPatient(String(row.patientId));
          if (!memberCard) throw new ConflictError('No active member card for patient');
          const balance = Number(memberCard.balance) - amount;
          if (balance < 0) throw new ConflictError('Insufficient member card balance');
          this.memberCardRepository.updateConsume(memberCard.id, balance, amount, now);
          this.memberCardRepository.insertLog({
            id: randomUUID(),
            clinicId: row.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            cardId: memberCard.id,
            type: 'CONSUME',
            amount: -amount,
            balanceAfter: balance,
            remark: `Charge ${id}`,
          });
        }
      });
      payRun();
      return { id, paidAmount: newPaid, status: newStatus };
    });
  }

  async refund(
    id: string,
    amount: number,
    reason: string,
    context: AppContext,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, requestId, () => {
      const row = this.chargeRepository.findById(id);
      if (!row) throw new NotFoundError('Charge not found');
      if (row.clinicId && context.clinicId && row.clinicId !== context.clinicId) {
        throw new NotFoundError('Charge not found');
      }
      const paid = Number(row.paidAmount);
      const refunded = Number(row.refundedAmount);
      const available = paid - refunded;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > available) {
        throw new ValidationError('Refund amount must be a positive integer and not exceed the refundable amount');
      }
      const newRefunded = refunded + amount;
      const newStatus = newRefunded >= paid ? 'REFUNDED' : String(row.status);
      const now = context.now().toISOString();
      const refundId = randomUUID();
      const run = this.db.transaction(() => {
        this.chargeRepository.updateRefund(id, newRefunded, newStatus, now);
        if (row.payMethod === 'MEMBER_CARD') {
          const memberCard = this.memberCardRepository.findByPatient(String(row.patientId));
          if (memberCard) {
            const balance = Number(memberCard.balance) + amount;
            this.memberCardRepository.updateBalanceRefund(memberCard.id, balance, now);
            this.memberCardRepository.insertLog({
              id: randomUUID(),
              clinicId: row.clinicId ?? null,
              createdAt: now,
              updatedAt: now,
              cardId: memberCard.id,
              type: 'REFUND',
              amount,
              balanceAfter: balance,
              remark: reason,
            });
          }
        }
        const debt = this.debtRepository.findByCharge(id);
        if (debt && Number(debt.paidAmount) > 0) {
          const newDebtPaid = Math.max(0, Number(debt.paidAmount) - amount);
          const debtStatus = newDebtPaid >= Number(debt.totalAmount)
            ? 'PAID'
            : newDebtPaid > 0 ? 'PARTIAL' : 'UNPAID';
          this.debtRepository.updatePaid(debt.id, newDebtPaid, debtStatus, now);
        }
        this.db.prepare(
          `INSERT INTO Refund (
             id, clinicId, createdAt, updatedAt, deletedAt,
             chargeId, patientId, amount, reason, operatorId
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        ).run(refundId, row.clinicId ?? null, now, now, id, String(row.patientId), amount, reason, context.userId);
      });
      run();
      return { id: refundId, chargeId: id, amount, status: newStatus };
    });
  }
}

export class InventoryService {
  private readonly db: Database.Database;
  private readonly inventoryRepository: InventoryRepository;
  private readonly unitOfWork: IUnitOfWork;

  constructor(db: Database.Database, inventoryRepository?: InventoryRepository, unitOfWork?: IUnitOfWork) {
    this.db = db;
    this.inventoryRepository = inventoryRepository ?? new SqliteInventoryRepository(db);
    this.unitOfWork = unitOfWork ?? new SqliteUnitOfWork(db);
  }

  async createTransaction(
    input: { itemId: string; type: 'IN' | 'OUT' | 'ADJUST'; quantity: number; remark?: string },
    context: AppContext,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, requestId, () => {
      if (!['IN', 'OUT', 'ADJUST'].includes(input.type)) {
        throw new ValidationError('Inventory transaction type must be IN, OUT, or ADJUST');
      }
      if (!Number.isFinite(input.quantity) || input.quantity === 0) {
        throw new ValidationError('Inventory transaction quantity must be a non-zero number');
      }
      if (input.type !== 'ADJUST' && input.quantity < 0) {
        throw new ValidationError('Inventory transaction quantity must be positive');
      }
      const item = this.inventoryRepository.findItem(input.itemId);
      if (!item) throw new NotFoundError('Inventory item not found');
      if (item.clinicId && context.clinicId && item.clinicId !== context.clinicId) {
        throw new NotFoundError('Inventory item not found');
      }
      const before = Number(item.stock);
      const delta = input.type === 'IN' ? input.quantity : input.type === 'OUT' ? -input.quantity : input.quantity;
      const after = before + delta;
      if (after < 0) throw new ConflictError('Insufficient stock');
      const now = context.now().toISOString();
      const id = randomUUID();
      this.unitOfWork.run(() => {
        this.inventoryRepository.updateStock(input.itemId, after, now);
        this.inventoryRepository.createTransaction({
          id,
          clinicId: context.clinicId ?? null,
          itemId: input.itemId,
          type: input.type,
          quantity: input.quantity,
          beforeStock: before,
          afterStock: after,
          operatorId: context.userId,
          remark: input.remark ?? null,
          createdAt: now,
          updatedAt: now,
        });
      });
      return { id, beforeStock: before, afterStock: after };
    });
  }

  lowStock(): Array<Record<string, unknown>> {
    return this.inventoryRepository.lowStock().map((row) => ({ ...row }));
  }

  expiringSoon(days = 30): Array<Record<string, unknown>> {
    const clock = new SystemClock();
    const today = clock.clinicDate();
    const cutoff = clock.clinicDate(Date.now() + Math.max(1, days) * 86_400_000);
    return this.db.prepare(
      `SELECT * FROM InventoryItem
       WHERE deletedAt IS NULL
         AND expireDate IS NOT NULL
         AND expireDate >= ?
         AND expireDate <= ?
       ORDER BY expireDate ASC
       LIMIT 100`,
    ).all(today, cutoff) as Array<Record<string, unknown>>;
  }
}

export class FollowUpService {
  private readonly db: Database.Database;
  private readonly followUpRepository: FollowUpRepository;

  constructor(db: Database.Database, followUpRepository?: FollowUpRepository) {
    this.db = db;
    this.followUpRepository = followUpRepository ?? new SqliteFollowUpRepository(db);
  }

  reminders(): Array<Record<string, unknown>> {
    return this.followUpRepository.reminders();
  }

  async batchGenerate(limit = 50, context: AppContext): Promise<{ processed: number; generated: number }> {
    const rows = this.db.prepare(
      `SELECT DISTINCT V.patientId,
              COALESCE(T.completedDate, V.createdAt) AS completedAt
       FROM Visit V
       INNER JOIN Treatment T ON T.visitId = V.id
       WHERE V.status = 'COMPLETED'
         AND T.status = 'COMPLETED'
         AND V.deletedAt IS NULL
         AND T.deletedAt IS NULL
       LIMIT ?`,
    ).all(limit) as Array<{ patientId: string; completedAt: string }>;
    const templates = this.db.prepare(
      `SELECT id, name, daysAfter, content, assigneeId
       FROM FollowUpTemplate
       WHERE isEnabled = 1 AND deletedAt IS NULL
       ORDER BY daysAfter ASC
       LIMIT 20`,
    ).all() as Array<{ id: string; name: string; daysAfter: number; content: string | null; assigneeId: string | null }>;
    let generated = 0;
    const now = context.now().toISOString();
    for (const row of rows) {
      if (templates.length === 0) {
        this.followUpRepository.insert({
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          createdAt: now,
          updatedAt: now,
          patientId: row.patientId,
          planDate: new SystemClock().clinicDate(Date.now() + 14 * 86_400_000),
          content: 'Scheduled follow-up',
          status: 'PENDING',
        });
        generated += 1;
        continue;
      }
      /* v8 ignore start -- the query returns a non-null COALESCE value. */
      const completedAt = new Date(String(row.completedAt ?? Date.now())).getTime();
      /* v8 ignore stop */
      for (const template of templates) {
        this.followUpRepository.insert({
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          createdAt: now,
          updatedAt: now,
          patientId: row.patientId,
          planDate: new SystemClock().clinicDate(completedAt + Number(template.daysAfter ?? 1) * 86_400_000),
          content: template.content ?? template.name,
          status: 'PENDING',
          assigneeId: template.assigneeId ?? null,
          templateId: template.id,
        });
        generated += 1;
      }
    }
    return { processed: rows.length, generated };
  }

  adherence(): { total: number; onTime: number; rate: number } {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN substr(completedAt, 1, 10) <= planDate THEN 1 ELSE 0 END), 0) AS onTime
       FROM FollowUp
       WHERE status = 'COMPLETED' AND planDate IS NOT NULL AND deletedAt IS NULL`,
    ).get() as { total: number; onTime: number };
    /* v8 ignore start -- the aggregate query always returns numeric columns. */
    const total = Number(row.total ?? 0);
    const onTime = Number(row.onTime ?? 0);
    /* v8 ignore stop */
    return { total, onTime, rate: total === 0 ? 0 : Math.round((onTime / total) * 100) };
  }
}

export interface BackupCreateOptions {
  type?: 'MANUAL' | 'AUTO' | 'RESTORE';
  operatorId?: string | null;
  operatorName?: string | null;
  encrypted?: boolean;
}

export class BackupService {
  constructor(
    private readonly db: Database.Database,
    private readonly dbPath: string,
    private readonly backupDir: string,
  ) {}

  list(): Array<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    return fs.readdirSync(this.backupDir)
      .filter((name) => name.endsWith('.sqlite') || name.endsWith('.enc'))
      .filter((name) => !name.startsWith('.staged-'))
      .map((name) => {
        const stat = fs.statSync(path.join(this.backupDir, name));
        return {
          filename: name,
          fileSize: stat.size,
          createdAt: stat.mtime.toISOString(),
          encrypted: name.endsWith('.enc'),
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async create(options: BackupCreateOptions = {}): Promise<Record<string, unknown>> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const encrypted = options.encrypted ?? Boolean(process.env.V2_BACKUP_KEY);
    const base = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const filename = encrypted ? `${base}.enc` : `${base}.sqlite`;
    const tempPath = path.join(this.backupDir, `${base}.tmp`);
    const finalPath = path.join(this.backupDir, filename);
    await this.db.backup(tempPath);
    if (encrypted) {
      this.encryptFile(tempPath, finalPath);
      fs.unlinkSync(tempPath);
    } else {
      fs.renameSync(tempPath, finalPath);
    }
    const fileSize = fs.statSync(finalPath).size;
    this.db.prepare(
      `INSERT INTO BackupRecord (
         id, clinicId, createdAt, updatedAt, deletedAt,
         filename, fileSize, type, operatorId, operatorName
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      null,
      new Date().toISOString(),
      new Date().toISOString(),
      filename,
      fileSize,
      options.type ?? 'MANUAL',
      options.operatorId ?? null,
      options.operatorName ?? null,
    );
    return { filename, fileSize, encrypted, type: options.type ?? 'MANUAL', message: 'Backup created' };
  }

  async verify(filename: string): Promise<Record<string, unknown>> {
    const file = this.safePath(filename);
    if (!fs.existsSync(file)) throw new NotFoundError('Backup file not found');
    const encrypted = file.endsWith('.enc');
    let sqlitePath = file;
    let tempPath: string | undefined;
    if (encrypted) {
      tempPath = path.join(this.backupDir, `.verify-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`);
      this.decryptFile(file, tempPath);
      sqlitePath = tempPath;
    }
    try {
      const backupDb = new Database(sqlitePath, { readonly: true });
      try {
        const integrity = backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
        return { filename, integrity: ok ? 'ok' : 'corrupt', encrypted };
      } finally {
        backupDb.close();
      }
    } finally {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  async stageRestore(filename: string): Promise<Record<string, unknown>> {
    const verified = await this.verify(filename);
    if (verified.integrity !== 'ok') throw new Error('Backup integrity check failed before restore');
    const source = this.safePath(filename);
    const stagedPath = path.join(
      this.backupDir,
      `.staged-${path.basename(filename).replace(/\.[^.]+$/, '')}-${Date.now()}.sqlite`,
    );
    if (source.endsWith('.enc')) {
      this.decryptFile(source, stagedPath);
    } else {
      fs.copyFileSync(source, stagedPath);
    }
    const staged = new Database(stagedPath, { readonly: true });
    try {
      const integrity = staged.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
        throw new Error('staged restore integrity check failed');
      }
    } finally {
      staged.close();
    }
    const markerPath = path.join(path.dirname(this.dbPath), '.restore-pending.json');
    fs.writeFileSync(markerPath, JSON.stringify({ stagedPath }), 'utf8');
    return {
      filename,
      stagedPath,
      message: 'Backup verified and staged. Restart the application to activate this restore.',
    };
  }

  cleanup(maxKeep = 30): { kept: number; deleted: Array<{ filename: string; fileSize: number }> } {
    const files = this.list() as Array<{ filename: string; fileSize: number }>;
    const deleteFiles = files.slice(maxKeep);
    for (const file of deleteFiles) {
      fs.unlinkSync(path.join(this.backupDir, file.filename));
    }
    return {
      kept: Math.min(files.length, maxKeep),
      deleted: deleteFiles.map((file) => ({ filename: file.filename, fileSize: file.fileSize })),
    };
  }

  private safePath(filename: string): string {
    const resolvedDir = path.resolve(this.backupDir);
    const safeName = path.basename(filename);
    const full = path.join(resolvedDir, safeName);
    /* v8 ignore start */
    if (!full.startsWith(resolvedDir)) throw new NotFoundError('Backup path is invalid');
    /* v8 ignore stop */
    return full;
  }

  private encryptFile(sourcePath: string, targetPath: string): void {
    const data = fs.readFileSync(sourcePath);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', backupEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    fs.writeFileSync(targetPath, Buffer.concat([BACKUP_MAGIC, iv, cipher.getAuthTag(), encrypted]));
  }

  private decryptFile(sourcePath: string, targetPath: string): void {
    const data = fs.readFileSync(sourcePath);
    if (data.length < BACKUP_MAGIC.length + 12 + 16) throw new Error('Encrypted backup file is too short');
    const magic = data.subarray(0, BACKUP_MAGIC.length);
    if (!magic.equals(BACKUP_MAGIC)) throw new Error('Encrypted backup header is invalid');
    const iv = data.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 12);
    const authTag = data.subarray(BACKUP_MAGIC.length + 12, BACKUP_MAGIC.length + 28);
    const encrypted = data.subarray(BACKUP_MAGIC.length + 28);
    const decipher = createDecipheriv('aes-256-gcm', backupEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    fs.writeFileSync(targetPath, decrypted);
  }
}

export class StatsService {
  constructor(private readonly db: Database.Database) {}

  dashboard(context: AppContext): Record<string, unknown> {
    const clinic = context.clinicId;
    const withClinic = (sql: string): string => clinic ? sql.replace('{clinic}', 'clinicId = ? AND ') : sql.replace('{clinic}', '');
    const param = clinic ? [clinic] : [];
    const patientCount = (this.db.prepare(withClinic('SELECT COUNT(*) AS c FROM Patient WHERE {clinic}deletedAt IS NULL')).get(...param) as { c: number }).c;
    const appointmentCount = (this.db.prepare(withClinic('SELECT COUNT(*) AS c FROM Appointment WHERE {clinic}deletedAt IS NULL')).get(...param) as { c: number }).c;
    const chargeRow = this.db.prepare(withClinic('SELECT COALESCE(SUM(paidAmount), 0) AS paid, COALESCE(SUM(totalAmount - paidAmount), 0) AS unpaid FROM Charge WHERE {clinic}deletedAt IS NULL')).get(...param) as { paid: number; unpaid: number };
    const inventoryCount = (this.db.prepare(withClinic('SELECT COUNT(*) AS c FROM InventoryItem WHERE {clinic}deletedAt IS NULL')).get(...param) as { c: number }).c;
    const followUpCount = (this.db.prepare(withClinic("SELECT COUNT(*) AS c FROM FollowUp WHERE {clinic}deletedAt IS NULL AND status = 'PENDING'")).get(...param) as { c: number }).c;
    return {
      patients: patientCount,
      appointments: appointmentCount,
      paidAmount: chargeRow.paid,
      unpaidAmount: chargeRow.unpaid,
      inventoryItems: inventoryCount,
      pendingFollowUps: followUpCount,
    };
  }

  revenue(startDate?: string, endDate?: string, groupBy: 'day' | 'month' = 'day'): Array<Record<string, unknown>> {
    const groupExpr = groupBy === 'month'
      ? "substr(paidAt, 1, 7)"
      : "substr(paidAt, 1, 10)";
    const where: string[] = ['deletedAt IS NULL', 'paidAt IS NOT NULL'];
    const params: unknown[] = [];
    if (startDate) {
      where.push('paidAt >= ?');
      params.push(startDate);
    }
    if (endDate) {
      where.push('paidAt <= ?');
      params.push(endDate);
    }
    return this.db.prepare(
      `SELECT ${groupExpr} AS period, SUM(paidAmount) AS amount, COUNT(*) AS count
       FROM Charge
       WHERE ${where.join(' AND ')}
       GROUP BY ${groupExpr}
       ORDER BY period ASC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  patientGrowth(startDate?: string, endDate?: string): Array<Record<string, unknown>> {
    const where: string[] = ['deletedAt IS NULL'];
    const params: unknown[] = [];
    if (startDate) {
      where.push('createdAt >= ?');
      params.push(startDate);
    }
    if (endDate) {
      where.push('createdAt <= ?');
      params.push(endDate);
    }
    return this.db.prepare(
      `SELECT substr(createdAt, 1, 10) AS day, COUNT(*) AS count
       FROM Patient
       WHERE ${where.join(' AND ')}
       GROUP BY substr(createdAt, 1, 10)
       ORDER BY day ASC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  doctorWorkload(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT U.id AS doctorId, U.name AS doctorName,
              COUNT(DISTINCT V.id) AS visits,
              COUNT(DISTINCT C.id) AS charges,
              COALESCE(SUM(C.paidAmount), 0) AS paidAmount
       FROM User U
       LEFT JOIN Visit V ON V.doctorId = U.id AND V.deletedAt IS NULL
       LEFT JOIN Charge C ON C.doctorId = U.id AND C.deletedAt IS NULL
       WHERE U.role IN ('DOCTOR', 'BOSS')
       GROUP BY U.id, U.name
       ORDER BY paidAmount DESC`,
    ).all() as Array<Record<string, unknown>>;
  }

  inventoryStats(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT category, COUNT(*) AS count, SUM(stock) AS totalStock, SUM(minStock) AS minStock
       FROM InventoryItem
       WHERE deletedAt IS NULL
       GROUP BY category
       ORDER BY category`,
    ).all() as Array<Record<string, unknown>>;
  }

  memberStats(): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active,
              COALESCE(SUM(balance), 0) AS totalBalance,
              COALESCE(SUM(points), 0) AS totalPoints
       FROM MemberCard`,
    ).get() as Record<string, unknown>;
    return row;
  }
}

export class PrintService {
  render(kind: string, data: Record<string, unknown>): string {
    const title = String(data.title ?? kind);
    const lines = Object.entries(data)
      .filter(([key]) => key !== 'title')
      .map(([key, value]) => `<p><strong>${escapeHtml(key)}</strong>: ${escapeHtml(String(value))}</p>`)
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${lines}</body></html>`;
  }
}

export class SearchService {
  constructor(private readonly db: Database.Database) {}

  search(query: string): Array<Record<string, unknown>> {
    const term = `%${query}%`;
    const results: Array<Record<string, unknown>> = [];
    const searches: Array<{ resource: string; rows: Array<Record<string, unknown>>; label: (row: Record<string, unknown>) => string }> = [
      {
        resource: 'patients',
        rows: this.db.prepare(
          `SELECT id, name, phone, code FROM Patient
           WHERE deletedAt IS NULL AND (name LIKE ? OR phone LIKE ? OR code LIKE ?)
           LIMIT 20`,
        ).all(term, term, term) as Array<Record<string, unknown>>,
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'appointments',
        rows: this.db.prepare(
          `SELECT A.id, P.name AS patientName, A.startTime, A.status
           FROM Appointment A
           LEFT JOIN Patient P ON P.id = A.patientId
           WHERE A.deletedAt IS NULL AND P.deletedAt IS NULL
             AND (P.name LIKE ? OR A.startTime LIKE ? OR A.status LIKE ?)
           LIMIT 20`,
        ).all(term, term, term) as Array<Record<string, unknown>>,
        label: (row) => String(row.patientName ?? ''),
      },
      {
        resource: 'charges',
        rows: this.db.prepare(
          `SELECT C.id, P.name AS patientName, C.number, C.status
           FROM Charge C
           LEFT JOIN Patient P ON P.id = C.patientId
           WHERE C.deletedAt IS NULL AND P.deletedAt IS NULL
             AND (C.number LIKE ? OR P.name LIKE ? OR C.status LIKE ?)
           LIMIT 20`,
        ).all(term, term, term) as Array<Record<string, unknown>>,
        label: (row) => String(row.number ?? ''),
      },
      {
        resource: 'inventoryItems',
        rows: this.db.prepare(
          `SELECT id, name, code, category, stock FROM InventoryItem
           WHERE deletedAt IS NULL AND (name LIKE ? OR code LIKE ? OR category LIKE ?)
           LIMIT 20`,
        ).all(term, term, term) as Array<Record<string, unknown>>,
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'suppliers',
        rows: this.db.prepare(
          `SELECT id, name, code, phone FROM Supplier
           WHERE deletedAt IS NULL AND (name LIKE ? OR code LIKE ? OR phone LIKE ?)
           LIMIT 20`,
        ).all(term, term, term) as Array<Record<string, unknown>>,
        label: (row) => String(row.name ?? ''),
      },
      {
        resource: 'followUps',
        rows: this.db.prepare(
          `SELECT F.id, P.name AS patientName, P.phone AS phone, F.content, F.status
           FROM FollowUp F
           LEFT JOIN Patient P ON P.id = F.patientId
           WHERE F.deletedAt IS NULL AND P.deletedAt IS NULL
             AND (P.name LIKE ? OR F.content LIKE ? OR F.status LIKE ?)
           LIMIT 20`,
        ).all(term, term, term) as Array<Record<string, unknown>>,
        label: (row) => String(row.patientName ?? ''),
      },
    ];

    for (const search of searches) {
      for (const row of search.rows) {
        const maskedPhone = row.phone ? this.maskPhone(String(row.phone)) : undefined;
        results.push({
          resource: search.resource,
          id: row.id,
          label: search.label(row),
          detail: { ...row, phone: maskedPhone ?? row.phone },
        });
      }
    }
    return results;
  }

  private maskPhone(phone: string): string {
    if (phone.length < 7) return '****';
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }
}

const SYNC_ALLOWED_TABLES = new Set([
  'Patient',
  'Appointment',
  'Treatment',
  'Charge',
  'InventoryItem',
  'FollowUp',
  'PurchaseOrder',
]);

const SYNC_RESOURCES: Record<string, string> = {
  Patient: 'patients',
  Appointment: 'appointments',
  Treatment: 'treatments',
  Charge: 'charges',
  InventoryItem: 'inventoryItems',
  FollowUp: 'followUps',
  PurchaseOrder: 'purchaseOrders',
};

export class SyncService {
  constructor(private readonly db: Database.Database) {}

  pull(since: string, deviceId: string, deviceToken: string, context: AppContext): { changes: Array<Record<string, unknown>>; serverTime: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    this.assertDevice(deviceId, deviceToken, context);
    const changes = this.db.prepare(
      `SELECT id, tableName, recordId, operation, deviceId, clinicId, createdAt
       FROM SyncChange
       WHERE createdAt > ? AND deviceId != ? AND clinicId = ?
       ORDER BY createdAt ASC
       LIMIT 1000`,
    ).all(since, deviceId, context.clinicId) as Array<Record<string, unknown>>;
    return { changes, serverTime: new Date().toISOString() };
  }

  async push(payload: {
    deviceId: string;
    deviceToken: string;
    changes: Array<{
      tableName: string;
      recordId: string;
      operation: string;
      updatedAt: string;
      data?: Record<string, unknown>;
    }>;
  }, context: AppContext): Promise<{
    accepted: number;
    conflicts: number;
    failed: number;
    errors: Array<{ recordId: string; error: string }>;
  }> {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    this.assertDevice(payload.deviceId, payload.deviceToken, context);
    let accepted = 0;
    const conflicts = 0;
    const errors: Array<{ recordId: string; error: string }> = [];
    for (const change of payload.changes) {
      if (!SYNC_ALLOWED_TABLES.has(change.tableName)) {
        errors.push({ recordId: change.recordId, error: 'Table is not allowed for sync' });
        continue;
      }
      const resourceName = SYNC_RESOURCES[change.tableName];
      const definition = resourceRegistry.get(resourceName);
      /* v8 ignore start */
      if (!definition) {
        errors.push({ recordId: change.recordId, error: `Resource is not defined: ${resourceName}` });
        continue;
      }
      /* v8 ignore stop */
      try {
        const repo = new SqliteRepository(this.db, definition);
        if (change.operation === 'DELETE') {
          await repo.softDelete(change.recordId, context);
        } else {
          if (!change.data || typeof change.data !== 'object') {
            throw new Error('Sync change requires row data');
          }
          const existing = await repo.findById(change.recordId, context);
          const payloadRow = stripProtectedWriteFields(validatePayload(
            definition,
            change.data,
            existing ? { partial: true } : {},
          ));
          const entity = { id: change.recordId, ...payloadRow };
          if (existing) await repo.update(entity, context);
          else await repo.insert(entity, context);
        }
        this.record(change.tableName, change.recordId, change.operation, payload.deviceId, context.clinicId);
        accepted += 1;
      } catch (error) {
        /* v8 ignore start -- non-Error rejection is defensive; current repositories throw Error instances. */
        errors.push({ recordId: change.recordId, error: error instanceof Error ? error.message : String(error) });
        /* v8 ignore stop */
      }
    }
    return { accepted, conflicts, failed: errors.length, errors };
  }

  registerDevice(deviceId: string, name: string, context: AppContext): { deviceId: string; token: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    if (!['BOSS', 'ADMIN'].includes(context.role)) {
      throw new AppError('FORBIDDEN', 'Sync requires BOSS or ADMIN', 403);
    }
    const token = newRefreshToken();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO SyncDevice (
         id, clinicId, userId, deviceId, tokenHash, name, active,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
       ON CONFLICT(clinicId, deviceId) DO UPDATE SET
         tokenHash = excluded.tokenHash,
         name = excluded.name,
         active = 1,
         updatedAt = excluded.updatedAt`,
    ).run(randomUUID(), context.clinicId, context.userId, deviceId, hashRefreshToken(token), name, now, now);
    return { deviceId, token };
  }

  record(tableName: string, recordId: string, operation: string, deviceId: string, clinicId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO SyncChange (id, clinicId, createdAt, updatedAt, deletedAt, tableName, recordId, operation, deviceId)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(randomUUID(), clinicId, now, now, tableName, recordId, operation, deviceId);
  }

  cleanup(before: string | undefined, context: AppContext): { deleted: number; cutoff: string } {
    if (!context.clinicId) throw new AppError('FORBIDDEN', 'Sync requires a clinic scope', 403);
    const cutoff = before ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
    const result = this.db.prepare('DELETE FROM SyncChange WHERE createdAt < ? AND clinicId = ?').run(cutoff, context.clinicId);
    return { deleted: result.changes, cutoff };
  }

  private assertDevice(deviceId: string, deviceToken: string, context: AppContext): void {
    if (!deviceId || !deviceToken || !context.clinicId) {
      throw new AppError('UNAUTHORIZED', 'Device credentials are required', 401);
    }
    const device = this.db.prepare(
      'SELECT id FROM SyncDevice WHERE clinicId = ? AND deviceId = ? AND tokenHash = ? AND active = 1 AND deletedAt IS NULL',
    ).get(context.clinicId, deviceId, hashRefreshToken(deviceToken));
    if (!device) throw new AppError('UNAUTHORIZED', 'Device is not registered or active', 401);
  }
}

export class HrService {
  private readonly db: Database.Database;
  private readonly hrRepository: HrRepository;

  constructor(db: Database.Database, hrRepository?: HrRepository) {
    this.db = db;
    this.hrRepository = hrRepository ?? new SqliteHrRepository(db);
  }

  attendance(workDate?: string): Array<Record<string, unknown>> {
    return this.hrRepository.attendance(workDate);
  }

  approveLeave(id: string, reviewerId: string, approved: boolean): Record<string, unknown> {
    const now = new Date().toISOString();
    const status = approved ? 'APPROVED' : 'REJECTED';
    this.hrRepository.approveLeave(id, status, reviewerId, now);
    return { id, status };
  }
}

export class AlertService {
  private readonly db: Database.Database;
  private readonly alertRepository: AlertRepository;

  constructor(db: Database.Database, alertRepository?: AlertRepository) {
    this.db = db;
    this.alertRepository = alertRepository ?? new SqliteAlertRepository(db);
  }

  open(): Array<Record<string, unknown>> {
    return this.alertRepository.open();
  }

  create(input: {
    alertType: string;
    level: 'INFO' | 'WARNING' | 'CRITICAL';
    severity: 'INFO' | 'WARN' | 'CRITICAL';
    title: string;
    message: string;
    source: string;
    metricName?: string;
    suggestion?: string;
    clinicId?: string | null;
  }): Record<string, unknown> {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO BusinessAlert (
         id, clinicId, alertType, severity, metricName, currentValue,
         baselineValue, deviationPercent, message, suggestion, acknowledged,
         acknowledgedAt, acknowledgedBy, occurredAt, level, title, source,
         status, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, 'OPEN', ?, ?, NULL)`,
    ).run(
      id,
      input.clinicId ?? null,
      input.alertType,
      input.severity,
      input.metricName ?? null,
      input.message,
      input.suggestion ?? null,
      now,
      input.level,
      input.title,
      input.source,
      now,
      now,
    );
    return { id, alertType: input.alertType, status: 'OPEN' };
  }

  setStatus(id: string, status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED', userId?: string): Record<string, unknown> {
    const now = new Date().toISOString();
    this.alertRepository.setStatus(id, status, userId ?? null, now);
    return { id, status };
  }
}

export class MemberCardService {
  private readonly db: Database.Database;
  private readonly memberCardRepository: MemberCardRepository;

  constructor(db: Database.Database, memberCardRepository?: MemberCardRepository) {
    this.db = db;
    this.memberCardRepository = memberCardRepository ?? new SqliteMemberCardRepository(db);
  }

  async recharge(cardId: string, amount: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, requestId, () => {
      const card = this.card(cardId, context);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('Recharge amount must be a positive integer in cents');
      const now = context.now().toISOString();
      const balance = Number(card.balance) + amount;
      this.memberCardRepository.updateRecharge(cardId, balance, amount, now);
      this.log(cardId, 'RECHARGE', amount, balance, now, context.clinicId, null);
      return { cardId, balance, amount };
    });
  }

  async consume(cardId: string, amount: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, requestId, () => {
      const card = this.card(cardId, context);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError('Consume amount must be a positive integer in cents');
      const balance = Number(card.balance) - amount;
      if (balance < 0) throw new ConflictError('Insufficient member card balance');
      const now = context.now().toISOString();
      this.memberCardRepository.updateConsume(cardId, balance, amount, now);
      this.log(cardId, 'CONSUME', -amount, balance, now, context.clinicId, null);
      return { cardId, balance, amount };
    });
  }

  async addPoints(cardId: string, points: number, context: AppContext, requestId?: string): Promise<Record<string, unknown>> {
    return withIdempotency(this.db, requestId, () => {
      const card = this.card(cardId, context);
      if (!Number.isSafeInteger(points) || points === 0) {
        throw new ValidationError('Points must be a non-zero integer');
      }
      const after = Number(card.points) + points;
      if (after < 0) throw new ConflictError('Insufficient points');
      const now = context.now().toISOString();
      this.memberCardRepository.updatePoints(cardId, after, Number(card.totalPoints) + Math.max(0, points), now);
      this.memberCardRepository.insertPointLog({
        id: randomUUID(),
        clinicId: context.clinicId ?? null,
        createdAt: now,
        updatedAt: now,
        cardId,
        type: points >= 0 ? 'ADD' : 'DEDUCT',
        points,
        pointsAfter: after,
      });
      return { cardId, points: after };
    });
  }

  private card(cardId: string, context: AppContext): MemberCardRecord {
    const row = this.memberCardRepository.findById(cardId);
    if (!row) throw new NotFoundError('Member card not found');
    if (row.clinicId && context.clinicId && row.clinicId !== context.clinicId) {
      throw new NotFoundError('Member card not found');
    }
    return row;
  }

  private log(cardId: string, type: string, amount: number, balanceAfter: number, now: string, clinicId: string | null, remark: string | null): void {
    this.memberCardRepository.insertLog({
      id: randomUUID(),
      clinicId,
      createdAt: now,
      updatedAt: now,
      cardId,
      type,
      amount,
      balanceAfter,
      remark,
    });
  }
}

export class PurchaseOrderService {
  private readonly db: Database.Database;
  private readonly purchaseOrderRepository: PurchaseOrderRepository;
  private readonly inventoryRepository: InventoryRepository;

  constructor(
    db: Database.Database,
    purchaseOrderRepository?: PurchaseOrderRepository,
    inventoryRepository?: InventoryRepository,
  ) {
    this.db = db;
    this.purchaseOrderRepository = purchaseOrderRepository ?? new SqlitePurchaseOrderRepository(db);
    this.inventoryRepository = inventoryRepository ?? new SqliteInventoryRepository(db);
  }

  async receive(orderId: string, context: AppContext): Promise<Record<string, unknown>> {
    const order = this.purchaseOrderRepository.findById(orderId);
    if (!order) throw new NotFoundError('Purchase order not found');
    if (order.status !== 'PENDING') throw new ConflictError('Purchase order is not pending');
    const now = context.now().toISOString();
    const items = this.purchaseOrderRepository.itemsByOrder(orderId);
    const run = this.db.transaction(() => {
      this.purchaseOrderRepository.markReceived(orderId, now, now);
      for (const item of items) {
        if (!item.itemId) continue;
        const current = this.inventoryRepository.findItem(item.itemId);
        if (!current) continue;
        const before = Number(current.stock);
        const after = before + Number(item.quantity);
        this.inventoryRepository.updateStock(item.itemId, after, now);
        this.inventoryRepository.createTransaction({
          id: randomUUID(),
          clinicId: context.clinicId ?? null,
          itemId: item.itemId,
          type: 'IN',
          quantity: Number(item.quantity),
          beforeStock: before,
          afterStock: after,
          operatorId: context.userId,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    run();
    return { id: orderId, status: 'RECEIVED' };
  }
}

const PROCESSING_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

export class ProcessingOrderService {
  private readonly db: Database.Database;
  private readonly processingOrderRepository: ProcessingOrderRepository;

  constructor(db: Database.Database, processingOrderRepository?: ProcessingOrderRepository) {
    this.db = db;
    this.processingOrderRepository = processingOrderRepository ?? new SqliteProcessingOrderRepository(db);
  }

  transition(id: string, status: string, context: AppContext): Record<string, unknown> {
    const row = this.processingOrderRepository.findById(id);
    if (!row) throw new NotFoundError('Processing order not found');
    if (!PROCESSING_TRANSITIONS[row.status]?.includes(status)) {
      throw new ConflictError(`Cannot transition processing order from ${row.status} to ${status}`);
    }
    this.processingOrderRepository.updateStatus(id, status, context.now().toISOString());
    return { id, status };
  }
}

export class PatientRiskService {
  private readonly db: Database.Database;
  private readonly patientRiskRepository: PatientRiskRepository;

  constructor(db: Database.Database, patientRiskRepository?: PatientRiskRepository) {
    this.db = db;
    this.patientRiskRepository = patientRiskRepository ?? new SqlitePatientRiskRepository(db);
  }

  calculate(patientId: string, context: AppContext): Record<string, unknown> {
    const treatmentCount = this.patientRiskRepository.treatmentCount(patientId);
    const periodontalCount = this.patientRiskRepository.periodontalCount(patientId);
    const cariesScore = Math.min(100, treatmentCount * 5);
    const periodontalScore = Math.min(100, periodontalCount * 10);
    const implantScore = Math.min(100, treatmentCount * 2);
    const level = (score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' => {
      if (score >= 80) return 'EXTREME';
      if (score >= 60) return 'HIGH';
      if (score >= 30) return 'MEDIUM';
      return 'LOW';
    };
    const now = context.now().toISOString();
    const id = randomUUID();
    const snapshot = { treatmentCount, periodontalCount, dataSources: { treatmentCount, periodontalCount } };
    this.patientRiskRepository.insert({
      id,
      clinicId: context.clinicId ?? null,
      createdAt: now,
      updatedAt: now,
      patientId,
      cariesScore,
      periodontalScore,
      implantScore,
      cariesLevel: level(cariesScore),
      periodontalLevel: level(periodontalScore),
      implantLevel: level(implantScore),
      factorSnapshotJson: JSON.stringify(snapshot),
      assessedById: context.userId,
    });
    return { id, cariesScore, periodontalScore, implantScore };
  }
}

export class PrescriptionSafetyService {
  constructor(private readonly db: Database.Database) {}

  check(prescriptionId: string): { safe: boolean; warnings: string[] } {
    const prescription = this.db.prepare('SELECT * FROM Prescription WHERE id = ? AND deletedAt IS NULL').get(prescriptionId) as Record<string, unknown> | undefined;
    if (!prescription) throw new NotFoundError('Prescription not found');
    const patient = this.db.prepare('SELECT allergies, medicalHistory FROM Patient WHERE id = ?').get(prescription.patientId) as
      | { allergies: string; medicalHistory: string }
      | undefined;
    const allergies = patient ? JSON.parse(patient.allergies || '[]') as string[] : [];
    const items = this.db.prepare('SELECT name FROM PrescriptionItem WHERE prescriptionId = ?').all(prescriptionId) as Array<{ name: string }>;
    const warnings = items
      .flatMap((item) => allergies.filter((allergy) => item.name.toUpperCase().includes(allergy.toUpperCase())))
      .map((allergy) => `Potential allergy: ${allergy}`);
    return { safe: warnings.length === 0, warnings };
  }
}

export class CephalometricService {
  constructor(private readonly db: Database.Database) {}

  compute(caseId: string, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare('SELECT * FROM CephalometricCase WHERE id = ? AND deletedAt IS NULL').get(caseId) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('Cephalometric case not found');
    const landmarks = JSON.parse(String(row.landmarksJson ?? '{}')) as Record<string, { x: number; y: number }>;
    const metrics: Record<string, number> = {};
    if (landmarks.sella && landmarks.nasion) {
      metrics.snLength = distance(landmarks.sella, landmarks.nasion);
    }
    if (landmarks.upperIncisor && landmarks.lowerIncisor) {
      metrics.interincisalAngle = angle(landmarks.upperIncisor, landmarks.lowerIncisor);
    }
    const now = context.now().toISOString();
    this.db.prepare('UPDATE CephalometricCase SET metricsJson = ?, status = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(metrics), 'ANALYZED', now, caseId);
    return { id: caseId, metrics };
  }
}

export class TreatmentProgressService {
  constructor(private readonly db: Database.Database) {}

  summary(planId: string): Record<string, unknown> {
    const plan = this.db.prepare('SELECT * FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL').get(planId) as Record<string, unknown> | undefined;
    if (!plan) throw new NotFoundError('Treatment plan not found');
    const items = this.db.prepare('SELECT status FROM TreatmentPlanItem WHERE planId = ?').all(planId) as Array<{ status: string }>;
    const completed = items.filter((item) => item.status === 'COMPLETED').length;
    return {
      planId,
      totalItems: items.length,
      completedItems: completed,
      progress: items.length === 0 ? 0 : Math.round((completed / items.length) * 100),
    };
  }
}

export class BulkImportService {
  constructor(private readonly db: Database.Database) {}

  async importRows(resourceName: string, rows: Array<Record<string, unknown>>, context: AppContext): Promise<{ imported: number; failed: number; errors: string[] }> {
    const definition = resourceRegistry.get(resourceName);
    if (!definition || !definition.capabilities.create) throw new ValidationError(`Resource cannot import: ${resourceName}`);
    if (FORBIDDEN_BULK_IMPORT_RESOURCES.has(resourceName)) {
      throw new AppError('FORBIDDEN', `Bulk import is disabled for ${resourceName}`, 403);
    }
    if (!definition.roles.includes(context.role)) {
      throw new AppError('FORBIDDEN', `Forbidden resource: ${resourceName}`, 403);
    }
    if (!Array.isArray(rows) || rows.length > 1000) {
      throw new ValidationError('Bulk import rows must be an array with at most 1000 rows');
    }
    const repository = new SqliteRepository(this.db, definition);
    let imported = 0;
    const errors: string[] = [];
    for (const row of rows) {
      try {
        const payload = stripProtectedWriteFields(validatePayload(definition, row));
        await repository.insert({ id: randomUUID(), ...payload }, context);
        imported += 1;
      } catch (error) {
        /* v8 ignore start -- non-Error rejection is defensive; current repository paths throw Error instances. */
        errors.push(error instanceof Error ? error.message : String(error));
        /* v8 ignore stop */
      }
    }
    return { imported, failed: errors.length, errors };
  }
}

export class DebtService {
  private readonly db: Database.Database;
  private readonly debtRepository: DebtRepository;

  constructor(db: Database.Database, debtRepository?: DebtRepository) {
    this.db = db;
    this.debtRepository = debtRepository ?? new SqliteDebtRepository(db);
  }

  pay(debtId: string, amount: number, context: AppContext, requestId?: string): Record<string, unknown> {
    return withIdempotency(this.db, requestId, () => {
      const debt = this.debtRepository.findById(debtId);
      if (!debt) throw new NotFoundError('Debt record not found');
      if (debt.clinicId && context.clinicId && debt.clinicId !== context.clinicId) {
        throw new NotFoundError('Debt record not found');
      }
      const remaining = Number(debt.totalAmount) - Number(debt.paidAmount);
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) throw new ValidationError('Invalid debt payment amount');
      const paid = Number(debt.paidAmount) + amount;
      const status = paid >= Number(debt.totalAmount) ? 'PAID' : 'PARTIAL';
      this.debtRepository.updatePaid(debtId, paid, status, context.now().toISOString());
      return { id: debtId, paidAmount: paid, status };
    });
  }
}

export class NotificationService {
  constructor(private readonly db: Database.Database) {}

  list(userId: string): Array<Record<string, unknown>> {
    return this.db.prepare(
      'SELECT * FROM Notification WHERE userId = ? ORDER BY createdAt DESC LIMIT 100',
    ).all(userId) as Array<Record<string, unknown>>;
  }

  markRead(id: string, userId: string): Record<string, unknown> {
    const result = this.db.prepare('UPDATE Notification SET readAt = ?, updatedAt = ? WHERE id = ? AND userId = ?')
      .run(new Date().toISOString(), new Date().toISOString(), id, userId);
    if (result.changes === 0) throw new NotFoundError('Notification not found');
    return { id, read: true };
  }
}

export class SatisfactionService {
  constructor(private readonly db: Database.Database) {}

  nps(): { promoters: number; detractors: number; passive: number; score: number } {
    const rows = this.db.prepare('SELECT score FROM SatisfactionSurvey').all() as Array<{ score: number }>;
    if (rows.length === 0) return { promoters: 0, detractors: 0, passive: 0, score: 0 };
    const promoters = rows.filter((row) => row.score >= 9).length;
    const detractors = rows.filter((row) => row.score <= 6).length;
    const passive = rows.length - promoters - detractors;
    return { promoters, detractors, passive, score: Math.round(((promoters - detractors) / rows.length) * 100) };
  }

  trend(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT surveyDate, AVG(score) AS avgScore, COUNT(*) AS count
       FROM SatisfactionSurvey
       GROUP BY surveyDate
       ORDER BY surveyDate ASC`,
    ).all() as Array<Record<string, unknown>>;
  }

  doctorRankings(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT S.doctorId, COALESCE(U.name, 'Unknown') AS doctorName,
              COUNT(*) AS surveyCount,
              ROUND(AVG(S.score), 1) AS avgScore
       FROM SatisfactionSurvey S
       LEFT JOIN User U ON U.id = S.doctorId
       WHERE S.deletedAt IS NULL
       GROUP BY S.doctorId, U.name
       ORDER BY avgScore DESC
       LIMIT 50`,
    ).all() as Array<Record<string, unknown>>;
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function angle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rad = Math.atan2(dy, dx);
  return Math.round(Math.abs(rad * 180 / Math.PI));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
