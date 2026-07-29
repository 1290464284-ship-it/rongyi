import {
  als,
  getRequestContext,
  getTraceId,
  getCurrentUserId,
  getCurrentClinicId,
  setClinicId,
  generateTraceId,
  runWithContext,
  RequestContext,
} from './async-context';

describe('async-context', () => {
  beforeEach(() => {
    als.disable();
  });

  afterEach(() => {
    als.disable();
  });

  describe('generateTraceId', () => {
    it('应生成 UUID 格式的 traceId', () => {
      const traceId = generateTraceId();
      expect(traceId).toBeDefined();
      expect(typeof traceId).toBe('string');
      expect(traceId.length).toBeGreaterThan(0);
    });

    it('每次调用应生成不同的 traceId', () => {
      const id1 = generateTraceId();
      const id2 = generateTraceId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('runWithContext', () => {
    it('应在上下文中运行函数', () => {
      const context: RequestContext = {
        traceId: 'test-trace-id',
        userId: 'user-123',
        requestStart: '2024-01-15T10:00:00.000Z',
      };

      let capturedContext: RequestContext | undefined;
      runWithContext(context, () => {
        capturedContext = getRequestContext();
      });

      expect(capturedContext).toEqual(context);
    });

    it('函数执行完后上下文应清空', () => {
      const context: RequestContext = { traceId: 'test' };

      runWithContext(context, () => {
        expect(getRequestContext()).toBeDefined();
      });

      expect(getRequestContext()).toBeUndefined();
    });

    it('应返回函数的返回值', () => {
      const context: RequestContext = { traceId: 'test' };
      const result = runWithContext(context, () => 42);
      expect(result).toBe(42);
    });

    it('函数抛出异常时应正确传播', () => {
      const context: RequestContext = { traceId: 'test' };
      expect(() => {
        runWithContext(context, () => {
          throw new Error('test error');
        });
      }).toThrow('test error');
    });
  });

  describe('getRequestContext', () => {
    it('在上下文之外应返回 undefined', () => {
      expect(getRequestContext()).toBeUndefined();
    });

    it('在上下文之内应返回完整上下文', () => {
      const context: RequestContext = {
        traceId: 'trace-1',
        userId: 'user-1',
        requestStart: '2024-01-01T00:00:00.000Z',
      };

      runWithContext(context, () => {
        const result = getRequestContext();
        expect(result).toBeDefined();
        expect(result!.traceId).toBe('trace-1');
        expect(result!.userId).toBe('user-1');
        expect(result!.requestStart).toBe('2024-01-01T00:00:00.000Z');
      });
    });
  });

  describe('getTraceId', () => {
    it('在上下文之外应返回 undefined', () => {
      expect(getTraceId()).toBeUndefined();
    });

    it('在上下文之内应返回 traceId', () => {
      const context: RequestContext = { traceId: 'my-trace-id' };
      runWithContext(context, () => {
        expect(getTraceId()).toBe('my-trace-id');
      });
    });
  });

  describe('getCurrentUserId', () => {
    it('在上下文之外应返回 undefined', () => {
      expect(getCurrentUserId()).toBeUndefined();
    });

    it('有 userId 时应返回 userId', () => {
      const context: RequestContext = { traceId: 'trace-1', userId: 'user-456' };
      runWithContext(context, () => {
        expect(getCurrentUserId()).toBe('user-456');
      });
    });

    it('没有 userId 时应返回 undefined', () => {
      const context: RequestContext = { traceId: 'trace-1' };
      runWithContext(context, () => {
        expect(getCurrentUserId()).toBeUndefined();
      });
    });
  });

  describe('嵌套上下文', () => {
    it('内层上下文不应影响外层', () => {
      const outerContext: RequestContext = { traceId: 'outer' };
      const innerContext: RequestContext = { traceId: 'inner' };

      runWithContext(outerContext, () => {
        expect(getTraceId()).toBe('outer');

        runWithContext(innerContext, () => {
          expect(getTraceId()).toBe('inner');
        });

        expect(getTraceId()).toBe('outer');
      });
    });
  });

  describe('异步函数', () => {
    it('异步函数也应保持上下文', async () => {
      const context: RequestContext = { traceId: 'async-trace' };

      const result = await runWithContext(context, async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return getTraceId();
      });

      expect(result).toBe('async-trace');
    });
  });

  describe('setClinicId', () => {
    it('在上下文中应设置 clinicId', () => {
      const context: RequestContext = { traceId: 'test' };
      runWithContext(context, () => {
        setClinicId('clinic-abc');
        expect(getCurrentClinicId()).toBe('clinic-abc');
      });
    });

    it('在上下文外调用应不报错（no-op）', () => {
      expect(() => setClinicId('clinic-abc')).not.toThrow();
    });
  });

  describe('getCurrentClinicId', () => {
    it('在上下文之外应返回 undefined', () => {
      expect(getCurrentClinicId()).toBeUndefined();
    });

    it('有 clinicId 时应返回', () => {
      const context: RequestContext = { traceId: 't', clinicId: 'clinic-xyz' };
      runWithContext(context, () => {
        expect(getCurrentClinicId()).toBe('clinic-xyz');
      });
    });

    it('没有 clinicId 时应返回 undefined', () => {
      const context: RequestContext = { traceId: 't' };
      runWithContext(context, () => {
        expect(getCurrentClinicId()).toBeUndefined();
      });
    });
  });
});
