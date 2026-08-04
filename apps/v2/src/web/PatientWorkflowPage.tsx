import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { Page } from './types';

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

  return (
    <div className="page">
      <h1>患者风险评分</h1>
      {message && <p className="info">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Action</th></tr></thead>
          <tbody>
            {patients.data?.items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.id).slice(0, 8)}</td>
                <td>{String(row.name ?? '')}</td>
                <td><button onClick={() => calculate(String(row.id))}>计算风险</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>历史评分</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Patient</th><th>Caries</th><th>Periodontal</th><th>Implant</th></tr></thead>
          <tbody>
            {scores.data?.items.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.patientId ?? '')}</td>
                <td>{String(row.cariesScore ?? '')}</td>
                <td>{String(row.periodontalScore ?? '')}</td>
                <td>{String(row.implantScore ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
