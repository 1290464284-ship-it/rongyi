import { apiRequest } from '../lib/api';
import { errorMessage } from '../lib/messages';
import type { ToastKind } from '../lib/toast-context';

/** 变更加工单状态（服务端 /processing-orders/:id/status）。 */
export async function transitionProcessingOrder(
  showToast: (message: string, kind?: ToastKind) => void,
  reload: () => Promise<unknown>,
  id: string,
  status: string,
): Promise<void> {
  try {
    await apiRequest(`/processing-orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('加工单状态已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '状态更新失败'), 'error');
  }
}
