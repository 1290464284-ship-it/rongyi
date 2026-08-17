import { FormEvent, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { ConfirmDialog, Dialog, LoadingState, PageError, PagePager, SearchableSelect } from '../../components';

/** 批次列表每页条数（W-1 分页）。 */
const BATCH_PAGE_SIZE = 20;
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { useAsyncAction } from '../../hooks/use-async-action';
import type { BatchRow, BatchListData } from '../../inventory/types';
import { InventoryReportPanel } from './InventoryReportPanel';
import { BarcodeView } from '../../inventory/BarcodeView';

export function InventoryPage() {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const urlItemId = searchParams.get('id');
  const [itemId, setItemId] = useState<string | null>(urlItemId);
  const [prevUrlItemId, setPrevUrlItemId] = useState(urlItemId);
  if (prevUrlItemId !== urlItemId) {
    setPrevUrlItemId(urlItemId);
    setItemId(urlItemId);
  }
  const [itemIdError, setItemIdError] = useState<string | null>(null);
  const [type, setType] = useState<'IN' | 'OUT' | 'ADJUST'>('IN');
  const [quantity, setQuantity] = useState('1');
  const { busy: submitting, run: runSubmitting } = useAsyncAction();
  const [batchNo, setBatchNo] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [batchQuantity, setBatchQuantity] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [editTarget, setEditTarget] = useState<BatchRow | null>(null);
  const [editBatchNo, setEditBatchNo] = useState('');
  const [editProductionDate, setEditProductionDate] = useState('');
  const [editExpiryDate, setEditExpiryDate] = useState('');
  const [editSupplierId, setEditSupplierId] = useState('');
  const { busy: editing, run: runEditing } = useAsyncAction();
  const [deleteTarget, setDeleteTarget] = useState<BatchRow | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'report'>('overview');
  const [page, setPage] = useState(1);
  // W-1：批次列表独立分页（服务端 OFFSET，total 驱动）
  const [batchPage, setBatchPage] = useState(1);
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [barcodeTarget, setBarcodeTarget] = useState<Record<string, unknown> | null>(null);
  const query = useQuery({
    queryKey: ['inventory', page],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/inventoryItems?page=${page}&pageSize=20`,
    ),
    placeholderData: (previous) => previous,
  });
  const stale = query.isPlaceholderData;
  const derivedFromList = useRef(false);
  useEffect(() => {
    if (derivedFromList.current || !query.data) return;
    derivedFromList.current = true;
    const first = query.data.items[0];
    setItemId((current) => current ?? (first ? String(first.id) : null));
  }, [query.data]);
  const lowStock = useQuery({
    queryKey: ['inventory-low'],
    queryFn: () => apiRequest<{ items: Array<Record<string, unknown>>; truncated: boolean }>('/inventory/low-stock'),
  });
  const expiring = useQuery({
    queryKey: ['inventory-expiring'],
    queryFn: () => apiRequest<{ items: Array<Record<string, unknown>>; truncated: boolean }>('/inventory/expiring?days=30'),
  });
  const batches = useQuery({
    queryKey: ['inventory-batches', itemId ?? '', batchPage],
    queryFn: () => apiRequest<BatchListData>(
      itemId ? `/inventory-batches?itemId=${encodeURIComponent(itemId)}&page=${batchPage}&pageSize=${BATCH_PAGE_SIZE}` : '/inventory-batches',
    ),
    // 未选中项目时不拉取：避免 itemId 为空时退化为全量批次拉取（历史数据可增长）。
    enabled: Boolean(itemId),
  });
  const expiringBatches = useQuery({
    queryKey: ['inventory-batches-expiring'],
    queryFn: () => apiRequest<BatchListData>('/inventory-batches?days=30'),
  });

  if (query.isLoading || lowStock.isLoading || expiring.isLoading) return <LoadingState label="库存数据加载中..." />;
  const loadError = query.error ?? lowStock.error ?? expiring.error;
  if (loadError) {
    return (
      <div className="page">
        <PageError message={loadError instanceof Error ? loadError.message : String(loadError)} />
        <button onClick={() => {
          void query.refetch();
          void lowStock.refetch();
          void expiring.refetch();
        }}>重试</button>
      </div>
    );
  }
  // 兼容旧接口直接返回数组的响应；新接口返回 { items, truncated }。
  const lowItems = Array.isArray(lowStock.data) ? lowStock.data : lowStock.data?.items ?? [];
  const expiringItems = Array.isArray(expiring.data) ? expiring.data : expiring.data?.items ?? [];
  const lowTruncated = !Array.isArray(lowStock.data) && Boolean(lowStock.data?.truncated);
  const expiringTruncated = !Array.isArray(expiring.data) && Boolean(expiring.data?.truncated);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || stale) return;
    // M13：itemId 必填，提交前字段级校验（避免报错延迟到服务端）
    if (!itemId || !itemId.trim()) {
      setItemIdError('请填写库存项目 ID');
      return;
    }
    setItemIdError(null);
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('请输入有效的库存数量', 'error');
      return;
    }
    const body = { itemId, type, quantity: qty, requestId: crypto.randomUUID() };
    await runSubmitting(async () => {
      try {
        await apiRequest('/inventory/transactions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        showToast('库存流水已记录', 'success');
        await Promise.all([query.refetch(), lowStock.refetch(), expiring.refetch()]);
      } catch (error) {
        showToast(errorMessage(error, '保存库存流水失败'), 'error');
      }
    });
  }

  async function generateReplenishment() {
    if (submitting || stale) return;
    await runSubmitting(async () => {
      try {
        await apiRequest('/inventory/replenishment/generate', { method: 'POST', body: JSON.stringify({}) });
        showToast('补货建议已生成', 'success');
        await lowStock.refetch();
      } catch (error) {
        showToast(errorMessage(error, '生成补货建议失败'), 'error');
      }
    });
  }

  async function searchByBarcode() {
    const value = barcodeSearch.trim();
    if (!value) {
      showToast('请输入条码或编码', 'error');
      return;
    }
    try {
      // 扫码定位优先走服务端精确过滤（code/barcode 等值），不受前 20 条截断影响；
      // 通用列表对已声明字段支持 `?field=value` 精确过滤。
      const [byCode, byBarcode] = await Promise.all([
        apiRequest<Page<Record<string, unknown>>>(
          `/resources/inventoryItems?page=1&pageSize=1&code=${encodeURIComponent(value)}`),
        apiRequest<Page<Record<string, unknown>>>(
          `/resources/inventoryItems?page=1&pageSize=1&barcode=${encodeURIComponent(value)}`),
      ]);
      const exact = (byCode.items ?? []).find((row) => String(row.code ?? '') === value)
        ?? (byBarcode.items ?? []).find((row) => String(row.barcode ?? '') === value);
      if (exact) {
        setItemId(String(exact.id));
        showToast(`已定位：${String(exact.name ?? exact.code ?? '')}`, 'success');
        return;
      }
      // 精确未命中再退化为全文搜索（兼容手输部分编码/名称的场景）。
      const result = await apiRequest<Page<Record<string, unknown>>>(
        `/resources/inventoryItems?page=1&pageSize=20&search=${encodeURIComponent(value)}`,
      );
      const match = (result.items ?? []).find((row) =>
        String(row.barcode ?? '') === value || String(row.code ?? '') === value);
      if (!match) {
        showToast('未找到匹配的库存项目', 'error');
        return;
      }
      setItemId(String(match.id));
      showToast(`已定位：${String(match.name ?? match.code ?? '')}`, 'success');
    } catch (error) {
      showToast(errorMessage(error, '扫码定位失败'), 'error');
    }
  }

  async function submitBatch(event: FormEvent) {
    event.preventDefault();
    if (submitting || stale) return;
    if (!itemId) {
      showToast('请先填写库存项目 ID', 'error');
      return;
    }
    const qty = Number(batchQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('请输入有效的入库数量', 'error');
      return;
    }
    const body = {
      itemId,
      batchNo: batchNo || undefined,
      productionDate: productionDate || undefined,
      expiryDate: expiryDate || undefined,
      initialQuantity: qty,
      supplierId: supplierId || undefined,
    };
    await runSubmitting(async () => {
      try {
        await apiRequest('/inventory-batches', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        showToast('批次已入库', 'success');
        setBatchNo('');
        setProductionDate('');
        setExpiryDate('');
        setBatchQuantity('');
        setSupplierId('');
        await Promise.all([query.refetch(), batches.refetch(), expiringBatches.refetch()]);
      } catch (error) {
        showToast(errorMessage(error, '批次入库失败'), 'error');
      }
    });
  }

  async function generateExpiryAlerts() {
    if (submitting) return;
    await runSubmitting(async () => {
      try {
        await apiRequest('/inventory-batches/expiry-alerts', { method: 'POST', body: JSON.stringify({ days: 30 }) });
        showToast('到期提醒已生成', 'success');
        await expiringBatches.refetch();
      } catch (error) {
        showToast(errorMessage(error, '生成到期提醒失败'), 'error');
      }
    });
  }

  function openEditBatch(batch: BatchRow) {
    setEditBatchNo(batch.batchNo ?? '');
    setEditProductionDate(batch.productionDate ?? '');
    setEditExpiryDate(batch.expiryDate ?? '');
    setEditSupplierId(batch.supplierId ?? '');
    setEditTarget(batch);
  }

  async function submitEditBatch(event: FormEvent) {
    event.preventDefault();
    if (!editTarget || editing) return;
    const targetId = editTarget.id;
    const body = {
      batchNo: editBatchNo,
      productionDate: editProductionDate,
      expiryDate: editExpiryDate,
      supplierId: editSupplierId,
    };
    await runEditing(async () => {
      try {
        await apiRequest(`/inventory-batches/${targetId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        showToast('批次已更新', 'success');
        setEditTarget(null);
        await Promise.all([batches.refetch(), expiringBatches.refetch()]);
      } catch (error) {
        showToast(errorMessage(error, '批次更新失败'), 'error');
      }
    });
  }

  async function confirmDeleteBatch() {
    if (!deleteTarget || submitting) return;
    const targetId = deleteTarget.id;
    await runSubmitting(async () => {
      try {
        await apiRequest(`/inventory-batches/${targetId}`, { method: 'DELETE' });
        showToast('批次已删除', 'success');
        await Promise.all([batches.refetch(), expiringBatches.refetch()]);
      } catch (error) {
        showToast(errorMessage(error, '删除批次失败'), 'error');
      } finally {
        setDeleteTarget(null);
      }
    });
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>库存管理</h1>
        <button disabled={stale} onClick={generateReplenishment}>生成补货建议</button>
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void searchByBarcode();
        }}
      >
        <input
          aria-label="条码扫码"
          placeholder="扫描条码或输入编码"
          value={barcodeSearch}
          onChange={(event) => setBarcodeSearch(event.target.value)}
        />
        <button type="submit">扫码定位</button>
      </form>
      <div className="tabs" role="tablist">
        <button
          id="inventory-tab-overview"
          role="tab"
          aria-selected={activeTab === 'overview'}
          aria-controls="inventory-panel-overview"
          tabIndex={activeTab === 'overview' ? 0 : -1}
          className={activeTab === 'overview' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('overview')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              setActiveTab('report');
              document.getElementById('inventory-tab-report')?.focus();
            }
          }}
        >
          库存概览
        </button>
        <button
          id="inventory-tab-report"
          role="tab"
          aria-selected={activeTab === 'report'}
          aria-controls="inventory-panel-report"
          tabIndex={activeTab === 'report' ? 0 : -1}
          className={activeTab === 'report' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('report')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setActiveTab('overview');
              document.getElementById('inventory-tab-overview')?.focus();
            }
          }}
        >
          库存明细报表
        </button>
      </div>
      {activeTab === 'report' ? (
        <div id="inventory-panel-report" role="tabpanel" aria-labelledby="inventory-tab-report">
          <InventoryReportPanel />
        </div>
      ) : (
        <div id="inventory-panel-overview" role="tabpanel" aria-labelledby="inventory-tab-overview">
          <form className="inline-form" onSubmit={submit}>
            <input
              aria-label="库存项目 ID"
              className={itemIdError ? 'error' : undefined}
              value={itemId ?? ''}
              onChange={(event) => {
                setItemId(event.target.value);
                if (itemIdError) setItemIdError(null);
              }}
            />
            {itemIdError && <span className="field-error">{itemIdError}</span>}
            <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
              <option value="ADJUST">ADJUST</option>
            </select>
            <input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            <button type="submit" disabled={submitting || stale}>{submitting ? '保存中...' : '保存库存流水'}</button>
          </form>
          <div className="cards">
            {query.data?.items.map((row) => (
              <div className="card" key={String(row.id)}>
                <strong>{String(row.name ?? row.code ?? '')}</strong>
                <span>库存：{String(row.stock ?? '')} / 最低 {String(row.minStock ?? '')}</span>
                {row.barcode ? <BarcodeView value={String(row.barcode)} height={40} /> : null}
                <button type="button" onClick={() => setBarcodeTarget(row)}>条码</button>
              </div>
            ))}
          </div>
          <PagePager
            page={page}
            hasNext={page * 20 < (query.data?.total ?? 0)}
            onPageChange={(next) => {
              setPage(next);
              setItemId('');
              setItemIdError('');
            }}
            disabled={stale}
          />
          <h2>低库存</h2>
          {lowTruncated && <p className="reminder-muted">低库存超过 100 条，仅显示前 100 条</p>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>名称</th><th>库存</th><th>最低</th></tr></thead>
              <tbody>
                {lowItems.map((row) => (
                  <tr key={String(row.id)}><td>{String(row.name)}</td><td>{String(row.stock)}</td><td>{String(row.minStock)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>30 天内到期</h2>
          {expiringTruncated && <p className="reminder-muted">临期项目超过 100 条，仅显示前 100 条</p>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>名称</th><th>到期日期</th><th>库存</th></tr></thead>
              <tbody>
                {expiringItems.map((row) => (
                  <tr key={String(row.id)}><td>{String(row.name ?? row.code ?? '')}</td><td>{String(row.expireDate ?? '')}</td><td>{String(row.stock ?? '')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>批次管理</h2>
          <form className="inline-form" onSubmit={submitBatch}>
            <input aria-label="批次号" placeholder="批次号" value={batchNo} onChange={(event) => setBatchNo(event.target.value)} />
            <input aria-label="生产日期" type="date" value={productionDate} onChange={(event) => setProductionDate(event.target.value)} />
            <input aria-label="效期日期" type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
            <input aria-label="入库数量" type="number" value={batchQuantity} onChange={(event) => setBatchQuantity(event.target.value)} />
            <SearchableSelect resource="suppliers" ariaLabel="供应商" value={supplierId} onChange={setSupplierId} placeholder="供应商（可选）" />
            <button type="submit" disabled={submitting || stale}>{submitting ? '入库中...' : '新增批次'}</button>
          </form>
          <div className="table-wrap">
            <table>
              <thead><tr><th>批次号</th><th>生产日期</th><th>效期</th><th>入库量</th><th>剩余量</th><th>操作</th></tr></thead>
              <tbody>
                {(batches.data?.batches ?? []).map((batch) => (
                  <tr key={String(batch.id)}>
                    <td>{String(batch.batchNo ?? '')}</td>
                    <td>{String(batch.productionDate ?? '')}</td>
                    <td>{String(batch.expiryDate ?? '')}</td>
                    <td>{String(batch.initialQuantity ?? '')}</td>
                    <td>{String(batch.remainingQuantity ?? '')}</td>
                    <td>
                      <button type="button" onClick={() => openEditBatch(batch)}>编辑</button>
                      <button type="button" onClick={() => setDeleteTarget(batch)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* W-1：批次列表分页（服务端 OFFSET，total 驱动 hasNext） */}
            {batches.data && (batches.data.total ?? 0) > 0 && (
              <PagePager
                page={batchPage}
                hasNext={(batchPage * BATCH_PAGE_SIZE) < (batches.data?.total ?? 0)}
                onPageChange={setBatchPage}
                disabled={stale}
              />
            )}
          </div>
          <div className="page-head">
            <h2>批次效期提醒</h2>
            <button onClick={generateExpiryAlerts} disabled={submitting}>{submitting ? '生成中...' : '生成到期提醒'}</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>物料</th><th>批次号</th><th>效期</th><th>剩余量</th></tr></thead>
              <tbody>
                {(expiringBatches.data?.expiring ?? []).map((batch) => (
                  <tr key={String(batch.id)}>
                    <td>{String(batch.itemName ?? batch.itemCode ?? '')}</td>
                    <td>{String(batch.batchNo ?? '')}</td>
                    <td>{String(batch.expiryDate ?? '')}</td>
                    <td>{String(batch.remainingQuantity ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Dialog open={editTarget !== null} title="编辑批次" onClose={() => setEditTarget(null)}>
        <form onSubmit={submitEditBatch}>
          <input aria-label="编辑批次号" placeholder="批次号" value={editBatchNo} onChange={(event) => setEditBatchNo(event.target.value)} />
          <input aria-label="编辑生产日期" type="date" value={editProductionDate} onChange={(event) => setEditProductionDate(event.target.value)} />
          <input aria-label="编辑效期日期" type="date" value={editExpiryDate} onChange={(event) => setEditExpiryDate(event.target.value)} />
          <SearchableSelect resource="suppliers" ariaLabel="编辑供应商" value={editSupplierId} onChange={setEditSupplierId} placeholder="供应商（可选）" />
          <div className="modal-actions">
            <button type="button" onClick={() => setEditTarget(null)}>取消</button>
            <button type="submit" disabled={editing}>{editing ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={barcodeTarget !== null}
        title={`条码标签：${String(barcodeTarget?.name ?? barcodeTarget?.code ?? '')}`}
        onClose={() => setBarcodeTarget(null)}
      >
        <div className="barcode-print">
          <BarcodeView value={String(barcodeTarget?.barcode ?? barcodeTarget?.code ?? '')} height={96} />
          <div className="barcode-print-text">
            <strong>{String(barcodeTarget?.name ?? '')}</strong>
            <span>{String(barcodeTarget?.barcode ?? barcodeTarget?.code ?? '')}</span>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={() => setBarcodeTarget(null)}>关闭</button>
        </div>
      </Dialog>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除确认"
        message="确定删除该批次吗？"
        danger
        onConfirm={() => confirmDeleteBatch()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
