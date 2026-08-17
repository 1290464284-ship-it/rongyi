import { FormEvent, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { ConfirmDialog, LoadingState, PageError } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { useAsyncAction } from '../../hooks/use-async-action';
import type { BatchRow, BatchListData } from '../../inventory/types';
import { InventoryReportPanel } from './InventoryReportPanel';
import { BATCH_PAGE_SIZE } from './inventory-constants';
import { BarcodeSearch } from './inventory-barcode';
import { InventoryTabs } from './inventory-tabs';
import { InventoryOverview, BatchManagement } from './inventory-overview';
import { EditBatchDialog, BarcodeLabelDialog } from './inventory-dialogs';

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
      <BarcodeSearch onLocated={(id) => setItemId(id)} />
      <InventoryTabs activeTab={activeTab} onChange={setActiveTab} />
      {activeTab === 'report' ? (
        <div id="inventory-panel-report" role="tabpanel" aria-labelledby="inventory-tab-report">
          <InventoryReportPanel />
        </div>
      ) : (
        <InventoryOverview
          itemId={itemId} onItemIdChange={setItemId} itemIdError={itemIdError} onItemIdErrorChange={setItemIdError}
          type={type} onTypeChange={setType} quantity={quantity} onQuantityChange={setQuantity}
          submitting={submitting} stale={stale}
          page={page} onPageChange={(next) => { setPage(next); setItemId(''); setItemIdError(''); }}
          items={query.data?.items} total={query.data?.total}
          lowItems={lowItems} lowTruncated={lowTruncated} expiringItems={expiringItems} expiringTruncated={expiringTruncated}
          onShowBarcode={setBarcodeTarget} onSubmit={submit}
        >
          <BatchManagement
            batchNo={batchNo} onBatchNoChange={setBatchNo} productionDate={productionDate} onProductionDateChange={setProductionDate}
            expiryDate={expiryDate} onExpiryDateChange={setExpiryDate} batchQuantity={batchQuantity} onBatchQuantityChange={setBatchQuantity}
            supplierId={supplierId} onSupplierIdChange={setSupplierId} submitting={submitting} stale={stale}
            batches={batches.data} batchPage={batchPage} onBatchPageChange={setBatchPage} expiringBatches={expiringBatches.data}
            onSubmitBatch={submitBatch} onOpenEditBatch={openEditBatch} onDeleteBatch={setDeleteTarget} onGenerateExpiryAlerts={generateExpiryAlerts}
          />
        </InventoryOverview>
      )}
      <EditBatchDialog
        open={editTarget !== null} batchNo={editBatchNo} onBatchNoChange={setEditBatchNo}
        productionDate={editProductionDate} onProductionDateChange={setEditProductionDate}
        expiryDate={editExpiryDate} onExpiryDateChange={setEditExpiryDate}
        supplierId={editSupplierId} onSupplierIdChange={setEditSupplierId}
        editing={editing} onSubmit={submitEditBatch} onClose={() => setEditTarget(null)}
      />
      <BarcodeLabelDialog target={barcodeTarget} onClose={() => setBarcodeTarget(null)} />
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
