import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, uploadFile } from './api';
import { CrudPage } from './CrudPage';
import { errorMessage } from './messages';
import { useToast } from './toast-context';
import type { Page } from './types';
import { cephalometricColumns } from './cephalometric/columns';
import { CompareResultView } from './cephalometric/CompareResultView';
import { CephalometricFormFields } from './cephalometric/FormFields';
import { ReportDialog } from './cephalometric/ReportDialog';
import { SendWechatDialog } from './cephalometric/SendWechatDialog';
import { jsonToText } from './cephalometric/utils';
import { emptyForm } from './cephalometric/types';
import type { CephalometricCompareResult, CephalometricForm, CephalometricRow } from './cephalometric/types';

export function CephalometricPage() {
  const { showToast } = useToast();
  const editingIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reportTarget, setReportTarget] = useState<CephalometricRow | null>(null);
  const [sendTarget, setSendTarget] = useState<CephalometricRow | null>(null);
  const [compareTargets, setCompareTargets] = useState<Set<string>>(new Set());
  const [compareResult, setCompareResult] = useState<CephalometricCompareResult | null>(null);
  const [comparing, setComparing] = useState(false);

  // 与 CrudPage 列表共享查询缓存（useCrudResource 将 queryKey 展开为 ['cephalometric', page, search]）。
  // 使用独立键 'caseList' 避免与列表查询键冲突（列表键可能被误认为二维分页参数）。
  const caseList = useQuery({
    queryKey: ['cephalometric', 'caseList', 1, ''],
    queryFn: () => apiRequest<Page<CephalometricRow>>('/resources/cephalometricCases?page=1&pageSize=50'),
  });
  const compareOptions = caseList.data?.items ?? [];

  function toggleCompare(id: string, checked: boolean) {
    setCompareResult(null);
    if (checked && compareTargets.size >= 10) {
      showToast('最多选择 10 个病例进行比较', 'error');
      return;
    }
    setCompareTargets((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function runCompare() {
    const caseIds = Array.from(compareTargets);
    if (caseIds.length < 1 || caseIds.length > 10) {
      showToast('请选择 1-10 个病例进行比较', 'error');
      return;
    }
    setComparing(true);
    try {
      const result = await apiRequest<CephalometricCompareResult>('/cephalometric/compare', {
        method: 'POST',
        body: JSON.stringify({ caseIds }),
      });
      setCompareResult(result);
    } catch (error) {
      showToast(errorMessage(error, '轮廓比较失败'), 'error');
    } finally {
      setComparing(false);
    }
  }

  return (
    <>
      <CrudPage<CephalometricRow, CephalometricForm>
        title="头影测量"
        createLabel="新建测量"
        emptyMessage="暂无头影测量"
        queryKey={['cephalometric']}
        endpoint="/resources/cephalometricCases"
        initialForm={() => {
          editingIdRef.current = null;
          return { ...emptyForm };
        }}
        validate={(form) => {
          let parsedLandmarks: Record<string, unknown> = {};
          let _parsedMetrics: Record<string, unknown> = {};
          try {
            parsedLandmarks = JSON.parse(form.landmarksJson || '{}') as Record<string, unknown>;
            _parsedMetrics = JSON.parse(form.metricsJson || '{}') as Record<string, unknown>;
          } catch {
            return '标记点或测量结果必须是有效 JSON';
          }
          if (!form.patientId || (!file && !form.imageUrl && Object.keys(parsedLandmarks ?? {}).length === 0)) {
            return '请选择患者并上传影像或填写标记点';
          }
          return null;
        }}
        submitOverride={async ({ form, editing }) => {
          const parsedLandmarks = JSON.parse(form.landmarksJson || '{}') as Record<string, unknown>;
          const parsedMetrics = JSON.parse(form.metricsJson || '{}') as Record<string, unknown>;
          const imageUrl = file ? (await uploadFile(file)).url : undefined;
          const payload = {
            patientId: form.patientId,
            imageUrl: imageUrl ?? String(form.imageUrl ?? ''),
            landmarksJson: JSON.stringify(parsedLandmarks),
            metricsJson: JSON.stringify(parsedMetrics),
            templateId: form.templateId || undefined,
            status: form.status,
            remark: form.remark || undefined,
          };
          if (editing) {
            await apiRequest(`/resources/cephalometricCases/${editingIdRef.current}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
          } else {
            await apiRequest('/resources/cephalometricCases', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }
        }}
        onAfterCreate={() => setFile(null)}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          return {
            patientId: String(row.patientId ?? ''),
            status: String(row.status ?? 'DRAFT'),
            templateId: String(row.templateId ?? ''),
            landmarksJson: jsonToText(row.landmarksJson),
            metricsJson: jsonToText(row.metricsJson),
            remark: String(row.remark ?? ''),
            imageUrl: String(row.imageUrl ?? ''),
          };
        }}
        messages={{ create: '头影测量已创建', update: '头影测量已更新', delete: '头影测量已删除' }}
        errorMessages={{ create: '创建头影测量失败', update: '更新头影测量失败', delete: '删除头影测量失败' }}
        columns={cephalometricColumns()}
        canEdit
        canDelete
        rowActions={(row, ctx) => (
          <>
            <button onClick={() => { setSendTarget(null); setReportTarget(row); }}>测量报告</button>
            <button onClick={() => { setReportTarget(null); setSendTarget(row); }}>发送微信</button>
            {reportTarget?.id === row.id && (
              <ReportDialog row={row} reload={ctx.reload} onClose={() => setReportTarget(null)} />
            )}
            {sendTarget?.id === row.id && (
              <SendWechatDialog row={row} onClose={() => setSendTarget(null)} />
            )}
          </>
        )}
        renderForm={(ctx) => (
          <CephalometricFormFields form={ctx.form} update={ctx.update} file={file} setFile={setFile} />
        )}
      />

      <section className="card" aria-label="轮廓重叠比较">
        <h2>轮廓重叠比较</h2>
        {compareOptions.length === 0 ? (
          <p>暂无测量病例可选</p>
        ) : (
          <>
            <div className="ceph-compare-controls">
              {compareOptions.map((row) => (
                <label key={row.id} className="ceph-compare-option">
                  <input
                    type="checkbox"
                    checked={compareTargets.has(row.id)}
                    onChange={(event) => toggleCompare(row.id, event.target.checked)}
                  />
                  {String(row.patientIdLabel ?? row.patientId ?? row.id)}（{row.id}）
                </label>
              ))}
            </div>
            <button type="button" disabled={comparing || compareTargets.size === 0} onClick={() => void runCompare()}>
              {comparing ? '比较中...' : '开始比较'}
            </button>
          </>
        )}
        {compareResult && <CompareResultView result={compareResult} />}
      </section>
    </>
  );
}
