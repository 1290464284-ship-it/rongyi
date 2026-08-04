import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../infrastructure/errors';
import { SqliteAuthRepository } from '../../infrastructure/repositories/core.repositories';
import { tenantAnd, tenantMatches, tenantParams } from '../../infrastructure/tenant';
import type { AppContext, User } from '../../../domain/contracts';
import type { AuthRepository, AuthUserRecord } from '../ports';
import {
  AuthSession,
  JWT_SECRET,
  REFRESH_TTL_MS,
  TOKEN_TTL,
  TokenPayload,
  assertPatientExists,
  hashRefreshToken,
  isUserRole,
  newRefreshToken,
  rowToUser,
} from './common';

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
    this.authRepository.cleanupUsedRefreshTokens(new Date(Date.now() - 90 * 86_400_000).toISOString());
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

  async createUser(
    input: { username: string; password: string; name: string; role: string; phone?: string; active?: boolean },
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    const username = String(input.username ?? '').trim();
    const name = String(input.name ?? '').trim();
    const role = String(input.role ?? '');
    if (!username || !name) throw new ValidationError('Username and name are required');
    if (input.password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    if (!isUserRole(role)) throw new ValidationError(`Invalid user role: ${role}`);
    if (this.authRepository.findByUsername(username)) throw new ConflictError('Username already exists');
    const passwordHash = await bcrypt.hash(input.password, 10);
    const now = new Date().toISOString();
    const record: AuthUserRecord = {
      id: randomUUID(),
      clinicId: context.clinicId,
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
    const changes = this.authRepository.updateUser(id, {
      name: input.name,
      phone: input.phone,
      role: input.role,
      active: input.active,
    }, new Date().toISOString(), context.clinicId);
    if (changes === 0) throw new NotFoundError('User not found');
    return this.getUserById(id);
  }

  async resetPassword(id: string, newPassword: string, context: AppContext): Promise<{ id: string }> {
    const row = this.authRepository.findById(id);
    if (!row || !tenantMatches(row.clinicId, context.clinicId)) throw new NotFoundError('User not found');
    if (newPassword.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const changes = this.authRepository.resetPassword(id, passwordHash, new Date().toISOString(), context.clinicId);
    if (changes === 0) throw new NotFoundError('User not found');
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
    assertPatientExists(this.db, input.patientId, context.clinicId);
    this.assertTimeRange(input.startTime, input.endTime);
    this.assertNoConflict(input.doctorId, input.chairId, input.startTime, input.endTime, context.clinicId);
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
    const params = clinicId ? [doctorId, chairId ?? null, endTime, startTime, clinicId] : [doctorId, chairId ?? null, endTime, startTime];
    const rows = this.db.prepare(
      `SELECT id FROM Appointment
       WHERE deletedAt IS NULL
         AND status NOT IN ('CANCELLED', 'NO_SHOW')
         AND ((doctorId = ?) OR (chairId IS NOT NULL AND chairId = ?))
         AND startTime < ? AND endTime > ?${tenantAnd(clinicId)}`,
    ).all(...params) as Array<{ id: string }>;
    if (rows.length > 0) throw new ConflictError('Doctor or chair is already booked in this time range');
  }
}
