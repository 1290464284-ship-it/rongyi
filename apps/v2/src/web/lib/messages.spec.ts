import { describe, expect, it, vi } from 'vitest';
import { errorMessage, friendlyError } from './messages';

describe('friendlyError', () => {
  it('translates common server errors and falls back to a Chinese message for unknown ones', () => {
    expect(friendlyError(new Error('Patient not found'))).toBe('患者不存在');
    expect(friendlyError(new Error('Invalid payment method'))).toBe('支付方式无效');
    // M5：未命中的英文/内部消息不再原样暴露，统一兜底中文文案
    expect(friendlyError(new Error('custom error'))).toBe('操作失败，请稍后重试');
    expect(friendlyError('plain text')).toBe('操作失败，请稍后重试');
    // 中文消息已可读，直接透传（H4「部分明细可能未保存」提示依赖该行为）
    expect(friendlyError(new Error('更新采购单失败；部分明细可能未保存，请核对后重试'))).toBe('更新采购单失败；部分明细可能未保存，请核对后重试');
  });

  it('translates network, state transition, and dynamic unique errors', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toBe('无法连接本地服务，请检查应用是否正常运行');
    expect(friendlyError('Cannot transition from BOOKED to UNKNOWN')).toBe('当前状态不能执行该操作');
    expect(friendlyError('Appointment violates a unique field constraint')).toBe('记录已存在，请检查唯一字段');
    expect(friendlyError('Inventory item not found: item-1')).toBe('库存项目不存在');
  });

  it('translates newly added permission and clinic scope errors', () => {
    expect(friendlyError(new Error('Insufficient permissions'))).toBe('权限不足');
    expect(friendlyError(new Error('No clinic scope assigned to this account'))).toBe('账号未分配诊所，请联系管理员');
  });

  it('uses a stable Chinese fallback for non-error failures', () => {
    expect(errorMessage('boom', '操作失败，请稍后重试')).toBe('操作失败，请稍后重试');
    expect(errorMessage(new Error('Patient not found'), '操作失败')).toBe('患者不存在');
  });

  it('covers pattern and resource-name fallbacks', () => {
    expect(friendlyError('Username is required')).toBe('请填写必填项');
    expect(friendlyError('Name must be unique')).toBe('输入内容格式不正确');
    expect(friendlyError('Remark exceeds max length')).toBe('输入内容超过长度限制');
    expect(friendlyError('Medical record not found')).toBe('病历不存在');
    expect(friendlyError('Processing order not found')).toBe('加工单不存在');
    expect(friendlyError('Sync record not found')).toBe('同步记录不存在');
    expect(friendlyError('Wechat message not found')).toBe('微信消息不存在');
    expect(friendlyError('Member card not found')).toBe('会员卡不存在');
    expect(friendlyError('Cephalometric case not found')).toBe('头影测量记录不存在');
    expect(friendlyError('Resource cannot import: patients')).toBe('该资源不支持批量导入');
    expect(friendlyError('Bulk import is disabled for patients')).toBe('该资源已禁用批量导入');
    expect(friendlyError('Invalid user role: X')).toBe('用户角色无效');
    expect(friendlyError('Purchase order contains missing inventory items: i-1')).toBe('采购单包含不存在的库存项目');
    expect(friendlyError('Sync change requires row data')).toBe('同步数据格式不正确');
    expect(friendlyError('Sync record not found: r-1')).toBe('同步记录不存在');
    expect(friendlyError('Table is not allowed for sync')).toBe('同步表不允许');
    expect(friendlyError('Sync operation must be INSERT, UPDATE, or DELETE')).toBe('同步操作类型无效');
  });

  it('warns and falls back for unknown English messages', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(friendlyError('a completely unexpected message')).toBe('操作失败，请稍后重试');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses the fallback when the error has no message', () => {
    expect(errorMessage(new Error(''))).toBe('操作失败，请稍后重试');
    expect(errorMessage('')).toBe('操作失败，请稍后重试');
  });

  it('appends the trace id when the error carries one', () => {
    const error = new Error('Patient not found');
    (error as { traceId?: string }).traceId = 'trace-abc';
    expect(errorMessage(error)).toBe('患者不存在（trace: trace-abc）');
  });
});
