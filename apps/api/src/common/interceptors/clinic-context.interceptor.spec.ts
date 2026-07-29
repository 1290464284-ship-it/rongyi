import { ClinicContextInterceptor } from './clinic-context.interceptor';
import { ClinicContextService } from '../services/clinic-context.service';
import { of } from 'rxjs';

function createMockContext(user?: { clinicId?: string; id?: string; role?: string }, userAgent?: string) {
  const request = {
    user,
    headers: { 'user-agent': userAgent ?? 'Mozilla/5.0' },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as any;
}

function createMockCallHandler(value: unknown = 'ok') {
  return {
    handle: () => of(value),
  } as any;
}

describe('ClinicContextInterceptor', () => {
  let interceptor: ClinicContextInterceptor;
  let clinicContext: ClinicContextService;

  beforeEach(() => {
    clinicContext = {
      run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
      getClinicId: () => 'test-clinic',
      getUserId: () => 'test-user',
      getRole: () => 'DOCTOR',
      getUserAgent: () => 'jest',
      getSource: () => 'test',
      isInitialized: () => true,
    } as unknown as ClinicContextService;
    interceptor = new ClinicContextInterceptor(clinicContext);
  });

  it('应从 request.user 提取 clinicId 并传递给 run', (done) => {
    const ctx = createMockContext({ clinicId: 'clinic-1', id: 'user-1', role: 'BOSS' });
    const next = createMockCallHandler();

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        expect(clinicContext.run).toHaveBeenCalled();
        const runCtx = (clinicContext.run as jest.Mock).mock.calls[0][0];
        expect(runCtx.clinicId).toBe('clinic-1');
        expect(runCtx.userId).toBe('user-1');
        expect(runCtx.role).toBe('BOSS');
        done();
      },
    });
  });

  it('无 user 时 clinicId 为 null', (done) => {
    const ctx = createMockContext();
    const next = createMockCallHandler();

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        const runCtx = (clinicContext.run as jest.Mock).mock.calls[0][0];
        expect(runCtx.clinicId).toBeNull();
        expect(runCtx.userId).toBeNull();
        done();
      },
    });
  });

  it('Electron 请求 source 应为 electron', (done) => {
    const ctx = createMockContext({ clinicId: 'c1' }, 'MyApp/1.0 Electron/28.0');
    const next = createMockCallHandler();

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        const runCtx = (clinicContext.run as jest.Mock).mock.calls[0][0];
        expect(runCtx.source).toBe('electron');
        done();
      },
    });
  });

  it('普通浏览器 source 应为 web', (done) => {
    const ctx = createMockContext({ clinicId: 'c1' }, 'Mozilla/5.0');
    const next = createMockCallHandler();

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        const runCtx = (clinicContext.run as jest.Mock).mock.calls[0][0];
        expect(runCtx.source).toBe('web');
        done();
      },
    });
  });
});
