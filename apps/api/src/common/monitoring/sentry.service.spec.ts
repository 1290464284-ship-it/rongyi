import { SentryService } from './sentry.service';
import { ClinicContextService } from '../services/clinic-context.service';

// Mock @sentry/node
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn().mockReturnValue('event-id'),
  captureMessage: jest.fn().mockReturnValue('msg-id'),
  setTag: jest.fn(),
  withScope: jest.fn((cb) => cb({ setTag: jest.fn(), setExtra: jest.fn(), setUser: jest.fn() })),
}));

import * as Sentry from '@sentry/node';

function createClinicContext(overrides?: Partial<ClinicContextService>): ClinicContextService {
  return {
    getClinicId: jest.fn().mockReturnValue('clinic-1'),
    getUserId: jest.fn().mockReturnValue('user-1'),
    getRole: jest.fn().mockReturnValue('DOCTOR'),
    getSource: jest.fn().mockReturnValue('web'),
    ...overrides,
  } as unknown as ClinicContextService;
}

describe('SentryService', () => {
  let service: SentryService;
  let clinicContext: ClinicContextService;

  beforeEach(() => {
    jest.clearAllMocks();
    clinicContext = createClinicContext();
    service = new SentryService(clinicContext);
  });

  describe('init', () => {
    it('DSN 为空时不应初始化 Sentry', () => {
      service.init('', 'test');
      expect(Sentry.init).not.toHaveBeenCalled();
      expect(service.isEnabled()).toBe(false);
    });

    it('DSN 有效时应调用 Sentry.init', () => {
      service.init('https://key@sentry.io/1', 'production');
      expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
        dsn: 'https://key@sentry.io/1',
        environment: 'production',
      }));
      expect(service.isEnabled()).toBe(true);
    });

    it('重复调用 init 不应重复初始化', () => {
      service.init('https://key@sentry.io/1', 'test');
      service.init('https://key@sentry.io/1', 'test');
      expect(Sentry.init).toHaveBeenCalledTimes(1);
    });

    it('应传递 release 参数', () => {
      service.init('https://key@sentry.io/1', 'production', 'v1.0.0');
      expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
        release: 'v1.0.0',
      }));
    });

    it('Sentry.init 抛异常时应捕获错误', () => {
      (Sentry.init as jest.Mock).mockImplementationOnce(() => { throw new Error('init failed'); });
      service.init('https://key@sentry.io/1', 'test');
      expect(service.isEnabled()).toBe(false);
    });

    it('beforeSend 应执行 sanitizeEvent 并返回 event', () => {
      service.init('https://key@sentry.io/1', 'test');
      const initCall = (Sentry.init as jest.Mock).mock.calls[0][0];
      const event = {
        request: {
          headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
          data: { password: 'secret123', name: 'test' },
        },
        extra: { token: 'abc123', action: 'login' },
        breadcrumbs: [
          { data: { token: 'key-123', action: 'click' } },
          { data: undefined },
        ],
      };
      const result = initCall.beforeSend(event);
      expect(result).toBe(event);
      expect(event.request.headers.Authorization).toBe('[Filtered]');
      expect(event.request.headers['Content-Type']).toBe('application/json');
      expect(event.request.data.password).toBe('[Filtered]');
      expect(event.request.data.name).toBe('test');
      expect(event.extra.token).toBe('[Filtered]');
      expect(event.extra.action).toBe('login');
      expect(event.breadcrumbs?.[0].data).toEqual({ token: '[Filtered]', action: 'click' });
      expect(event.breadcrumbs?.[1].data).toBeUndefined();
    });

    it('sanitizeEvent 应处理 null/undefined/number/boolean/array 值', () => {
      service.init('https://key@sentry.io/1', 'test');
      const initCall = (Sentry.init as jest.Mock).mock.calls[0][0];
      const event = {
        extra: {
          nullVal: null,
          undefVal: undefined,
          numVal: 42,
          boolVal: true,
          arrVal: [1, 'str', { nested: 'val' }],
          funcVal: () => 'test',
        },
      };
      const result = initCall.beforeSend(event);
      expect(result.extra.nullVal).toBeNull();
      expect(result.extra.undefVal).toBeUndefined();
      expect(result.extra.numVal).toBe(42);
      expect(result.extra.boolVal).toBe(true);
      expect(result.extra.arrVal).toEqual([1, 'str', { nested: 'val' }]);
      expect(result.extra.funcVal).toBe('() => \'test\'');
    });
  });

  describe('captureException', () => {
    it('未初始化时应返回 undefined', () => {
      const result = service.captureException(new Error('test'));
      expect(result).toBeUndefined();
    });

    it('初始化后应调用 Sentry.captureException', () => {
      service.init('https://key@sentry.io/1', 'test');
      const result = service.captureException(new Error('test'), { extra: 'data' });
      expect(Sentry.captureException).toHaveBeenCalled();
      expect(result).toBe('event-id');
    });

    it('应传递 context 到 scope', () => {
      service.init('https://key@sentry.io/1', 'test');
      const mockScope = { setTag: jest.fn(), setExtra: jest.fn(), setUser: jest.fn() };
      (Sentry.captureException as jest.Mock).mockImplementationOnce((_err, cb) => {
        cb(mockScope);
        return 'event-id';
      });
      service.captureException(new Error('test'), { requestId: '123' });
      expect(mockScope.setExtra).toHaveBeenCalledWith('requestId', '123');
    });

    it('应通过 populateScopeWithContext 设置 clinic 上下文', () => {
      service.init('https://key@sentry.io/1', 'test');
      const mockScope = { setTag: jest.fn(), setExtra: jest.fn(), setUser: jest.fn() };
      (Sentry.captureException as jest.Mock).mockImplementationOnce((_err, cb) => {
        cb(mockScope);
        return 'event-id';
      });
      service.captureException(new Error('test'));
      expect(mockScope.setTag).toHaveBeenCalledWith('clinicId', 'clinic-1');
      expect(mockScope.setExtra).toHaveBeenCalledWith('clinicId', 'clinic-1');
      expect(mockScope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
      expect(mockScope.setTag).toHaveBeenCalledWith('userId', 'user-1');
      expect(mockScope.setTag).toHaveBeenCalledWith('role', 'DOCTOR');
      expect(mockScope.setTag).toHaveBeenCalledWith('source', 'web');
    });

    it('clinicContext 为空时不应设置对应 tag', () => {
      const emptyCtx = createClinicContext({
        getClinicId: jest.fn().mockReturnValue(null),
        getUserId: jest.fn().mockReturnValue(null),
        getRole: jest.fn().mockReturnValue(null),
        getSource: jest.fn().mockReturnValue(null),
      });
      const svc = new SentryService(emptyCtx);
      svc.init('https://key@sentry.io/1', 'test');
      const mockScope = { setTag: jest.fn(), setExtra: jest.fn(), setUser: jest.fn() };
      (Sentry.captureException as jest.Mock).mockImplementationOnce((_err, cb) => {
        cb(mockScope);
        return 'event-id';
      });
      svc.captureException(new Error('test'));
      expect(mockScope.setUser).not.toHaveBeenCalled();
    });

    it('captureException 失败时应返回 undefined', () => {
      service.init('https://key@sentry.io/1', 'test');
      (Sentry.captureException as jest.Mock).mockImplementationOnce(() => { throw new Error('capture failed'); });
      const result = service.captureException(new Error('test'));
      expect(result).toBeUndefined();
    });

    it('无 context 时不应调用 setExtra', () => {
      service.init('https://key@sentry.io/1', 'test');
      const mockScope = { setTag: jest.fn(), setExtra: jest.fn(), setUser: jest.fn() };
      (Sentry.captureException as jest.Mock).mockImplementationOnce((_err, cb) => {
        cb(mockScope);
        return 'event-id';
      });
      service.captureException(new Error('test'));
      // setExtra 只被 populateScopeWithContext 调用（clinicId），不被 context 调用
      expect(mockScope.setExtra).toHaveBeenCalledWith('clinicId', 'clinic-1');
    });
  });

  describe('captureMessage', () => {
    it('未初始化时应返回 undefined', () => {
      const result = service.captureMessage('hello');
      expect(result).toBeUndefined();
    });

    it('初始化后应调用 Sentry.captureMessage', () => {
      service.init('https://key@sentry.io/1', 'test');
      const result = service.captureMessage('hello', 'warning');
      expect(Sentry.captureMessage).toHaveBeenCalled();
      expect(result).toBe('msg-id');
    });

    it('带 context 应传递 extra', () => {
      service.init('https://key@sentry.io/1', 'test');
      service.captureMessage('hello', 'info', { action: 'test' });
      expect(Sentry.captureMessage).toHaveBeenCalledWith('hello', { level: 'info', extra: { action: 'test' } });
    });

    it('不带 context 应只传 level', () => {
      service.init('https://key@sentry.io/1', 'test');
      service.captureMessage('hello');
      expect(Sentry.captureMessage).toHaveBeenCalledWith('hello', { level: 'info' });
    });

    it('captureMessage 失败时应返回 undefined', () => {
      service.init('https://key@sentry.io/1', 'test');
      (Sentry.captureMessage as jest.Mock).mockImplementationOnce(() => { throw new Error('capture failed'); });
      const result = service.captureMessage('hello');
      expect(result).toBeUndefined();
    });
  });

  describe('setTag', () => {
    it('未初始化时不应调用 Sentry.setTag', () => {
      service.setTag('key', 'value');
      expect(Sentry.setTag).not.toHaveBeenCalled();
    });

    it('初始化后应调用 Sentry.setTag', () => {
      service.init('https://key@sentry.io/1', 'test');
      service.setTag('key', 'value');
      expect(Sentry.setTag).toHaveBeenCalledWith('key', 'value');
    });
  });

  describe('withScope', () => {
    it('未初始化时不应执行 callback', () => {
      const cb = jest.fn();
      service.withScope(cb);
      expect(cb).not.toHaveBeenCalled();
    });

    it('初始化后应执行 callback', () => {
      service.init('https://key@sentry.io/1', 'test');
      const cb = jest.fn();
      service.withScope(cb);
      expect(cb).toHaveBeenCalled();
    });
  });
});
