import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';

const STATUSES = ['BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export function AppointmentsPage() {
  const [patientId, setPatientId] = useState('patient-demo-001');
  const [doctorId, setDoctorId] = useState('user-admin-001');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['appointments'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/appointments?page=1&pageSize=20'),
  });

  async function create(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await apiRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          doctorId,
          startTime: new Date(startTime || Date.now() + 86_400_000).toISOString(),
          endTime: new Date(endTime || Date.now() + 90_000_000).toISOString(),
          type: 'REGULAR',
        }),
      });
      setMessage('Appointment created');
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Create failed');
    }
  }

  async function transition(id: string, status: string) {
    try {
      await apiRequest(`/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Status transition failed');
    }
  }

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'patientId', label: 'Patient', render: (row) => String(row.patientId ?? '') },
    { key: 'doctorId', label: 'Doctor', render: (row) => String(row.doctorId ?? '') },
    { key: 'startTime', label: 'Start', render: (row) => String(row.startTime ?? '') },
    { key: 'status', label: 'Status', render: (row) => String(row.status ?? '') },
    {
      key: 'actions',
      label: 'Action',
      render: (row) => (
        <select defaultValue="" onChange={(event) => event.target.value && transition(String(row.id), event.target.value)}>
          <option value="">Change status</option>
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      ),
    },
  ];

  return (
    <div className="page">
      <h1>Appointments</h1>
      <form className="inline-form" onSubmit={create}>
        <input value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="patientId" />
        <input value={doctorId} onChange={(event) => setDoctorId(event.target.value)} placeholder="doctorId" />
        <input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        <input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        <button type="submit">Create</button>
      </form>
      {message && <p className="info">{message}</p>}
      <DataTable columns={columns} rows={query.data?.items ?? []} keyField="id" emptyText="No appointments" />
    </div>
  );
}
