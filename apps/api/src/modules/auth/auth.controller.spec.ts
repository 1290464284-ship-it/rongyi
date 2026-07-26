import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let auth: { [key: string]: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    auth = {
      login: jest.fn(),
      refreshToken: jest.fn(),
      logout: jest.fn(),
      listUsers: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
      changePassword: jest.fn(),
    };

    res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();

    controller = module.get(AuthController);
  });

  describe('login', () => {
    it('登录成功设置 cookies 并返回用户信息', async () => {
      const dto = { username: 'admin', password: '0801' };
      const loginResult = {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
        user: { id: 'u-1', username: 'admin', name: '管理员' },
        needChangePassword: false,
      };
      auth.login.mockResolvedValue(loginResult);

      const result = await controller.login(dto, res as any);

      expect(result).toEqual({
        user: loginResult.user,
        needChangePassword: false,
      });
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'access-token-123',
        expect.objectContaining({ httpOnly: true, maxAge: 3600 * 1000 }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token-456',
        expect.objectContaining({ httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 }),
      );
      expect(auth.login).toHaveBeenCalledWith(dto);
    });

    it('登录需要修改密码时 needChangePassword 为 true', async () => {
      const dto = { username: 'user', password: '1234' };
      auth.login.mockResolvedValue({
        access_token: 'at',
        refresh_token: 'rt',
        user: { id: 'u-2', username: 'user' },
        needChangePassword: true,
      });

      const result = await controller.login(dto, res as any);

      expect(result.needChangePassword).toBe(true);
    });
  });

  describe('refresh', () => {
    it('使用 cookie 中的 refresh_token 刷新', async () => {
      const req = { cookies: { refresh_token: 'cookie-token' } } as any;
      auth.refreshToken.mockResolvedValue({
        access_token: 'new-at',
        refresh_token: 'new-rt',
      });

      const result = await controller.refresh(req, undefined, res as any);

      expect(result).toEqual({ ok: true });
      expect(auth.refreshToken).toHaveBeenCalledWith('cookie-token');
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'new-at',
        expect.any(Object),
      );
    });

    it('使用 body 中的 refreshToken 刷新（cookie 不存在时）', async () => {
      const req = { cookies: {} } as any;
      auth.refreshToken.mockResolvedValue({
        access_token: 'new-at',
        refresh_token: 'new-rt',
      });

      const result = await controller.refresh(req, 'body-token', res as any);

      expect(result).toEqual({ ok: true });
      expect(auth.refreshToken).toHaveBeenCalledWith('body-token');
    });

    it('未提供 refreshToken 时抛出 BadRequestException', async () => {
      const req = { cookies: {} } as any;

      await expect(
        controller.refresh(req, undefined as any, res as any),
      ).rejects.toThrow(BadRequestException);
      expect(auth.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('返回当前用户信息', () => {
      const user = { id: 'u-1', username: 'admin', name: '管理员', role: 'BOSS' };

      const result = controller.me(user);

      expect(result).toEqual(user);
    });
  });

  describe('logout', () => {
    it('登出并清除 cookies', async () => {
      const user = { id: 'u-1', username: 'admin' };
      auth.logout.mockResolvedValue({ success: true });

      const result = await controller.logout(user as any, res as any);

      expect(result).toEqual({ success: true });
      expect(auth.logout).toHaveBeenCalledWith('u-1');
      expect(res.clearCookie).toHaveBeenCalledWith('access_token', expect.any(Object));
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    });
  });

  describe('listUsers', () => {
    it('不带 role 参数调用 listUsers', async () => {
      const expected = [{ id: 'u-1', username: 'admin' }];
      auth.listUsers.mockResolvedValue(expected);

      const result = await controller.listUsers();
      expect(result).toEqual(expected);
      expect(auth.listUsers).toHaveBeenCalledWith(undefined);
    });

    it('带 role 参数调用 listUsers', async () => {
      const expected = [{ id: 'u-2', username: 'doctor', role: 'DOCTOR' }];
      auth.listUsers.mockResolvedValue(expected);

      const result = await controller.listUsers('DOCTOR');
      expect(result).toEqual(expected);
      expect(auth.listUsers).toHaveBeenCalledWith('DOCTOR');
    });
  });

  describe('createUser', () => {
    it('调用 auth.createUser 传入 dto', async () => {
      const dto = {
        username: 'newuser',
         
        password: 'password123',
        name: '新用户',
        role: 'DOCTOR',
        phone: '13800138000',
      };
      const expected = { id: 'u-3', ...dto, password: undefined };
      auth.createUser.mockResolvedValue(expected);

      const result = await controller.createUser(dto as any);
      expect(result).toEqual(expected);
      expect(auth.createUser).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateUser', () => {
    it('更新基本字段（name, role, phone）', async () => {
      const dto = { name: '更新名', role: 'NURSE', phone: '13900139000' };
      const expected = { id: 'u-1', name: '更新名' };
      auth.updateUser.mockResolvedValue(expected);

      const result = await controller.updateUser('u-1', dto as any);
      expect(result).toEqual(expected);
      expect(auth.updateUser).toHaveBeenCalledWith('u-1', {
        name: '更新名',
        role: 'NURSE',
        phone: '13900139000',
      });
    });

    it('active 字段为 true 时转换为 1', async () => {
      const dto = { active: true };
      auth.updateUser.mockResolvedValue({ id: 'u-1', active: 1 });

      await controller.updateUser('u-1', dto);
      expect(auth.updateUser).toHaveBeenCalledWith('u-1', expect.objectContaining({ active: 1 }));
    });

    it('active 字段为 false 时转换为 0', async () => {
      const dto = { active: false };
      auth.updateUser.mockResolvedValue({ id: 'u-1', active: 0 });

      await controller.updateUser('u-1', dto);
      expect(auth.updateUser).toHaveBeenCalledWith('u-1', expect.objectContaining({ active: 0 }));
    });

    it('未传 active 字段时 updates 中不包含 active', async () => {
      const dto = { name: '只更新名字' };
      auth.updateUser.mockResolvedValue({ id: 'u-1' });

      await controller.updateUser('u-1', dto);
      const callArgs = auth.updateUser.mock.calls[0][1];
      expect(callArgs.active).toBeUndefined();
      expect(callArgs.name).toBe('只更新名字');
    });
  });

  describe('deleteUser', () => {
    it('调用 auth.deleteUser 传入 id', async () => {
      const expected = { success: true };
      auth.deleteUser.mockResolvedValue(expected);

      const result = await controller.deleteUser('u-1');
      expect(result).toEqual(expected);
      expect(auth.deleteUser).toHaveBeenCalledWith('u-1');
    });
  });

  describe('changePassword', () => {
    it('调用 auth.changePassword 传入 userId 和 dto', async () => {
      const user = { id: 'u-1', username: 'admin' };
      const dto = { oldPassword: 'old', newPassword: 'new' };
      const expected = { success: true };
      auth.changePassword.mockResolvedValue(expected);

      const result = await controller.changePassword(user as any, dto);
      expect(result).toEqual(expected);
      expect(auth.changePassword).toHaveBeenCalledWith('u-1', dto);
    });
  });
});
