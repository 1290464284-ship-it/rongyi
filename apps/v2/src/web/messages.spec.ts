import { describe, expect, it } from 'vitest';
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
});
