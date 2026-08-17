import { useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { Dialog, DoctorSelect } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { rowPatientName, type RegistrationRow } from './types';

export function RecordDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RegistrationRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const patientId = String(row.patientId ?? '');
  const patientName = rowPatientName(row);
  const [doctorId, setDoctorId] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('DRAFT');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    if (!doctorId) {
      showToast('请选择医生', 'error');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await apiRequest('/resources/medicalRecords', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          visitId: row.visitId ? String(row.visitId) : undefined,
          doctorId,
          category: category || undefined,
          status,
          chiefComplaint: chiefComplaint || undefined,
          diagnosis: diagnosis || undefined,
          treatmentPlan: treatmentPlan || undefined,
          isTemplate: false,
        }),
      });
      showToast('病历已创建', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '创建病历失败'), 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open title="新建病历" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          患者
          <input readOnly value={patientName} aria-label="患者" />
        </label>
        <DoctorSelect label="医生" value={doctorId} onChange={setDoctorId} />
        <label>
          分类
          <input value={category} onChange={(event) => setCategory(event.target.value)} />
        </label>
        <label>
          状态
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="DRAFT">草稿</option>
            <option value="SUBMITTED">已提交</option>
            <option value="APPROVED">已审核</option>
          </select>
        </label>
        <label>
          主诉
          <textarea value={chiefComplaint} onChange={(event) => setChiefComplaint(event.target.value)} />
        </label>
        <label>
          诊断
          <textarea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} />
        </label>
        <label>
          治疗计划
          <textarea value={treatmentPlan} onChange={(event) => setTreatmentPlan(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy}>提交病历</button>
        </div>
      </form>
    </Dialog>
  );
}
