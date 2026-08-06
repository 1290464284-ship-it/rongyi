import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../infrastructure/errors';
import { SqliteAuthRepository } from '../../infrastructure/repositories/core.repositories';
import { tenantAnd, tenantMatches, tenantParams, tenantWhere } from '../../infrastructure/tenant';
import type { AppContext, User } from '../../../domain/contracts';
import type { AuthRepository, AuthUserRecord } from '../ports';
import {
  AuthSession,
  JWT_SECRET,
  REFRESH_TTL_MS,
  TOKEN_TTL,
  TokenPayload,
  assertChairExists,
  assertDoctorExists,
  assertPatientExists,
  hashRefreshToken,
  isUserRole,
  newRefreshToken,
  rowToUser,
} from './common';

const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8cG5fVb55Qk9X7pL5Nh4bKj1R8f69y';

export class AuthService {
  private readonly db: Database.Database;
  private readonly authRepository: AuthRepository;

  constructor(db: Database.Database, authRepository?: AuthRepository) {
    this.db = db;
    this.authRepository = authRepository ?? new SqliteAuthRepository(db);
  }

  private runTx<T>(fn: () => T): T {
    const tx = (this.db as unknown as { transaction?: <U>(cb: () => U) => () => U }).transaction;
    if (typeof tx === 'function') {
      return tx.call(this.db, fn)() as T;
    }
    return fn();
  }

