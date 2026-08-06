import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, LoadingState, PageError, type DataTableColumn } from './components';
import { formatMoney } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const PROCESSING_STATUS_LABELS: Record<string, string> = {
  SENT: '已发送',
  IN_PROGRESS: '加工中',
  COMPLETED: '已完成',
  RECEIVED: '已收货',
};

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  PENDING: '待收货',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

const STOCKTAKE_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: '进行中',
  LOCKED: '已锁定',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export function InventoryWorkflowPage() {
  const { showToast } = useToast();
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [stocktakeNumber, setStocktakeNumber] = useState('');
  const [stocktakeNote, setStocktakeNote] = useState('');
  const [expandedStocktakeId, setExpandedStocktakeId] = useState<string | null>(null);
  const [countedInputs, setCountedInputs] = useState<Record<string, string>>({});
  const purchase = useQuery({
    queryKey: ['po-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/purchaseOrders?page=1&pageSize=100'),
  });
  const purchaseItems = useQuery({
    queryKey: ['po-items-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/purchaseOrderItems?page=1&pageSize=200'),
  });
  const processing = useQuery({
    queryKey: ['processing-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/processingOrders?page=1&pageSize=100'),
  });
  const suggestions = useQuery({
    queryKey: ['suggestions-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100'),
  });
  const stocktakes = useQuery({
    queryKey: ['stocktakes-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/stocktakes'),
  });
  const stocktakeItems = useQuery({
    queryKey: ['stocktake-items', expandedStocktakeId ?? ''],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>(`/stocktakes/${String(expandedStocktakeId)}/items`),
    enabled: expandedStocktakeId !== null,
  });

  if (purchase.isLoading || purchaseItems.isLoading || processing.isLoading || suggestions.isLoading) {
    return <LoadingState label="库存与采购数据加载中..." />;
  }
  const loadError = purchase.error ?? purchaseItems.error ?? processing.error ?? suggestions.error;
  if (loadError) {
    return (
      <div className="page">
        <PageError message={loadError instanceof Error ? loadError.message : String(loadError)} />
        <button onClick={() => {
          void purchase.refetch();
          void purchaseItems.refetch();
          void processing.refetch();
          void suggestions.refetch();
        }}>重试</button>
      </div>
    );
  }

  async function run(path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>) {
    try {
      await apiRequest(path, { method, body: JSON.stringify(body) });
      showToast('操作成功', 'success');
      await Promise.all([purchase.refetch(), processing.refetch(), suggestions.refetch()]);
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
    }
  }

  async function applySuggestions() {
    if (!selectedSuggestions.length) return;
    await run('/inventory/replenishment/apply', 'POST', { ids: selectedSuggestions });
    setSelectedSuggestions([]);
  }

  async function generateSuggestions() {
    await run('/inventory/replenishment/generate', 'POST', {});
  }

  const openSuggestions = suggestions.data?.items.filter((row) => {
    const status = row.status === null || row.status === undefined ? 'OPEN' : String(row.status);
    return status === 'OPEN';
  }) ?? [];

  const purchaseColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'number', label: '单号', render: (row) => String(row.number ?? row.id ?? '').slice(0, 14) },
    { key: 'supplierId', label: '供应商', render: (row) => String(row.supplierId ?? '') },
    { key: 'totalAmount', label: '金额', render: (row) => formatMoney(row.totalAmount) },
    { key: 'status', label: '状态', render: (row) => PURCHASE_STATUS_LABELS[String(row.status)] ?? String(row.status) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => <button onClick={() => run(`/purchase-orders/${String(row.id)}/receive`, 'PATCH', {})}>收货</button>,
    },
  ];

  const purchaseItemColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'orderId', label: '采购单', render: (row) => String(row.orderId ?? '').slice(0, 8) },
    { key: 'name', label: '项目', render: (row) => String(row.name ?? row.itemId ?? '') },
    { key: 'quantity', label: '数量', render: (row) => String(row.quantity ?? '') },
    { key: 'unitPrice', label: '单价', render: (row) => formatMoney(row.unitPrice) },
    { key: 'subtotal', label: '小计', render: (row) => formatMoney(row.subtotal) },
  ];

  const processingColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'status', label: '状态', render: (row) => PROCESSING_STATUS_LABELS[String(row.status)] ?? String(row.status) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <select defaultValue="" onChange={(event) => event.target.value && run(`/processing-orders/${String(row.id)}/status`, 'PATCH', { status: event.target.value })}>
          <option value="">流转</option>
          <option value="SENT">已发送</option>
          <option value="IN_PROGRESS">加工中</option>
          <option value="COMPLETED">已完成</option>
          <option value="RECEIVED">已收货</option>
        </select>
      ),
    },
  ];

  const suggestionColumns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'selected',
      label: '选',
      render: (row) => (
        <input type="checkbox" checked={selectedSuggestions.includes(String(row.id))} onChange={(event) => {
          setSelectedSuggestions((current) => event.target.checked ? [...current, String(row.id)] : current.filter((id) => id !== String(row.id)));
        }} />
      ),
    },
    { key: 'inventoryId', label: '库存项目', render: (row) => String(row.inventoryId ?? row.id ?? '').slice(0, 12) },
    { key: 'rop', label: '补货点', render: (row) => String(row.rop ?? '') },
    { key: 'suggestedQty', label: '建议数量', render: (row) => String(row.suggestedQty ?? '') },
    { key: 'status', label: '状态', render: () => '待应用' },
  ];

  async function stocktakeAction(path: string, method: 'PATCH' | 'POST', body?: Record<string, unknown>) {
    try {
      await apiRequest(path, { method, body: JSON.stringify(body ?? {}) });
      showToast('操作成功', 'success');
      await stocktakes.refetch();
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
    }
  }

  async function createStocktake() {
    const number = stocktakeNumber.trim();
    if (!number) {
      showToast('请填写盘点单号', 'error');
      return;
    }
    const note = stocktakeNote.trim() || undefined;
    await stocktakeAction('/stocktakes', 'POST', { number, note });
    setStocktakeNumber('');
    setStocktakeNote('');
  }

  function toggleStocktakeItems(stocktakeId: string) {
    setExpandedStocktakeId((current) => current === stocktakeId ? null : stocktakeId);
    setCountedInputs({});
  }

  async function saveCountedStock(stocktakeId: string, itemId: string) {
    const raw = countedInputs[itemId];
    const countedStock = Number(raw);
    if (raw === undefined || raw.trim() === '' || !Number.isInteger(countedStock) || countedStock < 0) {
      showToast('录入数量必须是非负整数', 'error');
      return;
    }
    try {
      await apiRequest(`/stocktakes/${stocktakeId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ countedStock }),
      });
      showToast('操作成功', 'success');
      await Promise.all([stocktakes.refetch(), stocktakeItems.refetch()]);
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
    }
  }

  const lockStocktake = (id: string) => stocktakeAction(`/stocktakes/${id}/lock`, 'POST');
  const completeStocktake = (id: string) => stocktakeAction(`/stocktakes/${id}/complete`, 'POST');
  const cancelStocktake = (id: string) => stocktakeAction(`/stocktakes/${id}/cancel`, 'POST');

  const stocktakeColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'number', label: '单号', render: (row) => String(row.number ?? '') },
    { key: 'status', label: '状态', render: (row) => STOCKTAKE_STATUS_LABELS[String(row.status)] ?? String(row.status) },
    { key: 'startedById', label: '开始人', render: (row) => String(row.startedById ?? '') },
    { key: 'startedAt', label: '开始时间', render: (row) => String(row.startedAt ?? '').slice(0, 16).replace('T', ' ') },
    { key: 'itemCount', label: '项目数', render: (row) => String(row.itemCount ?? 0) },
    { key: 'differenceCount', label: '差异数', render: (row) => String(row.differenceCount ?? 0) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => {
        const status = String(row.status);
        const id = String(row.id);
        if (status === 'IN_PROGRESS') {
          return (
            <span className="inline-form">
              <button onClick={() => toggleStocktakeItems(id)}>{expandedStocktakeId === id ? '收起' : '录入'}</button>
              <button onClick={() => lockStocktake(id)}>锁定</button>
              <button onClick={() => cancelStocktake(id)}>取消</button>
            </span>
          );
        }
        if (status === 'LOCKED') {
          return (
            <span className="inline-form">
              <button onClick={() => completeStocktake(id)}>完成盘点</button>
              <button onClick={() => cancelStocktake(id)}>取消</button>
            </span>
          );
        }
        return null;
      },
    },
  ];

  const stocktakeItemColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'name', label: '项目', render: (row) => String(row.name ?? row.itemId ?? '') },
    { key: 'code', label: '编码', render: (row) => String(row.code ?? '') },
    { key: 'systemStock', label: '系统库存', render: (row) => String(row.systemStock ?? 0) },
    {
      key: 'countedStock',
      label: '实盘数量',
      render: (row) => {
        const itemId = String(row.itemId);
        const fallback = row.countedStock === null || row.countedStock === undefined ? '' : String(row.countedStock);
        return (
          <input
            type="number"
            min={0}
            aria-label="实盘数量"
            value={countedInputs[itemId] ?? fallback}
            onChange={(event) => setCountedInputs((current) => ({ ...current, [itemId]: event.target.value }))}
          />
        );
      },
    },
    { key: 'difference', label: '差异', render: (row) => String(row.difference ?? 0) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (<button onClick={() => saveCountedStock(String(expandedStocktakeId), String(row.itemId))}>保存</button>),
    },
  ];

  return (
    <div className="page">
      <h1>库存与采购操作</h1>
      <h2>采购单</h2>
      <DataTable
        columns={purchaseColumns}
        rows={purchase.data?.items.filter((row) => String(row.status) === 'PENDING') ?? []}
        keyField="id"
        emptyText="暂无待收货采购单"
      />
      <h2>采购单明细</h2>
      <DataTable columns={purchaseItemColumns} rows={purchaseItems.data?.items ?? []} keyField="id" emptyText="暂无采购明细" />
      <h2>加工单</h2>
      <DataTable columns={processingColumns} rows={processing.data?.items ?? []} keyField="id" emptyText="暂无加工单" />
      <h2>补货建议</h2>
      <div className="inline-form">
        <button onClick={generateSuggestions}>生成补货建议</button>
        <button onClick={applySuggestions}>应用选中建议</button>
      </div>
      <DataTable columns={suggestionColumns} rows={openSuggestions} keyField="id" emptyText="暂无待应用补货建议" />
      <h2>库存盘点</h2>
      <div className="inline-form">
        <input
          value={stocktakeNumber}
          onChange={(event) => setStocktakeNumber(event.target.value)}
          placeholder="盘点单号"
          aria-label="盘点单号"
        />
        <input
          value={stocktakeNote}
          onChange={(event) => setStocktakeNote(event.target.value)}
          placeholder="备注"
          aria-label="备注"
        />
        <button onClick={createStocktake}>开始盘点</button>
      </div>
      {stocktakes.isLoading ? <LoadingState label="盘点数据加载中..." /> : null}
      {stocktakes.error ? <PageError message={stocktakes.error instanceof Error ? stocktakes.error.message : String(stocktakes.error)} /> : null}
      {!stocktakes.isLoading && !stocktakes.error ? (
        <DataTable columns={stocktakeColumns} rows={stocktakes.data?.items ?? []} keyField="id" emptyText="暂无盘点单" />
      ) : null}
      {expandedStocktakeId ? (
        <div>
          <h3>录入盘点数量</h3>
          {stocktakeItems.isLoading ? <LoadingState label="盘点明细加载中..." /> : null}
          {stocktakeItems.error ? <PageError message={stocktakeItems.error instanceof Error ? stocktakeItems.error.message : String(stocktakeItems.error)} /> : null}
          {!stocktakeItems.isLoading && !stocktakeItems.error && stocktakeItems.data && stocktakeItems.data.length > 0 ? (
            <DataTable columns={stocktakeItemColumns} rows={stocktakeItems.data} keyField="id" emptyText="暂无明细" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
