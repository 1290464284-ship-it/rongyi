import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { DataTable, LoadingState, PageError, PagePager, QuerySection, type DataTableColumn } from '../../components';
import { formatMoney } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import { useToast } from '../../lib/toast-context';
import { INVENTORY_PROCESSING_STATUS_LABELS, PURCHASE_STATUS_LABELS, STOCKTAKE_STATUS_LABELS } from '../../lib/labels';

export function InventoryWorkflowPage() {
  const { showToast } = useToast();
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [stocktakeNumber, setStocktakeNumber] = useState('');
  const [stocktakeNote, setStocktakeNote] = useState('');
  const [expandedStocktakeId, setExpandedStocktakeId] = useState<string | null>(null);
  const [countedInputs, setCountedInputs] = useState<Record<string, string>>({});
  // 写请求 busy 守卫：防止双击重复创建盘点单
  const { busy: creatingStocktake, run: runCreateStocktake } = useAsyncAction();
  const { busy: suggestionsBusy, run: runSuggestions } = useAsyncAction();
  const { busy: savingCounted, run: runSavingCounted } = useAsyncAction();
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseItemsPage, setPurchaseItemsPage] = useState(1);
  const [processingPage, setProcessingPage] = useState(1);
  const [suggestionsPage, setSuggestionsPage] = useState(1);
  const [stocktakePage, setStocktakePage] = useState(1);
  const purchase = useQuery({
    queryKey: ['po-workflow', purchasePage],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/purchaseOrders?page=${purchasePage}&pageSize=100`),
  });
  const purchaseItems = useQuery({
    queryKey: ['po-items-workflow', purchaseItemsPage],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/purchaseOrderItems?page=${purchaseItemsPage}&pageSize=200`),
  });
  const pendingPurchaseRows = useMemo(
    () => (purchase.data?.items ?? []).filter((row) => String(row.status) === 'PENDING'),
    [purchase.data],
  );
  const processing = useQuery({
    queryKey: ['processing-workflow', processingPage],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/processingOrders?page=${processingPage}&pageSize=100`),
  });
  const suggestions = useQuery({
    queryKey: ['suggestions-workflow', suggestionsPage],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/inventoryReplenishmentSuggestions?page=${suggestionsPage}&pageSize=100`),
  });
  const openSuggestions = useMemo(
    () => (suggestions.data?.items ?? []).filter((row) => {
      const status = row.status === null || row.status === undefined ? 'OPEN' : String(row.status);
      return status === 'OPEN';
    }),
    [suggestions.data],
  );
  const stocktakes = useQuery({
    queryKey: ['stocktakes-workflow', stocktakePage],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/stocktakes?page=${stocktakePage}&pageSize=200`),
  });
  const stocktakeItems = useQuery({
    queryKey: ['stocktake-items', expandedStocktakeId ?? ''],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>(`/stocktakes/${String(expandedStocktakeId)}/items`),
    enabled: expandedStocktakeId !== null,
  });

  async function run(path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>): Promise<boolean> {
    try {
      await apiRequest(path, { method, body: JSON.stringify(body) });
      showToast('操作成功', 'success');
      await Promise.all([purchase.refetch(), purchaseItems.refetch(), processing.refetch(), suggestions.refetch()]);
      return true;
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
      return false;
    }
  }

  async function applySuggestions() {
    if (!selectedSuggestions.length) return;
    await runSuggestions(async () => {
      const applied = await run('/inventory/replenishment/apply', 'POST', { ids: selectedSuggestions });
      if (applied) setSelectedSuggestions([]);
    });
  }

  async function generateSuggestions() {
    await runSuggestions(async () => {
      await run('/inventory/replenishment/generate', 'POST', {});
    });
  }

  const purchaseColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'number', label: '单号', render: (row) => String(row.number ?? row.id ?? '').slice(0, 14) },
    { key: 'supplierId', label: '供应商', render: (row) => String(row.supplierId ?? '') },
    { key: 'totalAmount', label: '金额', render: (row) => formatMoney(row.totalAmount) },
    { key: 'status', label: '状态', render: (row) => PURCHASE_STATUS_LABELS[String(row.status)] ?? String(row.status) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <ReceiveButton
          id={String(row.id)}
          onDone={async (id) => {
            await run(`/purchase-orders/${id}/receive`, 'PATCH', {});
          }}
        />
      ),
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
    { key: 'status', label: '状态', render: (row) => INVENTORY_PROCESSING_STATUS_LABELS[String(row.status)] ?? String(row.status) },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <StatusFlowSelect
          id={String(row.id)}
          onDone={async (id, status) => {
            await run(`/processing-orders/${id}/status`, 'PATCH', { status });
          }}
        />
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
    await runSavingCounted(async () => {
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
    });
  }

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
              <StocktakeRowActions
                id={id}
                onDone={stocktakeAction}
              />
            </span>
          );
        }
        if (status === 'LOCKED') {
          return (
            <span className="inline-form">
              <StocktakeRowActions
                id={id}
                onDone={stocktakeAction}
                locked
              />
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
      render: (row) => (
        <button disabled={savingCounted} onClick={() => saveCountedStock(String(expandedStocktakeId), String(row.itemId))}>
          {savingCounted ? '保存中...' : '保存'}
        </button>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head"><h1>库存与采购操作</h1></div>
      <h2>采购单</h2>
      <QuerySection
        query={purchase}
        render={() => (
          <DataTable
            columns={purchaseColumns}
            rows={pendingPurchaseRows}
            keyField="id"
            emptyText="暂无待收货采购单"
          />
        )}
      />
      <PagePager
        page={purchasePage}
        hasNext={purchasePage * 100 < (purchase.data?.total ?? 0)}
        onPageChange={setPurchasePage}
        disabled={purchase.isFetching}
      />
      {purchase.data?.truncated && <p className="reminder-muted">采购单超过 100 条，仅显示部分数据</p>}
      <h2>采购单明细</h2>
      <QuerySection
        query={purchaseItems}
        render={(data) => <DataTable columns={purchaseItemColumns} rows={data?.items ?? []} keyField="id" emptyText="暂无采购明细" />}
      />
      <PagePager
        page={purchaseItemsPage}
        hasNext={purchaseItemsPage * 200 < (purchaseItems.data?.total ?? 0)}
        onPageChange={setPurchaseItemsPage}
        disabled={purchaseItems.isFetching}
      />
      {purchaseItems.data && (purchaseItems.data.total ?? 0) > (purchaseItems.data.items?.length ?? 0) && (
        <p className="reminder-muted">采购明细超过 200 条，仅显示部分数据</p>
      )}
      <h2>加工单</h2>
      <QuerySection
        query={processing}
        render={(data) => <DataTable columns={processingColumns} rows={data?.items ?? []} keyField="id" emptyText="暂无加工单" />}
      />
      <PagePager
        page={processingPage}
        hasNext={processingPage * 100 < (processing.data?.total ?? 0)}
        onPageChange={setProcessingPage}
        disabled={processing.isFetching}
      />
      {processing.data?.truncated && <p className="reminder-muted">加工单超过 100 条，仅显示部分数据</p>}
      <h2>补货建议</h2>
      <QuerySection
        query={suggestions}
        render={(data) => {
          return (
            <>
              <div className="inline-form">
                <button disabled={suggestionsBusy} onClick={generateSuggestions}>{suggestionsBusy ? '处理中...' : '生成补货建议'}</button>
                <button disabled={suggestionsBusy || selectedSuggestions.length === 0} onClick={applySuggestions}>{suggestionsBusy ? '处理中...' : '应用选中建议'}</button>
              </div>
              <DataTable columns={suggestionColumns} rows={openSuggestions} keyField="id" emptyText="暂无待应用补货建议" />
              <PagePager
                page={suggestionsPage}
                hasNext={suggestionsPage * 100 < (data?.total ?? 0)}
                onPageChange={setSuggestionsPage}
                disabled={suggestions.isFetching}
              />
              {(data?.total ?? 0) > (data?.items?.length ?? 0) && (
                <p className="reminder-muted">补货建议超过 100 条，仅显示部分数据</p>
              )}
            </>
          );
        }}
      />
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
        <button onClick={() => void runCreateStocktake(createStocktake)} disabled={creatingStocktake}>
          {creatingStocktake ? '创建中...' : '开始盘点'}
        </button>
      </div>
      {stocktakes.isLoading ? <LoadingState label="盘点数据加载中..." /> : null}
      {stocktakes.error ? <PageError message={stocktakes.error instanceof Error ? stocktakes.error.message : String(stocktakes.error)} /> : null}
      {!stocktakes.isLoading && !stocktakes.error ? (
        <>
          <DataTable columns={stocktakeColumns} rows={stocktakes.data?.items ?? []} keyField="id" emptyText="暂无盘点单" />
          <PagePager
            page={stocktakePage}
            hasNext={stocktakePage * 200 < (stocktakes.data?.total ?? 0)}
            onPageChange={setStocktakePage}
            disabled={stocktakes.isFetching}
          />
          {stocktakes.data?.truncated ? (
            <p className="reminder-muted">
              盘点单超过 {stocktakes.data.pageSize} 条，仅显示前 {stocktakes.data.items.length} 条
            </p>
          ) : null}
        </>
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

/** 行内“收货”按钮：busy 期间禁用，防止双击重复收货。 */
function ReceiveButton({ id, onDone }: { id: string; onDone: (id: string) => Promise<void> }) {
  const { busy, run } = useAsyncAction();
  return (
    <button disabled={busy} onClick={() => run(() => onDone(id))}>
      {busy ? '收货中...' : '收货'}
    </button>
  );
}

/** 行内加工状态流转下拉：选中即触发，busy 期间禁用，防止连选重复流转。M12：受控 value + 选中后复位占位项。 */
function StatusFlowSelect({ id, onDone }: { id: string; onDone: (id: string, status: string) => Promise<void> }) {
  const { busy, run } = useAsyncAction();
  const [value, setValue] = useState('');
  return (
    <select
      disabled={busy}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue('');
        if (next) void run(() => onDone(id, next));
      }}
    >
      <option value="">流转</option>
      <option value="SENT">已发送</option>
      <option value="IN_PROGRESS">加工中</option>
      <option value="COMPLETED">已完成</option>
      <option value="RECEIVED">已收货</option>
    </select>
  );
}

/** 盘点单行内操作（锁定/完成/取消）：busy 期间全部禁用，防止双击重复状态迁移。 */
function StocktakeRowActions({ id, onDone, locked = false }: {
  id: string;
  onDone: (path: string, method: 'PATCH' | 'POST', body?: Record<string, unknown>) => Promise<void>;
  locked?: boolean;
}) {
  const { busy, run } = useAsyncAction();
  if (locked) {
    return (
      <span className="inline-form">
        <button disabled={busy} onClick={() => run(() => onDone(`/stocktakes/${id}/complete`, 'POST'))}>完成盘点</button>
        <button disabled={busy} onClick={() => run(() => onDone(`/stocktakes/${id}/cancel`, 'POST'))}>取消</button>
      </span>
    );
  }
  return (
    <span className="inline-form">
      <button disabled={busy} onClick={() => run(() => onDone(`/stocktakes/${id}/lock`, 'POST'))}>锁定</button>
      <button disabled={busy} onClick={() => run(() => onDone(`/stocktakes/${id}/cancel`, 'POST'))}>取消</button>
    </span>
  );
}
