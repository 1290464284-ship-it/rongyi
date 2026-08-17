import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { DataTable, LoadingState, PageError, PagePager, QuerySection } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import { useToast } from '../../lib/toast-context';
import { inventoryWorkflowColumns } from './inventory-workflow-columns';

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
    // W-2：待收货列表改服务端 status 过滤（通用列表等值过滤），不再依赖页内 filter 截断。
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/purchaseOrders?page=${purchasePage}&pageSize=100&status=PENDING`),
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
    // W-2：待应用建议改服务端 status 过滤（OPEN），不再依赖页内 filter 截断。
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(`/resources/inventoryReplenishmentSuggestions?page=${suggestionsPage}&pageSize=100&status=OPEN`),
  });
  const openSuggestions = useMemo(
    () => (suggestions.data?.items ?? []).filter((row) => {
      // 服务端已按 OPEN 过滤；保留 null→OPEN 的历史兜底作为次级防御。
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
    /* v8 ignore next -- 应用按钮在 0 选中时 disabled，浏览器不派发点击，守卫为防御冗余 */
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

  async function stocktakeAction(path: string, method: 'PATCH' | 'POST', body?: Record<string, unknown>): Promise<boolean> {
    try {
      await apiRequest(path, { method, body: JSON.stringify(body ?? {}) });
      showToast('操作成功', 'success');
      await stocktakes.refetch();
      return true;
    } catch (error) {
      showToast(errorMessage(error, '操作失败'), 'error');
      return false;
    }
  }

  async function createStocktake() {
    const number = stocktakeNumber.trim();
    if (!number) {
      showToast('请填写盘点单号', 'error');
      return;
    }
    const note = stocktakeNote.trim() || undefined;
    // 仅创建成功后清空输入：失败时保留用户填写的单号/备注，避免重复劳动。
    if (await stocktakeAction('/stocktakes', 'POST', { number, note })) {
      setStocktakeNumber('');
      setStocktakeNote('');
    }
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

  const {
    purchaseColumns,
    purchaseItemColumns,
    processingColumns,
    suggestionColumns,
    stocktakeColumns,
    stocktakeItemColumns,
  } = inventoryWorkflowColumns({
    selectedSuggestions,
    setSelectedSuggestions,
    onReceive: async (id) => {
      await run(`/purchase-orders/${id}/receive`, 'PATCH', {});
    },
    onStatusFlow: async (id, status) => {
      await run(`/processing-orders/${id}/status`, 'PATCH', { status });
    },
    expandedStocktakeId,
    onToggleStocktakeItems: toggleStocktakeItems,
    onStocktakeAction: stocktakeAction,
    countedInputs,
    setCountedInputs,
    savingCounted,
    onSaveCounted: (stocktakeId, itemId) => saveCountedStock(stocktakeId, itemId),
  });

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
                onPageChange={(next) => {
                  setSelectedSuggestions([]);
                  setSuggestionsPage(next);
                }}
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
