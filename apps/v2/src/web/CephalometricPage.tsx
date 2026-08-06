import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, getApiOrigin, uploadFile } from './api';
import { CrudPage } from './CrudPage';
import { Dialog, SearchableSelect, type DataTableColumn } from './components';
import { formatDateTime } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';
import type { Page } from './types';

const REPORT_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  COMPLETED: '已完成',
  FINAL: '最终',
};

const COLOR_OPTIONS = [
  { value: '#2563eb', label: '蓝色' },
  { value: '#16a34a', label: '绿色' },
  { value: '#dc2626', label: '红色' },
  { value: '#9333ea', label: '紫色' },
  { value: '#d97706', label: '橙色' },
];

const COMPARE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#d97706',
  '#0f766e',
  '#db2777',
  '#4f46e5',
  '#65a30d',
  '#b45309',
];

const DEFAULT_REPORT_JSON = `{
  "outline": [],
  "polylines": [],
  "outlineColor": "#2563eb",
  "lineColor": "#dc2626",
  "conclusion": ""
}`;

type Point2D = [number, number] | { x: number; y: number };

interface CephalometricReportJson {
  outline?: Point2D[];
  polylines?: Array<{ points?: Point2D[]; color?: string; label?: string }>;
  outlineColor?: string;
  lineColor?: string;
  conclusion?: string;
  [key: string]: unknown;
}

interface CephalometricReportResponse {
  caseId?: string;
  patientId?: string | null;
  reportJson?: CephalometricReportJson;
  reportStatus?: string | null;
  metricsJson?: Record<string, unknown>;
  landmarksJson?: Record<string, unknown>;
  createdAt?: string | null;
}

interface CephalometricCompareCase extends Record<string, unknown> {
  id?: string;
  patientId?: string | null;
  imageUrl?: string | null;
  landmarksJson?: Record<string, unknown>;
  metricsJson?: Record<string, unknown>;
  createdAt?: string | null;
  remark?: string | null;
}

interface CephalometricCompareResult {
  cases: CephalometricCompareCase[];
}

interface CephalometricRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  imageUrl?: string | null;
  status?: string | null;
  reportStatus?: string | null;
}

interface CephalometricForm {
  patientId: string;
  status: string;
  templateId: string;
  landmarksJson: string;
  metricsJson: string;
  remark: string;
}

const emptyForm: CephalometricForm = {
  patientId: '',
  status: 'DRAFT',
  templateId: '',
  landmarksJson: '{}',
  metricsJson: '{}',
  remark: '',
};

function toPoint(point: Point2D): { x: number; y: number } {
  if (Array.isArray(point)) return { x: Number(point[0] ?? 0), y: Number(point[1] ?? 0) };
  return { x: Number(point.x ?? 0), y: Number(point.y ?? 0) };
}

function pointsAttr(points: Point2D[] | undefined): string {
  return (points ?? []).map((point) => {
    const p = toPoint(point);
    return `${p.x},${p.y}`;
  }).join(' ');
}

function viewBoxFor(points: Array<{ x: number; y: number }>, padding = 24): string {
  if (points.length === 0) return '0 0 400 300';
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;
}

function landmarksOutline(landmarks: Record<string, unknown> | undefined): Array<{ x: number; y: number }> {
  if (!landmarks) return [];
  if (Array.isArray(landmarks.outline)) {
    return (landmarks.outline as Point2D[]).map(toPoint);
  }
  const points: Array<{ x: number; y: number }> = [];
  for (const value of Object.values(landmarks)) {
    if (Array.isArray(value)) {
      const [x, y] = value as [number, number];
      if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) points.push({ x: Number(x), y: Number(y) });
    } else if (typeof value === 'object' && value !== null) {
      const candidate = value as { x?: unknown; y?: unknown };
      if (Number.isFinite(Number(candidate.x)) && Number.isFinite(Number(candidate.y))) {
        points.push({ x: Number(candidate.x), y: Number(candidate.y) });
      }
    }
  }
  return points;
}

