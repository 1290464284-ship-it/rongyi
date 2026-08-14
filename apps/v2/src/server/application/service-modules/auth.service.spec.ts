// AuthService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AuthService } from './auth.service';
import type { AuthRepository } from '../ports';
import type { AppContext } from '../../../domain/contracts';

describe('AuthService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

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

  it('rotates refresh tokens and rejects reused tokens', async () => {
    const service = new AuthService(db);
    const session = await service.login('admin', 'v2-test-seed-password');
    expect(session.refreshToken).toBeDefined();
    const refreshed = await service.refresh(session.refreshToken);
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);
    // B-M9：轮换成功后旧 token 进入 5 秒窗口缓存（并发刷新共享同一新会话），
    // 窗口内重复 refresh 返回同一会话；窗口过后重放才触发 RFC 6819 吊销。
    const replayed = await service.refresh(session.refreshToken);
    expect(replayed.refreshToken).toBe(refreshed.refreshToken);
    await new Promise((resolve) => setTimeout(resolve, 5100));
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
});
