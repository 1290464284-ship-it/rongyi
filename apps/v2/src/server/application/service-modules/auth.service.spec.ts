// AuthService 模块化 spec：自 services.spec.ts / services-edge.spec.ts
// （聚合文件）迁移而来。迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AuthService } from './auth.service';
import type { AuthRepository } from '../ports';
import type { AppContext } from '../../../domain/contracts';

interface TokenPayload {
  sub: string;
  clinicId: string | null;
  role: string;
  tokenVersion: number;
}

describe('AuthService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-04T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-auth-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertUser(id: string, overrides: Record<string, unknown> = {}): void {
    const merged = {
      id,
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      username: `user-${id}`,
      passwordHash: '$2a$10$7EqJtq98hPqEX7fNZaFWoOhi4J7BQj2rC1s6s5n9oJ3l6dL6J9t1e',
      name: `User ${id}`,
      role: 'BOSS',
      active: 1,
      loginAttempts: 0,
      tokenVersion: 0,
      lockedUntil: null,
      ...overrides,
    };
    db.prepare(
      `INSERT OR REPLACE INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion,
         lockedUntil
       ) VALUES (
         @id, @clinicId, @createdAt, @updatedAt, NULL,
         @username, @passwordHash, @name, @role, @active, @loginAttempts, @tokenVersion,
         @lockedUntil
       )`,
    ).run(merged);
  }

  it('rotates refresh tokens and rejects reused tokens', async () => {
    vi.useFakeTimers();
    try {
      const service = new AuthService(db);
      const session = await service.login('admin', 'v2-test-seed-password');
      expect(session.refreshToken).toBeDefined();
      const refreshed = await service.refresh(session.refreshToken);
      expect(refreshed.refreshToken).not.toBe(session.refreshToken);
      // B-M9：轮换成功后旧 token 进入 5 秒窗口缓存（并发刷新共享同一新会话），
      // 窗口内重复 refresh 返回同一会话；窗口过后重放才触发 RFC 6819 吊销。
      const replayed = await service.refresh(session.refreshToken);
      expect(replayed.refreshToken).toBe(refreshed.refreshToken);
      await vi.advanceTimersByTimeAsync(5100);
      const versionBeforeReplay = (db.prepare("SELECT tokenVersion FROM User WHERE username = 'admin'").get() as { tokenVersion: number }).tokenVersion;
      await expect(service.refresh(session.refreshToken)).rejects.toThrow('Invalid refresh token');
      // M5：重用检测后按 RFC 6819 吊销整个会话族——轮换出的 refresh token 也失效，且当前 refresh token 被清除、tokenVersion 递增
      await expect(service.refresh(refreshed.refreshToken)).rejects.toThrow('Invalid refresh token');
      const afterReplay = db.prepare("SELECT refreshToken, tokenVersion FROM User WHERE username = 'admin'").get() as {
        refreshToken: string | null;
        tokenVersion: number;
      };
      expect(afterReplay.refreshToken).toBeNull();
      expect(afterReplay.tokenVersion).toBe(versionBeforeReplay + 1);
      await service.logout(refreshed.refreshToken);
      await expect(service.refresh(refreshed.refreshToken)).rejects.toThrow('Invalid refresh token');
    } finally {
      vi.useRealTimers();
    }
  }, 15000);

  it('shares the refresh rotation window across service instances via the DB claim', async () => {
    const first = new AuthService(db);
    const session = await first.login('admin', 'v2-test-seed-password');
    const refreshed = await first.refresh(session.refreshToken);
    // 第二个实例没有进程内缓存，必须命中数据库 claim 并返回同一新会话，不能触发会话族吊销。
    const second = new AuthService(db);
    const replayed = await second.refresh(session.refreshToken);
    expect(replayed.refreshToken).toBe(refreshed.refreshToken);
    expect(replayed.token).toBe(refreshed.token);
  });

  it('maps create-user unique races to conflict errors', async () => {
    const repo = {
      findByUsername: () => null,
      insertUser: () => { throw new Error('UNIQUE constraint failed: User.username'); },
      clinicMemberships: () => [],
    } as unknown as AuthRepository;
    const auth = new AuthService(db, repo);
    await expect(auth.createUser({
      username: 'race-user',
      password: 'password123',
      name: 'Race User',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('Username already exists');
  });

  it('rethrows non-unique create-user repository failures', async () => {
    const repo = {
      findByUsername: () => null,
      insertUser: () => { throw new Error('database down'); },
      clinicMemberships: () => [],
    } as unknown as AuthRepository;
    const auth = new AuthService(db, repo);
    await expect(auth.createUser({
      username: 'down-user',
      password: 'password123',
      name: 'Down User',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('database down');
  });

  it('restricts non-BOSS user creation to the creator clinic scope (S-L6)', async () => {
    const auth = new AuthService(db);
    // 第二个诊所（BOSS 可跨诊所创建并分配成员）
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-v2-002', NULL, ?, ?, NULL, 'B', 'Branch Clinic', 1)`,
    ).run(now, now);
    // BOSS 在 clinic-v2-001 创建 DOCTOR（仅属于本诊所；BOSS 为全局管理员）
    const doctor = await auth.createUser({
      username: 'doctor-local',
      password: 'password123',
      name: 'Local Doctor',
      role: 'DOCTOR',
      clinicIds: ['clinic-v2-001'],
    }, context);
    // 医生在服务层也不允许创建员工账号（HTTP 路由同样拒绝）
    const outsiderContext: AppContext = { ...context, userId: doctor.id, clinicId: 'clinic-v2-002', role: 'DOCTOR' };
    await expect(auth.createUser({
      username: 'outsider-user',
      password: 'password123',
      name: 'Outsider User',
      role: 'DOCTOR',
    }, outsiderContext)).rejects.toThrow('医生不能管理员工账号');
    const doctorInOwnClinic: AppContext = { ...context, userId: doctor.id, clinicId: 'clinic-v2-001', role: 'DOCTOR' };
    await expect(auth.createUser({
      username: 'inner-user',
      password: 'password123',
      name: 'Inner User',
      role: 'DOCTOR',
    }, doctorInOwnClinic)).rejects.toThrow('医生不能管理员工账号');
  });

  it('rejects user updates when the repository reports zero affected rows', async () => {
    const fakeAuth = {
      findById: () => ({
        id: 'user-1',
        clinicId: 'clinic-v2-001',
        username: 'u',
        passwordHash: 'hash',
        name: 'n',
        role: 'BOSS',
        active: true,
        loginAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:00.000Z',
        deletedAt: null,
      }),
      updateUser: () => 0,
      resetPassword: () => 0,
    } as unknown as AuthRepository;
    const service = new AuthService(db, fakeAuth);
    await expect(service.updateUser('user-1', { name: 'x' }, context)).rejects.toThrow('User not found');
    await expect(service.resetPassword('user-1', 'password123', context)).rejects.toThrow('User not found');
  });

  // ---- 用户管理测试（自 services-edge.spec.ts 聚合文件迁移，相对顺序保留）----

  it('manages users through the admin service', async () => {
    const auth = new AuthService(db);
    const created = await auth.createUser({
      username: 'admin-created',
      password: 'password123',
      name: 'Created',
      role: 'DOCTOR',
    }, context);
    expect(created.id).toBeDefined();
    await expect(auth.createUser({
      username: 'admin-created',
      password: 'password123',
      name: 'Duplicate',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('Username already exists');
    await expect(auth.createUser({
      username: 'bad-role',
      password: 'password123',
      name: 'Bad Role',
      role: 'SUPER',
    }, context)).rejects.toThrow('Invalid user role');
    await expect(auth.createUser({
      username: 'short',
      password: 'short',
      name: 'Short',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('at least 6 characters');
    await expect(auth.createUser({
      username: '',
      password: 'password123',
      name: 'No Username',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('Username and name are required');
    await expect(auth.createUser({} as never, context)).rejects.toThrow('Username and name are required');

    const updated = await auth.updateUser(created.id, { name: 'Updated', phone: '13800000000', role: 'DOCTOR', active: false }, context);
    expect(updated.name).toBe('Updated');
    await expect(auth.updateUser(created.id, { role: 'BAD' }, context)).rejects.toThrow('Invalid user role');
    await expect(auth.updateUser('missing-user', {}, context)).rejects.toThrow('User not found');
    await expect(auth.resetPassword('missing-user', 'password123', context)).rejects.toThrow('User not found');
    await expect(auth.resetPassword(created.id, 'short', context)).rejects.toThrow('at least 6 characters');
    await expect(auth.resetPassword(created.id, 'newpassword123', context)).resolves.toEqual({ id: created.id });
    db.prepare('UPDATE User SET lockedUntil = ?, loginAttempts = ? WHERE id = ?').run('not-a-date', 5, created.id);
    await auth.resetPassword(created.id, 'newpassword123', context);
    const unlocked = db.prepare('SELECT lockedUntil, loginAttempts FROM User WHERE id = ?').get(created.id) as {
      lockedUntil: string | null;
      loginAttempts: number;
    };
    expect(unlocked.lockedUntil).toBeNull();
    expect(Number(unlocked.loginAttempts)).toBe(0);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, ?, ?, ?, NULL, 'other-user', 'hash', 'Other', 'BOSS', 1, 0, 0)`,
    ).run('user-other', 'other-clinic', now, now);
    await expect(auth.updateUser('user-other', {}, context)).rejects.toThrow('User not found');
    await expect(auth.resetPassword('user-other', 'password123', context)).rejects.toThrow('User not found');

    const replayHash = createHash('sha256').update('replay-token').digest('hex');
    db.prepare(
      'UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ? WHERE id = ?',
    ).run(replayHash, new Date(Date.now() + 86_400_000).toISOString(), 'user-admin-001');
    db.prepare('INSERT INTO UsedRefreshToken (tokenHash, userId, usedAt) VALUES (?, ?, ?)')
      .run(replayHash, 'user-admin-001', now);
    await expect(auth.refresh('replay-token')).rejects.toThrow('Invalid refresh token');
  });

  it('refuses to disable or demote the last active BOSS of a clinic', async () => {
    const auth = new AuthService(db);
    const t = new Date().toISOString();
    const clinicId = 'clinic-v2-last-boss';
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-LAST-BOSS', 'Last Boss Clinic', 1)`,
    ).run(clinicId, t, t);
    const insertUserAt = (id: string, username: string, role: string): void => {
      db.prepare(
        `INSERT INTO User (
           id, clinicId, createdAt, updatedAt, deletedAt,
           username, passwordHash, name, role, active, loginAttempts, tokenVersion
         ) VALUES (?, ?, ?, ?, NULL, ?, 'hash', ?, ?, 1, 0, 0)`,
      ).run(id, clinicId, t, t, username, id, role);
    };
    // 该诊所唯一的 BOSS：禁用或降级必须被拒绝。
    insertUserAt('user-last-boss', 'lastboss', 'BOSS');
    const loneContext: AppContext = { ...context, clinicId };
    await expect(auth.updateUser('user-last-boss', { active: false }, loneContext)).rejects.toThrow('最后一个管理员');
    await expect(auth.updateUser('user-last-boss', { role: 'DOCTOR' }, loneContext)).rejects.toThrow('最后一个管理员');
    // 增加第二个 BOSS 后，原 BOSS 可以被禁用（保护只针对最后一个）。
    insertUserAt('user-last-boss-2', 'lastboss2', 'BOSS');
    await expect(auth.updateUser('user-last-boss', { active: false }, loneContext)).resolves.toMatchObject({ id: 'user-last-boss' });
    // 非 BOSS 用户不受保护影响。
    insertUserAt('user-last-doctor', 'lastdoctor', 'DOCTOR');
    await expect(auth.updateUser('user-last-doctor', { active: false }, loneContext)).resolves.toMatchObject({ id: 'user-last-doctor' });
  });

  it('lists and edits cross-clinic users through UserClinic membership', async () => {
    const auth = new AuthService(db);
    const t = new Date().toISOString();
    const clinicB = 'clinic-v2-cross-b';
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-CROSS-B', 'Cross Clinic B', 1)`,
    ).run(clinicB, t, t);
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES ('user-admin-001', ?, 'BOSS', ?, ?, NULL)`,
    ).run(clinicB, t, t);
    const doctor = await auth.createUser({
      username: 'cross-doctor-b',
      password: 'password123',
      name: 'Cross Doctor B',
      role: 'DOCTOR',
      clinicIds: [clinicB],
    }, context);
    const clinicBContext: AppContext = { ...context, clinicId: clinicB };
    expect(auth.listDoctors(clinicBContext).some((entry) => entry.id === doctor.id)).toBe(true);
    const updated = await auth.updateUser(doctor.id, { name: 'Cross Doctor B Updated' }, clinicBContext);
    expect(updated.name).toBe('Cross Doctor B Updated');
    await expect(auth.resetPassword(doctor.id, 'newpassword123', clinicBContext)).resolves.toEqual({ id: doctor.id });
  });

  it('allows an admin to create another admin', async () => {
    const auth = new AuthService(db);
    const firstAdmin = await auth.createUser({
      username: 'first-admin',
      password: 'password123',
      name: 'First Admin',
      role: 'ADMIN',
    }, context);
    expect(firstAdmin.role).toBe('ADMIN');
    const adminContext: AppContext = { ...context, role: 'ADMIN', userId: firstAdmin.id };
    const secondAdmin = await auth.createUser({
      username: 'second-admin',
      password: 'password123',
      name: 'Second Admin',
      role: 'ADMIN',
    }, adminContext);
    expect(secondAdmin.role).toBe('ADMIN');
    const membership = db.prepare(
      'SELECT role FROM UserClinic WHERE userId = ? AND clinicId = ? AND deletedAt IS NULL',
    ).get(secondAdmin.id, context.clinicId) as { role: string } | undefined;
    expect(membership?.role).toBe('ADMIN');
    await expect(auth.createUser({
      username: 'forbidden-boss',
      password: 'password123',
      name: 'Forbidden Boss',
      role: 'BOSS',
    }, adminContext)).rejects.toThrow('管理员不能创建老板账号');
    await expect(auth.updateUser(context.userId, { name: 'Hacked' }, adminContext))
      .rejects.toThrow('管理员不能管理老板账号');
    await expect(auth.resetPassword(context.userId, 'newpassword123', adminContext))
      .rejects.toThrow('管理员不能管理老板账号');
    await expect(auth.deleteUser(context.userId, adminContext))
      .rejects.toThrow('管理员不能管理老板账号');
  });

  // ---- 边缘分支测试（自 services-edge.spec.ts 聚合文件迁移，相对顺序保留）----

  it('covers auth login, refresh, logout, me, and password branches', async () => {
    const auth = new AuthService(db);
    insertUser('edge-disabled', { active: 0 });
    await expect(auth.login('user-edge-disabled', 'v2-test-seed-password')).rejects.toThrow('disabled');
    insertUser('edge-locked', { lockedUntil: new Date(Date.now() + 60_000).toISOString() });
    await expect(auth.login('user-edge-locked', 'v2-test-seed-password')).rejects.toThrow('locked');
    insertUser('edge-lockout', { passwordHash: bcrypt.hashSync('correct', 10) });
    for (let i = 0; i < 5; i += 1) {
      await expect(auth.login('user-edge-lockout', 'wrong')).rejects.toThrow();
    }

    await expect(auth.refresh('')).rejects.toThrow('Refresh token is required');
    await expect(auth.refresh('unknown')).rejects.toThrow('Invalid refresh token');
    const session = await auth.login('admin', 'v2-test-seed-password');
    const tokenPayload: TokenPayload = {
      sub: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      tokenVersion: 0,
    };
    db.prepare('UPDATE User SET tokenVersion = 1 WHERE id = ?').run('user-admin-001');
    await expect(auth.me(tokenPayload)).rejects.toThrow('Token is no longer valid');
    db.prepare('UPDATE User SET tokenVersion = 0 WHERE id = ?').run('user-admin-001');
    await expect(auth.me(tokenPayload)).resolves.toMatchObject({ username: 'admin' });

    await expect(auth.getUserById('missing-user')).rejects.toThrow('User not found');
    await expect(auth.changePassword('missing-user', 'x', 'newpass123')).rejects.toThrow('User not found');
    await expect(auth.changePassword('user-admin-001', 'wrong', 'newpass123')).rejects.toThrow('Old password is incorrect');
    await expect(auth.changePassword('user-admin-001', 'v2-test-seed-password', 'short')).rejects.toThrow('at least 6');

    await auth.logout('');
    await auth.logout('unknown-token');
    await auth.logout(session.refreshToken);
    // 登出必须立即作废已签发 access token（tokenVersion + 1）。
    await expect(auth.me(tokenPayload)).rejects.toThrow('Token is no longer valid');

    await expect(auth.login('unknown-user', 'wrong')).rejects.toThrow('Invalid username or password');
    expect(() => auth.verifyToken('invalid-token')).toThrow('Invalid or expired token');

    insertUser('edge-refresh-disabled', { active: 0 });
    db.prepare('UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ? WHERE id = ?')
      .run(createHash('sha256').update('token-disabled').digest('hex'), new Date(Date.now() + 60_000).toISOString(), 'edge-refresh-disabled');
    await expect(auth.refresh('token-disabled')).rejects.toThrow('disabled');

    insertUser('edge-refresh-locked', { lockedUntil: new Date(Date.now() + 60_000).toISOString() });
    db.prepare('UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ? WHERE id = ?')
      .run(createHash('sha256').update('token-locked').digest('hex'), new Date(Date.now() + 60_000).toISOString(), 'edge-refresh-locked');
    await expect(auth.refresh('token-locked')).rejects.toThrow('locked');

    db.prepare('UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ? WHERE id = ?')
      .run(createHash('sha256').update('token-expired').digest('hex'), new Date(Date.now() - 60_000).toISOString(), 'user-admin-001');
    await expect(auth.refresh('token-expired')).rejects.toThrow('expired');

    insertUser('edge-null-clinic', {
      clinicId: null,
      loginAttempts: null,
      tokenVersion: null,
      passwordHash: bcrypt.hashSync('nullpass', 10),
    });
    // 无诊所作用域（clinicId NULL 且无 UserClinic 成员关系）的用户登录/刷新必须被拒绝。
    await expect(auth.login('user-edge-null-clinic', 'nullpass')).rejects.toThrow('No clinic scope assigned to this account');
    await expect(auth.login('user-edge-null-clinic', 'nullpass')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    // 无 clinicId 的 token 也必须 fail-closed，不能以“全诊所可见”作用域通过校验。
    expect(auth.isClinicAccessible('user-admin-001', null)).toBe(false);
    expect(auth.isClinicAccessible('user-admin-001', 'clinic-v2-001')).toBe(true);

    const mockAuthRepository = {
      findByUsername: () => ({
        id: 'mock-auth-user',
        clinicId: null,
        username: 'mock-auth',
        passwordHash: bcrypt.hashSync('mockpass', 10),
        name: 'Mock',
        role: 'BOSS',
        active: 1,
        loginAttempts: undefined,
        tokenVersion: undefined,
        createdAt: now,
        updatedAt: now,
      }),
      resetLoginAttempts: vi.fn(),
      updateRefreshToken: vi.fn(),
      clinicMemberships: () => [{ clinicId: 'clinic-v2-001', name: 'Clinic', role: 'BOSS' }],
    } as unknown as AuthRepository;
    const mockAuth = new AuthService({} as Database.Database, mockAuthRepository);
    const mockSession = await mockAuth.login('mock-auth', 'mockpass');
    expect(mockSession.user.clinicId).toBeNull();
    // 用户行本身无 clinicId 时，token 作用域来自 UserClinic 第一个成员关系。
    const mockPayload = mockAuth.verifyToken(mockSession.token);
    expect(mockPayload.clinicId).toBe('clinic-v2-001');
  });

  it('rejects self-deletion and unscoped clinic access', async () => {
    const auth = new AuthService(db);
    await expect(auth.deleteUser(context.userId, context)).rejects.toThrow('不能删除当前登录账号');
    expect(auth.isClinicAccessible('missing-user', 'clinic-v2-001')).toBe(false);
    expect(auth.isClinicAccessible('user-admin-001', 'clinic-other')).toBe(false);
  });

  it('does not store raw refresh tokens in idempotency claims', async () => {
    const auth = new AuthService(db);
    const session = await auth.login('admin', 'v2-test-seed-password');
    const refreshed = await auth.refresh(session.refreshToken);
    const claims = db.prepare(
      `SELECT responseJson FROM IdempotencyRecord
       WHERE operation = 'auth.refresh' AND status = 'COMPLETED'`,
    ).all() as Array<{ responseJson: string }>;
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(String(claim.responseJson)).not.toContain(refreshed.refreshToken);
      expect(String(claim.responseJson)).not.toContain(refreshed.token);
      expect(String(claim.responseJson).split('.')).toHaveLength(3);
    }
  });

  it('allows only BOSS to access multiple clinics and switch current clinic', async () => {
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-2', 'Clinic 2', 1)`,
    ).run('clinic-v2-other', now, now);
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES ('user-admin-001', 'clinic-v2-other', 'BOSS', ?, ?, NULL)`,
    ).run(now, now);
    const auth = new AuthService(db);
    expect(() => auth.listAccessibleClinics('missing-user', 'BOSS')).toThrow('User not found');
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-EMPTY', '', 1)`,
    ).run('clinic-v2-empty', now, now);
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES ('user-admin-001', 'clinic-v2-empty', 'BOSS', ?, ?, NULL)`,
    ).run(now, now);
    const boss = await auth.createUser({
      username: 'boss-multi',
      password: 'password123',
      name: 'Boss Multi',
      role: 'BOSS',
      clinicIds: ['clinic-v2-001', 'clinic-v2-other'],
    }, context);
    const accessible = auth.listAccessibleClinics(boss.id, 'BOSS');
    expect(accessible.clinics).toHaveLength(2);
    const emptyNameBoss = await auth.createUser({
      username: 'boss-empty-name',
      password: 'password123',
      name: 'Boss Empty Name',
      role: 'BOSS',
      clinicIds: ['clinic-v2-empty'],
    }, context);
    expect(auth.listAccessibleClinics(emptyNameBoss.id, 'BOSS').clinics.some((clinic) => clinic.name === 'clinic-v2-empty')).toBe(true);
    expect(() => auth.switchClinic('missing-user', 'BOSS', 'clinic-v2-001')).toThrow('User not found');
    expect(() => auth.switchClinic(boss.id, 'BOSS', 'clinic-v2-missing')).toThrow('Clinic not found');
    const switched = auth.switchClinic(boss.id, 'BOSS', 'clinic-v2-other');
    expect(switched.clinicId).toBe('clinic-v2-other');
    expect((await auth.getUserById(boss.id)).currentClinicId).toBe('clinic-v2-other');
    db.prepare('DELETE FROM UserClinic WHERE userId = ?').run(boss.id);
    expect(auth.listAccessibleClinics(boss.id, 'BOSS').clinics).toHaveLength(1);
    await expect(auth.createUser({
      username: 'boss-bad-clinics',
      password: 'password123',
      name: 'Bad Clinics',
      role: 'BOSS',
      clinicIds: 'clinic-v2-001' as unknown as string[],
    }, context)).rejects.toThrow('clinicIds must be an array of strings');
    await expect(auth.createUser({
      username: 'boss-missing-clinic',
      password: 'password123',
      name: 'Missing Clinic',
      role: 'BOSS',
      clinicIds: ['clinic-v2-missing'],
    }, context)).rejects.toThrow('Cannot create users outside your clinic scope');
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-v2-disabled', NULL, ?, ?, NULL, 'V2-DISABLED', 'Disabled Clinic', 0)`,
    ).run(now, now);
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, 'clinic-v2-disabled', 'BOSS', ?, ?, NULL)`,
    ).run(boss.id, now, now);
    expect(() => auth.switchClinic(boss.id, 'BOSS', 'clinic-v2-disabled')).toThrow('Clinic not found');

    const nurse = await auth.createUser({
      username: 'nurse-single',
      password: 'password123',
      name: 'Nurse Single',
      role: 'DOCTOR',
      clinicIds: ['clinic-v2-other'],
    }, { ...context, clinicId: 'clinic-v2-001' });
    expect(auth.listAccessibleClinics(nurse.id, 'DOCTOR').clinics).toHaveLength(1);
    expect(() => auth.switchClinic(nurse.id, 'DOCTOR', 'clinic-v2-other')).toThrow('Only administrators can switch clinics');

    const bossNull = await auth.createUser({
      username: 'boss-null-clinic',
      password: 'password123',
      name: 'Boss Null Clinic',
      role: 'ADMIN',
    }, { ...context, clinicId: null });
    const nurseNull = await auth.createUser({
      username: 'nurse-null-clinic',
      password: 'password123',
      name: 'Nurse Null Clinic',
      role: 'DOCTOR',
    }, { ...context, clinicId: null });
    expect(auth.listAccessibleClinics(bossNull.id, 'BOSS').clinics).toEqual([]);
    expect(auth.listAccessibleClinics(nurseNull.id, 'DOCTOR')).toEqual({
      currentClinicId: null,
      clinics: [],
    });
  });

  it('lists active doctors scoped to the current clinic', async () => {
    const auth = new AuthService(db);
    const doctor = await auth.createUser({
      username: 'doctor-list-a',
      password: 'password123',
      name: 'Doctor A',
      role: 'DOCTOR',
    }, context);
    const disabledDoctor = await auth.createUser({
      username: 'doctor-list-disabled',
      password: 'password123',
      name: 'Disabled Doctor',
      role: 'DOCTOR',
      active: false,
    }, context);

    const doctors = auth.listDoctors(context);
    expect(doctors.some((entry) => entry.id === doctor.id)).toBe(true);
    expect(doctors.some((entry) => entry.id === disabledDoctor.id)).toBe(false);
  });
});