  async login(username: string, password: string): Promise<AuthSession> {
    const preRow = this.authRepository.findByUsername(username);
    if (!preRow) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedError('Invalid username or password');
    }
    const preUser = rowToUser(preRow);
    const valid = await bcrypt.compare(password, preUser.passwordHash);
    return this.runTx(() => {
      const row = this.authRepository.findByUsername(username);
      if (!row) throw new UnauthorizedError('Invalid username or password');
      const user = rowToUser(row);
      if (!user.active) throw new UnauthorizedError('User is disabled');
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
        throw new UnauthorizedError('Account is temporarily locked');
      }
      if (!valid) {
        const attempts = user.loginAttempts + 1;
        const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
        this.authRepository.updateLoginAttempts(user.id, attempts, lockedUntil, new Date().toISOString());
        throw new UnauthorizedError('Invalid username or password');
      }
      this.authRepository.resetLoginAttempts(user.id, new Date().toISOString());
      const token = this.sign({ sub: user.id, clinicId: this.resolveClinicId(user), role: user.role, tokenVersion: user.tokenVersion });
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
    });
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    if (!refreshToken) throw new UnauthorizedError('Refresh token is required');
    const tokenHash = hashRefreshToken(refreshToken);
    this.authRepository.cleanupUsedRefreshTokens(new Date(Date.now() - 90 * 86_400_000).toISOString());
    if (this.authRepository.isRefreshTokenUsed(tokenHash)) {
      throw new UnauthorizedError('Invalid refresh token');
    }
    const preRow = this.authRepository.findByRefreshTokenHash(tokenHash);
    if (!preRow) throw new UnauthorizedError('Invalid refresh token');
    return this.runTx(() => {
      if (this.authRepository.isRefreshTokenUsed(tokenHash)) {
        throw new UnauthorizedError('Invalid refresh token');
      }
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
      const token = this.sign({ sub: user.id, clinicId: this.resolveClinicId(user), role: user.role, tokenVersion: user.tokenVersion });
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return { token, refreshToken: nextRefreshToken, expiresIn: 8 * 60 * 60, user: safeUser };
    });
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
      return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  private resolveClinicId(user: User): string {
    if (user.currentClinicId) return user.currentClinicId;
    if (user.clinicId) return user.clinicId;
    const membershipClinicId = this.authRepository.clinicMemberships(user.id)[0]?.clinicId ?? null;
    if (!membershipClinicId) {
      throw new AppError('FORBIDDEN', 'No clinic scope assigned to this account', 403);
    }
    return membershipClinicId;
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

  listAccessibleClinics(userId: string, role: User['role']): {
    currentClinicId: string | null;
    clinics: Array<{ clinicId: string; name: string; role: string }>;
  } {
    const row = this.authRepository.findById(userId);
    if (!row) throw new NotFoundError('User not found');
    if (role !== 'BOSS') {
      const clinicId = row.currentClinicId ?? row.clinicId ?? null;
      return {
        currentClinicId: clinicId,
        clinics: clinicId ? [{ clinicId, name: clinicId, role }] : [],
      };
    }
    let memberships = this.authRepository.clinicMemberships(userId);
    if (memberships.length === 0 && row.clinicId) {
      memberships = [{ clinicId: row.clinicId, name: row.clinicId, role }];
    }
    return {
      currentClinicId: row.currentClinicId ?? row.clinicId ?? null,
      clinics: memberships.map((membership) => ({
        clinicId: membership.clinicId,
        name: membership.name || membership.clinicId,
        role: membership.role,
      })),
    };
  }

  listDoctors(context: AppContext): Array<{ id: string; name: string; phone: string | null; role: string }> {
    const rows = this.db.prepare(
      `SELECT id, name, phone, role FROM User
       WHERE role = 'DOCTOR' AND active = 1 AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY name ASC`,
    ).all(...tenantParams(context.clinicId)) as Array<{ id: string; name: string; phone: string | null; role: string }>;
    return rows;
  }

  switchClinic(userId: string, role: User['role'], clinicId: string): { token: string; clinicId: string } {
    if (role !== 'BOSS') {
      throw new AppError('FORBIDDEN', 'Only BOSS can switch clinics', 403);
    }
    const row = this.authRepository.findById(userId);
    if (!row) throw new NotFoundError('User not found');
    const memberships = this.authRepository.clinicMemberships(userId);
    if (!memberships.some((membership) => membership.clinicId === clinicId)) {
      throw new NotFoundError('Clinic not found');
    }
    const clinic = this.db.prepare('SELECT id FROM Clinic WHERE id = ? AND active = 1 AND deletedAt IS NULL').get(clinicId) as
      | { id: string }
      | undefined;
    if (!clinic) throw new NotFoundError('Clinic not found');
    const now = new Date().toISOString();
    this.authRepository.setCurrentClinic(userId, clinicId, now);
    const token = this.sign({ sub: userId, clinicId, role: row.role, tokenVersion: row.tokenVersion });
    return { token, clinicId };
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
    const now = new Date().toISOString();
    this.runTx(() => {
      this.authRepository.updatePassword(userId, hash, now);
      this.authRepository.clearRefreshToken(userId, now);
      this.db.prepare?.('UPDATE User SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')?.run(now, userId);
    });
  }

  async createUser(
    input: { username: string; password: string; name: string; role: string; phone?: string; active?: boolean; clinicIds?: string[] },
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    const username = String(input.username ?? '').trim();
    const name = String(input.name ?? '').trim();
    const role = String(input.role ?? '');
    if (!username || !name) throw new ValidationError('Username and name are required');
    if (input.password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    if (!isUserRole(role)) throw new ValidationError(`Invalid user role: ${role}`);
    if (input.clinicIds !== undefined && (!Array.isArray(input.clinicIds) || input.clinicIds.some((id) => typeof id !== 'string'))) {
      throw new ValidationError('clinicIds must be an array of strings');
    }
    if (this.authRepository.findByUsername(username)) throw new ConflictError('Username already exists');
    const clinicIds = role === 'BOSS'
      ? [...new Set([...tenantParams(context.clinicId), ...(input.clinicIds ?? [])])]
      : [...tenantParams(context.clinicId)];
    if (clinicIds.length > 0) {
      const placeholders = clinicIds.map(() => '?').join(',');
      const clinics = this.db.prepare(
        `SELECT id FROM Clinic WHERE id IN (${placeholders}) AND active = 1 AND deletedAt IS NULL`,
      ).all(...clinicIds) as Array<{ id: string }>;
      if (clinics.length !== clinicIds.length) {
        throw new ValidationError('clinicIds must reference existing clinics');
      }
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const now = new Date().toISOString();
    const record: AuthUserRecord = {
      id: randomUUID(),
      clinicId: context.clinicId,
      currentClinicId: context.clinicId,
      username,
      passwordHash,
      name,
      role,
      phone: input.phone ?? null,
      active: input.active ?? true,
      loginAttempts: 0,
      lockedUntil: null,
      tokenVersion: 0,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    try {
      this.authRepository.insertUser(record);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
        throw new ConflictError('Username already exists');
      }
      throw error;
    }
    for (const clinicId of clinicIds as string[]) {
      this.authRepository.addClinicMembership(record.id, clinicId, role, now, now);
    }
    const { passwordHash: _passwordHash, ...safeUser } = rowToUser(record);
    return safeUser;
  }

  async updateUser(
    id: string,
    input: { name?: string; phone?: string; role?: string; active?: boolean },
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    const row = this.authRepository.findById(id);
    if (!row || !tenantMatches(row.clinicId, context.clinicId)) throw new NotFoundError('User not found');
    if (input.role !== undefined && !isUserRole(input.role)) throw new ValidationError(`Invalid user role: ${input.role}`);
    const now = new Date().toISOString();
    const bumpToken = input.active === false;
    this.runTx(() => {
      const changes = this.authRepository.updateUser(id, {
        name: input.name,
        phone: input.phone,
        role: input.role,
        active: input.active,
      }, now, context.clinicId);
      if (changes === 0) throw new NotFoundError('User not found');
      if (bumpToken) {
        this.db.prepare?.('UPDATE User SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')?.run(now, id);
      }
    });
    return this.getUserById(id);
  }

  async resetPassword(id: string, newPassword: string, context: AppContext): Promise<{ id: string }> {
    const row = this.authRepository.findById(id);
    if (!row || !tenantMatches(row.clinicId, context.clinicId)) throw new NotFoundError('User not found');
    if (newPassword.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date().toISOString();
    this.runTx(() => {
      const changes = this.authRepository.resetPassword(id, passwordHash, now, context.clinicId);
      if (changes === 0) throw new NotFoundError('User not found');
      this.db.prepare?.('UPDATE User SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')?.run(now, id);
    });
    return { id };
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

  cleanup(beforeIso: string): number {
    const result = this.db.prepare('DELETE FROM OperationLog WHERE createdAt < ?').run(beforeIso);
    return result.changes;
  }

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

  private runTx<T>(fn: () => T): T {
    const tx = (this.db as unknown as { transaction?: <U>(cb: () => U) => () => U }).transaction;
    if (typeof tx === 'function') {
      return tx.call(this.db, fn)() as T;
    }
    return fn();
  }

  async create(input: {
    patientId?: string;
    doctorId: string;
    chairId?: string;
    startTime: string;
    endTime: string;
    type: string;
    remark?: string;
    purpose?: string;
    tempPatientName?: string;
    tempPatientPhone?: string;
  }, context: AppContext): Promise<Record<string, unknown>> {
    const tempPatientName = String(input.tempPatientName ?? '').trim();
    const tempPatientPhone = input.tempPatientPhone !== undefined && input.tempPatientPhone !== null
      ? String(input.tempPatientPhone).trim()
      : '';
    assertDoctorExists(this.db, input.doctorId, context.clinicId);
    if (input.chairId) assertChairExists(this.db, input.chairId, context.clinicId);
    if (!['REGULAR', 'FOLLOW_UP', 'EMERGENCY', 'CONSULTATION'].includes(input.type)) {
      throw new ValidationError('Invalid appointment type');
    }
    if (!input.patientId && !tempPatientName) {
      throw new ValidationError('patientId or tempPatientName is required');
    }
    if (input.patientId) assertPatientExists(this.db, input.patientId, context.clinicId);
    this.assertTimeRange(input.startTime, input.endTime);
    const now = context.now().toISOString();
    const id = randomUUID();
    this.runTx(() => {
      let resolvedPatientId = input.patientId;
      if (!resolvedPatientId) {
        resolvedPatientId = randomUUID();
        this.db.prepare(
          `INSERT INTO Patient (
             id, clinicId, createdAt, updatedAt, deletedAt,
             code, name, gender, phone, source, active, isTempPatient
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'UNKNOWN', ?, 'WALK_IN', 1, 1)`,
        ).run(
          resolvedPatientId,
          context.clinicId ?? null,
          now,
          now,
          `TEMP-${Date.now()}-${randomUUID().slice(0, 8)}`,
          tempPatientName,
          tempPatientPhone || null,
        );
      }
      this.assertNoConflict(input.doctorId, input.chairId, input.startTime, input.endTime, context.clinicId);
      this.db.prepare(
        `INSERT INTO Appointment (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, doctorId, chairId, startTime, endTime, status, type, remark,
           purpose, tempPatientName, tempPatientPhone
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'BOOKED', ?, ?, ?, ?, ?)`,
      ).run(
        id,
        context.clinicId ?? null,
        now,
        now,
        resolvedPatientId as string,
        input.doctorId,
        input.chairId ?? null,
        input.startTime,
        input.endTime,
        input.type,
        input.remark ?? null,
        input.purpose ?? null,
        input.patientId ? null : (tempPatientName || null),
        input.patientId ? null : (tempPatientPhone || null),
      );
    });
    return { id, status: 'BOOKED' };
  }

  async transition(id: string, nextStatus: string, context: AppContext): Promise<Record<string, unknown>> {
    const row = this.db.prepare(`SELECT * FROM Appointment WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`).get(id, ...tenantParams(context.clinicId)) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new NotFoundError('Appointment not found');
    const current = String(row.status);
    if (!APPOINTMENT_TRANSITIONS[current]?.includes(nextStatus)) {
      throw new ConflictError(`Cannot transition appointment from ${current} to ${nextStatus}`);
    }
    this.db.prepare(
      `UPDATE Appointment SET status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(nextStatus, context.now().toISOString(), id, ...tenantParams(context.clinicId));
    return { id, status: nextStatus };
  }

  private assertTimeRange(startTime: string, endTime: string): void {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new ValidationError('endTime must be later than startTime');
    }
  }

  private assertNoConflict(
    doctorId: string,
    chairId: string | undefined,
    startTime: string,
    endTime: string,
    clinicId: string | null,
  ): void {
    const tenant = tenantWhere(clinicId);
    const params = [doctorId, chairId ?? null, endTime, startTime, ...tenant.params];
    const rows = this.db.prepare(
      `SELECT id FROM Appointment
       WHERE deletedAt IS NULL
         AND status NOT IN ('CANCELLED', 'NO_SHOW')
         AND ((doctorId = ?) OR (chairId IS NOT NULL AND chairId = ?))
         AND startTime < ? AND endTime > ?
         ${tenant.sql ? `AND ${tenant.sql}` : ''}`,
    ).all(...params) as Array<{ id: string }>;
    if (rows.length > 0) throw new ConflictError('Doctor or chair is already booked in this time range');
  }
}
