import type { FormEvent } from 'react';
import { Dialog, SearchableSelect } from '../../components';
import { BarcodeView } from '../../inventory/BarcodeView';

/** 编辑批次弹窗：字段值与提交/关闭回调均由父页注入。 */
export function EditBatchDialog({
  open,
  batchNo,
  onBatchNoChange,
  productionDate,
  onProductionDateChange,
  expiryDate,
  onExpiryDateChange,
  supplierId,
  onSupplierIdChange,
  editing,
  onSubmit,
  onClose,
}: {
  open: boolean;
  batchNo: string;
  onBatchNoChange: (value: string) => void;
  productionDate: string;
  onProductionDateChange: (value: string) => void;
  expiryDate: string;
  onExpiryDateChange: (value: string) => void;
  supplierId: string;
  onSupplierIdChange: (value: string) => void;
  editing: boolean;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title="编辑批次" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <input aria-label="编辑批次号" placeholder="批次号" value={batchNo} onChange={(event) => onBatchNoChange(event.target.value)} />
        <input aria-label="编辑生产日期" type="date" value={productionDate} onChange={(event) => onProductionDateChange(event.target.value)} />
        <input aria-label="编辑效期日期" type="date" value={expiryDate} onChange={(event) => onExpiryDateChange(event.target.value)} />
        <SearchableSelect resource="suppliers" ariaLabel="编辑供应商" value={supplierId} onChange={onSupplierIdChange} placeholder="供应商（可选）" />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={editing}>{editing ? '保存中...' : '保存'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** 条码标签弹窗：展示目标项目的条码与名称。 */
export function BarcodeLabelDialog({ target, onClose }: {
  target: Record<string, unknown> | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      title={`条码标签：${String(target?.name ?? target?.code ?? '')}`}
      onClose={onClose}
    >
      <div className="barcode-print">
        <BarcodeView value={String(target?.barcode ?? target?.code ?? '')} height={96} />
        <div className="barcode-print-text">
          <strong>{String(target?.name ?? '')}</strong>
          <span>{String(target?.barcode ?? target?.code ?? '')}</span>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </Dialog>
  );
}
