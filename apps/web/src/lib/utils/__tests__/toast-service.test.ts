import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { toastService } from '@/lib/utils/toast-service';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

const mockedToast = vi.mocked(toast);

describe('toastService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('success / warning / info 透传消息与描述', () => {
    toastService.success('保存成功', '数据已更新');
    toastService.warning('注意', '库存偏低');
    toastService.info('提示');

    expect(mockedToast.success).toHaveBeenCalledWith('保存成功', { description: '数据已更新' });
    expect(mockedToast.warning).toHaveBeenCalledWith('注意', { description: '库存偏低' });
    expect(mockedToast.info).toHaveBeenCalledWith('提示', { description: undefined });
  });

  it('error 以 Error.message 作为描述，无 error 时描述为 undefined', () => {
    toastService.error('操作失败', new Error('网络中断'));
    expect(mockedToast.error).toHaveBeenCalledWith('操作失败', { description: '网络中断' });

    toastService.error('操作失败');
    expect(mockedToast.error).toHaveBeenLastCalledWith('操作失败', { description: undefined });
  });

  it('createSuccess / updateSuccess / deleteSuccess 拼接实体名', () => {
    toastService.createSuccess('患者');
    toastService.updateSuccess('预约');
    toastService.deleteSuccess('账单');

    expect(mockedToast.success).toHaveBeenNthCalledWith(1, '患者创建成功');
    expect(mockedToast.success).toHaveBeenNthCalledWith(2, '预约更新成功');
    expect(mockedToast.success).toHaveBeenNthCalledWith(3, '账单删除成功');
  });

  it('createError / updateError / deleteError 携带错误描述', () => {
    const err = new Error('boom');
    toastService.createError('患者', err);
    toastService.updateError('预约', err);
    toastService.deleteError('账单');

    expect(mockedToast.error).toHaveBeenNthCalledWith(1, '患者创建失败', { description: 'boom' });
    expect(mockedToast.error).toHaveBeenNthCalledWith(2, '预约更新失败', { description: 'boom' });
    expect(mockedToast.error).toHaveBeenNthCalledWith(3, '账单删除失败', {
      description: undefined,
    });
  });

  it('validationError / networkError / unauthorized 固定文案', () => {
    toastService.validationError('手机号', '格式不正确');
    toastService.networkError();
    toastService.unauthorized();

    expect(mockedToast.error).toHaveBeenNthCalledWith(1, '手机号 格式不正确');
    expect(mockedToast.error).toHaveBeenNthCalledWith(2, '网络请求失败，请检查网络连接');
    expect(mockedToast.error).toHaveBeenNthCalledWith(3, '登录已过期，请重新登录');
  });
});
