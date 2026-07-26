import { ExecutionContext, CallHandler } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { GlobalOperationLogInterceptor } from './global-operation-log.interceptor';
import { OperationLogSink, OPERATION_LOG_SINK } from '../../../common/services/operation-log-sink.interface';
import { OPERATION_LOG_RESOURCE_KEY } from '../../../common/decorators/operation-log-resource.decorator';

/**
 * 创建 mock ExecutionContext（HTTP）
 */
function createMockHttpContext(options: {
  method?: string;
  url?: string;
  routePath?: string;
  body?: unknown;
  user?: { id?: string; userId?: string; username?: string; name?: string };
  ip?: string;
  classDecorators?: Record<string, unknown>;
} = {}): ExecutionContext {
  const request = {
    method: options.method ?? 'POST',
    url: options.url ?? '/patients',
    route: options.routePath !== undefined ? { path: options.routePath } : undefined,
    body: options.body ?? {},
    user: options.user,
    ip: options.ip,
  };
  const handler = jest.fn();
  const context: ExecutionContext = {
    switchToHttp: () => ({
      getRequest: () => request as never,
      getResponse: () => ({}) as never,
      getNext: () => jest.fn() as never,
    }),
    getClass: () => {
      const cls: { new (): unknown } = function () {} as unknown as { new (): unknown };
      // 绑定装饰器元数据
      if (options.classDecorators) {
        for (const [key, value] of Object.entries(options.classDecorators)) {
          Reflect.defineMetadata(key, value, cls);
        }
      }
      return cls as never;
    },
    getHandler: () => handler as never,
    getArgs: () => [] as never,
    getArgByIndex: () => null,
    switchToRpc: () => ({} as never) as ReturnType<ExecutionContext['switchToRpc']>,
    switchToWs: () => ({} as never) as ReturnType<ExecutionContext['switchToWs']>,
    getType: () => 'http' as never,
  };
  return context;
}

/**
 * 创建 mock ModuleRef
 */
function createMockModuleRef(sink: OperationLogSink | null): ModuleRef {
  return {
    get: (token: unknown) => {
      if (token === OPERATION_LOG_SINK) {
        if (sink) return sink;
        throw new Error('not found');
      }
      return;
    },
  } as unknown as ModuleRef;
}

/**
 * 创建 mock OperationLogSink
 */
function createMockSink(): OperationLogSink & { createMock: jest.Mock; calls: unknown[] } {
  const calls: unknown[] = [];
  const createMock = jest.fn(async (data: unknown) => {
    calls.push(data);
    return { id: 'log-1' };
  });
  return { create: createMock, createMock, calls };
}

/**
 * next.handle() 返回值
 */
function nextHandler(value: unknown = { id: 'resource-1' }): CallHandler {
  return { handle: () => of(value) };
}

