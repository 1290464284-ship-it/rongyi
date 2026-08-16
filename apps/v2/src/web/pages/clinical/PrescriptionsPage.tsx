import { useEffect, useRef, useState } from 'react';
import { apiRequest, fetchAllPages } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { Dialog } from '../../components';
import { errorMessage } from '../../lib/messages';
import { useAsyncAction } from '../../hooks/use-async-action';
import { useToast, type ToastKind } from '../../lib/toast-context';
import { createPrescription, processPrescription, updatePrescription } from '../../prescriptions/api';
import { prescriptionColumns } from '../../prescriptions/columns';
import { emptyForm, itemRowToForm, validItems } from '../../prescriptions/form';
import { PrescriptionForm as PrescriptionFormFields } from '../../prescriptions/PrescriptionForm';
import { PrescriptionStatusDialog } from '../../prescriptions/status-dialog';
import type { PrescriptionForm, PrescriptionRow } from '../../prescriptions/types';

export function PrescriptionsPage() {
  const { showToast } = useToast();
  const [statusTarget, setStatusTarget] = useState<{ row: PrescriptionRow; reload: () => Promise<unknown> } | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const prescriptionItemsLoadedRef = useRef(false);
  const [prescriptionItemsError, setPrescriptionItemsError] = useState<string | null>(null);
  const updateFormRef = useRef<((patch: Partial<PrescriptionForm>) => void) | null>(null);
  const [editLoadKey, setEditLoadKey] = useState(0);

  // 编辑打开时异步加载该处方的明细行并回填表单 items（formFromRow 是同步的，无法 await）。
  useEffect(() => {
    if (editLoadKey === 0) return;
    const prescriptionId = editingIdRef.current;
    /* v8 ignore next -- editLoadKey 仅在 formFromRow（先写入 editingIdRef）中递增，prescriptionId 恒非空，防御冗余 */
    if (!prescriptionId) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchAllPages<Record<string, unknown>>(
          `/resources/prescriptionItems?prescriptionId=${prescriptionId}`,
        );
        if (!cancelled) {
          prescriptionItemsLoadedRef.current = true;
          setPrescriptionItemsError(null);
          updateFormRef.current?.({ items: items.map(itemRowToForm) });
        }
      } catch (error) {
        if (!cancelled) {
          setPrescriptionItemsError(errorMessage(error, '加载处方明细失败'));
          showToast(errorMessage(error, '加载处方明细失败'), 'error');
        }
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
        paged
        initialForm={() => {
          editingIdRef.current = null;
          prescriptionItemsLoadedRef.current = false;
          setPrescriptionItemsError(null);
          return emptyForm();
        }}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          prescriptionItemsLoadedRef.current = false;
          setPrescriptionItemsError(null);
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
          editingIdRef.current && !prescriptionItemsLoadedRef.current
            ? (prescriptionItemsError ?? '处方明细加载中，请稍候再保存')
            : !form.patientId || !form.doctorId || validItems(form).length === 0
            ? '请选择患者、医生并至少填写一条有效处方明细'
            : null
        }
        submitOverride={({ form, editing }) => {
          // L1：与采购单一致，填了名称但数量/单价无效的明细会被静默丢弃，提交前提示
          const dropped = form.items.filter((item) => item.name.trim()).length - validItems(form).length;
          if (dropped > 0) showToast(`${dropped} 条明细因数量或单价无效将被忽略`, 'info');
          return editing ? updatePrescription(form, editingIdRef.current) : createPrescription(form, showToast);
        }}
        messages={{ create: '处方已创建', update: '处方已更新', delete: '处方已删除' }}
        errorMessages={{ create: '创建处方失败', update: '更新处方失败', delete: '删除处方失败' }}
        deleteOverride={async (row) => {
          // 服务端 DELETE 为软删除且不级联：先删全部明细，再删主记录（明细删除失败仅告警）
          const prescriptionId = String(row.id);
          try {
            const items = await fetchAllPages<Record<string, unknown>>(
              `/resources/prescriptionItems?prescriptionId=${prescriptionId}`,
            );
            for (const item of items) {
              await apiRequest(`/resources/prescriptionItems/${String(item.id)}`, { method: 'DELETE' });
            }
          } catch (error) {
            console.warn(`删除处方明细失败（已中止删除主记录）：${prescriptionId}`, error);
            showToast('删除处方明细失败，已中止删除主记录', 'error');
            throw error;
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
            <ProcessPrescriptionButton row={row} reload={ctx.reload} showToast={showToast} disabled={ctx.stale} />
          )
        }
        renderForm={(ctx) => {
          updateFormRef.current = ctx.update;
          return (
            <>
              {prescriptionItemsError && <p className="error">{prescriptionItemsError}</p>}
              <PrescriptionFormFields form={ctx.form} update={ctx.update} editing={ctx.editing} />
            </>
          );
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

/** 行内“处理”按钮：busy 期间禁用，防止双击重复生成划价单与领药单。 */
function ProcessPrescriptionButton({
  row,
  reload,
  showToast,
  disabled,
}: {
  row: PrescriptionRow;
  reload: () => Promise<unknown>;
  showToast: (message: string, kind?: ToastKind) => void;
  disabled?: boolean;
}) {
  const { busy, run } = useAsyncAction();
  return (
    <button disabled={busy || disabled} onClick={() => {
      /* v8 ignore next -- 按钮在 busy/disabled 期间禁用（jsdom 不派发 click），守卫为防御冗余 */
      if (disabled) return;
      run(() => processPrescription(row, reload, showToast));
    }}>
      {busy ? '处理中...' : '处理'}
    </button>
  );
}
