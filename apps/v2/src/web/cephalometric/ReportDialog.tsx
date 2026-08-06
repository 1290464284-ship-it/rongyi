import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api';
import { Dialog } from '../components';
import { errorMessage } from '../messages';
import { useToast } from '../toast-context';
import { COLOR_OPTIONS, DEFAULT_REPORT_JSON } from './constants';
import { OutlineSvg } from './OutlineSvg';
import type { CephalometricReportJson, CephalometricReportResponse, CephalometricRow } from './types';

export function ReportDialog({
  row,
  reload,
  onClose,
}: {
  row: CephalometricRow;
  reload: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  // 编辑态：null 表示未编辑，渲染时派生自服务端数据；用户编辑后锁定本地值（无 effect setState）
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [outlineColor, setOutlineColor] = useState<string | null>(null);
  const [lineColor, setLineColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reportQuery = useQuery({
    queryKey: ['cephalometric-report', row.id],
    queryFn: () => apiRequest<CephalometricReportResponse>(`/cephalometric/${row.id}/report`),
  });

  const loadedReport = reportQuery.data?.reportJson ?? {};
  const effectiveJsonText = jsonText ?? (reportQuery.data ? JSON.stringify(loadedReport, null, 2) : DEFAULT_REPORT_JSON);
  const effectiveOutlineColor = outlineColor ?? (typeof loadedReport.outlineColor === 'string' ? loadedReport.outlineColor : '#2563eb');
  const effectiveLineColor = lineColor ?? (typeof loadedReport.lineColor === 'string' ? loadedReport.lineColor : '#dc2626');

  const previewReport = useMemo<CephalometricReportJson>(() => {
    try {
      const parsed = JSON.parse(effectiveJsonText || '{}') as CephalometricReportJson;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { ...parsed, outlineColor: effectiveOutlineColor, lineColor: effectiveLineColor };
      }
      return { outline: [], polylines: [], outlineColor: effectiveOutlineColor, lineColor: effectiveLineColor };
    } catch {
      return { outline: [], polylines: [], outlineColor: effectiveOutlineColor, lineColor: effectiveLineColor };
    }
  }, [effectiveJsonText, effectiveOutlineColor, effectiveLineColor]);

  async function handleSave() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText || '{}');
    } catch {
      showToast('报告 JSON 必须是合法 JSON', 'error');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      showToast('报告 JSON 必须是对象', 'error');
      return;
    }
    const reportJson = { ...(parsed as Record<string, unknown>), outlineColor: effectiveOutlineColor, lineColor: effectiveLineColor };
    setSaving(true);
    try {
      await apiRequest(`/cephalometric/${row.id}/report`, {
        method: 'POST',
        body: JSON.stringify({ reportJson, reportStatus: 'COMPLETED' }),
      });
      setJsonText(JSON.stringify(reportJson, null, 2));
      showToast('测量报告已保存', 'success');
      await reload();
      await reportQuery.refetch();
    } catch (error) {
      showToast(errorMessage(error, '保存报告失败'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open title="测量报告" onClose={onClose}>
      {reportQuery.isLoading ? (
        <p>加载中...</p>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
          <label>
            轮廓色
            <select aria-label="轮廓色" value={effectiveOutlineColor} onChange={(event) => setOutlineColor(event.target.value)}>
              {COLOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            折线色
            <select aria-label="折线色" value={effectiveLineColor} onChange={(event) => setLineColor(event.target.value)}>
              {COLOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <OutlineSvg report={previewReport} />
          <label>
            报告数据 JSON（轮廓点 outline / 折线 polylines）
            <textarea aria-label="报告 JSON" value={effectiveJsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
          </label>
          {reportQuery.data?.metricsJson && Object.keys(reportQuery.data.metricsJson).length > 0 && (
            <label>
              测量指标
              <textarea readOnly aria-label="测量指标" value={JSON.stringify(reportQuery.data.metricsJson, null, 2)} />
            </label>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" disabled={saving}>{saving ? '保存中...' : '保存报告'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