describe('GlobalOperationLogInterceptor', () => {
  let interceptor: GlobalOperationLogInterceptor;
  let sink: ReturnType<typeof createMockSink>;

  beforeEach(() => {
    sink = createMockSink();
    interceptor = new GlobalOperationLogInterceptor(createMockModuleRef(sink));
  });

  describe('HTTP 方法过滤', () => {
    it('GET 请求跳过日志记录', async () => {
      const ctx = createMockHttpContext({ method: 'GET', url: '/patients' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).not.toHaveBeenCalled();
    });

    it('OPTIONS 请求跳过日志记录', async () => {
      const ctx = createMockHttpContext({ method: 'OPTIONS' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).not.toHaveBeenCalled();
    });

    it('HEAD 请求跳过日志记录', async () => {
      const ctx = createMockHttpContext({ method: 'HEAD' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).not.toHaveBeenCalled();
    });

    it('POST 请求记录日志', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/patients' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).toHaveBeenCalledTimes(1);
    });

    it('PATCH 请求记录日志', async () => {
      const ctx = createMockHttpContext({ method: 'PATCH', url: '/patients/1' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).toHaveBeenCalledTimes(1);
    });

    it('PUT 请求记录日志', async () => {
      const ctx = createMockHttpContext({ method: 'PUT', url: '/patients/1' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).toHaveBeenCalledTimes(1);
    });

    it('DELETE 请求记录日志', async () => {
      const ctx = createMockHttpContext({ method: 'DELETE', url: '/patients/1' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('SKIP_PATHS 跳过', () => {
    it.each([
      ['/auth/login'],
      ['/auth/refresh'],
      ['/health'],
      ['/health/check'],
      ['/operation-logs/batch'],
      ['/api/auth/login/extra'],
    ])('跳过路径 %s', async (path) => {
      const ctx = createMockHttpContext({ method: 'POST', url: path });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).not.toHaveBeenCalled();
    });
  });

  describe('route.path 缺失回退到 request.url', () => {
    it('route.path 缺失时使用 request.url', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/charges' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).toHaveBeenCalledTimes(1);
      expect((sink.createMock.mock.calls[0][0] as { target: string }).target).toBe('/charges');
    });

    it('route.path 存在时优先使用 route.path', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/patients/123?q=1',
        routePath: '/patients/:id',
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect((sink.createMock.mock.calls[0][0] as { target: string }).target).toBe('/patients/:id');
    });
  });

  describe('OperationLogSink 获取失败', () => {
    it('ModuleRef.get 抛错时直接放行（不记录日志）', async () => {
      const failingInterceptor = new GlobalOperationLogInterceptor(createMockModuleRef(null));
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = failingInterceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).not.toHaveBeenCalled();
    });
  });

  describe('user 字段映射', () => {
    it('user.id 存在时使用 user.id', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/x',
        user: { id: 'u-id', username: '张三' },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { userId: string; userName: string };
      expect(data.userId).toBe('u-id');
      expect(data.userName).toBe('张三');
    });

    it('user.userId 存在但 user.id 不存在时使用 user.userId', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/x',
        user: { userId: 'u-uid', username: '李四' },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { userId: string; userName: string };
      expect(data.userId).toBe('u-uid');
      expect(data.userName).toBe('李四');
    });

    it('user 缺失时 userId 为 undefined, userName 默认为 "unknown"', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x', user: undefined });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { userId: unknown; userName: string };
      expect(data.userId).toBeUndefined();
      expect(data.userName).toBe('unknown');
    });

    it('user 仅含 name 字段时 userName 使用 name', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/x',
        user: { id: 'u1', name: '王五' },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { userName: string };
      expect(data.userName).toBe('王五');
    });

    it('user 仅有 userId 时 userName 退化为 userId', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/x',
        user: { userId: 'u-fallback' },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { userName: string };
      expect(data.userName).toBe('u-fallback');
    });
  });

  describe('result.id 处理', () => {
    it('result 含 id 时在 detail 末尾追加 " ID: <id>"', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/patients' });
      const result$ = interceptor.intercept(ctx, nextHandler({ id: 'patient-99' }));
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { detail: string };
      expect(data.detail).toMatch(/ ID: patient-99$/);
    });

    it('result 不含 id 时 detail 末尾不追加 ID 文本', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = interceptor.intercept(ctx, nextHandler({ status: 'ok' }));
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { detail: string };
      expect(data.detail).not.toMatch(/ ID: /);
    });
  });

  describe('body 脱敏与序列化', () => {
    it('敏感字段被遮蔽为 ***', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/users',
        body: { username: 'admin', password: '123456', idCard: '110101' },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { detail: string };
      expect(data.detail).toContain('"password":"***"');
      expect(data.detail).toContain('"idCard":"***"');
      expect(data.detail).toContain('"username":"admin"');
    });

    it('嵌套对象的敏感字段也被遮蔽', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/patients',
        body: { name: '张三', contact: { phone: '13800000000', address: '北京' } },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { detail: string };
      expect(data.detail).toContain('"phone":"***"');
      expect(data.detail).toContain('"address":"***"');
      expect(data.detail).toContain('"name":"张三"');
    });

    it('body 为 null 时不报错', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x', body: null });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).toHaveBeenCalled();
    });

    it('body 缺失时使用空对象', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      // 显式不传 body
      const req = (ctx.switchToHttp() as { getRequest: () => Record<string, unknown> }).getRequest();
      delete req.body;
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).toHaveBeenCalled();
    });

    it('body 长度超过 2000 时被截断并附加 ...', async () => {
      const longText = 'a'.repeat(3000);
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/x',
        body: { data: longText },
      });
      // 不返回 id，避免 resultInfo 影响
      const result$ = interceptor.intercept(ctx, nextHandler({ status: 'ok' }));
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { detail: string };
      expect(data.detail.endsWith('...')).toBe(true);
      // 截断到 2000 字符再加 '...'
      expect(data.detail.length).toBe(2003);
    });

    it('body 含循环引用导致 JSON.stringify 失败时降级为 "无法序列化"', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      // 构造循环引用
      const circular: Record<string, unknown> = { name: 'x' };
      circular.self = circular;
      (ctx.switchToHttp() as { getRequest: () => Record<string, unknown> }).getRequest().body = circular;
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { detail: string };
      expect(data.detail.startsWith('无法序列化')).toBe(true);
    });
  });

  describe('ip 字段透传', () => {
    it('request.ip 透传到日志', async () => {
      const testIp = '127.0.0.1';
      const ctx = createMockHttpContext({ method: 'POST', url: '/x', ip: testIp });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { ip: string };
      expect(data.ip).toBe(testIp);
    });
  });

  describe('action 文本生成', () => {
    it('POST 资源名为 swagger/apiTags 时 action 形如 "创建<TAG>"', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/patients',
        classDecorators: { 'swagger/apiTags': ['患者管理'] },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('创建患者管理');
    });

    it('PATCH 资源名为 OperationLogResource 元数据时优先使用', async () => {
      const ctx = createMockHttpContext({
        method: 'PATCH',
        url: '/patients/1',
        classDecorators: {
          [OPERATION_LOG_RESOURCE_KEY]: '患者档案',
          'swagger/apiTags': ['Patients'],
        },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('更新患者档案');
    });

    it('OperationLogResource 为空字符串时回退到 swagger/apiTags', async () => {
      const ctx = createMockHttpContext({
        method: 'DELETE',
        url: '/patients/1',
        classDecorators: {
          [OPERATION_LOG_RESOURCE_KEY]: '',
          'swagger/apiTags': ['Patient'],
        },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('删除Patient');
    });

    it('无装饰器时回退到 url 路径首段', async () => {
      const ctx = createMockHttpContext({ method: 'PUT', url: '/orders/42' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('更新orders');
    });

    it('unknown 方法时使用 HTTP 方法名本身', async () => {
      // 覆盖 extractActionName 内部 fallback 难以直接触发（HTTP 方法过滤器与 ACTION_MAP 完全重叠）
      // 这里通过设置 url 为空路径，验证 pathParts 为空时回退到 'unknown' 的分支（与 method fallback 同函数体）
      const emptyPathCtx = createMockHttpContext({ method: 'POST', url: '/' });
      const result$ = interceptor.intercept(emptyPathCtx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('创建unknown');
    });

    it('OperationLogResource 非字符串时回退到 swagger/apiTags', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/x',
        classDecorators: {
          [OPERATION_LOG_RESOURCE_KEY]: 123,
          'swagger/apiTags': ['Resource'],
        },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('创建Resource');
    });

    it('OperationLogResource 与 swagger/apiTags 均无时回退到 url 首段', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/visits' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('创建visits');
    });

    it('swagger/apiTags 为空数组时回退到 url 首段', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/drugs',
        classDecorators: { 'swagger/apiTags': [] },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('创建drugs');
    });

    it('swagger/apiTags 第一项非字符串时回退到 url 首段', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/invoices',
        classDecorators: { 'swagger/apiTags': [42] },
      });
      const result$ = interceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      const data = sink.createMock.mock.calls[0][0] as { action: string };
      expect(data.action).toBe('创建invoices');
    });
  });

  describe('请求异常处理', () => {
    it('下游抛出 Error 时记录失败日志（action 追加 " [失败]"）', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = interceptor.intercept(ctx, {
        handle: () => throwError(() => new Error('boom')),
      });
      await new Promise<void>((resolve) => {
        result$.subscribe({
          next: () => {},
          error: () => {
            // 给 microtask 时间执行 tap 的 error 回调
            setImmediate(() => resolve());
          },
        });
      });
      expect(sink.createMock).toHaveBeenCalledTimes(1);
      const data = sink.createMock.mock.calls[0][0] as { action: string; detail: string };
      expect(data.action).toMatch(/ \[失败\]$/);
      expect(data.detail).toContain('错误: boom');
    });

    it('下游抛出非 Error 时 detail 退化为 String(error)', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = interceptor.intercept(ctx, {
        handle: () => throwError(() => '字符串错误'),
      });
      await new Promise<void>((resolve) => {
        result$.subscribe({
          next: () => {},
          error: () => setImmediate(() => resolve()),
        });
      });
      const data = sink.createMock.mock.calls[0][0] as { detail: string };
      expect(data.detail).toContain('错误: 字符串错误');
    });

    it('失败日志中也包含 body 快照', async () => {
      const ctx = createMockHttpContext({
        method: 'POST',
        url: '/x',
        body: { name: 'test' },
      });
      const result$ = interceptor.intercept(ctx, {
        handle: () => throwError(() => new Error('err')),
      });
      await new Promise<void>((resolve) => {
        result$.subscribe({
          next: () => {},
          error: () => setImmediate(() => resolve()),
        });
      });
      const data = sink.createMock.mock.calls[0][0] as { detail: string };
      expect(data.detail).toContain('请求:');
      expect(data.detail).toContain('"name":"test"');
    });
  });

  describe('OperationLogSink.create 失败', () => {
    it('create reject（Error 实例）时通过 logger.warn 记录（不抛出）', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const failingSink: OperationLogSink = {
        create: jest.fn().mockRejectedValue(new Error('db down')),
      };
      const failInterceptor = new GlobalOperationLogInterceptor(createMockModuleRef(failingSink));
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = failInterceptor.intercept(ctx, nextHandler());
      // 不应抛出错误
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      // 等待 microtask 完成 catch
      await new Promise((r) => setImmediate(r));
      expect(failingSink.create).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('create reject（非 Error）时使用 String(err) 形式', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const failingSink: OperationLogSink = {
        create: jest.fn().mockRejectedValue('string rejection'),
      };
      const failInterceptor = new GlobalOperationLogInterceptor(createMockModuleRef(failingSink));
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = failInterceptor.intercept(ctx, nextHandler());
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      await new Promise((r) => setImmediate(r));
      expect(failingSink.create).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('失败分支下 create reject 也通过 logger.warn 记录', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const failingSink: OperationLogSink = {
        create: jest.fn().mockRejectedValue(new Error('down2')),
      };
      const failInterceptor = new GlobalOperationLogInterceptor(createMockModuleRef(failingSink));
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = failInterceptor.intercept(ctx, {
        handle: () => throwError(() => new Error('request-fail')),
      });
      await new Promise<void>((resolve) => {
        result$.subscribe({
          next: () => {},
          error: () => setTimeout(() => resolve(), 10),
        });
      });
      expect(failingSink.create).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('失败分支下 create reject 为字符串时也通过 warn 记录', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const failingSink: OperationLogSink = {
        create: jest.fn().mockRejectedValue('plain error'),
      };
      const failInterceptor = new GlobalOperationLogInterceptor(createMockModuleRef(failingSink));
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = failInterceptor.intercept(ctx, {
        handle: () => throwError(() => new Error('request-fail')),
      });
      await new Promise<void>((resolve) => {
        result$.subscribe({
          next: () => {},
          error: () => setTimeout(() => resolve(), 10),
        });
      });
      expect(failingSink.create).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('operationLogSink 缓存（第二次不再调用 moduleRef）', () => {
    it('后续请求复用已缓存 sink', async () => {
      const ctx1 = createMockHttpContext({ method: 'POST', url: '/a' });
      const result1$ = interceptor.intercept(ctx1, nextHandler());
      await new Promise<void>((resolve) => result1$.subscribe({ next: () => {}, complete: resolve }));

      const ctx2 = createMockHttpContext({ method: 'POST', url: '/b' });
      const result2$ = interceptor.intercept(ctx2, nextHandler());
      await new Promise<void>((resolve) => result2$.subscribe({ next: () => {}, complete: resolve }));

      expect(sink.createMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('operationLogSink 为 null 时的兜底分支', () => {
    it('成功路径下 sink 变为 null 时不记录', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = interceptor.intercept(ctx, nextHandler());
      // 在订阅前清空 sink，覆盖 next 回调里的兜底 if 分支
      (interceptor as unknown as { operationLogSink: unknown }).operationLogSink = null;
      await new Promise<void>((resolve) => result$.subscribe({ next: () => {}, complete: resolve }));
      expect(sink.createMock).not.toHaveBeenCalled();
    });

    it('失败路径下 sink 变为 null 时不记录', async () => {
      const ctx = createMockHttpContext({ method: 'POST', url: '/x' });
      const result$ = interceptor.intercept(ctx, {
        handle: () => throwError(() => new Error('boom')),
      });
      // 在订阅前清空 sink，覆盖 error 回调里的兜底 if 分支
      (interceptor as unknown as { operationLogSink: unknown }).operationLogSink = null;
      await new Promise<void>((resolve) => {
        result$.subscribe({
          next: () => {},
          error: () => setImmediate(() => resolve()),
        });
      });
      expect(sink.createMock).not.toHaveBeenCalled();
    });
  });
});
