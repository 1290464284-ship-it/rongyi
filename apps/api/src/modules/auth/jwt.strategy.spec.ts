import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let config: { get: jest.Mock };
  let auth: { validateById: jest.Mock };

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret-key';
        return;
      }),
    };
    auth = {
      validateById: jest.fn(),
    };

    strategy = new JwtStrategy(config as any, auth as any);
  });

  describe('validate', () => {
    it('验证有效用户返回用户信息（含 clinicId 来自 payload）', async () => {
      const payload = { sub: 'u-1', tv: 1, cid: 'clinic-from-token' };
      const user = { id: 'u-1', username: 'admin', name: '管理员', clinicId: 'user-clinic' };
      auth.validateById.mockResolvedValue(user);

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        ...user,
        clinicId: 'clinic-from-token',
      });
      expect(auth.validateById).toHaveBeenCalledWith('u-1', 1);
    });

    it('payload 中无 cid 时使用 user.clinicId', async () => {
      const payload = { sub: 'u-1', tv: 0 };
      const user = { id: 'u-1', username: 'admin', clinicId: 'user-clinic' };
      auth.validateById.mockResolvedValue(user);

      const result = await strategy.validate(payload);

      expect(result.clinicId).toBe('user-clinic');
    });

    it('用户不存在时抛出 UnauthorizedException', async () => {
      const payload = { sub: 'non-existent', tv: 0 };
      auth.validateById.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('用户验证返回 undefined 时抛出 UnauthorizedException', async () => {
      const payload = { sub: 'u-1', tv: 0 };
      auth.validateById.mockResolvedValue(undefined);

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('tokenVersion 不匹配时 validateById 返回 null 并抛出 UnauthorizedException', async () => {
      const payload = { sub: 'u-1', tv: 5 };
      auth.validateById.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      expect(auth.validateById).toHaveBeenCalledWith('u-1', 5);
    });
  });

  describe('构造函数配置', () => {
    it('从 ConfigService 读取 JWT_SECRET', () => {
      expect(config.get).toHaveBeenCalledWith('JWT_SECRET');
    });
  });
});
