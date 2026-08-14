// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, fetchAllPages } from '../lib/api';
import { receivePurchase, reconcilePurchaseItems, reviewAction } from './api';

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
  fetchAllPages: vi.fn(),
}));

afterEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(fetchAllPages).mockReset();
});

describe('purchase-orders/api', () => {
  it('reconciles items with new, patched and deleted rows', async () => {
    vi.mocked(fetchAllPages).mockResolvedValue([
      { id: 'keep', itemId: 'i-1', name: '耗材', spec: 'S', quantity: 1, unitPrice: 100 },
      { id: 'remove', itemId: 'i-1', name: '耗材', spec: 'S', quantity: 1, unitPrice: 100 },
    ]);
    const items = [
      { id: 'keep', itemId: 'i-1', name: '耗材', spec: 'S', quantity: '2', unitPrice: '1' },
      { id: undefined, itemId: '', name: '', spec: '', quantity: '1', unitPrice: '50' },
      { id: 'bad', itemId: 'i-1', name: '', spec: '', quantity: '0', unitPrice: '100' },
    ];
    await reconcilePurchaseItems('po-1', items as never);

    expect(apiRequest).toHaveBeenCalledWith('/resources/purchaseOrderItems/keep', expect.objectContaining({ method: 'PATCH' }));
    expect(apiRequest).toHaveBeenCalledWith('/resources/purchaseOrderItems', expect.objectContaining({ method: 'POST' }));
    expect(apiRequest).toHaveBeenCalledWith('/resources/purchaseOrderItems/remove', expect.objectContaining({ method: 'DELETE' }));
    const postCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/purchaseOrderItems');
    expect(JSON.parse(String((postCall?.[1] as RequestInit)?.body))).toMatchObject({
      orderId: 'po-1',
      name: '自定义项目',
      quantity: 1,
      unitPrice: 5000,
    });
    expect(JSON.parse(String((postCall?.[1] as RequestInit)?.body)).itemId).toBeUndefined();
  });

  it('reports review action success and failure', async () => {
    const showToast = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    const setReviewing = vi.fn();
    const onChanged = vi.fn();
    await reviewAction(showToast, reload, setReviewing, onChanged, 'po-1', 'approve', '已通过审核');
    expect(apiRequest).toHaveBeenCalledWith('/purchase-orders/po-1/approve', expect.objectContaining({ method: 'POST' }));
    expect(showToast).toHaveBeenCalledWith('已通过审核', 'success');
    expect(reload).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();

    vi.mocked(apiRequest).mockRejectedValueOnce(new Error(''));
    await reviewAction(showToast, reload, setReviewing, onChanged, 'po-1', 'approve', '已通过审核');
    expect(showToast).toHaveBeenCalledWith('操作失败，请稍后重试', 'error');
  });

  it('reports receive success and failure', async () => {
    const showToast = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    const setReceiving = vi.fn();
    const onChanged = vi.fn();
    await receivePurchase(showToast, reload, setReceiving, 'po-1', onChanged);
    expect(apiRequest).toHaveBeenCalledWith('/purchase-orders/po-1/receive', expect.objectContaining({ method: 'PATCH' }));
    expect(showToast).toHaveBeenCalledWith('采购单已收货', 'success');
    expect(onChanged).toHaveBeenCalled();

    vi.mocked(apiRequest).mockRejectedValueOnce(new Error(''));
    await receivePurchase(showToast, reload, setReceiving, 'po-1', onChanged);
    expect(showToast).toHaveBeenCalledWith('收货失败', 'error');
  });

  it('skips invalid items and uses fallback names when reconciling', async () => {
    vi.mocked(fetchAllPages).mockResolvedValue([
      { id: 'keep2', itemId: 'i-1', name: '耗材', spec: 'S', quantity: 1, unitPrice: 100 },
    ]);
    const items = [
      { id: 'keep2', itemId: '', name: '', spec: '', quantity: '1', unitPrice: '1' },
      { id: undefined, itemId: 'i-9', name: '', spec: '', quantity: '1', unitPrice: '1' },
      { id: undefined, itemId: '', name: '', spec: '', quantity: '', unitPrice: '1' },
    ];
    await reconcilePurchaseItems('po-2', items as never);

    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/resources/purchaseOrderItems/keep2' && (options as RequestInit)?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const patchBody = JSON.parse(String((patchCall?.[1] as RequestInit)?.body)) as Record<string, unknown>;
    expect(patchBody.itemId).toBeUndefined();
    expect(patchBody.name).toBe('自定义项目');
    expect(patchBody.spec).toBeUndefined();

    const postCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/resources/purchaseOrderItems' && (options as RequestInit)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    const postBody = JSON.parse(String((postCalls[0]?.[1] as RequestInit)?.body)) as Record<string, unknown>;
    expect(postBody).toMatchObject({ itemId: 'i-9', name: '自定义项目' });
    expect(postBody.spec).toBeUndefined();
  });

  it('uses the form item name when the item id is matched', async () => {
    vi.mocked(fetchAllPages).mockResolvedValue([]);
    const items = [{ id: undefined, itemId: 'i-1', name: '耗材甲', spec: 'X', quantity: '1', unitPrice: '1' }];
    await reconcilePurchaseItems('po-3', items as never);
    const postCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/purchaseOrderItems');
    const postBody = JSON.parse(String((postCall?.[1] as RequestInit)?.body)) as Record<string, unknown>;
    expect(postBody).toMatchObject({ name: '耗材甲', spec: 'X' });
  });
});
