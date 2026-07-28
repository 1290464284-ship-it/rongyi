import { AuthService } from './auth.service';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { MockDbService, MockDbRow } from '../../db/__mocks__/db-service.mock';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { CacheService } from '../../common/services/cache.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';

// P4-1: AuthService 现在依赖 CacheService，构造一个始终 miss 的 mock，
// 使原有测试继续走 DB 路径，避免缓存干扰测试断言。
function createMockCacheService(): CacheService {
  return {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn(),
    clear: jest.fn(),
    getOrSet: jest.fn(),
    getStats: () => ({ hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 1000 }),
    resetStats: jest.fn(),
  } as unknown as CacheService;
}

describe('AuthService', () => {
  let service: AuthService;
  let db: MockDbService;
  let jwt: JwtService;
  let config: ConfigService;
  let clinicContext: ClinicContextService;
  let cache: CacheService;
  let auditLog: AuditLogService;

  beforeEach(() => {
    db = new MockDbService();
    (db as any).tables.set('AuditLog', new Map());

    jwt = {
      sign: jest.fn((payload) => `mock-jwt-token-${payload.sub || 'unknown'}`),
    } as unknown as JwtService;

    config = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret-key';
        if (key === 'BCRYPT_ROUNDS') return '4';
        return;
      }),
    } as unknown as ConfigService;

    clinicContext = {
      getClinicId: jest.fn(() => 'test-clinic-id'),
      getUserId: jest.fn(() => 'test-user-id'),
    } as unknown as ClinicContextService;

    cache = createMockCacheService();
    auditLog = {
      logAudit: jest.fn((db: { prepare: jest.Mock }, type: string, targetId: string, targetType: string, clinicId: string | null, options?: Record<string, unknown>) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const beforeData = options?.beforeData !== undefined ? JSON.stringify(options.beforeData) : null;
        const afterData = options?.afterData !== undefined ? JSON.stringify(options.afterData) : null;
        db.prepare(
          `INSERT INTO AuditLog (id, type, targetId, targetType, beforeData, afterData, remark, clinicId, createdAt, operatorId, operatorName, amount, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, type, targetId, targetType, beforeData, afterData, options?.remark || null, clinicId, now, options?.operatorId || null, options?.operatorName || null, options?.amount || null, options?.ip || null);
      }),
    } as unknown as AuditLogService;
    service = new AuthService(db as any, jwt, config, clinicContext, cache, auditLog);
  });

  afterEach(() => {
    db.clear();
  });

  interface TestUser {
    id: string;
    username: string;
    passwordHash: string;
    name: unknown;
    role: unknown;
    clinicId: unknown;
    active: unknown;
    loginAttempts: unknown;
    lockedUntil: unknown;
    tokenVersion: unknown;
    refreshToken: unknown;
    refreshTokenExpiresAt: unknown;
    phone: unknown;
    isTempPassword: unknown;
    passwordChangedAt: unknown;
    createdAt: string;
    updatedAt: string;
  }

  function createUser(overrides: Record<string, unknown> = {}): TestUser {
    const id = (overrides.id as string) || crypto.randomUUID();
    const username = (overrides.username as string) || 'testuser';
    const passwordHash = (overrides.passwordHash as string) || bcrypt.hashSync('password123', 4);
    return {
      id,
      username,
      passwordHash,
      name: overrides.name || '测试用户',
      role: overrides.role || 'DOCTOR',
      clinicId: overrides.clinicId || 'clinic-001',
      active: overrides.active !== undefined ? overrides.active : 1,
      loginAttempts: overrides.loginAttempts || 0,
      lockedUntil: overrides.lockedUntil || null,
      tokenVersion: overrides.tokenVersion || 0,
      refreshToken: overrides.refreshToken || null,
      refreshTokenExpiresAt: overrides.refreshTokenExpiresAt || null,
      phone: overrides.phone || null,
      isTempPassword: overrides.isTempPassword !== undefined ? overrides.isTempPassword : 0,
      passwordChangedAt: overrides.passwordChangedAt !== undefined ? (overrides.passwordChangedAt as string) : new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  describe('login - 登录', () => {
    it('登录成功，返回 access_token 和 refresh_token', async () => {
      const user = createUser({ username: 'doctor01' });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      const result = await service.login({ username: 'doctor01', password: 'password123' });

      expect(result).toBeDefined();
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user.username).toBe('doctor01');
    });

    it('密码错误时抛出 UnauthorizedException', async () => {
      const user = createUser({ username: 'user1' });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      await expect(service.login({ username: 'user1', password: 'wrongpassword' })).rejects.toThrow(UnauthorizedException);
    });

    it('用户名不存在时抛出 UnauthorizedException', async () => {
       
      await expect(service.login({ username: 'nonexistent', password: 'password123' })).rejects.toThrow(UnauthorizedException);
    });

    it('禁用的用户无法登录', async () => {
      const user = createUser({ username: 'disabled', active: 0 });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      await expect(service.login({ username: 'disabled', password: 'password123' })).rejects.toThrow(UnauthorizedException);
    });

    it('密码哈希格式不正确时拒绝登录', async () => {
       
      const user = createUser({ username: 'badhash', passwordHash: 'not-a-bcrypt-hash' });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      await expect(service.login({ username: 'badhash', password: 'password123' })).rejects.toThrow(UnauthorizedException);
    });

    it('4位PIN密码登录时 needChangePassword 为 true', async () => {
       
      const pinHash = bcrypt.hashSync('1234', 4);
      const user = createUser({ username: 'pinuser', passwordHash: pinHash });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      const result = await service.login({ username: 'pinuser', password: '1234' });

      expect(result.needChangePassword).toBe(true);
    });

    it('临时密码登录时 needChangePassword 为 true', async () => {
      const user = createUser({ username: 'tempuser', isTempPassword: 1 });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      const result = await service.login({ username: 'tempuser', password: 'password123' });

      expect(result.needChangePassword).toBe(true);
    });

    it('正常密码登录时 needChangePassword 为 false', async () => {
      const user = createUser({ username: 'normaluser', isTempPassword: 0 });
      db.seed('User', [user] as unknown as MockDbRow[]);

      
      const result = await service.login({ username: 'normaluser', password: 'password123' });

      expect(result.needChangePassword).toBe(false);
    });

    it('首次登录（passwordChangedAt 为 null）时 needChangePassword 为 true', async () => {
      const user = createUser({ username: 'firstloginuser', passwordChangedAt: null });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const result = await service.login({ username: 'firstloginuser', password: 'password123' });

      expect(result.needChangePassword).toBe(true);
    });

    it('登录成功后写入审计日志 AuditLog', async () => {
      const user = createUser({ username: 'audituser' });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      await service.login({ username: 'audituser', password: 'password123' });

      const auditLogs = db.getTableData('AuditLog');
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].type).toBe('LOGIN');
      expect(auditLogs[0].targetId).toBe(user.id);
      expect(auditLogs[0].targetType).toBe('User');
    });

    it('登录成功后写入 refreshToken 到 User 表', async () => {
      const user = createUser({ username: 'refreshtokenuser' });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      const result = await service.login({ username: 'refreshtokenuser', password: 'password123' });

      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'refreshtokenuser');
      expect(updatedUser?.refreshToken).toBeTruthy();
      expect(updatedUser?.refreshTokenExpiresAt).toBeTruthy();
      expect(typeof result.refresh_token).toBe('string');
      expect(result.refresh_token.length).toBeGreaterThan(0);
    });
  });

  describe('登录次数限制', () => {
    it('连续失败 5 次后锁定账户 30 分钟', async () => {
      const user = createUser({ username: 'locktest', loginAttempts: 0 });
      db.seed('User', [user] as unknown as MockDbRow[]);

      for (let i = 0; i < 5; i++) {
        try {
          await service.login({ username: 'locktest', password: 'wrong' });
        } catch {
          // 预期的异常
        }
      }

      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'locktest');
      expect(updatedUser?.loginAttempts).toBe(5);
      expect(updatedUser?.lockedUntil).toBeTruthy();
    });

    it('锁定期间即使用正确密码也无法登录', async () => {
      const lockedUser = createUser({
        username: 'locked',
        loginAttempts: 5,
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      });
      db.seed('User', [lockedUser] as unknown as MockDbRow[]);

       
      await expect(service.login({ username: 'locked', password: 'password123' })).rejects.toThrow(UnauthorizedException);
    });

    it('登录成功后重置登录尝试次数', async () => {
      const user = createUser({ username: 'resettest', loginAttempts: 3 });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      await service.login({ username: 'resettest', password: 'password123' });

      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'resettest');
      expect(updatedUser?.loginAttempts).toBe(0);
    });

    it('第4次失败时只增加 loginAttempts，不锁定账户', async () => {
      const user = createUser({ username: 'attempt4', loginAttempts: 0 });
      db.seed('User', [user] as unknown as MockDbRow[]);

      for (let i = 0; i < 4; i++) {
        try {
          await service.login({ username: 'attempt4', password: 'wrong' });
        } catch {
          // 预期的异常
        }
      }

      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'attempt4');
      expect(updatedUser?.loginAttempts).toBe(4);
      expect(updatedUser?.lockedUntil).toBeNull();
    });
  });

  describe('changePassword - 修改密码', () => {
    it('正常修改密码', async () => {
      const user = createUser({ username: 'changepw' });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      const result = await service.changePassword(user.id, {
        oldPassword: 'password123',
        newPassword: 'newpassword456',
      });
       

      expect(result.success).toBe(true);
    });

    it('旧密码错误时抛出 BusinessValidationException', async () => {
      const user = createUser({ username: 'wrongoldpw' });
      db.seed('User', [user] as unknown as MockDbRow[]);

      await expect(
        service.changePassword(user.id, { oldPassword: 'wrong', newPassword: 'newpass' })
      ).rejects.toThrow(BusinessValidationException);
    });

    it('新旧密码相同时抛出 BusinessValidationException', async () => {
      const user = createUser({ username: 'samepw' });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      await expect(
        service.changePassword(user.id, { oldPassword: 'password123', newPassword: 'password123' })
      ).rejects.toThrow(BusinessValidationException);
       
    });

    it('用户不存在时抛出 BusinessNotFoundException', async () => {
      await expect(
        service.changePassword('non-existent-id', { oldPassword: 'a', newPassword: 'b' })
      ).rejects.toThrow(BusinessNotFoundException);
    });

    it('禁用的用户无法修改密码', async () => {
      const user = createUser({ username: 'disableduser', active: 0 });
      db.seed('User', [user] as unknown as MockDbRow[]);

       
      await expect(
        service.changePassword(user.id, { oldPassword: 'password123', newPassword: 'newpass' })
      ).rejects.toThrow(BusinessNotFoundException);
       
    });
  });

  describe('refreshToken - 刷新令牌', () => {
    it('使用有效的 refresh token 成功刷新', async () => {
      const refreshToken = crypto.randomBytes(48).toString('hex');
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const user = createUser({
        username: 'refreshtest',
        refreshToken: refreshTokenHash,
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const result = await service.refreshToken(refreshToken);

      expect(result).toBeDefined();
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
      expect(result.refresh_token).not.toBe(refreshToken);

      const usedTokens = db.getTableData('UsedRefreshToken');
      expect(usedTokens.length).toBe(1);
    });

    it('过期的 refresh token 抛出 UnauthorizedException', async () => {
      const refreshToken = crypto.randomBytes(48).toString('hex');
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const user = createUser({
        username: 'expiredtoken',
        refreshToken: refreshTokenHash,
        refreshTokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      });
      db.seed('User', [user] as unknown as MockDbRow[]);

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('无效的 refresh token 抛出 UnauthorizedException', async () => {
      const user = createUser({ username: 'invalidtoken' });
      db.seed('User', [user] as unknown as MockDbRow[]);

      await expect(service.refreshToken('invalid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('重复使用 refresh token 应检测并重放攻击，吊销所有会话', async () => {
      const refreshToken = crypto.randomBytes(48).toString('hex');
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const user = createUser({
        username: 'reuseattack',
        refreshToken: refreshTokenHash,
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      db.seed('User', [user] as unknown as MockDbRow[]);

      await service.refreshToken(refreshToken);

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(UnauthorizedException);

      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'reuseattack');
      expect(updatedUser?.tokenVersion).toBeGreaterThan(0);
    });
  });

  describe('validateById - 根据 ID 验证用户', () => {
    it('验证存在且活跃的用户', async () => {
      const user = createUser({ username: 'validuser', tokenVersion: 2 });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const result = await service.validateById(user.id, 2);

      expect(result).toBeTruthy();
      expect(result?.username).toBe('validuser');
    });

    it('tokenVersion 不匹配时返回 null', async () => {
      const user = createUser({ username: 'versionmismatch', tokenVersion: 3 });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const result = await service.validateById(user.id, 1);

      expect(result).toBeNull();
    });

    it('用户不存在时返回 null', async () => {
      const result = await service.validateById('non-existent');

      expect(result).toBeNull();
    });

    it('禁用的用户返回 null', async () => {
      const user = createUser({ username: 'disabledval', active: 0 });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const result = await service.validateById(user.id);

      expect(result).toBeNull();
    });
  });

  describe('logout - 登出', () => {
    it('登出时递增 tokenVersion 并清除 refresh token', async () => {
      const user = createUser({ username: 'logouttest', tokenVersion: 1 });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const result = await service.logout(user.id);

      expect(result.success).toBe(true);

      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'logouttest');
      expect(updatedUser?.tokenVersion).toBe(2);
      expect(updatedUser?.refreshToken).toBeNull();
    });

    it('不传 userId 时也返回成功', async () => {
      const result = await service.logout();

      expect(result.success).toBe(true);
    });
  });

  describe('createUser - 创建用户', () => {
    it('正常创建用户', async () => {
       
      const result = await service.createUser({
        username: 'newuser',
        password: 'password123',
        name: '新用户',
        role: 'DOCTOR',
        phone: '13800138000',
      });
       

      expect(result).toBeDefined();
      expect((result as any).username).toBe('newuser');

      const users = db.getTableData('User');
      expect(users.length).toBe(1);
    });

    it('用户名已存在时抛出 BusinessValidationException', async () => {
      const user = createUser({ username: 'existing' });
      db.seed('User', [user] as unknown as MockDbRow[]);

      await expect(
        service.createUser({
          username: 'existing',
          password: 'password',
          name: 'Existing',
          role: 'DOCTOR',
        })
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('deleteUser - 删除用户（软删除）', () => {
    it('正常软删除用户', async () => {
      const user = createUser({ username: 'deleteuser', role: 'DOCTOR', clinicId: 'test-clinic-id' });
      db.seed('User', [user] as unknown as MockDbRow[]);

      await service.deleteUser(user.id);

      // Verify user is now inactive
      const users = db.getTableData('User');
      const deleted = users.find(u => u.username === 'deleteuser');
      expect(deleted?.active).toBe(0);
    });

    it('不能删除 BOSS 角色的账户', async () => {
      const boss = createUser({ username: 'boss', role: 'BOSS' });
      db.seed('User', [boss] as unknown as MockDbRow[]);

      await expect(service.deleteUser(boss.id)).rejects.toThrow(BusinessValidationException);
    });

    it('删除不存在的用户抛出 BusinessNotFoundException', async () => {
      await expect(service.deleteUser('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('listUsers - 用户列表', () => {
    it('返回分页的用户列表结构', async () => {
      const user1 = createUser({ username: 'user1', clinicId: 'test-clinic-id', role: 'DOCTOR' });
      const user2 = createUser({ username: 'user2', clinicId: 'test-clinic-id', role: 'NURSE' });
      db.seed('User', [user1, user2] as unknown as MockDbRow[]);

      const result = await service.listUsers();

      expect(result).toBeDefined();
      expect((result as any).items).toBeDefined();
      expect((result as any).total).toBeDefined();
      expect((result as any).page).toBe(1);
      expect((result as any).pageSize).toBe(100);
      expect(Array.isArray((result as any).items)).toBe(true);
    });

    it('按 role 过滤用户列表', async () => {
      const user1 = createUser({ username: 'doctor1', clinicId: 'test-clinic-id', role: 'DOCTOR' });
      const user2 = createUser({ username: 'nurse1', clinicId: 'test-clinic-id', role: 'NURSE' });
      const user3 = createUser({ username: 'doctor2', clinicId: 'test-clinic-id', role: 'DOCTOR' });
      db.seed('User', [user1, user2, user3] as unknown as MockDbRow[]);

      const result = await service.listUsers('DOCTOR');

      expect((result as any).items).toBeDefined();
      (result as any).items.forEach((item: any) => {
        expect(item.role).toBe('DOCTOR');
      });
    });

    it('分页查询失败时回退到简单查询', async () => {
      const user1 = createUser({ username: 'fallback1', clinicId: 'test-clinic-id', role: 'DOCTOR' });
      db.seed('User', [user1] as unknown as MockDbRow[]);

      const originalPrepare = db.prepare.bind(db);
      let callCount = 0;
      db.prepare = jest.fn((sql: string) => {
        const upperSql = sql.trim().toUpperCase();
        if (upperSql.startsWith('SELECT COUNT') && callCount === 0) {
          callCount++;
          throw new Error('Simulated count query failure');
        }
        return originalPrepare(sql);
      });

      const result = await service.listUsers();

      expect(Array.isArray(result)).toBe(true);
      expect((result as any[]).length).toBeGreaterThan(0);
      expect((result as any[])[0].username).toBe('fallback1');

      db.prepare = originalPrepare;
    });
  });

  describe('updateUser - 更新用户', () => {
    it('正常更新用户姓名、角色和电话', async () => {
      const user = createUser({ username: 'updateuser', clinicId: 'test-clinic-id' });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const result = await service.updateUser(user.id, {
        name: '新姓名',
        role: 'NURSE',
        phone: '13900139000',
      });

      expect(result).toBeDefined();
      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'updateuser');
      expect(updatedUser?.name).toBe('新姓名');
      expect(updatedUser?.role).toBe('NURSE');
      expect(updatedUser?.phone).toBe('13900139000');
    });

    it('部分字段更新只修改指定字段', async () => {
      const user = createUser({ username: 'partialupdate', clinicId: 'test-clinic-id', name: '原名', role: 'DOCTOR', phone: '13800138000' });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const result = await service.updateUser(user.id, {
        name: '新名字',
      });

      expect(result).toBeDefined();
      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'partialupdate');
      expect(updatedUser?.name).toBe('新名字');
      expect(updatedUser?.role).toBe('DOCTOR');
      expect(updatedUser?.phone).toBe('13800138000');
    });

    it('用户不存在时抛出 BusinessNotFoundException', async () => {
      await expect(
        service.updateUser('non-existent-id', { name: '测试' })
      ).rejects.toThrow(BusinessNotFoundException);
    });

    it('可以更新 active 字段', async () => {
      const user = createUser({ username: 'activeuser', clinicId: 'test-clinic-id', active: 1 });
      db.seed('User', [user] as unknown as MockDbRow[]);

      await service.updateUser(user.id, { active: 0 });

      const users = db.getTableData('User');
      const updatedUser = users.find(u => u.username === 'activeuser');
      expect(updatedUser?.active).toBe(0);
    });

    it('更新用户后写入审计日志', async () => {
      const user = createUser({ username: 'auditupdate', clinicId: 'test-clinic-id' });
      db.seed('User', [user] as unknown as MockDbRow[]);

      await service.updateUser(user.id, { name: '更新后' });

      const auditLogs = db.getTableData('AuditLog');
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].type).toBe('USER_UPDATE');
      expect(auditLogs[0].targetId).toBe(user.id);
      expect(auditLogs[0].targetType).toBe('User');
    });
  });

  describe('bcryptRounds - bcrypt 轮数配置', () => {
    it('使用配置的 BCRYPT_ROUNDS 值', () => {
      const customConfig = {
        get: jest.fn((key: string) => {
          if (key === 'JWT_SECRET') return 'test-secret-key';
          if (key === 'BCRYPT_ROUNDS') return '8';
          return;
        }),
      } as unknown as ConfigService;

      const customService = new AuthService(db as any, jwt, customConfig, clinicContext, cache, auditLog);

      const rounds = (customService as any).bcryptRounds;
      expect(rounds).toBe(8);
    });

    it('BCRYPT_ROUNDS 小于 8 时使用 8', () => {
      const customConfig = {
        get: jest.fn((key: string) => {
          if (key === 'JWT_SECRET') return 'test-secret-key';
          if (key === 'BCRYPT_ROUNDS') return '2';
          return;
        }),
      } as unknown as ConfigService;

      const customService = new AuthService(db as any, jwt, customConfig, clinicContext, cache, auditLog);

      const rounds = (customService as any).bcryptRounds;
      expect(rounds).toBe(8);
    });

    it('BCRYPT_ROUNDS 大于 15 时使用 15', () => {
      const customConfig = {
        get: jest.fn((key: string) => {
          if (key === 'JWT_SECRET') return 'test-secret-key';
          if (key === 'BCRYPT_ROUNDS') return '20';
          return;
        }),
      } as unknown as ConfigService;

      const customService = new AuthService(db as any, jwt, customConfig, clinicContext, cache, auditLog);

      const rounds = (customService as any).bcryptRounds;
      expect(rounds).toBe(15);
    });

    it('未配置 BCRYPT_ROUNDS 时使用默认值 10', () => {
      const customConfig = {
        get: jest.fn((_key: string) => {
          return;
        }),
      } as unknown as ConfigService;

      const customService = new AuthService(db as any, jwt, customConfig, clinicContext, cache, auditLog);

      const rounds = (customService as any).bcryptRounds;
      expect(rounds).toBe(10);
    });
  });

  describe('onModuleInit / onModuleDestroy - 生命周期', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('onModuleInit 启动时执行清理逻辑', () => {
      const prepareSpy = jest.spyOn(db, 'prepare');

      service.onModuleInit();

      jest.runAllTicks();

      const deleteCalls = prepareSpy.mock.calls.filter(call =>
        call[0].toUpperCase().startsWith('DELETE FROM USEDREFRESHTOKEN')
      );
      expect(deleteCalls.length).toBeGreaterThan(0);

      service.onModuleDestroy();
      prepareSpy.mockRestore();
    });

    it('onModuleDestroy 清除定时器', () => {
      const spy = jest.spyOn(globalThis, 'clearInterval');

      service.onModuleInit();
      service.onModuleDestroy();

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('refreshToken - 刷新令牌补充测试', () => {
    it('刷新事务内不执行 UsedRefreshToken 清理（由定时器统一负责）', async () => {
      const oldUsedToken = {
        id: 'old-used-1',
        tokenHash: 'old-used-hash',
        userId: 'user-1',
        usedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
      };
      db.seed('UsedRefreshToken', [oldUsedToken]);

      const refreshToken = crypto.randomBytes(48).toString('hex');
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const user = createUser({
        username: 'cleanuptest',
        refreshToken: refreshTokenHash,
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        clinicId: 'test-clinic-id',
      });
      db.seed('User', [user] as unknown as MockDbRow[]);

      const prepareSpy = jest.spyOn(db, 'prepare');

      const result = await service.refreshToken(refreshToken);

      // 刷新本身成功
      expect(result.access_token).toBeDefined();

      // 清理已移交给 onModuleInit 定时器（cleanupUsedRefreshTokens），
      // 刷新事务内不应再执行 DELETE FROM UsedRefreshToken
      const deleteCalls = prepareSpy.mock.calls.filter(call =>
        call[0].toUpperCase().startsWith('DELETE FROM USEDREFRESHTOKEN')
      );
      expect(deleteCalls.length).toBe(0);

      prepareSpy.mockRestore();
    });
  });
});
