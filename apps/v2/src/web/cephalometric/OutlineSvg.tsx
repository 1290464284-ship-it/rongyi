import { pointsAttr, toPoint, viewBoxFor } from './utils';
import { DEFAULT_LINE_COLOR, DEFAULT_OUTLINE_COLOR } from './constants';
import type { CephalometricReportJson } from './types';

export function OutlineSvg({ report }: { report: CephalometricReportJson }) {
  const points: Array<{ x: number; y: number }> = [];
  for (const point of report.outline ?? []) points.push(toPoint(point));
  for (const line of report.polylines ?? []) {
    for (const point of line.points ?? []) points.push(toPoint(point));
  }
  const viewBox = viewBoxFor(points);
  const outlineColor = report.outlineColor ?? DEFAULT_OUTLINE_COLOR;
  const lineColor = report.lineColor ?? DEFAULT_LINE_COLOR;
  return (
    <svg
      className="ceph-outline-svg"
      viewBox={viewBox}
      width="100%"
      height={300}
      role="img"
      aria-label="轮廓图预览"
      style={{ border: '1px solid var(--chart-grid)', borderRadius: 'var(--radius-sm)', background: 'var(--chart-bg)' }}
    >
      {points.length === 0 && (
        <text x={12} y={20} style={{ fontSize: 12, fill: 'var(--chart-muted)' }}>暂无轮廓数据</text>
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
