import { apiRequest } from '../lib/api';
import { errorMessage } from '../lib/messages';
import { createInFlightGuard } from '../lib/in-flight';

const transitionGuard = createInFlightGuard();

export async function transitionFirstExam(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  status: string,
) {
  if (!transitionGuard.start(id)) return;
  try {
    await apiRequest(`/first-exams/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('首诊状态已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '状态更新失败'), 'error');
  } finally {
    transitionGuard.finish(id);
  }
}

export async function changeDentition(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
  dentition: string,
) {
  try {
    await apiRequest(`/first-exams/${id}/dentition`, {
      method: 'POST',
      body: JSON.stringify({ dentition }),
    });
    showToast('牙列已更新', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '牙列更新失败'), 'error');
  }
}

export async function restartFirstExam(
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void,
  reload: () => Promise<unknown>,
  id: string,
) {
  try {
    await apiRequest(`/first-exams/${id}/restart`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('首诊已重启', 'success');
    await reload();
  } catch (error) {
    showToast(errorMessage(error, '重启检查失败'), 'error');
  }
}
