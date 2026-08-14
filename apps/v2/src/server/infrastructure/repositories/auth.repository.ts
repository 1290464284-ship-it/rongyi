// 认证/用户仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import type { AuthRepository, AuthUserRecord } from '../../application/ports';

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
       WHERE UC.userId = ? AND UC.deletedAt IS NULL AND C.deletedAt IS NULL AND C.active = 1
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
    if (clinicId) params.push(clinicId, clinicId);
    return this.db.prepare(
      `UPDATE User SET ${sets.join(', ')} WHERE id = ? AND deletedAt IS NULL
       ${clinicId
         ? `AND (EXISTS (
               SELECT 1 FROM UserClinic uc
               WHERE uc.userId = User.id AND uc.clinicId = ? AND uc.deletedAt IS NULL
             ) OR User.clinicId = ?)`
         : ''}`,
    ).run(...params).changes;
  }

  resetPassword(id: string, passwordHash: string, updatedAt: string, clinicId?: string | null): number {
    const params = clinicId ? [passwordHash, updatedAt, id, clinicId, clinicId] : [passwordHash, updatedAt, id];
    return this.db.prepare(
      `UPDATE User SET passwordHash = ?, loginAttempts = 0, lockedUntil = NULL, tokenVersion = tokenVersion + 1, refreshToken = NULL, refreshTokenExpiresAt = NULL, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL
       ${clinicId
         ? `AND (EXISTS (
               SELECT 1 FROM UserClinic uc
               WHERE uc.userId = User.id AND uc.clinicId = ? AND uc.deletedAt IS NULL
             ) OR User.clinicId = ?)`
         : ''}`,
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
