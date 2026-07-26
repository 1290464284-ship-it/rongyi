/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/hardcoded-secret-signatures -- 测试夹具中合法使用硬编码 IP 和测试密码 */
import { RateLimitMiddleware } from './rate-limit.middleware';
import { ConfigService } from '../services/config.service';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { ROLES } from '../constants/roles';
import { HttpException } from '@nestjs/common';
import { MemoryRateLimitStore, RateLimitStore } from './rate-limit-store';

function createMockConfigService(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => overrides[key] ?? undefined,
    JWT_SECRET: overrides['JWT_SECRET'] ?? 'test-secret-key-1234567890',
  } as unknown as ConfigService;
}

function createMockReq(overrides: Partial<Record<string, unknown>> = {}): Request {
  return {
    path: '/api/test',
    method: 'GET',
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    body: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response {
  const res = {
    setHeader: jest.fn(),
    statusCode: 200,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as unknown as Response;
}

function createMockNext(): NextFunction {
  return jest.fn();
}

describe('RateLimitMiddleware', () => {
  let middleware: RateLimitMiddleware;
  let configService: ConfigService;

  beforeEach(() => {
    jest.useFakeTimers();
    configService = createMockConfigService();
    middleware = new RateLimitMiddleware(configService);
  });

  afterEach(() => {
    middleware.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('普通请求限流', () => {
    it('匿名用户默认限制为 120 次/分钟', async () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 120);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 119);
    });

    it('超过限制后通过 next 传递 429 错误', async () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();

      for (let i = 0; i < 120; i++) {
        await middleware.use(createMockReq({ path: '/api/test' }), createMockRes(), createMockNext());
      }

      const next = createMockNext();
      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalled();
      const errorArg = (next as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(HttpException);
      expect(errorArg.message).toBe('请求过于频繁，请稍后再试');
      expect(errorArg.status).toBe(429);
    });

    it('窗口过期后可以重新请求', async () => {
      const req = createMockReq({ path: '/api/test' });

      for (let i = 0; i < 120; i++) {
        await middleware.use(req, createMockRes(), createMockNext());
      }

      const next1 = createMockNext();
      await middleware.use(req, createMockRes(), next1);
      expect((next1 as jest.Mock).mock.calls[0][0]).toBeInstanceOf(HttpException);

      jest.advanceTimersByTime(60 * 1000 + 100);

      const next2 = createMockNext();
      await middleware.use(req, createMockRes(), next2);
      expect(next2).toHaveBeenCalledWith();
    });
  });

  describe('基于角色的差异化限流', () => {
    it('BOSS 角色限制为 300 次/分钟', async () => {
      const token = jwt.sign({ role: ROLES.BOSS }, 'test-secret-key-1234567890');
      const req = createMockReq({
        path: '/api/test',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 300);
    });

    it('DOCTOR 角色限制为 200 次/分钟', async () => {
      const token = jwt.sign({ role: ROLES.DOCTOR }, 'test-secret-key-1234567890');
      const req = createMockReq({
        path: '/api/test',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 200);
    });

    it('RECEPTIONIST 角色限制为 150 次/分钟', async () => {
      const token = jwt.sign({ role: ROLES.RECEPTIONIST }, 'test-secret-key-1234567890');
      const req = createMockReq({
        path: '/api/test',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 150);
    });

    it('未知角色使用默认限制', async () => {
      const token = jwt.sign({ role: 'UNKNOWN_ROLE' }, 'test-secret-key-1234567890');
      const req = createMockReq({
        path: '/api/test',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 120);
    });

    it('从 cookie 中提取 JWT', async () => {
      const token = jwt.sign({ role: ROLES.BOSS }, 'test-secret-key-1234567890');
      const req = createMockReq({
        path: '/api/test',
        headers: { cookie: `access_token=${token}` },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 300);
    });

    it('无效 JWT 使用匿名限制', async () => {
      const req = createMockReq({
        path: '/api/test',
        headers: { authorization: 'Bearer invalid-token' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 120);
    });
  });

  describe('登录接口限流', () => {
    it('/api/auth/login 使用 IP 限流（10 次/5分钟）', async () => {
      const req = createMockReq({ path: '/api/auth/login', method: 'POST' });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    });

    it('/auth/login 也使用登录限流', async () => {
      const req = createMockReq({ path: '/auth/login', method: 'POST' });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    });

    it('登录超过 IP 限制后返回 429', async () => {
      const req = createMockReq({ path: '/api/auth/login', method: 'POST' });

      for (let i = 0; i < 10; i++) {
        await middleware.use(
          createMockReq({ path: '/api/auth/login', method: 'POST' }),
          createMockRes(),
          createMockNext(),
        );
      }

      const next = createMockNext();
      await middleware.use(req, createMockRes(), next);
      const errorArg = (next as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(HttpException);
    });

    it('登录用户维度限流（5 次/5分钟）', async () => {
      for (let i = 0; i < 5; i++) {
        const req = createMockReq({
          path: '/api/auth/login',
          method: 'POST',
          body: { username: 'testuser' },
          ip: `192.168.1.${i}`,
          socket: { remoteAddress: `192.168.1.${i}` },
        });
        await middleware.use(req, createMockRes(), createMockNext());
      }

      const req = createMockReq({
        path: '/api/auth/login',
        method: 'POST',
        body: { username: 'testuser' },
        ip: '192.168.1.99',
        socket: { remoteAddress: '192.168.1.99' },
      });

      const next = createMockNext();
      await middleware.use(req, createMockRes(), next);
      const errorArg = (next as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(HttpException);
      expect(errorArg.message).toBe('登录尝试次数过多，请稍后再试');
    });

    it('登录用户名会被 trim 并转小写', async () => {
      for (let i = 0; i < 5; i++) {
        const req = createMockReq({
          path: '/api/auth/login',
          method: 'POST',
          body: { username: '  TestUser  ' },
          ip: `10.0.0.${i}`,
          socket: { remoteAddress: `10.0.0.${i}` },
        });
        await middleware.use(req, createMockRes(), createMockNext());
      }

      const req = createMockReq({
        path: '/api/auth/login',
        method: 'POST',
        body: { username: 'testuser' },
        ip: '10.0.0.99',
        socket: { remoteAddress: '10.0.0.99' },
      });

      const next = createMockNext();
      await middleware.use(req, createMockRes(), next);
      const errorArg = (next as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(HttpException);
      expect(errorArg.message).toBe('登录尝试次数过多，请稍后再试');
    });
  });

  describe('刷新 Token 接口限流', () => {
    it('/api/auth/refresh 使用刷新限流（10 次/分钟）', async () => {
      const req = createMockReq({ path: '/api/auth/refresh' });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    });

    it('/auth/refresh 也使用刷新限流', async () => {
      const req = createMockReq({ path: '/auth/refresh' });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    });

    it('刷新超过限制后返回 429', async () => {
      const req = createMockReq({ path: '/api/auth/refresh' });

      for (let i = 0; i < 10; i++) {
        await middleware.use(
          createMockReq({ path: '/api/auth/refresh' }),
          createMockRes(),
          createMockNext(),
        );
      }

      const next = createMockNext();
      await middleware.use(req, createMockRes(), next);
      const errorArg = (next as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(HttpException);
    });
  });

  describe('IP 获取逻辑', () => {
    it('默认使用 req.ip', async () => {
      const req = createMockReq({ path: '/api/test', ip: '10.0.0.1' });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('trustProxy 开启时优先使用 x-forwarded-for', async () => {
      const proxyConfig = createMockConfigService({ TRUST_PROXY: '1', JWT_SECRET: 'test-secret-key-1234567890' });
      const proxyMiddleware = new RateLimitMiddleware(proxyConfig);

      const req1 = createMockReq({
        path: '/api/test',
        ip: '10.0.0.1',
        socket: { remoteAddress: '10.0.0.1' },
        headers: { 'x-forwarded-for': '192.168.1.100, 10.0.0.1' },
      });
      const res1 = createMockRes();
      const next1 = createMockNext();

      await proxyMiddleware.use(req1, res1, next1);
      expect(next1).toHaveBeenCalledWith();

      for (let i = 0; i < 119; i++) {
        await proxyMiddleware.use(
          createMockReq({
            path: '/api/test',
            ip: '10.0.0.2',
            socket: { remoteAddress: '10.0.0.2' },
            headers: { 'x-forwarded-for': '192.168.1.100' },
          }),
          createMockRes(),
          createMockNext(),
        );
      }

      const req2 = createMockReq({
        path: '/api/test',
        ip: '10.0.0.3',
        socket: { remoteAddress: '10.0.0.3' },
        headers: { 'x-forwarded-for': '192.168.1.100' },
      });
      const res2 = createMockRes();
      const next2 = createMockNext();

      await proxyMiddleware.use(req2, res2, next2);
      const errorArg = (next2 as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(HttpException);

      proxyMiddleware.onModuleDestroy();
    });

    it('trustProxy 开启时 x-real-ip 作为备选', async () => {
      const proxyConfig = createMockConfigService({ TRUST_PROXY: '1', JWT_SECRET: 'test-secret-key-1234567890' });
      const proxyMiddleware = new RateLimitMiddleware(proxyConfig);

      const req = createMockReq({
        path: '/api/test',
        ip: '10.0.0.1',
        socket: { remoteAddress: '10.0.0.1' },
        headers: { 'x-real-ip': '192.168.1.200' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await proxyMiddleware.use(req, res, next);
      expect(next).toHaveBeenCalledWith();

      proxyMiddleware.onModuleDestroy();
    });

    it('trustProxy 关闭时忽略 x-forwarded-for', async () => {
      const req1 = createMockReq({
        path: '/api/test',
        ip: '10.0.0.1',
        socket: { remoteAddress: '10.0.0.1' },
        headers: { 'x-forwarded-for': '192.168.1.100' },
      });

      for (let i = 0; i < 119; i++) {
        await middleware.use(req1, createMockRes(), createMockNext());
      }

      const req2 = createMockReq({
        path: '/api/test',
        ip: '10.0.0.2',
        socket: { remoteAddress: '10.0.0.2' },
        headers: { 'x-forwarded-for': '192.168.1.100' },
      });
      const next = createMockNext();
      await middleware.use(req2, createMockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('响应头设置', () => {
    it('设置正确的限流响应头', async () => {
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      await middleware.use(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', expect.any(Number));
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
    });

    it('限流时设置 Retry-After 头', async () => {
      const req = createMockReq({ path: '/api/test' });

      for (let i = 0; i < 120; i++) {
        await middleware.use(
          createMockReq({ path: '/api/test' }),
          createMockRes(),
          createMockNext(),
        );
      }

      const res = createMockRes();
      const next = createMockNext();
      await middleware.use(req, res, next);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });
  });

  describe('onModuleDestroy', () => {
    it('清理定时器和存储', async () => {
      const middleware2 = new RateLimitMiddleware(configService);
      await middleware2.use(createMockReq({ path: '/api/test' }), createMockRes(), createMockNext());

      middleware2.onModuleDestroy();

      expect(() => {
        middleware2.onModuleDestroy();
      }).not.toThrow();
    });
  });

  describe('JWT_SECRET 未配置', () => {
    it('JWT_SECRET 过短时使用匿名限流', async () => {
      const shortConfig = createMockConfigService({ JWT_SECRET: 'short' });
      const shortMiddleware = new RateLimitMiddleware(shortConfig);

      const token = jwt.sign({ role: ROLES.BOSS }, 'short');
      const req = createMockReq({
        path: '/api/test',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = createMockRes();
      const next = createMockNext();

      await shortMiddleware.use(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 120);

      shortMiddleware.onModuleDestroy();
    });
  });

  describe('自定义 store', () => {
    it('可以传入自定义的 store 实现', async () => {
      const customStore: RateLimitStore = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        increment: jest.fn().mockResolvedValue({ count: 1, resetTime: Date.now() + 60000 }),
      };

      const customMiddleware = new RateLimitMiddleware(configService, customStore);
      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      await customMiddleware.use(req, res, next);

      expect(customStore.increment).toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();

      customMiddleware.onModuleDestroy();
    });

    it('使用自定义 MemoryRateLimitStore', async () => {
      const store = new MemoryRateLimitStore();
      const customMiddleware = new RateLimitMiddleware(configService, store);

      const req = createMockReq({ path: '/api/test' });
      const res = createMockRes();
      const next = createMockNext();

      await customMiddleware.use(req, res, next);

      expect(store.size).toBeGreaterThan(0);
      expect(next).toHaveBeenCalledWith();

      customMiddleware.onModuleDestroy();
    });
  });
});
