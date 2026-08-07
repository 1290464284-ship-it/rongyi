import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { Dialog } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import type { Page } from '../lib/types';
import { CHIEF_MARK_LABELS } from './constants';
import type { FirstExamRow, FirstExamToothRow } from './types';

export function TeethMarkDialog({
  row,
  reload,
  onClose,
}: {
  row: FirstExamRow;
  reload: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [marks, setMarks] = useState<Record<string, string>>({});
  const teethQuery = useQuery({
    queryKey: ['first-exam-teeth', row.id],
    queryFn: () => apiRequest<Page<FirstExamToothRow>>(`/resources/firstExamTeeth?examId=${encodeURIComponent(row.id)}&page=1&pageSize=200`),
  });
  const teeth = teethQuery.data?.items ?? [];

  async function setChiefMark(tooth: FirstExamToothRow, mark: string) {
    const previous = String(tooth.chiefMark ?? 'NONE');
    setMarks((current) => ({ ...current, [tooth.id]: mark }));
    try {
      await apiRequest(`/first-exams/${row.id}/teeth/${tooth.id}/chief-mark`, {
        method: 'POST',
        body: JSON.stringify({ chiefMark: mark }),
      });
      showToast(`牙齿 ${String(tooth.toothNumber ?? tooth.id)} 主诉标记已更新`, 'success');
      await reload();
    } catch (error) {
      setMarks((current) => ({ ...current, [tooth.id]: previous }));
      showToast(errorMessage(error, '主诉标记更新失败'), 'error');
    }
  }

  return (
    <Dialog open title="主诉牙齿标记" onClose={onClose}>
      {teethQuery.isLoading ? (
        <p>加载中...</p>
      ) : teeth.length === 0 ? (
        <p>该首诊暂无牙齿记录</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>牙位</th>
              <th>状态</th>
              <th>主诉标记</th>
            </tr>
          </thead>
          <tbody>
            {teeth.map((tooth) => {
              const toothNumber = String(tooth.toothNumber ?? tooth.id);
              const currentMark = marks[tooth.id] ?? String(tooth.chiefMark ?? 'NONE');
              return (
                <tr key={tooth.id}>
                  <td>{toothNumber}</td>
                  <td>{String(tooth.toothStatus ?? '')}</td>
                  <td>
                    <select
                      aria-label={`牙齿 ${toothNumber} 主诉标记`}
                      value={currentMark}
                      onChange={(event) => void setChiefMark(tooth, event.target.value)}
                    >
                      {Object.entries(CHIEF_MARK_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </Dialog>
  );
}
