import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { Page } from '../lib/types';
import { CrudPage } from '../components/CrudPage';
import { Dialog } from '../components';
import { errorMessage } from '../lib/messages';
import { useToast } from '../lib/toast-context';
import { createPrescription, processPrescription, updatePrescription } from '../prescriptions/api';
import { prescriptionColumns } from '../prescriptions/columns';
import { emptyForm, itemRowToForm, validItems } from '../prescriptions/form';
import { PrescriptionForm as PrescriptionFormFields } from '../prescriptions/PrescriptionForm';
import { PrescriptionStatusDialog } from '../prescriptions/status-dialog';
import type { PrescriptionForm, PrescriptionRow } from '../prescriptions/types';

export function PrescriptionsPage() {
  const { showToast } = useToast();
  const [statusTarget, setStatusTarget] = useState<{ row: PrescriptionRow; reload: () => Promise<unknown> } | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const updateFormRef = useRef<((patch: Partial<PrescriptionForm>) => void) | null>(null);
  const [editLoadKey, setEditLoadKey] = useState(0);

  // 编辑打开时异步加载该处方的明细行并回填表单 items（formFromRow 是同步的，无法 await）。
  useEffect(() => {
    if (editLoadKey === 0) return;
    const prescriptionId = editingIdRef.current;
    if (!prescriptionId) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await apiRequest<Page<Record<string, unknown>>>(
          `/resources/prescriptionItems?prescriptionId=${prescriptionId}&page=1&pageSize=100`,
        );
        if (!cancelled) updateFormRef.current?.({ items: page.items.map(itemRowToForm) });
      } catch (error) {
        showToast(errorMessage(error, '加载处方明细失败'), 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [editLoadKey, showToast]);

  return (
    <>
      <CrudPage<PrescriptionRow, PrescriptionForm>
        title="处方管理"
        createLabel="新建处方"
        emptyMessage="暂无处方"
        queryKey={['prescriptions']}
        endpoint="/resources/prescriptions"
        initialForm={() => {
          editingIdRef.current = null;
          return emptyForm();
        }}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          setEditLoadKey((key) => key + 1);
          return {
            patientId: String(row.patientId ?? ''),
            doctorId: String(row.doctorId ?? ''),
            remark: String(row.remark ?? ''),
            status: String(row.status ?? 'DRAFT'),
            items: [],
          };
        }}
        validate={(form) =>
          !form.patientId || !form.doctorId || validItems(form).length === 0
            ? '请选择患者、医生并至少填写一条有效处方明细'
            : null
        }
        submitOverride={({ form, editing }) =>
          editing ? updatePrescription(form, editingIdRef.current) : createPrescription(form)
        }
        messages={{ create: '处方已创建', update: '处方已更新', delete: '处方已删除' }}
        errorMessages={{ create: '创建处方失败', update: '更新处方失败', delete: '删除处方失败' }}
        deleteOverride={async (row) => {
          // 服务端 DELETE 为软删除且不级联：先删全部明细，再删主记录（明细删除失败仅告警）
          const prescriptionId = String(row.id);
          try {
            const page = await apiRequest<Page<Record<string, unknown>>>(
              `/resources/prescriptionItems?prescriptionId=${prescriptionId}&page=1&pageSize=100`,
            );
            for (const item of page.items) {
              await apiRequest(`/resources/prescriptionItems/${String(item.id)}`, { method: 'DELETE' });
            }
          } catch (error) {
            console.warn(`删除处方明细失败（继续删除主记录）：${prescriptionId}`, error);
          }
          await apiRequest(`/resources/prescriptions/${prescriptionId}`, { method: 'DELETE' });
        }}
        columns={prescriptionColumns}
        canEdit
        canDelete
        dialogTitle={(editing) => (editing ? '编辑处方' : '新建处方')}
        rowActions={(row, ctx) =>
          row.status === 'PROCESSED' ? (
            <button onClick={() => setStatusTarget({ row, reload: ctx.reload })}>查看状态</button>
          ) : (
            <button onClick={() => void processPrescription(row, ctx.reload, showToast)}>处理</button>
          )
        }
        renderForm={(ctx) => {
          updateFormRef.current = ctx.update;
          return <PrescriptionFormFields form={ctx.form} update={ctx.update} editing={ctx.editing} />;
        }}
      />

      <Dialog open={statusTarget !== null} title="处方状态" onClose={() => setStatusTarget(null)}>
        {statusTarget && (
          <PrescriptionStatusDialog
            row={statusTarget.row}
            onClose={() => setStatusTarget(null)}
            onChanged={statusTarget.reload}
          />
        )}
      </Dialog>
    </>
  );
}
