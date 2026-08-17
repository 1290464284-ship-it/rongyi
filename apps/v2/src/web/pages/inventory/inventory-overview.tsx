import type { FormEvent, ReactNode } from 'react';
import { PagePager, SearchableSelect } from '../../components';
import { BarcodeView } from '../../inventory/BarcodeView';
import type { BatchListData, BatchRow } from '../../inventory/types';
import { BATCH_PAGE_SIZE } from './inventory-constants';

/** 库存概览面板：流水录入表单、项目卡片、分页、低库存与临期表格。 */
export function InventoryOverview({
  itemId,
  onItemIdChange,
  itemIdError,
  onItemIdErrorChange,
  type,
  onTypeChange,
  quantity,
  onQuantityChange,
  submitting,
  stale,
  page,
  onPageChange,
  items,
  total,
  lowItems,
  lowTruncated,
  expiringItems,
  expiringTruncated,
  onShowBarcode,
  onSubmit,
  children,
}: {
  itemId: string | null;
  onItemIdChange: (value: string) => void;
  itemIdError: string | null;
  onItemIdErrorChange: (value: string | null) => void;
  type: 'IN' | 'OUT' | 'ADJUST';
  onTypeChange: (value: 'IN' | 'OUT' | 'ADJUST') => void;
  quantity: string;
  onQuantityChange: (value: string) => void;
  submitting: boolean;
  stale: boolean;
  page: number;
  onPageChange: (next: number) => void;
  items: Array<Record<string, unknown>> | undefined;
  total: number | undefined;
  lowItems: Array<Record<string, unknown>>;
  lowTruncated: boolean;
  expiringItems: Array<Record<string, unknown>>;
  expiringTruncated: boolean;
  onShowBarcode: (row: Record<string, unknown>) => void;
  onSubmit: (event: FormEvent) => void;
  /** 面板尾部区块（批次管理等），仍渲染在 tabpanel 内部。 */
  children?: ReactNode;
}) {
  return (
    <div id="inventory-panel-overview" role="tabpanel" aria-labelledby="inventory-tab-overview">
      <form className="inline-form" onSubmit={onSubmit}>
        <input
          aria-label="库存项目 ID"
          className={itemIdError ? 'error' : undefined}
          value={itemId ?? ''}
          onChange={(event) => {
            onItemIdChange(event.target.value);
            if (itemIdError) onItemIdErrorChange(null);
          }}
        />
        {itemIdError && <span className="field-error">{itemIdError}</span>}
        <select value={type} onChange={(event) => onTypeChange(event.target.value as typeof type)}>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
          <option value="ADJUST">ADJUST</option>
        </select>
        <input type="number" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} />
        <button type="submit" disabled={submitting || stale}>{submitting ? '保存中...' : '保存库存流水'}</button>
      </form>
      <div className="cards">
        {items?.map((row) => (
          <div className="card" key={String(row.id)}>
            <strong>{String(row.name ?? row.code ?? '')}</strong>
            <span>库存：{String(row.stock ?? '')} / 最低 {String(row.minStock ?? '')}</span>
            {row.barcode ? <BarcodeView value={String(row.barcode)} height={40} /> : null}
            <button type="button" onClick={() => onShowBarcode(row)}>条码</button>
          </div>
        ))}
      </div>
      <PagePager
        page={page}
        hasNext={page * 20 < (total ?? 0)}
        onPageChange={onPageChange}
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
      {children}
    </div>
  );
}

/** 批次管理区块：新增批次表单、批次列表（含分页与行操作）与到期提醒。 */
export function BatchManagement({
  batchNo,
  onBatchNoChange,
  productionDate,
  onProductionDateChange,
  expiryDate,
  onExpiryDateChange,
  batchQuantity,
  onBatchQuantityChange,
  supplierId,
  onSupplierIdChange,
  submitting,
  stale,
  batches,
  batchPage,
  onBatchPageChange,
  expiringBatches,
  onSubmitBatch,
  onOpenEditBatch,
  onDeleteBatch,
  onGenerateExpiryAlerts,
}: {
  batchNo: string;
  onBatchNoChange: (value: string) => void;
  productionDate: string;
  onProductionDateChange: (value: string) => void;
  expiryDate: string;
  onExpiryDateChange: (value: string) => void;
  batchQuantity: string;
  onBatchQuantityChange: (value: string) => void;
  supplierId: string;
  onSupplierIdChange: (value: string) => void;
  submitting: boolean;
  stale: boolean;
  batches: BatchListData | undefined;
  batchPage: number;
  onBatchPageChange: (next: number) => void;
  expiringBatches: BatchListData | undefined;
  onSubmitBatch: (event: FormEvent) => void;
  onOpenEditBatch: (batch: BatchRow) => void;
  onDeleteBatch: (batch: BatchRow) => void;
  onGenerateExpiryAlerts: () => void;
}) {
  return (
    <>
      <h2>批次管理</h2>
      <form className="inline-form" onSubmit={onSubmitBatch}>
        <input aria-label="批次号" placeholder="批次号" value={batchNo} onChange={(event) => onBatchNoChange(event.target.value)} />
        <input aria-label="生产日期" type="date" value={productionDate} onChange={(event) => onProductionDateChange(event.target.value)} />
        <input aria-label="效期日期" type="date" value={expiryDate} onChange={(event) => onExpiryDateChange(event.target.value)} />
        <input aria-label="入库数量" type="number" value={batchQuantity} onChange={(event) => onBatchQuantityChange(event.target.value)} />
        <SearchableSelect resource="suppliers" ariaLabel="供应商" value={supplierId} onChange={onSupplierIdChange} placeholder="供应商（可选）" />
        <button type="submit" disabled={submitting || stale}>{submitting ? '入库中...' : '新增批次'}</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>批次号</th><th>生产日期</th><th>效期</th><th>入库量</th><th>剩余量</th><th>操作</th></tr></thead>
          <tbody>
            {(batches?.batches ?? []).map((batch) => (
              <tr key={String(batch.id)}>
                <td>{String(batch.batchNo ?? '')}</td>
                <td>{String(batch.productionDate ?? '')}</td>
                <td>{String(batch.expiryDate ?? '')}</td>
                <td>{String(batch.initialQuantity ?? '')}</td>
                <td>{String(batch.remainingQuantity ?? '')}</td>
                <td>
                  <button type="button" onClick={() => onOpenEditBatch(batch)}>编辑</button>
                  <button type="button" onClick={() => onDeleteBatch(batch)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* W-1：批次列表分页（服务端 OFFSET，total 驱动 hasNext） */}
        {batches && (batches.total ?? 0) > 0 && (
          <PagePager
            page={batchPage}
            hasNext={(batchPage * BATCH_PAGE_SIZE) < (batches.total ?? 0)}
            onPageChange={onBatchPageChange}
            disabled={stale}
          />
        )}
      </div>
      <div className="page-head">
        <h2>批次效期提醒</h2>
        <button onClick={onGenerateExpiryAlerts} disabled={submitting}>{submitting ? '生成中...' : '生成到期提醒'}</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>物料</th><th>批次号</th><th>效期</th><th>剩余量</th></tr></thead>
          <tbody>
            {(expiringBatches?.expiring ?? []).map((batch) => (
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
    </>
  );
}
