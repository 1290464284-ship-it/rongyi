/* eslint-disable sonarjs/no-hardcoded-ip */
import { RateLimitGuard } from './rate-limit.guard';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '../services/config.service';
import { HttpException, ExecutionContext } from '@nestjs/common';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';

function createMockConfigService(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => overrides[key] ?? undefined,
    JWT_SECRET: overrides['JWT_SECRET'] ?? 'test-secret-key-1234567890',
  } as unknown as ConfigService;
}

function createMockExecutionContext(
  requestOverrides: Partial<Record<string, unknown>> = {},
): ExecutionContext {
  const mockRequest = {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    method: 'GET',
    path: '/api/test',
    body: {},
    user: null,
    ...requestOverrides,
  };

  const mockResponse = {
    setHeader: jest.fn(),
  };

  return {
    getHandler: jest.fn().mockReturnValue({}),
    getClass: jest.fn().mockReturnValue({}),
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => mockResponse,
      getNext: () => ({}),
    }),
    getArgs: () => [],
    getArgByIndex: () => {},
    switchToRpc: () => ({
      getData: () => ({}),
      getContext: () => ({}),
    }),
    switchToWs: () => ({
      getClient: () => ({}),
      getData: () => ({}),
    }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let configService: ConfigService;
  let reflector: Reflector;
  let getAllAndOverrideMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    getAllAndOverrideMock = jest.fn();
    reflector = {
      getAllAndOverride: getAllAndOverrideMock,
    } as unknown as Reflector;
    configService = createMockConfigService();
    guard = new RateLimitGuard(reflector, configService);
  });

  afterEach(() => {
    guard.resetAll();
    jest.useRealTimers();
  });

  describe('无装饰器配置', () => {
    it('没有配置 RateLimit 装饰器时直接通过', () => {
      getAllAndOverrideMock.mockReturnValue(undefined);
      const context = createMockExecutionContext();
      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('IP 限流（默认）', () => {
    it('正常请求允许通过', () => {
      const options: RateLimitOptions = { capacity: 10, ratePerSecond: 5 };
      getAllAndOverrideMock.mockReturnValue(options);
      const context = createMockExecutionContext();
      const result = guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('超过容量后返回 429', () => {
      const options: RateLimitOptions = { capacity: 3, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      for (let i = 0; i < 3; i++) {
        const ctx = createMockExecutionContext({ ip: '192.168.1.1' });
        expect(guard.canActivate(ctx)).toBe(true);
      }

      const ctx = createMockExecutionContext({ ip: '192.168.1.1' });
      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      expect(() => guard.canActivate(ctx)).toThrow('请求过于频繁，请稍后再试');
    });

    it('不同 IP 相互独立', () => {
      const options: RateLimitOptions = { capacity: 2, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      for (let i = 0; i < 2; i++) {
        const ctx = createMockExecutionContext({ ip: '192.168.1.1' });
        guard.canActivate(ctx);
      }

      const ctx1 = createMockExecutionContext({ ip: '192.168.1.1' });
      expect(() => guard.canActivate(ctx1)).toThrow(HttpException);

      const ctx2 = createMockExecutionContext({ ip: '192.168.1.2' });
      expect(guard.canActivate(ctx2)).toBe(true);
    });

    it('一段时间后令牌会补充', () => {
      const options: RateLimitOptions = { capacity: 2, ratePerSecond: 2 };
      getAllAndOverrideMock.mockReturnValue(options);

      for (let i = 0; i < 2; i++) {
        const ctx = createMockExecutionContext({ ip: '10.0.0.1' });
        guard.canActivate(ctx);
      }

      const ctx1 = createMockExecutionContext({ ip: '10.0.0.1' });
      expect(() => guard.canActivate(ctx1)).toThrow(HttpException);

      jest.advanceTimersByTime(1000);

      const ctx2 = createMockExecutionContext({ ip: '10.0.0.1' });
      expect(guard.canActivate(ctx2)).toBe(true);
    });
  });

  describe('用户限流', () => {
    it('按用户 ID 限流', () => {
      const options: RateLimitOptions = {
        capacity: 2,
        ratePerSecond: 1,
        granularity: 'user',
      };
      getAllAndOverrideMock.mockReturnValue(options);

      const user = { id: 'user-123', role: 'doctor' };

      for (let i = 0; i < 2; i++) {
        const ctx = createMockExecutionContext({ user, ip: `10.0.0.${i}` });
        expect(guard.canActivate(ctx)).toBe(true);
      }

      const ctx = createMockExecutionContext({ user, ip: '10.0.0.99' });
      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
    });

    it('未登录用户使用 anonymous 作为 key', () => {
      const options: RateLimitOptions = {
        capacity: 1,
        ratePerSecond: 1,
        granularity: 'user',
      };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({ user: null, ip: '1.1.1.1' });
      expect(guard.canActivate(ctx1)).toBe(true);

      const ctx2 = createMockExecutionContext({ user: null, ip: '2.2.2.2' });
      expect(() => guard.canActivate(ctx2)).toThrow(HttpException);
    });
  });

  describe('诊所限流', () => {
    it('按诊所 ID 限流', () => {
      const options: RateLimitOptions = {
        capacity: 3,
        ratePerSecond: 1,
        granularity: 'clinic',
      };
      getAllAndOverrideMock.mockReturnValue(options);

      const user1 = { id: 'user-1', clinicId: 'clinic-A' };
      const user2 = { id: 'user-2', clinicId: 'clinic-A' };

      for (let i = 0; i < 3; i++) {
        const user = i % 2 === 0 ? user1 : user2;
        const ctx = createMockExecutionContext({ user });
        expect(guard.canActivate(ctx)).toBe(true);
      }

      const ctx = createMockExecutionContext({ user: user1 });
      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
    });

    it('不同诊所相互独立', () => {
      const options: RateLimitOptions = {
        capacity: 1,
        ratePerSecond: 1,
        granularity: 'clinic',
      };
      getAllAndOverrideMock.mockReturnValue(options);

      const userA = { id: 'user-a', clinicId: 'clinic-A' };
      const userB = { id: 'user-b', clinicId: 'clinic-B' };

      const ctxA = createMockExecutionContext({ user: userA });
      expect(guard.canActivate(ctxA)).toBe(true);

      const ctxA2 = createMockExecutionContext({ user: userA });
      expect(() => guard.canActivate(ctxA2)).toThrow(HttpException);

      const ctxB = createMockExecutionContext({ user: userB });
      expect(guard.canActivate(ctxB)).toBe(true);
    });
  });

  describe('自定义 key 生成策略', () => {
    it('使用自定义 keyGenerator', () => {
      const options: RateLimitOptions = {
        capacity: 2,
        ratePerSecond: 1,
        granularity: 'custom',
        keyGenerator: (req) => {
          const request = req as { body?: { phone?: string } };
          return `sms:${request.body?.phone ?? 'unknown'}`;
        },
      };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({
        body: { phone: '13800138000' },
        ip: '1.1.1.1',
      });
      const ctx2 = createMockExecutionContext({
        body: { phone: '13800138000' },
        ip: '2.2.2.2',
      });

      expect(guard.canActivate(ctx1)).toBe(true);
      expect(guard.canActivate(ctx2)).toBe(true);
      expect(() => guard.canActivate(ctx1)).toThrow(HttpException);
    });

    it('custom 粒度但没有 keyGenerator 时回退到 IP', () => {
      const options: RateLimitOptions = {
        capacity: 1,
        ratePerSecond: 1,
        granularity: 'custom',
      };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({ ip: '10.0.0.1' });
      expect(guard.canActivate(ctx1)).toBe(true);

      const ctx2 = createMockExecutionContext({ ip: '10.0.0.1' });
      expect(() => guard.canActivate(ctx2)).toThrow(HttpException);
    });
  });

  describe('白名单', () => {
    it('白名单 IP 不受限流限制', () => {
      const whitelistConfig = createMockConfigService({
        RATE_LIMIT_WHITELIST: '192.168.1.100,10.0.0.1',
      });
      const whitelistGuard = new RateLimitGuard(reflector, whitelistConfig);

      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      for (let i = 0; i < 10; i++) {
        const ctx = createMockExecutionContext({ ip: '192.168.1.100' });
        expect(whitelistGuard.canActivate(ctx)).toBe(true);
      }

      whitelistGuard.resetAll();
    });

    it('非白名单 IP 正常限流', () => {
      const whitelistConfig = createMockConfigService({
        RATE_LIMIT_WHITELIST: '192.168.1.100',
      });
      const whitelistGuard = new RateLimitGuard(reflector, whitelistConfig);

      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({ ip: '192.168.1.200' });
      expect(whitelistGuard.canActivate(ctx1)).toBe(true);

      const ctx2 = createMockExecutionContext({ ip: '192.168.1.200' });
      expect(() => whitelistGuard.canActivate(ctx2)).toThrow(HttpException);

      whitelistGuard.resetAll();
    });
  });

  describe('响应头', () => {
    it('设置限流响应头', () => {
      const options: RateLimitOptions = { capacity: 10, ratePerSecond: 5 };
      getAllAndOverrideMock.mockReturnValue(options);
      const context = createMockExecutionContext();
      guard.canActivate(context);

      const response = context.switchToHttp().getResponse();
      expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
      expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
      expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
    });

    it('限流时设置 Retry-After 头', () => {
      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({ ip: '172.16.0.1' });
      guard.canActivate(ctx1);

      const ctx2 = createMockExecutionContext({ ip: '172.16.0.1' });
      expect(() => guard.canActivate(ctx2)).toThrow(HttpException);

      const response = ctx2.switchToHttp().getResponse();
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });
  });

  describe('元数据读取', () => {
    it('使用 getAllAndOverride 读取 RATE_LIMIT_KEY 元数据', () => {
      const options: RateLimitOptions = { capacity: 10, ratePerSecond: 5 };
      getAllAndOverrideMock.mockReturnValue(options);

      const context = createMockExecutionContext();
      guard.canActivate(context);

      expect(getAllAndOverrideMock).toHaveBeenCalledWith(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });
  });

  describe('多令牌消耗', () => {
    it('支持每个请求消耗多个令牌', () => {
      const options: RateLimitOptions = {
        capacity: 10,
        ratePerSecond: 1,
        tokensPerRequest: 3,
      };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({ ip: '20.0.0.1' });
      expect(guard.canActivate(ctx1)).toBe(true);

      const ctx2 = createMockExecutionContext({ ip: '20.0.0.1' });
      expect(guard.canActivate(ctx2)).toBe(true);

      const ctx3 = createMockExecutionContext({ ip: '20.0.0.1' });
      expect(guard.canActivate(ctx3)).toBe(true);

      const ctx4 = createMockExecutionContext({ ip: '20.0.0.1' });
      expect(() => guard.canActivate(ctx4)).toThrow(HttpException);
    });
  });

  describe('trustProxy 模式', () => {
    it('应读取 x-forwarded-for 头获取客户端 IP', () => {
      const proxyConfig = createMockConfigService({ TRUST_PROXY: '1' });
      const proxyGuard = new RateLimitGuard(reflector, proxyConfig);
      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({
        ip: '127.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18' },
      });
      expect(proxyGuard.canActivate(ctx1)).toBe(true);

      // 来自同一真实 IP 的第二次请求应被限流
      const ctx2 = createMockExecutionContext({
        ip: '127.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });
      expect(() => proxyGuard.canActivate(ctx2)).toThrow(HttpException);

      proxyGuard.resetAll();
    });

    it('x-forwarded-for 为数组时应取第一个元素', () => {
      const proxyConfig = createMockConfigService({ TRUST_PROXY: '1' });
      const proxyGuard = new RateLimitGuard(reflector, proxyConfig);
      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx = createMockExecutionContext({
        ip: '127.0.0.1',
        headers: { 'x-forwarded-for': ['203.0.113.50'] },
      });
      expect(proxyGuard.canActivate(ctx)).toBe(true);
      proxyGuard.resetAll();
    });

    it('无 x-forwarded-for 时应回退到 x-real-ip', () => {
      const proxyConfig = createMockConfigService({ TRUST_PROXY: '1' });
      const proxyGuard = new RateLimitGuard(reflector, proxyConfig);
      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx = createMockExecutionContext({
        ip: '127.0.0.1',
        headers: { 'x-real-ip': '198.51.100.10' },
      });
      expect(proxyGuard.canActivate(ctx)).toBe(true);
      proxyGuard.resetAll();
    });

    it('x-real-ip 为数组时应取第一个元素', () => {
      const proxyConfig = createMockConfigService({ TRUST_PROXY: '1' });
      const proxyGuard = new RateLimitGuard(reflector, proxyConfig);
      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx = createMockExecutionContext({
        ip: '127.0.0.1',
        headers: { 'x-real-ip': ['198.51.100.10'] },
      });
      expect(proxyGuard.canActivate(ctx)).toBe(true);
      proxyGuard.resetAll();
    });

    it('无代理头时应回退到 req.ip', () => {
      const proxyConfig = createMockConfigService({ TRUST_PROXY: '1' });
      const proxyGuard = new RateLimitGuard(reflector, proxyConfig);
      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx = createMockExecutionContext({
        ip: '192.168.0.1',
        headers: {},
      });
      expect(proxyGuard.canActivate(ctx)).toBe(true);
      proxyGuard.resetAll();
    });
  });

  describe('未知 granularity', () => {
    it('未知粒度应回退到 IP 限流', () => {
      const options: RateLimitOptions = {
        capacity: 1,
        ratePerSecond: 1,
        granularity: 'unknown' as 'ip',
      };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({ ip: '50.0.0.1' });
      expect(guard.canActivate(ctx1)).toBe(true);

      const ctx2 = createMockExecutionContext({ ip: '50.0.0.1' });
      expect(() => guard.canActivate(ctx2)).toThrow(HttpException);
    });
  });

  describe('resetAll', () => {
    it('重置所有限流器', () => {
      const options: RateLimitOptions = { capacity: 1, ratePerSecond: 1 };
      getAllAndOverrideMock.mockReturnValue(options);

      const ctx1 = createMockExecutionContext({ ip: '30.0.0.1' });
      expect(guard.canActivate(ctx1)).toBe(true);

      const ctx2 = createMockExecutionContext({ ip: '30.0.0.1' });
      expect(() => guard.canActivate(ctx2)).toThrow(HttpException);

      guard.resetAll();

      const ctx3 = createMockExecutionContext({ ip: '30.0.0.1' });
      expect(guard.canActivate(ctx3)).toBe(true);
    });
  });
});
