import { EmptyState } from '../../components';
import { formatMoney } from '../../lib/format';
import type { ChartRow } from './analytics-utils';

export function RevenueChart({ data, max }: { data: ChartRow[] | undefined; max: number }) {
  return (
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
                  style={{ width: `${Math.round((Number(row.amount || 0) / 100 / max) * 100)}%` }}
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
  );
}

export function PatientGrowthChart({ data, max }: { data: ChartRow[] | undefined; max: number }) {
  return (
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
                  style={{ width: `${Math.round((Number(row.count || 0) / max) * 100)}%` }}
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
  );
}

export function InventoryChart({ data, max }: { data: ChartRow[] | undefined; max: number }) {
  return (
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
                  style={{ width: `${Math.round((Number(row.totalStock || 0) / max) * 100)}%` }}
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
  );
}

export function SatisfactionChart({ data, max }: { data: ChartRow[] | undefined; max: number }) {
  return (
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
                  style={{ width: `${Math.round((Number(row.avgScore || 0) / max) * 100)}%` }}
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
  );
}

export function DoctorChart({ data }: { data: ChartRow[] | undefined }) {
  return (
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
  );
}
