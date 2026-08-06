import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, LoadingState, PageError, SearchableSelect } from './components';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

const STATUSES = ['BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const STATUS_LABELS: Record<string, string> = {
  BOOKED: '已预约',
  ARRIVED: '已到诊',
  IN_CHAIR: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  NO_SHOW: '未到诊',
};

const TYPE_LABELS: Record<string, string> = {
  REGULAR: '常规预约',
  FOLLOW_UP: '随访预约',
  EMERGENCY: '急诊',
  CONSULTATION: '咨询',
};

type LookupRow = Record<string, unknown> & { id: string; name?: string };
type AppointmentRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  startTime?: string | null;
  status?: string | null;
  purpose?: string | null;
  tempPatientName?: string | null;
};
type PurposeRow = Record<string, unknown> & { id: string; name?: string; active?: unknown };

export function AppointmentsPage() {
  const { showToast } = useToast();
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [chairId, setChairId] = useState('');
  const [type, setType] = useState('REGULAR');
  const [purpose, setPurpose] = useState('');
  const [tempPatientName, setTempPatientName] = useState('');
  const [tempPatientPhone, setTempPatientPhone] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newPurposeName, setNewPurposeName] = useState('');
  const [purposeBusy, setPurposeBusy] = useState(false);

  const doctors = useQuery({
    queryKey: ['appointment-doctors'],
    queryFn: () => apiRequest<Array<LookupRow>>('/doctors'),
  });
  const purposes = useQuery({
    queryKey: ['appointment-purposes'],
    queryFn: () => apiRequest<Page<PurposeRow>>('/resources/appointmentPurposes?page=1&pageSize=100'),
  });
  const query = useQuery({
    queryKey: ['appointments'],
    queryFn: () => apiRequest<Page<AppointmentRow>>('/resources/appointments?page=1&pageSize=20'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    const tempName = tempPatientName.trim();
    if (submitting || !(patientId || tempName) || !doctorId || !startTime || !endTime) {
      showToast('请选择患者、医生并填写开始和结束时间', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId: patientId || undefined,
          doctorId,
          chairId: chairId || undefined,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          type,
          purpose: purpose || undefined,
          tempPatientName: tempName || undefined,
          tempPatientPhone: tempPatientPhone.trim() || undefined,
        }),
      });
      showToast('预约已创建', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '创建预约失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function addPurpose(event: FormEvent) {
    event.preventDefault();
    const name = newPurposeName.trim();
    if (purposeBusy || !name) {
      showToast('请输入事项名称', 'error');
      return;
    }
    setPurposeBusy(true);
    try {
      await apiRequest('/resources/appointmentPurposes', {
        method: 'POST',
        body: JSON.stringify({ name, active: true }),
      });
      showToast('事项已添加', 'success');
      setNewPurposeName('');
      await purposes.refetch();
    } catch (error) {
      showToast(errorMessage(error, '添加事项失败'), 'error');
    } finally {
      setPurposeBusy(false);
    }
  }

  async function togglePurpose(row: PurposeRow) {
    try {
      const active = Number(row.active) === 1;
      await apiRequest(`/resources/appointmentPurposes/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !active }),
      });
      showToast('事项状态已更新', 'success');
      await purposes.refetch();
    } catch (error) {
      showToast(errorMessage(error, '更新事项失败'), 'error');
    }
  }

  async function transition(id: string, status: string) {
    try {
      await apiRequest(`/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('预约状态已更新', 'success');
      await query.refetch();
    } catch (error) {
      showToast(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  const columns = [
    { key: 'patientId', label: '患者', render: (row: AppointmentRow) => row.patientIdLabel ?? row.tempPatientName ?? row.patientId ?? '' },
    { key: 'doctorId', label: '医生', render: (row: AppointmentRow) => row.doctorIdLabel ?? row.doctorId ?? '' },
    { key: 'purpose', label: '预约事项', render: (row: AppointmentRow) => String(row.purpose ?? '') },
    {
      key: 'startTime',
      label: '开始时间',
      render: (row: AppointmentRow) => row.startTime ? new Date(row.startTime).toLocaleString('zh-CN', { hour12: false }) : '',
    },
    {
      key: 'status',
      label: '状态',
      render: (row: AppointmentRow) => STATUS_LABELS[String(row.status ?? '')] ?? String(row.status ?? ''),
    },
    {
      key: 'actions',
      label: '操作',
      render: (row: AppointmentRow) => (
        <select
          defaultValue=""
          aria-label="变更预约状态"
          onChange={(event) => event.target.value && transition(row.id, event.target.value)}
        >
          <option value="">变更状态</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <div className="page">
      <h1>预约管理</h1>
      <form className="inline-form" onSubmit={create}>
        <SearchableSelect resource="patients" value={patientId} onChange={setPatientId} ariaLabel="患者" placeholder="选择患者" />
        <select aria-label="医生" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
        <SearchableSelect resource="chairs" value={chairId} onChange={setChairId} ariaLabel="椅位" placeholder="不指定椅位" />
        <select aria-label="预约类型" value={type} onChange={(event) => setType(event.target.value)}>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select aria-label="预约事项" value={purpose} onChange={(event) => setPurpose(event.target.value)}>
          <option value="">不指定</option>
          {purposes.data?.items?.map((row) => (
            <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
        <input aria-label="临时患者姓名" type="text" value={tempPatientName} onChange={(event) => setTempPatientName(event.target.value)} placeholder="临时患者姓名" />
        <input aria-label="临时患者电话" type="text" value={tempPatientPhone} onChange={(event) => setTempPatientPhone(event.target.value)} placeholder="临时患者电话" />
        <input aria-label="开始时间" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        <input aria-label="结束时间" type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        <button type="submit" disabled={submitting}>{submitting ? '创建中...' : '创建预约'}</button>
      </form>
      <section className="analytics-panel" aria-label="预约事项管理">
        <h2>预约事项管理</h2>
        <ul className="purpose-list">
          {(purposes.data?.items ?? []).map((row) => (
            <li key={row.id}>
              <span>{String(row.name ?? row.id)}</span>
              <button type="button" onClick={() => void togglePurpose(row)}>
                {Number(row.active) === 1 ? '停用' : '启用'}
              </button>
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={addPurpose}>
          <input aria-label="新事项名称" type="text" value={newPurposeName} onChange={(event) => setNewPurposeName(event.target.value)} placeholder="新事项名称" />
          <button type="submit" disabled={purposeBusy}>{purposeBusy ? '添加中...' : '添加事项'}</button>
        </form>
      </section>
      <DataTable columns={columns} rows={query.data?.items ?? []} keyField="id" emptyText="暂无预约" />
    </div>
  );
}
