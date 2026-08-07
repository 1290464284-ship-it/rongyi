export const REPORT_TYPES = [
  { value: 'IN', label: 'IN 入库' },
  { value: 'OUT', label: 'OUT 出库' },
  { value: 'DISPENSE_RETURN', label: 'DISPENSE_RETURN 退药' },
  { value: 'RETURN_SUPPLIER', label: 'RETURN_SUPPLIER 退回厂商' },
  { value: 'LOSS', label: 'LOSS 库损' },
  { value: 'STOCKTAKE', label: 'STOCKTAKE 盘点' },
  { value: 'TRANSFER_OUT', label: 'TRANSFER_OUT 调拨出' },
  { value: 'TRANSFER_IN', label: 'TRANSFER_IN 调拨入' },
  { value: 'SUMMARY', label: 'SUMMARY 汇总' },
] as const;

export const REPORT_TYPE_LABELS: Record<string, string> = Object.fromEntries(REPORT_TYPES.map((entry) => [entry.value, entry.label]));
