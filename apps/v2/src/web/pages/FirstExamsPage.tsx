import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import { CrudPage } from '../components/CrudPage';
import { ConfirmDialog } from '../components';
import { useToast } from '../lib/toast-context';
import { changeDentition, restartFirstExam, transitionFirstExam } from '../first-exams/actions';
import { firstExamColumns } from '../first-exams/columns';
import { DENTITION_LABELS, STATUS_LABELS } from '../first-exams/constants';
import { FirstExamFormFields } from '../first-exams/FormFields';
import { HistoryDialog } from '../first-exams/HistoryDialog';
import { TeethMarkDialog } from '../first-exams/TeethMarkDialog';
import { TrackingDialog } from '../first-exams/TrackingDialog';
import { TrackingOverviewBar } from '../first-exams/TrackingOverviewBar';
import { emptyForm } from '../first-exams/types';
import type { FirstExamForm, FirstExamRow, FirstExamTrackingOverview } from '../first-exams/types';

export function FirstExamsPage() {
  const { showToast } = useToast();
  const [dialogTarget, setDialogTarget] = useState<{ kind: 'tracking' | 'teeth' | 'restart' | 'history'; row: FirstExamRow } | null>(null);
  const overviewQuery = useQuery({
    queryKey: ['first-exams-tracking-overview'],
    queryFn: () => apiRequest<FirstExamTrackingOverview>('/first-exams/tracking-overview'),
  });
  return (
    <>
      <TrackingOverviewBar data={overviewQuery.data} />
      <CrudPage<FirstExamRow, FirstExamForm>
        title="首诊管理"
        createLabel="新建首诊"
        emptyMessage="暂无首诊"
        queryKey={['first-exams']}
        endpoint="/resources/firstExams"
        initialForm={emptyForm}
        validate={(form) => (!form.patientId || !form.doctorId ? '请选择患者和医生' : null)}
        toPayload={(form) => ({
          patientId: form.patientId,
          doctorId: form.doctorId,
          consultantId: form.consultantId || undefined,
          status: form.status,
          chiefComplaint: form.chiefComplaint || undefined,
          presentIllness: form.presentIllness || undefined,
          pastHistory: form.pastHistory || undefined,
          oralExam: form.oralExam || undefined,
          auxiliaryExam: form.auxiliaryExam || undefined,
          diagnosis: form.diagnosis || undefined,
          treatmentSuggestion: form.treatmentSuggestion || undefined,
          remark: form.remark || undefined,
        })}
        formFromRow={(row) => ({
          patientId: String(row.patientId ?? ''),
          doctorId: String(row.doctorId ?? ''),
          consultantId: String(row.consultantId ?? ''),
          status: String(row.status ?? 'DRAFT'),
          chiefComplaint: String(row.chiefComplaint ?? ''),
          presentIllness: String(row.presentIllness ?? ''),
          pastHistory: String(row.pastHistory ?? ''),
          oralExam: String(row.oralExam ?? ''),
          auxiliaryExam: String(row.auxiliaryExam ?? ''),
          diagnosis: String(row.diagnosis ?? ''),
          treatmentSuggestion: String(row.treatmentSuggestion ?? ''),
          remark: String(row.remark ?? ''),
        })}
        canEdit
        canDelete
        messages={{ create: '首诊记录已创建', update: '首诊记录已更新', delete: '首诊记录已删除' }}
        errorMessages={{ create: '创建首诊失败' }}
        columns={firstExamColumns}
        rowActions={(row, ctx) => (
          <>
            <select
              defaultValue=""
              aria-label="变更首诊状态"
              onChange={(event) => {
                if (event.target.value) void transitionFirstExam(showToast, ctx.reload, row.id, event.target.value);
              }}
            >
              <option value="">变更状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button onClick={() => setDialogTarget({ kind: 'tracking', row })}>追踪</button>
            <select
              defaultValue={String(row.dentition ?? '')}
              aria-label="切换牙列"
              onChange={(event) => {
                if (event.target.value) void changeDentition(showToast, ctx.reload, row.id, event.target.value);
              }}
            >
              <option value="">牙列</option>
              {Object.entries(DENTITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button onClick={() => setDialogTarget({ kind: 'teeth', row })}>牙齿标记</button>
            <button onClick={() => setDialogTarget({ kind: 'restart', row })}>重启检查</button>
            <button onClick={() => setDialogTarget({ kind: 'history', row })}>历史</button>
            {dialogTarget?.kind === 'tracking' && dialogTarget.row.id === row.id && (
              <TrackingDialog
                row={dialogTarget.row}
                reload={ctx.reload}
                refetchOverview={() => void overviewQuery.refetch()}
                onClose={() => setDialogTarget(null)}
              />
            )}
            {dialogTarget?.kind === 'teeth' && dialogTarget.row.id === row.id && (
              <TeethMarkDialog row={dialogTarget.row} reload={ctx.reload} onClose={() => setDialogTarget(null)} />
            )}
            {dialogTarget?.kind === 'restart' && dialogTarget.row.id === row.id && (
              <ConfirmDialog
                open
                title="重启检查"
                message="确定重启该首诊吗？将复制临床内容创建一条新的检查记录（不复制牙齿明细），原记录保留为历史。"
                confirmText="确认重启"
                onConfirm={() => {
                  setDialogTarget(null);
                  void restartFirstExam(showToast, ctx.reload, row.id);
                }}
                onCancel={() => setDialogTarget(null)}
              />
            )}
            {dialogTarget?.kind === 'history' && dialogTarget.row.id === row.id && (
              <HistoryDialog row={dialogTarget.row} onClose={() => setDialogTarget(null)} />
            )}
          </>
        )}
        renderForm={(ctx) => <FirstExamFormFields form={ctx.form} update={ctx.update} />}
      />
    </>
  );
}
