import { SearchableSelect } from '../components';
import type { CephalometricForm } from './types';

export function CephalometricFormFields({
  form,
  update,
  setFile,
}: {
  form: CephalometricForm;
  update: (patch: Partial<CephalometricForm>) => void;
  file: File | null;
  setFile: (file: File | null) => void;
}) {
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        状态
        <input value={form.status} onChange={(event) => update({ status: event.target.value })} />
      </label>
      <label>
        模板 ID
        <input value={form.templateId} onChange={(event) => update({ templateId: event.target.value })} />
      </label>
      <label>
        影像文件
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <label>
        标记点 JSON
        <textarea value={form.landmarksJson} onChange={(event) => update({ landmarksJson: event.target.value })} />
      </label>
      <label>
        测量结果 JSON
        <textarea value={form.metricsJson} onChange={(event) => update({ metricsJson: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}
