import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { Dialog } from '../../components';
import { errorMessage } from '../../lib/messages';
import { splitList } from '../../lib/format';
import { useToast } from '../../lib/toast-context';
import { recordColumns } from '../../medical-records/columns';
import { EDIT_STATUS_OPTIONS } from '../../medical-records/constants';
import { listToText, textValue } from '../../medical-records/form';
import { proposedEntries } from '../../medical-records/format';
import { RecordFormFields } from '../../medical-records/RecordFormFields';
import { emptyEditForm, emptyForm, type EditRequestForm, type MedicalRecordRow, type RecordForm } from '../../medical-records/types';

export function MedicalRecordsPage() {
  const { showToast } = useToast();
  const [editTarget, setEditTarget] = useState<MedicalRecordRow | null>(null);
  const [reviewTarget, setReviewTarget] = useState<MedicalRecordRow | null>(null);
  const [editForm, setEditForm] = useState<EditRequestForm>(emptyEditForm);
  const [reviewNote, setReviewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const reloadRef = useRef<() => Promise<unknown>>(async () => undefined);

  function openEditRequest(row: MedicalRecordRow) {
    setEditForm({
      reason: '',
      category: textValue(row.category),
      status: textValue(row.status) || 'DRAFT',
      chiefComplaint: textValue(row.chiefComplaint),
      presentIllness: textValue(row.presentIllness),
      pastHistory: textValue(row.pastHistory),
      allergyHistory: textValue(row.allergyHistory),
      examination: textValue(row.examination),
      diagnosis: textValue(row.diagnosis),
      treatmentPlan: textValue(row.treatmentPlan),
      teethInvolved: listToText(row.teethInvolved),
      images: listToText(row.images),
      signature: textValue(row.signature),
    });
    setEditTarget(row);
  }

  async function submitEditRequest() {
    if (!editTarget || submitting) return;
    if (!editForm.reason.trim()) {
      showToast('请填写修改原因', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/medical-records/${editTarget.id}/edit-request`, {
        method: 'POST',
        body: JSON.stringify({
          reason: editForm.reason.trim(),
          proposedContent: {
            category: editForm.category,
            status: editForm.status,
            chiefComplaint: editForm.chiefComplaint,
            presentIllness: editForm.presentIllness,
            pastHistory: editForm.pastHistory,
            allergyHistory: editForm.allergyHistory,
            examination: editForm.examination,
            diagnosis: editForm.diagnosis,
            treatmentPlan: editForm.treatmentPlan,
            teethInvolved: splitList(editForm.teethInvolved),
            images: splitList(editForm.images),
            signature: editForm.signature,
          },
        }),
      });
      showToast('修改申请已提交', 'success');
      setEditTarget(null);
      await reloadRef.current();
    } catch (error) {
      showToast(errorMessage(error, '提交失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReview(approve: boolean) {
    if (!reviewTarget || submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/medical-records/${reviewTarget.id}/edit-request/review`, {
        method: 'PATCH',
        body: JSON.stringify({ approve, reviewNote: reviewNote.trim() || undefined }),
      });
      showToast(approve ? '已通过修改申请' : '已驳回修改申请', 'success');
      setReviewTarget(null);
      setReviewNote('');
      await reloadRef.current();
    } catch (error) {
      showToast(errorMessage(error, '审核失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <CrudPage<MedicalRecordRow, RecordForm>
      title="病历管理"
      createLabel="新建病历"
      emptyMessage="暂无病历"
      queryKey={['medical-records']}
      endpoint="/resources/medicalRecords"
      initialForm={emptyForm}
      validate={(form) => (!form.patientId || !form.doctorId ? '请选择患者和医生' : null)}
      toPayload={(form) => ({
        patientId: form.patientId,
        visitId: form.visitId || undefined,
        doctorId: form.doctorId,
        category: form.category || undefined,
        status: form.status,
        isTemplate: form.isTemplate,
        chiefComplaint: form.chiefComplaint || undefined,
        presentIllness: form.presentIllness || undefined,
        pastHistory: form.pastHistory || undefined,
        allergyHistory: form.allergyHistory || undefined,
        examination: form.examination || undefined,
        diagnosis: form.diagnosis || undefined,
        treatmentPlan: form.treatmentPlan || undefined,
        teethInvolved: splitList(form.teethInvolved),
        images: splitList(form.images),
        signature: form.signature || undefined,
      })}
      messages={{ create: '病历已创建', update: '病历已更新', delete: '病历已删除' }}
      formFromRow={(row) => ({
        patientId: String(row.patientId ?? ''),
        visitId: String(row.visitId ?? ''),
        doctorId: String(row.doctorId ?? ''),
        category: textValue(row.category),
        status: textValue(row.status) || 'DRAFT',
        isTemplate: Boolean(row.isTemplate),
        chiefComplaint: textValue(row.chiefComplaint),
        presentIllness: textValue(row.presentIllness),
        pastHistory: textValue(row.pastHistory),
        allergyHistory: textValue(row.allergyHistory),
        examination: textValue(row.examination),
        diagnosis: textValue(row.diagnosis),
        treatmentPlan: textValue(row.treatmentPlan),
        teethInvolved: listToText(row.teethInvolved),
        images: listToText(row.images),
        signature: textValue(row.signature),
      })}
      errorMessages={{ create: '创建病历失败', update: '更新病历失败', delete: '删除病历失败' }}
      columns={recordColumns}
      canEdit
      canDelete
      rowActions={(row, ctx) => {
        return (
          <>
            <ReloadSync reload={ctx.reload} onReload={(reload) => { reloadRef.current = reload; }} />
            <button onClick={() => openEditRequest(row)}>申请修改</button>
            {String(row.editRequestStatus ?? '') === 'PENDING' && (
              <button onClick={() => { setReviewNote(''); setReviewTarget(row); }}>审核</button>
            )}
          </>
        );
      }}
      renderForm={(ctx) => <RecordFormFields form={ctx.form} update={ctx.update} />}
      />
      <Dialog open={editTarget !== null} title="申请修改病历" onClose={() => setEditTarget(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void submitEditRequest(); }}>
          <label>
            修改原因
            <textarea value={editForm.reason} onChange={(event) => setEditForm({ ...editForm, reason: event.target.value })} />
          </label>
          <label>
            分类
            <input value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} />
          </label>
          <label>
            状态
            <select value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}>
              {EDIT_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            主诉
            <textarea value={editForm.chiefComplaint} onChange={(event) => setEditForm({ ...editForm, chiefComplaint: event.target.value })} />
          </label>
          <label>
            现病史
            <textarea value={editForm.presentIllness} onChange={(event) => setEditForm({ ...editForm, presentIllness: event.target.value })} />
          </label>
          <label>
            既往史
            <textarea value={editForm.pastHistory} onChange={(event) => setEditForm({ ...editForm, pastHistory: event.target.value })} />
          </label>
          <label>
            过敏史
            <textarea value={editForm.allergyHistory} onChange={(event) => setEditForm({ ...editForm, allergyHistory: event.target.value })} />
          </label>
          <label>
            检查所见
            <textarea value={editForm.examination} onChange={(event) => setEditForm({ ...editForm, examination: event.target.value })} />
          </label>
          <label>
            诊断
            <textarea value={editForm.diagnosis} onChange={(event) => setEditForm({ ...editForm, diagnosis: event.target.value })} />
          </label>
          <label>
            治疗计划
            <textarea value={editForm.treatmentPlan} onChange={(event) => setEditForm({ ...editForm, treatmentPlan: event.target.value })} />
          </label>
          <label>
            涉及牙位（逗号分隔）
            <input value={editForm.teethInvolved} onChange={(event) => setEditForm({ ...editForm, teethInvolved: event.target.value })} />
          </label>
          <label>
            图片 URL（逗号分隔）
            <input value={editForm.images} onChange={(event) => setEditForm({ ...editForm, images: event.target.value })} />
          </label>
          <label>
            签名
            <input value={editForm.signature} onChange={(event) => setEditForm({ ...editForm, signature: event.target.value })} />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={() => setEditTarget(null)}>取消</button>
            <button type="submit" disabled={submitting}>{submitting ? '提交中...' : '提交申请'}</button>
          </div>
        </form>
      </Dialog>

      <Dialog open={reviewTarget !== null} title="审核修改申请" onClose={() => setReviewTarget(null)}>
        <p>申请原因：{reviewTarget?.editRequestReason ?? ''}</p>
        {proposedEntries(reviewTarget).map(([key, value]) => (
          <p key={key}>{key}: {String(value ?? '')}</p>
        ))}
        <label>
          审核意见
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={() => setReviewTarget(null)}>取消</button>
          <button type="button" disabled={submitting} onClick={() => void submitReview(false)}>驳回</button>
          <button type="button" disabled={submitting} onClick={() => void submitReview(true)}>通过</button>
        </div>
      </Dialog>
    </>
  );
}

// 与 MemberCardsPage 相同的 M9 约定：渲染期写 ref 是反模式（StrictMode 双渲染/
// 行集合变化时 ref 可能指向旧实例），改到 effect 提交后同步。
function ReloadSync({
  reload,
  onReload,
}: {
  reload: () => Promise<unknown>;
  onReload: (reload: () => Promise<unknown>) => void;
}) {
  useEffect(() => {
    onReload(reload);
  }, [reload, onReload]);
  return null;
}