export function CephalometricPage() {
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [apiOrigin, setApiOrigin] = useState('');
  const [reportTarget, setReportTarget] = useState<CephalometricRow | null>(null);
  const [sendTarget, setSendTarget] = useState<CephalometricRow | null>(null);
  const [compareTargets, setCompareTargets] = useState<Set<string>>(new Set());
  const [compareResult, setCompareResult] = useState<CephalometricCompareResult | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getApiOrigin().then((origin) => {
      if (!cancelled) setApiOrigin(origin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 与 CrudPage 列表共享查询缓存（useCrudResource 将 queryKey 展开为 ['cephalometric', page, search]）。
  const caseList = useQuery({
    queryKey: ['cephalometric', 1, ''],
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
        initialForm={emptyForm}
        validate={(form) => {
          let parsedLandmarks: Record<string, unknown> = {};
          let parsedMetrics: Record<string, unknown> = {};
          try {
            parsedLandmarks = JSON.parse(form.landmarksJson || '{}') as Record<string, unknown>;
            parsedMetrics = JSON.parse(form.metricsJson || '{}') as Record<string, unknown>;
          } catch {
            return '标记点或测量结果必须是有效 JSON';
          }
          if (!form.patientId || (!file && !parsedLandmarks)) {
            return '请选择患者并上传影像或填写标记点';
          }
          return null;
        }}
        submitOverride={async ({ form }) => {
          const parsedLandmarks = JSON.parse(form.landmarksJson || '{}') as Record<string, unknown>;
          const parsedMetrics = JSON.parse(form.metricsJson || '{}') as Record<string, unknown>;
          const imageUrl = file ? (await uploadFile(file)).url : undefined;
          await apiRequest('/resources/cephalometricCases', {
            method: 'POST',
            body: JSON.stringify({
              patientId: form.patientId,
              imageUrl: imageUrl ?? '',
              landmarksJson: JSON.stringify(parsedLandmarks),
              metricsJson: JSON.stringify(parsedMetrics),
              templateId: form.templateId || undefined,
              status: form.status,
              remark: form.remark || undefined,
            }),
          });
        }}
        onAfterCreate={() => setFile(null)}
        messages={{ create: '头影测量已创建' }}
        errorMessages={{ create: '创建头影测量失败' }}
        columns={cephalometricColumns(apiOrigin)}
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

function cephalometricColumns(apiOrigin: string): DataTableColumn<CephalometricRow>[] {
  return [
    { key: 'patientId', label: '患者', render: (row) => row.patientIdLabel ?? row.patientId ?? '' },
    { key: 'status', label: '状态' },
    {
      key: 'reportStatus',
      label: '报告状态',
      render: (row) => REPORT_STATUS_LABELS[String(row.reportStatus ?? '')] ?? String(row.reportStatus ?? ''),
    },
    {
      key: 'preview',
      label: '影像',
      render: (row) => (row.imageUrl ? <img className="imaging-thumb" src={`${apiOrigin}${row.imageUrl}`} alt="头影影像" /> : '无影像'),
    },
  ];
}

function CephalometricFormFields({
  form,
  update,
  file,
  setFile,
}: {
  form: CephalometricForm;
  update: (patch: Partial<CephalometricForm>) => void;
  file: File | null;
  setFile: (file: File | null) => void;
}) {
  return (
    <>
      <label>
        患者
        <SearchableSelect resource="patients" value={form.patientId} onChange={(id) => update({ patientId: id })} ariaLabel="患者" placeholder="选择患者" />
      </label>
      <label>
        状态
        <input value={form.status} onChange={(event) => update({ status: event.target.value })} />
      </label>
      <label>
        模板 ID
        <input value={form.templateId} onChange={(event) => update({ templateId: event.target.value })} />
      </label>
      <label>
        影像文件
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <label>
        标记点 JSON
        <textarea value={form.landmarksJson} onChange={(event) => update({ landmarksJson: event.target.value })} />
      </label>
      <label>
        测量结果 JSON
        <textarea value={form.metricsJson} onChange={(event) => update({ metricsJson: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
    </>
  );
}

function OutlineSvg({ report }: { report: CephalometricReportJson }) {
  const points: Array<{ x: number; y: number }> = [];
  for (const point of report.outline ?? []) points.push(toPoint(point));
  for (const line of report.polylines ?? []) {
    for (const point of line.points ?? []) points.push(toPoint(point));
  }
  const viewBox = viewBoxFor(points);
  const outlineColor = report.outlineColor ?? '#2563eb';
  const lineColor = report.lineColor ?? '#dc2626';
  return (
    <svg
      className="ceph-outline-svg"
      viewBox={viewBox}
      width="100%"
      height={300}
      role="img"
      aria-label="轮廓图预览"
      style={{ border: '1px solid #c9d3de', borderRadius: 8, background: '#f8fafc' }}
    >
      {points.length === 0 && (
        <text x={12} y={20} style={{ fontSize: 12, fill: '#6b7280' }}>暂无轮廓数据</text>
      )}
      {points.length > 1 && (
        <polyline points={pointsAttr(report.outline)} fill="none" stroke={outlineColor} strokeWidth={1.5} />
      )}
      {(report.outline ?? []).map((point, index) => {
        const p = toPoint(point);
        return <circle key={`o-${index}`} cx={p.x} cy={p.y} r={2.5} fill={outlineColor} />;
      })}
      {(report.polylines ?? []).map((line, index) => {
        const color = line.color ?? lineColor;
        const linePoints = line.points ?? [];
        const first = linePoints.length > 0 ? toPoint(linePoints[0]) : null;
        return (
          <g key={`l-${index}`}>
            <polyline points={pointsAttr(linePoints)} fill="none" stroke={color} strokeWidth={1.5} />
            {first && line.label && (
              <text x={first.x + 4} y={first.y - 4} style={{ fontSize: 10, fill: color }}>{line.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ReportDialog({
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

function SendWechatDialog({ row, onClose }: { row: CephalometricRow; onClose: () => void }) {
  const { showToast } = useToast();
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    try {
      await apiRequest(`/cephalometric/${row.id}/send`, {
        method: 'POST',
        body: JSON.stringify({
          phone: phone.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      showToast('微信已发送', 'success');
      onClose();
    } catch (error) {
      showToast(errorMessage(error, '微信发送失败'), 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open title="发送微信" onClose={onClose}>
      <form onSubmit={handleSend}>
        <label>
          手机号（选填）
          <input aria-label="手机号" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="如 13800000000" />
        </label>
        <label>
          发送内容（选填）
          <textarea aria-label="发送内容" value={note} onChange={(event) => setNote(event.target.value)} placeholder="默认为：测量报告已生成，请查收" />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={sending}>{sending ? '发送中...' : '发送'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function CompareResultView({ result }: { result: CephalometricCompareResult }) {
  const entries = result.cases.map((caseRow, index) => ({
    caseRow,
    color: COMPARE_COLORS[index % COMPARE_COLORS.length],
    points: landmarksOutline(caseRow.landmarksJson),
  }));
  const allPoints = entries.flatMap((entry) => entry.points);
  const viewBox = viewBoxFor(allPoints);
  return (
    <div className="ceph-compare-result">
      <svg
        className="ceph-outline-svg"
        viewBox={viewBox}
        width="100%"
        height={320}
        role="img"
        aria-label="轮廓重叠比较图"
        style={{ border: '1px solid #c9d3de', borderRadius: 8, background: '#f8fafc' }}
      >
        {allPoints.length === 0 && (
          <text x={12} y={20} style={{ fontSize: 12, fill: '#6b7280' }}>所选病例暂无轮廓数据</text>
        )}
        {entries.map((entry) => (
          <g key={String(entry.caseRow.id)}>
            {entry.points.length > 1 && (
              <polyline
                points={entry.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={entry.color}
                strokeWidth={1.5}
              />
            )}
            {entry.points.map((point, index) => (
              <circle key={index} cx={point.x} cy={point.y} r={2.5} fill={entry.color} />
            ))}
          </g>
        ))}
      </svg>
      <h3>对比说明</h3>
      <ul>
        {entries.map((entry) => {
          const metrics = entry.caseRow.metricsJson ?? {};
          const metricsText = Object.keys(metrics).length > 0 ? JSON.stringify(metrics) : '';
          return (
            <li key={String(entry.caseRow.id)}>
              <span className="ceph-compare-color" style={{ background: entry.color }} />
              {String(entry.caseRow.id)}
              {entry.caseRow.remark ? `（${String(entry.caseRow.remark)}）` : ''}
              {entry.caseRow.createdAt ? `，${formatDateTime(entry.caseRow.createdAt)}` : ''}
              {entry.points.length > 0 ? `，轮廓点 ${entry.points.length} 个` : ''}
              {metricsText ? `，指标 ${metricsText}` : ''}
            </li>
          );
        })}
      </ul>
      <p>重叠显示所选病例的轮廓/标记点，颜色与上图图例一一对应，便于对比牙颌面形态差异。</p>
    </div>
  );
}
