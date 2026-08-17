import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Dialog, DoctorSelect, SearchableSelect } from '../../components';
import type { AppointmentForm, PurposeRow } from '../../appointments/types';
import { AppointmentPurposeSelect, AppointmentTypeSelect } from './appointments-fields';

export function AppointmentEditDialog({
  open,
  form,
  setForm,
  purposeItems,
  purposeMissing,
  submitting,
  stale,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: AppointmentForm;
  setForm: Dispatch<SetStateAction<AppointmentForm>>;
  purposeItems: PurposeRow[] | undefined;
  purposeMissing: (id: string) => boolean;
  submitting: boolean;
  stale: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Dialog open={open} title="编辑预约" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <SearchableSelect resource="patients" value={form.patientId} onChange={(value) => setForm((current) => ({ ...current, patientId: value }))} ariaLabel="患者" placeholder="选择患者（预约患者）" />
        <DoctorSelect ariaLabel="医生" value={form.doctorId} onChange={(id) => setForm((current) => ({ ...current, doctorId: id }))} />
        <SearchableSelect resource="chairs" value={form.chairId} onChange={(value) => setForm((current) => ({ ...current, chairId: value }))} ariaLabel="椅位" placeholder="不指定椅位" />
        <AppointmentTypeSelect value={form.type} onChange={(value) => setForm((current) => ({ ...current, type: value }))} />
        <AppointmentPurposeSelect value={form.purpose} onChange={(value) => setForm((current) => ({ ...current, purpose: value }))} items={purposeItems} missing={purposeMissing} />
        <input aria-label="临时患者姓名" type="text" value={form.tempPatientName} onChange={(event) => setForm((current) => ({ ...current, tempPatientName: event.target.value }))} placeholder="临时患者姓名" />
        <input aria-label="临时患者电话" type="text" value={form.tempPatientPhone} onChange={(event) => setForm((current) => ({ ...current, tempPatientPhone: event.target.value }))} placeholder="临时患者电话" />
        <input aria-label="开始时间" type="datetime-local" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} />
        <input aria-label="结束时间" type="datetime-local" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={submitting || stale}>{submitting ? '保存中...' : '保存'}</button>
        </div>
      </form>
    </Dialog>
  );
}
