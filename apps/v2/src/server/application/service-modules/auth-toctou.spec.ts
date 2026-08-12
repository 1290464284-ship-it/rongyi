import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../../infrastructure/database';
import { NotFoundError, UnauthorizedError } from '../../infrastructure/errors';
import type { Logger } from '../../infrastructure/logger';
import type { AuthRepository, AuthUserRecord } from '../ports';
import { AuthService } from './auth.service';
import { UserManagementService } from './user-management.service';
import { hashRefreshToken, type AuthSession } from './common';
import { encryptRefreshClaim, refreshClaimKey } from './auth-refresh-claim';

function stubRepo(overrides: Partial<AuthRepository>): AuthRepository {
  return {
    findByUsername: () => null,
    findById: () => null,
    findByRefreshTokenHash: () => null,
    clinicMemberships: () => [],
    setCurrentClinic: () => undefined,
    addClinicMembership: () => undefined,
    isRefreshTokenUsed: () => false,
    findUsedRefreshToken: () => null,
    revokeSessionFamily: () => undefined,
    cleanupUsedRefreshTokens: () => 0,
    insertUser: () => undefined,
    updateUser: () => 0,
    resetPassword: () => 0,
    updateLoginAttempts: () => undefined,
    resetLoginAttempts: () => undefined,
    updatePassword: () => undefined,
    updateRefreshToken: () => undefined,
    clearRefreshToken: () => undefined,
    markRefreshTokenUsed: () => undefined,
    ...overrides,
  };
}

