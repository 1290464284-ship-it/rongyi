import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, fetchPrintHtml } from './api';
import { EmptyState, LoadingState, PageError } from './components';
import { formatMoney } from './format';
import { errorMessage } from './messages';
import { useToast } from './toast-context';

interface DashboardData {
  patients: number;
  appointments: number;
  paidAmount: number;
  unpaidAmount: number;
  inventoryItems: number;
  pendingFollowUps: number;
}

interface ChartRow extends Record<string, unknown> {
  period?: string | null;
  day?: string | null;
  surveyDate?: string | null;
  category?: string | null;
  amount?: number | null;
  count?: number | null;
  avgScore?: number | null;
  totalStock?: number | null;
  minStock?: number | null;
  doctorName?: string | null;
  surveyCount?: number | null;
  name?: string | null;
  frequency?: number | null;
  monetary?: number | null;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function maxValue(rows: ChartRow[], key: (row: ChartRow) => number): number {
  return Math.max(1, ...rows.map((row) => Number(key(row) || 0)));
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // CWE-1236：阻止公式注入（Excel 打开时执行 =SUM(...) 等），与服务端导出保持一致。
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([`\ufeff${content}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsDashboardPage() {
  const { showToast } = useToast();
  const [startDate, setStartDate] = useState(daysAgo(180));
  const [endDate, setEndDate] = useState(today());
  const [appliedStart, setAppliedStart] = useState(daysAgo(180));
  const [appliedEnd, setAppliedEnd] = useState(today());

  const queryParams = new URLSearchParams();
  if (appliedStart) queryParams.set('startDate', `${appliedStart}T00:00:00.000Z`);
  if (appliedEnd) queryParams.set('endDate', `${appliedEnd}T23:59:59.999Z`);
  const suffix = queryParams.toString() ? `?${queryParams.toString()}` : '';

  const dashboard = useQuery({
    queryKey: ['analytics-dashboard', appliedStart, appliedEnd],
    queryFn: () => apiRequest<DashboardData>(`/stats/dashboard${suffix}`),
  });
  const revenue = useQuery({
    queryKey: ['analytics-revenue', appliedStart, appliedEnd],
    queryFn: () => apiRequest<ChartRow[]>(`/stats/revenue?groupBy=month${suffix}`),
  });
  const patientGrowth = useQuery({
    queryKey: ['analytics-patient-growth', appliedStart, appliedEnd],
    queryFn: () => apiRequest<ChartRow[]>(`/stats/patient-growth${suffix}`),
  });
  const inventory = useQuery({
    queryKey: ['analytics-inventory'],
    queryFn: () => apiRequest<ChartRow[]>('/stats/inventory'),
  });
  const satisfaction = useQuery({
    queryKey: ['analytics-satisfaction'],
    queryFn: () => apiRequest<ChartRow[]>('/satisfaction/trend'),
  });
  const doctors = useQuery({
    queryKey: ['analytics-doctors'],
    queryFn: () => apiRequest<ChartRow[]>('/satisfaction/doctor-rankings'),
  });

  const revenueMax = useMemo(() => maxValue(revenue.data ?? [], (row) => Number(row.amount || 0) / 100), [revenue.data]);
  const growthMax = useMemo(() => maxValue(patientGrowth.data ?? [], (row) => Number(row.count || 0)), [patientGrowth.data]);
  const satisfactionMax = useMemo(() => maxValue(satisfaction.data ?? [], (row) => Number(row.avgScore || 0)), [satisfaction.data]);
  const inventoryMax = useMemo(() => maxValue(inventory.data ?? [], (row) => Number(row.totalStock || 0)), [inventory.data]);

  function applyDates(): void {
    if (startDate > endDate) {
      showToast('开始日期不能晚于结束日期', 'error');
      return;
    }
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
  }

  function exportCsv(): void {
    const sections: Array<{ title: string; rows: ChartRow[]; columns: Array<{ key: string; label: string }> }> = [
      {
        title: '月度收入',
        rows: revenue.data ?? [],
        columns: [
          { key: 'period', label: '期间' },
          { key: 'amount', label: '收入' },
          { key: 'count', label: '单数' },
        ],
      },
      {
        title: '患者增长',
        rows: patientGrowth.data ?? [],
        columns: [
          { key: 'day', label: '日期' },
          { key: 'count', label: '新增患者' },
        ],
      },
      {
        title: '库存分类',
        rows: inventory.data ?? [],
        columns: [
          { key: 'category', label: '分类' },
          { key: 'count', label: '项目数' },
          { key: 'totalStock', label: '库存总量' },
          { key: 'minStock', label: '最低库存' },
        ],
      },
      {
        title: '满意度趋势',
        rows: satisfaction.data ?? [],
        columns: [
          { key: 'surveyDate', label: '日期' },
          { key: 'avgScore', label: '平均分' },
          { key: 'count', label: '问卷数' },
        ],
      },
      {
        title: '医生满意度',
        rows: doctors.data ?? [],
        columns: [
          { key: 'doctorName', label: '医生' },
          { key: 'surveyCount', label: '问卷数' },
          { key: 'avgScore', label: '平均分' },
        ],
      },
    ];
    const lines: string[] = [];
    for (const section of sections) {
      lines.push(section.title);
      lines.push(section.columns.map((column) => csvCell(column.label)).join(','));
      for (const row of section.rows) {
        lines.push(section.columns.map((column) => csvCell(row[column.key])).join(','));
      }
      lines.push('');
    }
    downloadTextFile(`经营分析-${appliedStart}-${appliedEnd}.csv`, lines.join('\n'));
    showToast('经营分析已导出为 CSV，可直接用 Excel 打开', 'success');
  }

  async function printReport(): Promise<void> {
    const target = window.open('', '_blank');
    if (!target) {
      showToast('浏览器阻止了打印窗口，请允许弹窗后重试', 'error');
      return;
    }
    try {
      const html = await fetchPrintHtml('/print', {
        kind: 'analytics',
        data: {
          title: `经营分析 ${appliedStart} 至 ${appliedEnd}`,
          patients: dashboard.data?.patients ?? 0,
          appointments: dashboard.data?.appointments ?? 0,
          paidAmount: dashboard.data?.paidAmount ?? 0,
          unpaidAmount: dashboard.data?.unpaidAmount ?? 0,
          revenueRows: revenue.data ?? [],
          growthRows: patientGrowth.data ?? [],
          inventoryRows: inventory.data ?? [],
          satisfactionRows: satisfaction.data ?? [],
          doctorRows: doctors.data ?? [],
        },
      });
      // security-scan 禁止 document.write：打印报表改用 blob URL 打开。
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      target.location.href = url;
      target.focus();
      // 延迟释放 blob URL，避免页面尚未加载完成即被回收
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      target.close();
      showToast(errorMessage(error, '打开打印报表失败'), 'error');
    }
  }

  const loading = dashboard.isLoading || revenue.isLoading || patientGrowth.isLoading
    || inventory.isLoading || satisfaction.isLoading || doctors.isLoading;
  const error = dashboard.error || revenue.error || patientGrowth.error
    || inventory.error || satisfaction.error || doctors.error;
  if (loading) return <LoadingState label="经营分析加载中..." />;
  if (error) return <PageError message={(error as Error).message} />;

  const cards = [
    ['患者数', dashboard.data?.patients ?? 0],
    ['预约数', dashboard.data?.appointments ?? 0],
    ['已收金额', formatMoney(dashboard.data?.paidAmount ?? 0)],
    ['未收金额', formatMoney(dashboard.data?.unpaidAmount ?? 0)],
    ['库存项目', dashboard.data?.inventoryItems ?? 0],
    ['待随访', dashboard.data?.pendingFollowUps ?? 0],
  ];

  return (
    <div className="page analytics-page">
      <div className="page-head">
        <h1>经营分析</h1>
        <div className="inline-form">
          <label>
            开始日期
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            结束日期
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <button onClick={applyDates}>应用日期</button>
          <button onClick={exportCsv}>导出 CSV</button>
          <button onClick={() => void printReport()}>打印/PDF</button>
        </div>
      </div>
      <div className="cards">
        {cards.map(([label, value]) => (
          <div className="card" key={String(label)}>
            <strong>{label}</strong>
            <span>{String(value)}</span>
          </div>
        ))}
      </div>

      <section className="analytics-grid">
        <div className="analytics-panel">
          <h2>月度收入趋势</h2>
          {revenue.data?.length ? (
            <div className="bar-chart">
              {revenue.data.map((row) => (
                <div className="bar-row" key={String(row.period)}>
                  <span className="bar-label">{String(row.period ?? '')}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.round((Number(row.amount || 0) / 100 / revenueMax) * 100)}%` }}
                      title={`${formatMoney(row.amount)} / ${row.count} 单`}
                    />
                  </div>
                  <span className="bar-value">{formatMoney(row.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="所选日期内暂无收入数据" />
          )}
        </div>

        <div className="analytics-panel">
          <h2>患者增长</h2>
          {patientGrowth.data?.length ? (
            <div className="bar-chart compact">
              {patientGrowth.data.slice(-60).map((row) => (
                <div className="bar-row" key={String(row.day)}>
                  <span className="bar-label">{String(row.day ?? '')}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill growth"
                      style={{ width: `${Math.round((Number(row.count || 0) / growthMax) * 100)}%` }}
                      title={`${row.day}：${row.count} 人`}
                    />
                  </div>
                  <span className="bar-value">{String(row.count ?? 0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="所选日期内暂无患者增长数据" />
          )}
        </div>

        <div className="analytics-panel">
          <h2>库存分类</h2>
          {inventory.data?.length ? (
            <div className="bar-chart compact">
              {inventory.data.map((row) => (
                <div className="bar-row" key={String(row.category)}>
                  <span className="bar-label">{String(row.category ?? '未分类')}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill inventory"
                      style={{ width: `${Math.round((Number(row.totalStock || 0) / inventoryMax) * 100)}%` }}
                      title={`${row.category}：库存 ${row.totalStock} / 最低 ${row.minStock}`}
                    />
                  </div>
                  <span className="bar-value">{String(row.totalStock ?? 0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="暂无库存数据" />
          )}
        </div>

        <div className="analytics-panel">
          <h2>满意度趋势</h2>
          {satisfaction.data?.length ? (
            <div className="bar-chart compact">
              {satisfaction.data.slice(-60).map((row) => (
                <div className="bar-row" key={String(row.surveyDate)}>
                  <span className="bar-label">{String(row.surveyDate ?? '')}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill satisfaction"
                      style={{ width: `${Math.round((Number(row.avgScore || 0) / satisfactionMax) * 100)}%` }}
                      title={`${row.surveyDate}：${row.avgScore} 分 / ${row.count} 份`}
                    />
                  </div>
                  <span className="bar-value">{String(row.avgScore ?? '')}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="暂无满意度数据" />
          )}
        </div>

        <div className="analytics-panel wide">
          <h2>医生绩效与满意度</h2>
          {doctors.data?.length ? (
            <div className="bar-chart">
              {doctors.data.map((row) => (
                <div className="bar-row" key={String(row.doctorId ?? row.doctorName)}>
                  <span className="bar-label">{String(row.doctorName ?? '未分配')}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill doctor"
                      style={{ width: `${Math.min(100, Math.round((Number(row.avgScore || 0) / 100) * 100))}%` }}
                      title={`${row.doctorName}：平均 ${row.avgScore} 分 / ${row.surveyCount} 份`}
                    />
                  </div>
                  <span className="bar-value">{String(row.avgScore ?? '')} 分</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="暂无医生满意度数据" />
          )}
        </div>
      </section>
    </div>
  );
}
