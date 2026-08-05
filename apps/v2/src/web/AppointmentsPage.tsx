import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, LoadingState, PageError } from './components';
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
  doctorId?: string | null;
  startTime?: string | null;
  status?: string | null;
};

export function AppointmentsPage() {
  const { showToast } = useToast();
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [chairId, setChairId] = useState('');
  const [type, setType] = useState('REGULAR');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const patients = useQuery({
    queryKey: ['appointment-patients'],
    queryFn: () => apiRequest<Page<LookupRow>>('/resources/patients?page=1&pageSize=200'),
  });
  const doctors = useQuery({
    queryKey: ['appointment-doctors'],
    queryFn: () => apiRequest<Array<LookupRow>>('/doctors'),
  });
  const chairs = useQuery({
    queryKey: ['appointment-chairs'],
    queryFn: () => apiRequest<Page<LookupRow>>('/resources/chairs?page=1&pageSize=200'),
  });
  const query = useQuery({
    queryKey: ['appointments'],
    queryFn: () => apiRequest<Page<AppointmentRow>>('/resources/appointments?page=1&pageSize=20'),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <PageError message={(query.error as Error).message} />;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (submitting || !patientId || !doctorId || !startTime || !endTime) {
      showToast('请选择患者、医生并填写开始和结束时间', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          doctorId,
          chairId: chairId || undefined,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          type,
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
    { key: 'patientId', label: '患者' },
    { key: 'doctorId', label: '医生' },
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
        <select aria-label="患者" value={patientId} onChange={(event) => setPatientId(event.target.value)}>
          <option value="">选择患者</option>
          {patients.data?.items.map((row) => (
            <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
        <select aria-label="医生" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
          <option value="">选择医生</option>
          {doctors.data?.map((row) => (
            <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
        <select aria-label="椅位" value={chairId} onChange={(event) => setChairId(event.target.value)}>
          <option value="">不指定椅位</option>
          {chairs.data?.items.map((row) => (
            <option key={row.id} value={row.id}>{String(row.name ?? row.id)}</option>
          ))}
        </select>
        <select aria-label="预约类型" value={type} onChange={(event) => setType(event.target.value)}>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input aria-label="开始时间" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        <input aria-label="结束时间" type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        <button type="submit" disabled={submitting}>{submitting ? '创建中...' : '创建预约'}</button>
      </form>
      <DataTable columns={columns} rows={query.data?.items ?? []} keyField="id" emptyText="暂无预约" />
    </div>
  );
}
