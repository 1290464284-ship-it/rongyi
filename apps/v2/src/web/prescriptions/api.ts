import { apiRequest, fetchAllPages } from '../lib/api';
import { errorMessage } from '../lib/messages';
import type { ToastKind } from '../lib/toast-context';
import { itemPayload, validItems } from './form';
import type { PrescriptionForm, PrescriptionProcessResult, PrescriptionRow } from './types';

export async function createPrescription(form: PrescriptionForm): Promise<void> {
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
        await cleanupOrphanPrescription(prescriptionId, createdItemIds);
      } catch (cleanupError) {
        console.warn('清理孤儿处方失败', cleanupError);
      }
    }
    throw error;
  }
}

export async function updatePrescription(form: PrescriptionForm, prescriptionId: string | null): Promise<void> {
  if (!prescriptionId) throw new Error('处方 ID 缺失');
  await apiRequest(`/resources/prescriptions/${prescriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      patientId: form.patientId,
      doctorId: form.doctorId,
      remark: form.remark || undefined,
      status: form.status,
    }),
  });
  const existing = await fetchAllPages<Record<string, unknown>>(
    `/resources/prescriptionItems?prescriptionId=${prescriptionId}`,
  );
  const existingIds = new Set(existing.map((row) => String(row.id)));
  // 保留的明细（有服务端 id）→ PATCH；新增的明细 → POST（带 prescriptionId）。
  // 与 validItems 同一套有效性过滤，但保留本地 id 用于判断服务端存在性。
  const items = form.items
    .filter((item) => item.name.trim() && item.days && item.quantity && item.price)
    .map((item) => ({ id: item.id, payload: itemPayload(item) }))
    .filter((entry) => entry.payload.days > 0 && entry.payload.quantity > 0 && entry.payload.price >= 0);
  for (const { id, payload } of items) {
    if (existingIds.has(id)) {
      await apiRequest(`/resources/prescriptionItems/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else {
      await apiRequest('/resources/prescriptionItems', {
        method: 'POST',
        body: JSON.stringify({ prescriptionId, ...payload }),
      });
    }
  }
  // 表单中已移除的明细 → DELETE
  for (const row of existing) {
    const id = String(row.id);
    if (!form.items.some((item) => item.id === id)) {
      await apiRequest(`/resources/prescriptionItems/${id}`, { method: 'DELETE' });
    }
  }
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

async function cleanupOrphanPrescription(prescriptionId: string, createdItemIds: string[]): Promise<void> {
  // 服务端 DELETE 为软删除且不级联：先删已建明细，再删主记录
  for (const itemId of createdItemIds) {
    try {
      await apiRequest(`/resources/prescriptionItems/${itemId}`, { method: 'DELETE' });
    } catch (error) {
      console.warn(`删除处方明细失败（继续清理主记录）：${itemId}`, error);
    }
  }
  try {
    await apiRequest(`/resources/prescriptions/${prescriptionId}`, { method: 'DELETE' });
  } catch (error) {
    console.warn(`删除孤儿处方失败：${prescriptionId}`, error);
  }
}
