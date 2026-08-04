import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';
import { DataTable, type DataTableColumn } from './components';

export function PatientWorkflowPage() {
  const [message, setMessage] = useState('');
  const patients = useQuery({
    queryKey: ['patients-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/patients?page=1&pageSize=100'),
  });
  const scores = useQuery({
    queryKey: ['risk-workflow'],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>('/resources/patientRiskScores?page=1&pageSize=100'),
  });

  async function calculate(patientId: string) {
    try {
      const result = await apiRequest<Record<string, unknown>>(`/patients/${patientId}/risk`, { method: 'POST', body: JSON.stringify({}) });
      setMessage(JSON.stringify(result));
      await scores.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '计算失败');
    }
  }

  const patientColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'name', label: 'Name', render: (row) => String(row.name ?? '') },
    {
      key: 'actions',
      label: 'Action',
      render: (row) => <button onClick={() => calculate(String(row.id))}>计算风险</button>,
    },
  ];

  const scoreColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'patientId', label: 'Patient', render: (row) => String(row.patientId ?? '') },
    { key: 'cariesScore', label: 'Caries', render: (row) => String(row.cariesScore ?? '') },
    { key: 'periodontalScore', label: 'Periodontal', render: (row) => String(row.periodontalScore ?? '') },
    { key: 'implantScore', label: 'Implant', render: (row) => String(row.implantScore ?? '') },
  ];

  return (
    <div className="page">
      <h1>患者风险评分</h1>
      {message && <p className="info">{message}</p>}
      <DataTable columns={patientColumns} rows={patients.data?.items ?? []} keyField="id" emptyText="No patients" />
      <h2>历史评分</h2>
      <DataTable columns={scoreColumns} rows={scores.data?.items ?? []} keyField="id" emptyText="No scores" />
    </div>
  );
}
