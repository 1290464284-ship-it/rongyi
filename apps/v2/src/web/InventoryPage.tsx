import { FormEvent, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { apiRequest } from './api';
import type { Page } from './types';
import { LoadingState, PageError, SearchableSelect } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

interface BatchRow {
  id: string;
  batchNo: string | null;
  productionDate: string | null;
  expiryDate: string | null;
  initialQuantity: number;
  remainingQuantity: number;
  itemName?: string | null;
  itemCode?: string | null;
}

interface BatchListData {
  batches: BatchRow[];
  expiring: BatchRow[];
}

export function InventoryPage() {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const urlItemId = searchParams.get('id');
  const [itemId, setItemId] = useState<string | null>(urlItemId);
  const [type, setType] = useState<'IN' | 'OUT' | 'ADJUST'>('IN');
  const [quantity, setQuantity] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [batchNo, setBatchNo] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [batchQuantity, setBatchQuantity] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const query = useQuery({
    queryKey: ['inventory'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/inventoryItems?page=1&pageSize=20'),
  });
  const derivedFromList = useRef(false);
  useEffect(() => {
    if (derivedFromList.current || !query.data) return;
    derivedFromList.current = true;
    const first = query.data.items[0];
    setItemId((current) => current ?? (first ? String(first.id) : null));
  }, [query.data]);
  const lowStock = useQuery({
    queryKey: ['inventory-low'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/inventory/low-stock'),
  });
  const expiring = useQuery({
    queryKey: ['inventory-expiring'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/inventory/expiring?days=30'),
  });
  const batches = useQuery({
    queryKey: ['inventory-batches', itemId ?? ''],
    queryFn: () => apiRequest<BatchListData>(
      itemId ? `/api/v2/inventory-batches?itemId=${encodeURIComponent(itemId)}` : '/api/v2/inventory-batches',
    ),
  });
  const expiringBatches = useQuery({
    queryKey: ['inventory-batches-expiring'],
    queryFn: () => apiRequest<BatchListData>('/api/v2/inventory-batches?days=30'),
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest('/inventory/transactions', {
        method: 'POST',
        body: JSON.stringify({ itemId, type, quantity: Number(quantity), requestId: crypto.randomUUID() }),
      });
      showToast('库存流水已记录', 'success');
      await Promise.all([query.refetch(), lowStock.refetch(), expiring.refetch()]);
    } catch (error) {
      showToast(errorMessage(error, '保存库存流水失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function generateReplenishment() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest('/inventory/replenishment/generate', { method: 'POST', body: JSON.stringify({}) });
      showToast('补货建议已生成', 'success');
      await lowStock.refetch();
    } catch (error) {
      showToast(errorMessage(error, '生成补货建议失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBatch(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!itemId) {
      showToast('请先填写库存项目 ID', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/v2/inventory-batches', {
        method: 'POST',
        body: JSON.stringify({
          itemId,
          batchNo: batchNo || undefined,
          productionDate: productionDate || undefined,
          expiryDate: expiryDate || undefined,
          initialQuantity: Number(batchQuantity),
          supplierId: supplierId || undefined,
        }),
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
    } finally {
      setSubmitting(false);
    }
  }

  async function generateExpiryAlerts() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest('/api/v2/inventory-batches/expiry-alerts', { method: 'POST', body: JSON.stringify({ days: 30 }) });
      showToast('到期提醒已生成', 'success');
      await expiringBatches.refetch();
    } catch (error) {
      showToast(errorMessage(error, '生成到期提醒失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>库存管理</h1>
        <button onClick={generateReplenishment}>生成补货建议</button>
      </div>
      <form className="inline-form" onSubmit={submit}>
        <input aria-label="库存项目 ID" value={itemId ?? ''} onChange={(event) => setItemId(event.target.value)} />
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
          <option value="ADJUST">ADJUST</option>
        </select>
        <input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存库存流水'}</button>
      </form>
      <div className="cards">
        {query.data?.items.map((row) => (
          <div className="card" key={String(row.id)}>
            <strong>{String(row.name ?? row.code ?? '')}</strong>
            <span>库存：{String(row.stock ?? '')} / 最低 {String(row.minStock ?? '')}</span>
          </div>
        ))}
      </div>
      <h2>低库存</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>库存</th><th>最低</th></tr></thead>
          <tbody>
            {lowStock.data?.map((row) => (
              <tr key={String(row.id)}><td>{String(row.name)}</td><td>{String(row.stock)}</td><td>{String(row.minStock)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>30 天内到期</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>到期日期</th><th>库存</th></tr></thead>
          <tbody>
            {expiring.data?.map((row) => (
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
        <button type="submit" disabled={submitting}>{submitting ? '入库中...' : '新增批次'}</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>批次号</th><th>生产日期</th><th>效期</th><th>入库量</th><th>剩余量</th></tr></thead>
          <tbody>
            {(batches.data?.batches ?? []).map((batch) => (
              <tr key={String(batch.id)}>
                <td>{String(batch.batchNo ?? '')}</td>
                <td>{String(batch.productionDate ?? '')}</td>
                <td>{String(batch.expiryDate ?? '')}</td>
                <td>{String(batch.initialQuantity ?? '')}</td>
                <td>{String(batch.remainingQuantity ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  );
}
