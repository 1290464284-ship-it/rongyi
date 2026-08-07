import type { DataTableColumn } from '../components';
import { useAsyncAction } from '../hooks/use-async-action';
import { WEEKDAY_JS_LABELS, TYPE_LABELS } from './constants';
import { formatWorkDays } from './format';
import type { ShiftTemplate, WeekScheduleRow } from './types';

export function templateColumns(
  toggleActive: (template: ShiftTemplate) => Promise<void> | void,
  openEdit: (template: ShiftTemplate) => void,
  requestDelete: (template: ShiftTemplate) => void,
): DataTableColumn<ShiftTemplate>[] {
  return [
    { key: 'name', label: '名称' },
    { key: 'startTime', label: '时间', render: (row) => `${row.startTime} - ${row.endTime}` },
    { key: 'workDays', label: '工作日', render: (row) => formatWorkDays(row.workDays ?? []) },
    { key: 'active', label: '状态', render: (row) => (Number(row.active) === 1 ? '启用' : '停用') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => (
        <>
          <ToggleActiveButton template={row} onToggle={toggleActive} />
          <button onClick={() => openEdit(row)}>编辑</button>
          <button className="danger" onClick={() => requestDelete(row)}>删除</button>
        </>
      ),
    },
  ];
}

/** 模板启用/停用按钮：busy 期间禁用，防止双击导致状态来回切换。 */
function ToggleActiveButton({ template, onToggle }: {
  template: ShiftTemplate;
  onToggle: (template: ShiftTemplate) => Promise<void> | void;
}) {
  const { busy, run } = useAsyncAction();
  return (
    <button disabled={busy} onClick={() => run(async () => { await onToggle(template); })}>
      {Number(template.active) === 1 ? '停用' : '启用'}
    </button>
  );
}

export const weekColumns: DataTableColumn<WeekScheduleRow>[] = [
  { key: 'date', label: '日期', render: (row) => `${row.date}（${WEEKDAY_JS_LABELS[row.weekDay] ?? ''}）` },
  { key: 'userId', label: '用户', render: (row) => row.userIdLabel ?? row.userId },
  { key: 'title', label: '班次标题', render: (row) => row.title ?? '—' },
  { key: 'startTime', label: '时间', render: (row) => `${row.startTime.slice(11, 16)} - ${row.endTime.slice(11, 16)}` },
  { key: 'type', label: '类型', render: (row) => TYPE_LABELS[row.type] ?? row.type },
];
