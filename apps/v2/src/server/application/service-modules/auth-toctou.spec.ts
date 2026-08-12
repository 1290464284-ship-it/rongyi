import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../../infrastructure/database';
import { UnauthorizedError } from '../../infrastructure/errors';
import type { Logger } from '../../infrastructure/logger';
import type { AuthUserRecord } from '../ports';
import { AuthService } from './auth.service';

describe('AuthService login TOCTOU guard', () => {
  let db: Database.Database;
  let dataDir: string;
  const now = '2026-08-05T10:00:00.000Z';
  const later = '2026-08-05T10:00:01.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-auth-toctou-'));
    db = createDatabase(dataDir);
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
});
