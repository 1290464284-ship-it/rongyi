import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { DoctorSelect, MissingSelectOption, PagePager, SearchableSelect } from '../components';
import type { Page } from '../lib/types';
import type { RecordForm } from './types';

const VISIT_PAGE_SIZE = 100;

export function RecordFormFields({ form, update }: { form: RecordForm; update: (patch: Partial<RecordForm>) => void }) {
  const [visitPage, setVisitPage] = useState(1);
  const [prevPatientId, setPrevPatientId] = useState(form.patientId);
  const visitsPatientRef = useRef<string | null>(null);
  if (prevPatientId !== form.patientId) {
    setPrevPatientId(form.patientId);
    setVisitPage(1);
  }
  const visits = useQuery({
    queryKey: ['record-visits', form.patientId, visitPage],
    queryFn: async () => {
      const page = await apiRequest<Page<Record<string, unknown>>>(
        `/resources/visits?patientId=${encodeURIComponent(form.patientId)}&page=${visitPage}&pageSize=${VISIT_PAGE_SIZE}`,
      );
      visitsPatientRef.current = form.patientId;
      return page;
    },
    enabled: Boolean(form.patientId),
    // 仅在同一患者的翻页间复用上一页数据，患者切换/清空时不再显示旧患者就诊。
    placeholderData: (previous) => (previous && visitsPatientRef.current === form.patientId ? previous : undefined),
  });
  const visitRows = visits.data?.items ?? [];
  const visitMissing = form.visitId !== '' && !visits.isLoading && !visitRows.some((row) => String(row.id) === form.visitId);
  return (
    <>
      <label>
        患者
        <SearchableSelect
          resource="patients"
          value={form.patientId}
          onChange={(id) => {
            if (id !== form.patientId) update({ patientId: id, visitId: '' });
            else update({ patientId: id });
          }}
          ariaLabel="患者"
          placeholder="选择患者"
        />
      </label>
      <DoctorSelect label="医生" value={form.doctorId} onChange={(id) => update({ doctorId: id })} />
      <label>
        关联就诊
        <select value={form.visitId} onChange={(event) => update({ visitId: event.target.value })}>
          <option value="">不关联</option>
          {visitMissing && <MissingSelectOption value={form.visitId} />}
          {(visits.data?.items ?? []).map((row) => {
            // 可读 label（开始时间 + 短 ID），替代裸 UUID——否则多就诊时无法区分。
            const start = row.startTime ? formatDateTime(String(row.startTime)) : '';
            const label = start ? `${start}（${String(row.id).slice(0, 8)}）` : String(row.id);
            return <option key={String(row.id)} value={String(row.id)}>{label}</option>;
          })}
        </select>
      </label>
      {form.patientId && (
        <PagePager
          page={visitPage}
          hasNext={visitPage * VISIT_PAGE_SIZE < (visits.data?.total ?? 0)}
          onPageChange={(next) => {
            update({ visitId: '' });
            setVisitPage(next);
          }}
          disabled={visits.isPlaceholderData}
        />
      )}
      <label>
        分类
        <input value={form.category} onChange={(event) => update({ category: event.target.value })} />
      </label>
      <label>
        <input type="checkbox" checked={form.isTemplate} onChange={(event) => update({ isTemplate: event.target.checked })} />
        作为模板
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
        过敏史
        <textarea value={form.allergyHistory} onChange={(event) => update({ allergyHistory: event.target.value })} />
      </label>
      <label>
        检查所见
        <textarea value={form.examination} onChange={(event) => update({ examination: event.target.value })} />
      </label>
      <label>
        诊断
        <textarea value={form.diagnosis} onChange={(event) => update({ diagnosis: event.target.value })} />
      </label>
      <label>
        治疗计划
        <textarea value={form.treatmentPlan} onChange={(event) => update({ treatmentPlan: event.target.value })} />
      </label>
      <label>
        涉及牙位（逗号分隔）
        <input value={form.teethInvolved} onChange={(event) => update({ teethInvolved: event.target.value })} />
      </label>
      <label>
        图片 URL（逗号分隔）
        <input value={form.images} onChange={(event) => update({ images: event.target.value })} />
      </label>
      <label>
        签名
        <input value={form.signature} onChange={(event) => update({ signature: event.target.value })} />
      </label>
    </>
  );
}