describe('AuthService login TOCTOU guard', () => {
  let db: Database.Database;
  let dataDir: string;
  const now = '2026-08-05T10:00:00.000Z';
  const later = '2026-08-05T10:00:01.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-auth-toctou-'));
    db = createDatabase(dataDir);
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-v2-001', NULL, ?, ?, NULL, 'C', 'C', 1)`,
    ).run(now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function record(passwordHash: string, updatedAt: string): AuthUserRecord {
    return {
      id: 'user-toctou-001',
      clinicId: null,
      currentClinicId: 'clinic-v2-001',
      username: 'toctou',
      passwordHash,
      name: 'TOCTOU User',
      role: 'BOSS',
      active: true,
      loginAttempts: 0,
      lockedUntil: null,
      tokenVersion: 0,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      createdAt: now,
      updatedAt,
      deletedAt: null,
    };
  }

  it('does not reuse a password comparison computed before a concurrent reset', async () => {
    const oldHash = bcrypt.hashSync('old-pass', 4);
    const newHash = bcrypt.hashSync('new-pass', 4);
    let reads = 0;
    const repo = {
      findByUsername: () => {
        reads += 1;
        return record(reads === 1 ? oldHash : newHash, reads === 1 ? now : later);
      },
      findById: () => record(newHash, later),
      findByRefreshTokenHash: () => null,
      clinicMemberships: () => [],
      setCurrentClinic: () => undefined,
      addClinicMembership: () => undefined,
      isRefreshTokenUsed: () => false,
      findUsedRefreshToken: () => null,
      revokeSessionFamily: () => undefined,
      cleanupUsedRefreshTokens: () => 0,
      insertUser: () => undefined,
      updateUser: () => 0,
      resetPassword: () => 0,
      updateLoginAttempts: () => undefined,
      resetLoginAttempts: () => undefined,
      updatePassword: () => undefined,
      updateRefreshToken: () => undefined,
      clearRefreshToken: () => undefined,
      markRefreshTokenUsed: () => undefined,
    };

    const service = new AuthService(db, repo);
    await expect(service.login('toctou', 'old-pass')).rejects.toThrow(UnauthorizedError);
  });

  it('does not let a stale old-password change overwrite a concurrent admin reset', async () => {
    const oldHash = bcrypt.hashSync('old-pass', 4);
    const resetHash = bcrypt.hashSync('admin-reset-pass', 4);
    let reads = 0;
    const repo = {
      findById: () => {
        reads += 1;
        return record(reads === 1 ? oldHash : resetHash, reads === 1 ? now : later);
      },
      findByUsername: () => null,
      findByRefreshTokenHash: () => null,
      clinicMemberships: () => [],
      setCurrentClinic: () => undefined,
      addClinicMembership: () => undefined,
      isRefreshTokenUsed: () => false,
      findUsedRefreshToken: () => null,
      revokeSessionFamily: () => undefined,
      cleanupUsedRefreshTokens: () => 0,
      insertUser: () => undefined,
      updateUser: () => 0,
      resetPassword: () => 0,
      updateLoginAttempts: () => undefined,
      resetLoginAttempts: () => undefined,
      updatePassword: () => undefined,
      updateRefreshToken: () => undefined,
      clearRefreshToken: () => undefined,
      markRefreshTokenUsed: () => undefined,
    };

    const service = new AuthService(db, repo);
    await expect(service.changePassword('user-toctou-001', 'old-pass', 'changed-pass')).rejects.toThrow(UnauthorizedError);
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it('logs and retries session family revocation when the first attempt fails', async () => {
    let revokeCalls = 0;
    const repo = {
      findByUsername: () => null,
      findById: () => null,
      findByRefreshTokenHash: () => null,
      findUsedRefreshToken: () => ({ userId: 'user-replay-001' }),
      isRefreshTokenUsed: () => true,
      revokeSessionFamily: () => {
        revokeCalls += 1;
        if (revokeCalls === 1) throw new Error('db busy');
      },
      cleanupUsedRefreshTokens: () => 0,
      clinicMemberships: () => [],
      setCurrentClinic: () => undefined,
      addClinicMembership: () => undefined,
      insertUser: () => undefined,
      updateUser: () => 0,
      resetPassword: () => 0,
      updateLoginAttempts: () => undefined,
      resetLoginAttempts: () => undefined,
      updatePassword: () => undefined,
      updateRefreshToken: () => undefined,
      clearRefreshToken: () => undefined,
      markRefreshTokenUsed: () => undefined,
    };
    const logger = { error: vi.fn() } as unknown as Logger;
    const service = new AuthService(db, repo, logger);

    await expect(service.refresh('replay-token')).rejects.toThrow(UnauthorizedError);
    expect(revokeCalls).toBe(2);
    expect(logger.error).toHaveBeenCalledWith('session family revocation failed; retrying once', expect.anything());
  });

  it('rejects unknown usernames and treats invalid lockedUntil dates as locked', async () => {
    const unknown = new AuthService(db, stubRepo({}));
    await expect(unknown.login('missing-user', 'x')).rejects.toThrow(UnauthorizedError);

    const hash = bcrypt.hashSync('pass', 4);
    const locked = record(hash, now);
    locked.lockedUntil = 'not-a-date';
    const logger = { warn: vi.fn() } as unknown as Logger;
    const service = new AuthService(db, stubRepo({
      findByUsername: () => locked,
      findById: () => locked,
    }), logger);
    await expect(service.login('toctou', 'pass')).rejects.toThrow(UnauthorizedError);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('lockedUntil'), expect.anything());
  });

  it('rejects refresh tokens that vanish inside the transaction', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    const user = { ...record(hash, now), refreshToken: 'hash', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' };
    let reads = 0;
    const service = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => (reads++ === 0 ? user : null),
      findById: () => user,
    }));
    await expect(service.refresh('token')).rejects.toThrow(UnauthorizedError);
  });

  it('revokes the session family when a refresh token is used inside the transaction', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    const user = { ...record(hash, now), refreshToken: 'hash', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' };
    let usedCalls = 0;
    let revokes = 0;
    const service = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => user,
      findById: () => user,
      findUsedRefreshToken: () => ({ userId: 'user-replay-002' }),
      isRefreshTokenUsed: () => usedCalls++ > 0,
      revokeSessionFamily: () => { revokes += 1; },
    }));
    await expect(service.refresh('token')).rejects.toThrow(UnauthorizedError);
    expect(revokes).toBe(1);
  });

  it('warns and locks accounts whose refresh lockedUntil is invalid', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    const user = {
      ...record(hash, now),
      lockedUntil: 'not-a-date',
      refreshToken: 'hash',
      refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    const logger = { warn: vi.fn() } as unknown as Logger;
    const service = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => user,
      findById: () => user,
    }), logger);
    await expect(service.refresh('token')).rejects.toThrow(UnauthorizedError);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('lockedUntil'), expect.anything());
  });

  it('revokes the family when a used token is found only inside the transaction', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    const user = { ...record(hash, now), refreshToken: 'hash', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' };
    let reads = 0;
    let usedCalls = 0;
    let revokes = 0;
    const service = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => (reads++ === 0 ? user : null),
      findById: () => user,
      findUsedRefreshToken: () => ({ userId: 'user-replay-003' }),
      isRefreshTokenUsed: () => usedCalls++ > 0,
      revokeSessionFamily: () => { revokes += 1; },
    }));
    await expect(service.refresh('token')).rejects.toThrow(UnauthorizedError);
    expect(revokes).toBe(1);
  });

  it('tolerates corrupt idempotency claims and returns valid cached claims inside the transaction', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    const tokenHash = hashRefreshToken('token');
    const user = {
      ...record(hash, now),
      refreshToken: tokenHash,
      refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    const insertClaim = (responseJson: string): void => {
      db.prepare(
        `INSERT OR REPLACE INTO IdempotencyRecord (
           id, key, type, status, responseJson, result, userId, clinicId, operation,
           createdAt, updatedAt, deletedAt, expiresAt
         ) VALUES (?, ?, 'GENERIC', 'COMPLETED', ?, '{}', ?, NULL, 'auth.refresh', ?, ?, NULL, ?)`,
      ).run(randomUUID(), refreshClaimKey(tokenHash, user.id), responseJson, user.id, now, now, '2099-01-01T00:00:00.000Z');
    };
    insertClaim('not-encrypted');
    const corrupt = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => user,
      findById: () => user,
      isRefreshTokenUsed: () => false,
      findUsedRefreshToken: () => null,
    }));
    await expect(corrupt.refresh('token')).resolves.toBeDefined();

    db.prepare("DELETE FROM IdempotencyRecord WHERE operation = 'auth.refresh'").run();
    const { passwordHash: _passwordHash, ...safeUser } = user;
    const session = {
      token: 'access-token',
      refreshToken: 'next-refresh',
      expiresIn: 8 * 60 * 60,
      user: safeUser as unknown as AuthSession['user'],
    };
    let reads = 0;
    const cached = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => {
        if (reads++ === 1) insertClaim(encryptRefreshClaim(session, tokenHash));
        return reads === 1 ? user : null;
      },
      findById: () => user,
      findUsedRefreshToken: () => ({ userId: user.id }),
      isRefreshTokenUsed: () => false,
    }));
    await expect(cached.refresh('token')).resolves.toMatchObject({ token: 'access-token' });
  });

  it('rejects login when the user vanishes inside the transaction', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    let reads = 0;
    const service = new AuthService(db, stubRepo({
      findByUsername: () => (reads++ === 0 ? record(hash, now) : null),
      findById: () => null,
    }));
    await expect(service.login('toctou', 'pass')).rejects.toThrow(UnauthorizedError);
  });

  it('returns null from refresh claims for missing or stale users', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    const tokenHash = hashRefreshToken('token-claim');
    const user = {
      ...record(hash, now),
      refreshToken: tokenHash,
      refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    const { passwordHash: _passwordHash, ...safeUser } = user;
    const session = { token: 'claim-token', refreshToken: 'claim-next', expiresIn: 8 * 60 * 60, user: safeUser as unknown as AuthSession['user'] };
    const insertClaim = (): void => {
      db.prepare(
        `INSERT OR REPLACE INTO IdempotencyRecord (
           id, key, type, status, responseJson, result, userId, clinicId, operation,
           createdAt, updatedAt, deletedAt, expiresAt
         ) VALUES (?, ?, 'GENERIC', 'COMPLETED', ?, '{}', ?, NULL, 'auth.refresh', ?, ?, NULL, ?)`,
      ).run(randomUUID(), refreshClaimKey(tokenHash, user.id), encryptRefreshClaim(session, tokenHash), user.id, now, now, '2099-01-01T00:00:00.000Z');
    };
    insertClaim();
    const missing = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => user,
      findById: () => null,
      isRefreshTokenUsed: () => false,
      findUsedRefreshToken: () => null,
    }));
    await expect(missing.refresh('token-claim')).resolves.toBeDefined();

    insertClaim();
    const stale = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => user,
      findById: () => ({ ...user, tokenVersion: 99 }),
      isRefreshTokenUsed: () => false,
      findUsedRefreshToken: () => null,
    }));
    await expect(stale.refresh('token-claim')).resolves.toBeDefined();
  });

  it('clears the refresh cache when it exceeds capacity', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    const user = {
      ...record(hash, now),
      refreshToken: 'hash',
      refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    const service = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => user,
      findById: () => user,
      isRefreshTokenUsed: () => false,
      findUsedRefreshToken: () => null,
    }));
    for (let index = 0; index < 1001; index += 1) {
      await expect(service.refresh(`token-${index}`)).resolves.toBeDefined();
    }
  });

  it('user management rejects missing users', async () => {
    const service = new UserManagementService(db, stubRepo({}));
    await expect(service.getUserById('missing-user')).rejects.toThrow(NotFoundError);
  });

  it('ignores expired refresh claims', async () => {
    const hash = bcrypt.hashSync('pass', 4);
    const tokenHash = hashRefreshToken('token-expired-claim');
    const user = {
      ...record(hash, now),
      refreshToken: tokenHash,
      refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    db.prepare(
      `INSERT OR REPLACE INTO IdempotencyRecord (
         id, key, type, status, responseJson, result, userId, clinicId, operation,
         createdAt, updatedAt, deletedAt, expiresAt
       ) VALUES (?, ?, 'GENERIC', 'COMPLETED', '{}', '{}', ?, NULL, 'auth.refresh', ?, ?, NULL, '2000-01-01T00:00:00.000Z')`,
    ).run(randomUUID(), refreshClaimKey(tokenHash, user.id), user.id, now, now);
    const service = new AuthService(db, stubRepo({
      findByRefreshTokenHash: () => user,
      findById: () => user,
      isRefreshTokenUsed: () => false,
      findUsedRefreshToken: () => null,
    }));
    await expect(service.refresh('token-expired-claim')).resolves.toBeDefined();
  });

});
