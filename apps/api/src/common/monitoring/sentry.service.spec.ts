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
