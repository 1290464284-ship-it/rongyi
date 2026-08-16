import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { SearchableSelect } from '../components';
import type { FirstExamForm } from './types';

export function FirstExamFormFields({ form, update }: { form: FirstExamForm; update: (patch: Partial<FirstExamForm>) => void }) {
  const doctors = useQuery({
    queryKey: ['first-exam-doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      {/* B6：/doctors 加载失败时行内提示并支持重试，避免静默空列表 */}
      {doctors.isError && (
        <div className="query-section-error">
          <p className="error">医生列表加载失败</p>
          <button type="button" className="btn-secondary" onClick={() => void doctors.refetch()}>重试</button>
        </div>
      )}
      <label>
        医生
        <select value={form.doctorId} onChange={(event) => update({ doctorId: event.target.value })} disabled={doctors.isError}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        会诊医生
        <select value={form.consultantId} onChange={(event) => update({ consultantId: event.target.value })}>
          <option value="">不指定</option>
          {doctors.data?.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
      </label>
      <label>
        主诉
        <textarea value={form.chiefComplaint} onChange={(event) => update({ chiefComplaint: event.target.value })} />
      </label>
      <label>
        现病史
        <textarea value={form.presentIllness} onChange={(event) => update({ presentIllness: event.target.value })} />
      </label>
      <label>
        既往史
        <textarea value={form.pastHistory} onChange={(event) => update({ pastHistory: event.target.value })} />
      </label>
      <label>
        口腔检查
        <textarea value={form.oralExam} onChange={(event) => update({ oralExam: event.target.value })} />
      </label>
      <label>
        辅助检查
        <textarea value={form.auxiliaryExam} onChange={(event) => update({ auxiliaryExam: event.target.value })} />
      </label>
      <label>
        诊断
        <textarea value={form.diagnosis} onChange={(event) => update({ diagnosis: event.target.value })} />
      </label>
      <label>
        治疗建议
        <textarea value={form.treatmentSuggestion} onChange={(event) => update({ treatmentSuggestion: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}
