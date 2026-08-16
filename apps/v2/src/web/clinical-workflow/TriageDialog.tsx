import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { Dialog } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import type { Page } from '../lib/types';
import { rowPatientName, type RegistrationRow } from './types';

export function TriageDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RegistrationRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const patientName = rowPatientName(row);
  const departments = useQuery({
    queryKey: ['workflow', 'departments'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/departments?page=1&pageSize=100'),
  });
  const doctors = useQuery({
    queryKey: ['workbench', 'doctors'],
    queryFn: () => apiRequest<Array<Record<string, unknown>>>('/doctors'),
  });
  const [departmentId, setDepartmentId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [triageNote, setTriageNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(`/registrations/${row.id}/triage`, {
        method: 'POST',
        body: JSON.stringify({
          departmentId: departmentId || undefined,
          doctorId: doctorId || undefined,
          triageNote: triageNote.trim() || undefined,
        }),
      });
      showToast('分诊已提交', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '提交分诊失败'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title="分诊" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          患者
          <input readOnly value={patientName} aria-label="患者" />
        </label>
        <label>
          分诊科室
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">选择科室</option>
            {departments.data?.items?.map((department) => (
              <option key={String(department.id)} value={String(department.id)}>
                {String(department.name ?? department.id)}
              </option>
            ))}
          </select>
        </label>
        {/* B6：/doctors 加载失败时行内提示并支持重试，避免静默空列表 */}
        {doctors.isError && (
          <div className="query-section-error">
            <p className="error">医生列表加载失败</p>
            <button type="button" className="btn-secondary" onClick={() => void doctors.refetch()}>重试</button>
          </div>
        )}
        <label>
          分诊医生
          <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} disabled={doctors.isError}>
            <option value="">选择医生</option>
            {doctors.data?.map((doctor) => (
              <option key={String(doctor.id)} value={String(doctor.id)}>
                {String(doctor.name ?? doctor.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          分诊备注
          <textarea value={triageNote} onChange={(event) => setTriageNote(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy}>提交分诊</button>
        </div>
      </form>
    </Dialog>
  );
}
