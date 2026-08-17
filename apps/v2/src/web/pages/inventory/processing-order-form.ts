import { centsToYuanString } from '../../lib/format';
import { joinList, newItem } from '../../processing-orders/items';
import type { ProcessingOrderForm, ProcessingRow } from '../../processing-orders/types';

/** 行 → 表单的纯转换：编辑打开时回填各字段，明细始终以一条空明细起步。 */
export function rowToProcessingForm(row: ProcessingRow): ProcessingOrderForm {
  return {
    patientId: String(row.patientId ?? ''),
    doctorId: String(row.doctorId ?? ''),
    number: String(row.number ?? ''),
    shade: String(row.shade ?? ''),
    teethNumbers: joinList(row.teethNumbers),
    totalFee: centsToYuanString(row.totalFee),
    items: [newItem()],
  };
}
