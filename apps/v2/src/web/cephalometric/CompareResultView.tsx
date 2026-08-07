import { formatDateTime } from '../lib/format';
import { COMPARE_COLORS } from './constants';
import { landmarksOutline, viewBoxFor } from './utils';
import type { CephalometricCompareResult } from './types';

export function CompareResultView({ result }: { result: CephalometricCompareResult }) {
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
        style={{ border: '1px solid var(--border-strong, #c9d3de)', borderRadius: 8, background: 'var(--surface, #f8fafc)' }}
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
