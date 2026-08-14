// AuthService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
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
});
