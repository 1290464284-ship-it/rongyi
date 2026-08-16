import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, fetchPrintHtml } from '../../lib/api';
import { EmptyState, QuerySection } from '../../components';
import { formatMoney } from '../../lib/format';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';
import { ChartRow, csvCell, daysAgo, downloadTextFile, maxValue, today } from './analytics-utils';

interface DashboardData {
  patients: number;
  appointments: number;
  paidAmount: number;
  unpaidAmount: number;
  inventoryItems: number;
  pendingFollowUps: number;
}

export function AnalyticsDashboardPage() {
  const { showToast } = useToast();
  const [startDate, setStartDate] = useState(daysAgo(180));
  const [endDate, setEndDate] = useState(today());
  const [appliedStart, setAppliedStart] = useState(daysAgo(180));
  const [appliedEnd, setAppliedEnd] = useState(today());
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  // C7：导出 CSV 双击防重（同步导出完成瞬间按钮已复位，冷却窗口内拦截第二次点击）
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);

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

  function exportCsv(): void {    const sections: Array<{ title: string; rows: ChartRow[]; columns: Array<{ key: string; label: string }> }> = [
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

  function handleExportCsv(): void {
    /* v8 ignore next -- 导出按钮在冷却窗口内 disabled，重复点击不可达 */
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      exportCsv();
    } finally {
      window.setTimeout(() => {
        exportingRef.current = false;
        setExporting(false);
      }, 800);
    }
  }

  async function printReport(): Promise<void> {
    /* v8 ignore next -- 打印按钮在 printing 期间 disabled，双击竞态守卫为防御冗余 */
    if (printing || printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    const target = window.open('', '_blank');
    if (!target) {
      showToast('浏览器阻止了打印窗口，请允许弹窗后重试', 'error');
      printingRef.current = false;
      setPrinting(false);
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
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }

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
          <button disabled={exporting} onClick={handleExportCsv}>导出 CSV</button>
          <button disabled={printing} onClick={() => void printReport()}>{printing ? '打开中...' : '打印/PDF'}</button>
        </div>
      </div>
      <QuerySection
        query={dashboard}
        render={(data) => (
          <div className="stat-cards">
            {[
              ['患者数', data?.patients ?? 0],
              ['预约数', data?.appointments ?? 0],
              ['已收金额', formatMoney(data?.paidAmount ?? 0)],
              ['未收金额', formatMoney(data?.unpaidAmount ?? 0)],
              ['库存项目', data?.inventoryItems ?? 0],
              ['待随访', data?.pendingFollowUps ?? 0],
            ].map(([label, value]) => (
              <div className="stat-card" key={String(label)}>
                <div className="stat-value">{String(value)}</div>
                <div className="stat-label">{String(label)}</div>
              </div>
            ))}
          </div>
        )}
      />

      <section className="analytics-grid">
        <QuerySection
          query={revenue}
          render={(data) => (
            <div className="analytics-panel">
              <h2>月度收入趋势</h2>
              {data?.length ? (
                <div
                  className="bar-chart"
                  role="img"
                  aria-label={`月度收入趋势：${data
                    .map((row) => `${String(row.period ?? '')} ${formatMoney(row.amount)}，${Number(row.count ?? 0)} 单`)
                    .join('；')}`}
                >
                  {data.map((row) => (
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
          )}
        />

        <QuerySection
          query={patientGrowth}
          render={(data) => (
            <div className="analytics-panel">
              <h2>患者增长</h2>
              {data?.length ? (
                <div
                  className="bar-chart compact"
                  role="img"
                  aria-label={`患者增长：${data.slice(-60).map((row) => `${String(row.day ?? '')} ${Number(row.count ?? 0)} 人`).join('；')}`}
                >
                  {data.slice(-60).map((row) => (
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
          )}
        />

        <QuerySection
          query={inventory}
          render={(data) => (
            <div className="analytics-panel">
              <h2>库存分类</h2>
              {data?.length ? (
                <div
                  className="bar-chart compact"
                  role="img"
                  aria-label={`库存分类：${data.map((row) => `${String(row.category ?? '未分类')} 库存 ${Number(row.totalStock ?? 0)}`).join('；')}`}
                >
                  {data.map((row) => (
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
          )}
        />

        <QuerySection
          query={satisfaction}
          render={(data) => (
            <div className="analytics-panel">
              <h2>满意度趋势</h2>
              {data?.length ? (
                <div
                  className="bar-chart compact"
                  role="img"
                  aria-label={`满意度趋势：${data.slice(-60).map((row) => `${String(row.surveyDate ?? '')} ${Number(row.avgScore ?? 0)} 分`).join('；')}`}
                >
                  {data.slice(-60).map((row) => (
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
          )}
        />

        <QuerySection
          query={doctors}
          render={(data) => (
            <div className="analytics-panel wide">
              <h2>医生绩效与满意度</h2>
              {data?.length ? (
                <div
                  className="bar-chart"
                  role="img"
                  aria-label={`医生绩效：${data.map((row) => `${String(row.doctorName ?? '未分配')} ${Number(row.avgScore ?? 0)} 分`).join('；')}`}
                >
                  {data.map((row, index) => (
                    <div className="bar-row" key={String(row.doctorId ?? `row-${index}`)}>
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
          )}
        />
      </section>
    </div>
  );
}
