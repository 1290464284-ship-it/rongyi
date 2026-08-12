import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { DataTable, PagePager, QuerySection, type DataTableColumn } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import { useToast } from '../../lib/toast-context';

const WORKFLOW_PAGE_SIZE = 100;

export function PatientWorkflowPage() {
  const { showToast } = useToast();
  const [patientPage, setPatientPage] = useState(1);
  const [scorePage, setScorePage] = useState(1);
  const patients = useQuery({
    queryKey: ['patients-workflow', patientPage],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/patients?page=${patientPage}&pageSize=${WORKFLOW_PAGE_SIZE}`,
    ),
    placeholderData: (previous) => previous,
  });
  const scores = useQuery({
    queryKey: ['risk-workflow', scorePage],
    queryFn: () => apiRequest<Page<Record<string, unknown>>>(
      `/resources/patientRiskScores?page=${scorePage}&pageSize=${WORKFLOW_PAGE_SIZE}`,
    ),
    placeholderData: (previous) => previous,
  });
  const stale = patients.isPlaceholderData;

  async function calculate(patientId: string) {
    if (stale) return;
    try {
      await apiRequest<Record<string, unknown>>(`/patients/${patientId}/risk`, { method: 'POST', body: JSON.stringify({}) });
      showToast('风险评分已更新', 'success');
      await scores.refetch();
    } catch (error) {
      showToast(errorMessage(error, '计算失败'), 'error');
    }
  }

  const patientColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'id', label: 'ID', render: (row) => String(row.id).slice(0, 8) },
    { key: 'name', label: '姓名', render: (row) => String(row.name ?? '') },
    {
      key: 'actions',
      label: '操作',
      render: (row) => <CalculateRiskButton patientId={String(row.id)} onDone={calculate} disabled={stale} />,
    },
  ];

  const scoreColumns: DataTableColumn<Record<string, unknown>>[] = [
    { key: 'patientId', label: '患者', render: (row) => String(row.patientId ?? '') },
    { key: 'cariesScore', label: '龋齿风险', render: (row) => String(row.cariesScore ?? '') },
    { key: 'periodontalScore', label: '牙周风险', render: (row) => String(row.periodontalScore ?? '') },
    { key: 'implantScore', label: '种植风险', render: (row) => String(row.implantScore ?? '') },
  ];

  return (
    <div className="page">
      <div className="page-head"><h1>患者风险评分</h1></div>
      <QuerySection
        query={patients}
        render={(data) => <DataTable columns={patientColumns} rows={data?.items ?? []} keyField="id" emptyText="暂无患者" />}
      />
      <PagePager
        page={patientPage}
        hasNext={patientPage * WORKFLOW_PAGE_SIZE < (patients.data?.total ?? 0)}
        onPageChange={setPatientPage}
        disabled={stale}
      />
      <h2>历史评分</h2>
      <QuerySection
        query={scores}
        render={(data) => <DataTable columns={scoreColumns} rows={data?.items ?? []} keyField="id" emptyText="暂无评分记录" />}
      />
      <PagePager
        page={scorePage}
        hasNext={scorePage * WORKFLOW_PAGE_SIZE < (scores.data?.total ?? 0)}
        onPageChange={setScorePage}
        disabled={scores.isPlaceholderData}
      />
    </div>
  );
}

/** 行内“计算风险”按钮：busy 期间禁用，防止双击重复触发评分计算。 */
function CalculateRiskButton({ patientId, onDone, disabled }: { patientId: string; onDone: (patientId: string) => Promise<void>; disabled?: boolean }) {
  const { busy, run } = useAsyncAction();
  return (
    <button disabled={busy || disabled} onClick={() => run(() => onDone(patientId))}>
      {busy ? '计算中...' : '计算风险'}
    </button>
  );
}
