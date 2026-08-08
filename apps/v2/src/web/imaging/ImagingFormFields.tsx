import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { SearchableSelect, UploadPreview } from '../components';
import { PHASE_OPTIONS } from './constants';
import type { ImagingCategoryRow, ImagingForm } from './types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = '';
  for (const next of units) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${value.toFixed(1)} ${unit}`;
}

export function ImagingFormFields({
  form,
  update,
  file: _file,
  setFile,
  categories,
}: {
  form: ImagingForm;
  update: (patch: Partial<ImagingForm>) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  categories: ImagingCategoryRow[];
}) {
  const doctors = useQuery({
    queryKey: ['imaging-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        影像类型
        <input value={form.type} onChange={(event) => update({ type: event.target.value })} />
      </label>
      <label>
        分类
        <select value={form.categoryId} onChange={(event) => update({ categoryId: event.target.value })}>
          <option value="">不分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name ?? category.id}</option>
          ))}
        </select>
      </label>
      <label>
        阶段
        <select value={form.phase} onChange={(event) => update({ phase: event.target.value })}>
          <option value="">不指定</option>
          {PHASE_OPTIONS.map((phase) => (
            <option key={phase.value} value={phase.value}>{phase.label}</option>
          ))}
        </select>
      </label>
      <label>
        标题
        <input value={form.title} onChange={(event) => update({ title: event.target.value })} />
      </label>
      <label>
        描述
        <textarea value={form.description} onChange={(event) => update({ description: event.target.value })} />
      </label>
      <label>
        拍摄时间
        <input type="datetime-local" value={form.takenAt} onChange={(event) => update({ takenAt: event.target.value })} />
      </label>
      <label>
        图片文件
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {_file && (
        <UploadPreview
          files={[{ id: 'selected-file', name: _file.name, size: formatFileSize(_file.size) }]}
          onRemove={() => setFile(null)}
        />
      )}
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}
