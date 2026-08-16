import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { DentalChart, Dialog, LoadingState } from '../components';
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
  const [selectedToothId, setSelectedToothId] = useState<string | null>(null);
  const [markingToothIds, setMarkingToothIds] = useState<Set<string>>(new Set());
  const teethQuery = useQuery({
    queryKey: ['first-exam-teeth', row.id],
    queryFn: () => apiRequest<Page<FirstExamToothRow>>(`/resources/firstExamTeeth?examId=${encodeURIComponent(row.id)}&page=1&pageSize=200`),
  });
  const teeth = teethQuery.data?.items ?? [];
  const selectedTooth = teeth.find((tooth) => tooth.id === selectedToothId) ?? teeth[0] ?? null;
  const selectedNumber = selectedTooth ? String(selectedTooth.toothNumber ?? selectedTooth.id) : '';
  const selectedMark = selectedTooth
    ? (marks[selectedTooth.id] ?? String(selectedTooth.chiefMark ?? 'NONE'))
    : 'NONE';

  async function setChiefMark(tooth: FirstExamToothRow, mark: string) {
    if (markingToothIds.has(tooth.id)) return;
    const previous = String(tooth.chiefMark ?? 'NONE');
    setMarks((current) => ({ ...current, [tooth.id]: mark }));
    setMarkingToothIds((current) => new Set(current).add(tooth.id));
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
    } finally {
      setMarkingToothIds((current) => {
        const next = new Set(current);
        next.delete(tooth.id);
        return next;
      });
    }
  }

  const upper = teeth
    .filter((tooth) => {
      const number = Number(tooth.toothNumber);
      return number >= 11 && number <= 28;
    })
    .map((tooth) => Number(tooth.toothNumber));
  const lower = teeth
    .filter((tooth) => {
      const number = Number(tooth.toothNumber);
      return number >= 31 && number <= 48;
    })
    .map((tooth) => Number(tooth.toothNumber));
  const statuses: Record<number, 'normal' | 'issue' | 'selected'> = {};
  teeth.forEach((tooth) => {
    const number = Number(tooth.toothNumber);
    if (!Number.isFinite(number)) return;
    statuses[number] = tooth.id === selectedTooth?.id
      ? 'selected'
      : String(tooth.chiefMark ?? 'NONE') !== 'NONE'
        ? 'issue'
        : 'normal';
  });

  function selectTooth(number: number) {
    const tooth = teeth.find((item) => Number(item.toothNumber) === number);
    /* v8 ignore next -- 图表按钮仅渲染牙齿列表内存在的编号（同一数据源 filter 而来），lookup 恒命中，if 守卫为防御冗余 */
    if (tooth) setSelectedToothId(tooth.id);
  }

  return (
    <Dialog open title="主诉牙齿标记" onClose={onClose}>
      {teethQuery.isLoading ? (
        <LoadingState />
      ) : teeth.length === 0 ? (
        <p>该首诊暂无牙齿记录</p>
      ) : (
        <>
          <DentalChart
            upper={upper}
            lower={lower}
            statuses={statuses}
            onToothClick={selectTooth}
          />
          <div className="dental-legend">
            <span><i style={{ background: 'var(--border-strong)' }} />正常</span>
            <span><i style={{ background: 'var(--warning)' }} />主诉标记</span>
            <span><i style={{ background: 'var(--primary)' }} />当前选中</span>
          </div>
          {selectedTooth && (
            <div className="dental-mark-panel">
              <span className="dental-mark-tooth">牙位 {selectedNumber}</span>
              <div className="dental-mark-fields">
                <label>
                  主诉标记
                  <select
                    aria-label={`牙齿 ${selectedNumber} 主诉标记`}
                    disabled={markingToothIds.has(selectedTooth.id)}
                    value={selectedMark}
                    onChange={(event) => void setChiefMark(selectedTooth, event.target.value)}
                  >
                    {Object.entries(CHIEF_MARK_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <span>牙体状态：{String(selectedTooth.toothStatus ?? '')}</span>
              </div>
            </div>
          )}
        </>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </Dialog>
  );
}
