import type { Dispatch, SetStateAction } from 'react';
import type { DataTableColumn } from '../../components';
import { formatDateTime, formatMoney } from '../../lib/format';
import { INVENTORY_PROCESSING_STATUS_LABELS, PURCHASE_STATUS_LABELS, STOCKTAKE_STATUS_LABELS } from '../../lib/labels';
import { ReceiveButton, StatusFlowSelect, StocktakeRowActions } from './inventory-workflow-actions';

export interface InventoryWorkflowColumnHandlers {
  selectedSuggestions: string[];
  setSelectedSuggestions: Dispatch<SetStateAction<string[]>>;
  onReceive: (id: string) => Promise<void>;
  onStatusFlow: (id: string, status: string) => Promise<void>;
  expandedStocktakeId: string | null;
  onToggleStocktakeItems: (id: string) => void;
  onStocktakeAction: (path: string, method: 'PATCH' | 'POST', body?: Record<string, unknown>) => Promise<boolean>;
  countedInputs: Record<string, string>;
  setCountedInputs: Dispatch<SetStateAction<Record<string, string>>>;
  savingCounted: boolean;
  onSaveCounted: (stocktakeId: string, itemId: string) => Promise<void>;
}

export function inventoryWorkflowColumns(handlers: InventoryWorkflowColumnHandlers) {
  const {
    selectedSuggestions,
    setSelectedSuggestions,
    onReceive,
    onStatusFlow,
    expandedStocktakeId,
    onToggleStocktakeItems,
    onStocktakeAction,
    countedInputs,
    setCountedInputs,
    savingCounted,
    onSaveCounted,
  } = handlers;

  const purchaseColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'number', label: '单号', render: (row) => String(row.number ?? row.id ?? '').slice(0, 8) },
    { key: 'supplierId', label: '供应商', render: (row) => String(row.supplierId ?? '') },
    { key: 'totalAmount', label: '金额', render: (row) => formatMoney(row.totalAmount) },
    {
      key: 'status',
      label: '状态',
      // W-2 起列表已按 status=PENDING 服务端过滤，标签查表恒命中（删除兜底与 v8 排除）。
      render: (row) => PURCHASE_STATUS_LABELS[String(row.status)],
    },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <ReceiveButton
          id={String(row.id)}
          onDone={onReceive}
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
          onDone={onStatusFlow}
        />
      ),
    },
  ];

  const suggestionColumns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'selected',
      label: '选',
      render: (row) => (
        <input type="checkbox" aria-label={`选择 ${String(row.id)}`} checked={selectedSuggestions.includes(String(row.id))} onChange={(event) => {
          setSelectedSuggestions((current) => event.target.checked ? [...current, String(row.id)] : current.filter((id) => id !== String(row.id)));
        }} />
      ),
    },
    { key: 'inventoryId', label: '库存项目', render: (row) => String(row.inventoryId ?? row.id ?? '').slice(0, 8) },
    { key: 'rop', label: '补货点', render: (row) => String(row.rop ?? '') },
    { key: 'suggestedQty', label: '建议数量', render: (row) => String(row.suggestedQty ?? '') },
    { key: 'status', label: '状态', render: () => '待应用' },
  ];

  const stocktakeColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'number', label: '单号', render: (row) => String(row.number ?? '') },
    { key: 'status', label: '状态', render: (row) => STOCKTAKE_STATUS_LABELS[String(row.status)] ?? String(row.status) },
    { key: 'startedById', label: '开始人', render: (row) => String(row.startedById ?? '') },
    { key: 'startedAt', label: '开始时间', render: (row) => formatDateTime(row.startedAt) },
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
              <button onClick={() => onToggleStocktakeItems(id)}>{expandedStocktakeId === id ? '收起' : '录入'}</button>
              <StocktakeRowActions
                id={id}
                onDone={(path, method, body) => onStocktakeAction(path, method, body).then(() => undefined)}
              />
            </span>
          );
        }
        if (status === 'LOCKED') {
          return (
            <span className="inline-form">
              <StocktakeRowActions
                id={id}
                onDone={(path, method, body) => onStocktakeAction(path, method, body).then(() => undefined)}
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
        <button disabled={savingCounted} onClick={() => onSaveCounted(String(expandedStocktakeId), String(row.itemId))}>
          {savingCounted ? '保存中...' : '保存'}
        </button>
      ),
    },
  ];

  return {
    purchaseColumns,
    purchaseItemColumns,
    processingColumns,
    suggestionColumns,
    stocktakeColumns,
    stocktakeItemColumns,
  };
}
