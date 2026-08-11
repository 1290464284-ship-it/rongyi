import { apiRequest } from '../lib/api';
import { errorMessage } from '../lib/messages';
import type { ToastKind } from '../lib/toast-context';
import { itemPayload, validItems } from './form';
import type { PrescriptionForm, PrescriptionProcessResult, PrescriptionRow } from './types';

export async function createPrescription(
  form: PrescriptionForm,
  showToast?: (message: string, kind?: ToastKind) => void,
): Promise<void> {
  const items = validItems(form);
  let prescriptionId: string | null = null;
  const createdItemIds: string[] = [];
  try {
    const prescription = await apiRequest<{ id: string }>('/resources/prescriptions', {
      method: 'POST',
      body: JSON.stringify({ patientId: form.patientId, doctorId: form.doctorId, remark: form.remark || undefined }),
    });
    prescriptionId = prescription.id;
    for (const item of items) {
      const created = await apiRequest<{ id: string }>('/resources/prescriptionItems', {
        method: 'POST',
        body: JSON.stringify({ prescriptionId: prescription.id, ...item }),
      });
      createdItemIds.push(created.id);
    }
  } catch (error) {
    // 主记录已创建但明细中途失败：清理孤儿记录（清理失败仅告警，不掩盖原始错误）
    if (prescriptionId) {
      try {
        await cleanupOrphanPrescription(prescriptionId, createdItemIds, showToast);
      } catch {
        showToast?.('清理孤儿处方失败，请检查未完成数据', 'error');
      }
    }
    throw error;
  }
}

export async function updatePrescription(form: PrescriptionForm, prescriptionId: string | null): Promise<void> {
  if (!prescriptionId) throw new Error('处方 ID 缺失');
  const items = form.items
    .filter((item) => item.name.trim() && item.days && item.quantity && item.price)
    .map((item) => ({ id: item.id || undefined, payload: itemPayload(item) }))
    .filter((entry) => entry.payload.days > 0 && entry.payload.quantity > 0 && entry.payload.price >= 0);
  await apiRequest(`/prescriptions/${prescriptionId}/save`, {
    method: 'PATCH',
    body: JSON.stringify({
      patientId: form.patientId,
      doctorId: form.doctorId,
      remark: form.remark || undefined,
      status: form.status,
      items: items.map(({ id, payload }) => ({ id, ...payload })),
    }),
  });
}

export async function processPrescription(
  row: PrescriptionRow,
  reload: () => Promise<unknown>,
  showToast: (message: string, kind?: ToastKind) => void,
): Promise<void> {
  try {
    const result = await apiRequest<PrescriptionProcessResult>(`/prescriptions/${row.id}/process`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast(`已生成划价单 ${result.chargeNumber} 与领药单 ${result.dispenseNumber}`, 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '处理处方失败'), 'error');
  }
}

async function cleanupOrphanPrescription(
  prescriptionId: string,
  createdItemIds: string[],
  showToast?: (message: string, kind?: ToastKind) => void,
): Promise<void> {
  // 服务端 DELETE 为软删除且不级联：先删已建明细，再删主记录
  for (const itemId of createdItemIds) {
    try {
      await apiRequest(`/resources/prescriptionItems/${itemId}`, { method: 'DELETE' });
    } catch {
      showToast?.(`删除处方明细 ${itemId} 失败，请检查未完成数据`, 'error');
    }
  }
  try {
    await apiRequest(`/resources/prescriptions/${prescriptionId}`, { method: 'DELETE' });
  } catch {
    showToast?.(`删除孤儿处方 ${prescriptionId} 失败，请检查未完成数据`, 'error');
  }
}
