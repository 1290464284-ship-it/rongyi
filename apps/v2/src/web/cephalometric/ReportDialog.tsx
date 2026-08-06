import { useEffect, useMemo, useState } from 'react';
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
  const [jsonText, setJsonText] = useState(DEFAULT_REPORT_JSON);
  const [outlineColor, setOutlineColor] = useState('#2563eb');
  const [lineColor, setLineColor] = useState('#dc2626');
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);

  const reportQuery = useQuery({
    queryKey: ['cephalometric-report', row.id],
    queryFn: () => apiRequest<CephalometricReportResponse>(`/cephalometric/${row.id}/report`),
  });

  // 进入页面/刷新后回显已保存的报告。
  useEffect(() => {
    if (hydrated || !reportQuery.data) return;
    const report = reportQuery.data.reportJson ?? {};
    setJsonText(JSON.stringify(report, null, 2));
    setOutlineColor(typeof report.outlineColor === 'string' ? report.outlineColor : '#2563eb');
    setLineColor(typeof report.lineColor === 'string' ? report.lineColor : '#dc2626');
    setHydrated(true);
  }, [hydrated, reportQuery.data]);

  const previewReport = useMemo<CephalometricReportJson>(() => {
    try {
      const parsed = JSON.parse(jsonText || '{}') as CephalometricReportJson;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { ...parsed, outlineColor, lineColor };
      }
      return { outline: [], polylines: [], outlineColor, lineColor };
    } catch {
      return { outline: [], polylines: [], outlineColor, lineColor };
    }
  }, [jsonText, outlineColor, lineColor]);

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
    const reportJson = { ...(parsed as Record<string, unknown>), outlineColor, lineColor };
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
            <select aria-label="轮廓色" value={outlineColor} onChange={(event) => setOutlineColor(event.target.value)}>
              {COLOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            折线色
            <select aria-label="折线色" value={lineColor} onChange={(event) => setLineColor(event.target.value)}>
              {COLOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <OutlineSvg report={previewReport} />
          <label>
            报告数据 JSON（轮廓点 outline / 折线 polylines）
            <textarea aria-label="报告 JSON" value={jsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
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
