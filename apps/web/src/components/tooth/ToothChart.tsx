import { memo } from 'react';
import { UPPER_TEETH, LOWER_TEETH, TOOTH_STATUS_COLOR, TOOTH_CONDITION_DOT } from '@/lib/tooth-constants';

export interface ToothRecord {
  id: string;
  toothNumber: number;
  currentStatus: string;
  conditions: string[];
  remark?: string;
}

interface Props {
  teeth: ToothRecord[];
  selectedTooth?: number;
  onSelectTooth?: (toothNumber: number) => void;
}

const TOOTH_W = 40;
const TOOTH_H = 50;
const GAP = 4;
const CELL = TOOTH_W + GAP;
const MARGIN = 10;
const CENTER_GAP = 20;
const UPPER_Y = 10;
const LOWER_Y = 90;
const SVG_W = MARGIN * 2 + 16 * CELL + CENTER_GAP;
const SVG_H = 160;
const DIVIDER_X = MARGIN + 8 * CELL + CENTER_GAP / 2;

function toothX(index: number): number {
  if (index < 8) return MARGIN + index * CELL;
  return MARGIN + 8 * CELL + CENTER_GAP + (index - 8) * CELL;
}

interface ToothProps {
  toothNumber: number;
  x: number;
  y: number;
  record?: ToothRecord;
  selected: boolean;
  onSelect?: (n: number) => void;
}

const Tooth = memo(function Tooth({ toothNumber, x, y, record, selected, onSelect }: ToothProps) {
  const status = record?.currentStatus ?? 'SOUND';
  const color = TOOTH_STATUS_COLOR[status] ?? TOOTH_STATUS_COLOR.SOUND;
  const conditions = record?.conditions ?? [];

  const handleKeyDown = (e: React.KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(toothNumber);
    }
  };

  return (
    <g
      transform={`translate(${x}, ${y})`}
      className="cursor-pointer focus-visible:outline-none"
      role="button"
      tabIndex={0}
      aria-label={`牙位 ${toothNumber}，状态 ${status}`}
      onClick={() => onSelect?.(toothNumber)}
      onKeyDown={handleKeyDown}
    >
      <rect
        width={TOOTH_W}
        height={TOOTH_H}
        rx={6}
        ry={6}
        fill={color.bg}
        stroke={selected ? '#0F766E' : '#E7E5E4'}
        strokeWidth={selected ? 2.5 : 1}
      />
      <text
        x={TOOTH_W / 2}
        y={TOOTH_H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13}
        fontWeight={600}
        fill={color.text}
      >
        {toothNumber}
      </text>
      {conditions.slice(0, 3).map((c, i) => (
        <circle
          key={c}
          cx={TOOTH_W - 5 - i * 7}
          cy={5}
          r={3}
          fill={TOOTH_CONDITION_DOT[c] ?? '#6B7280'}
          stroke="#FFFFFF"
          strokeWidth={0.5}
        />
      ))}
      {(status === 'MISSING' || status === 'EXTRACTED') && (
        <>
          <line x1={4} y1={4} x2={TOOTH_W - 4} y2={TOOTH_H - 4} stroke="#FFFFFF" strokeWidth={1.5} opacity={0.6} />
          <line x1={TOOTH_W - 4} y1={4} x2={4} y2={TOOTH_H - 4} stroke="#FFFFFF" strokeWidth={1.5} opacity={0.6} />
        </>
      )}
    </g>
  );
});

export const ToothChart = memo(function ToothChart({ teeth, selectedTooth, onSelectTooth }: Props) {
  const recordMap = new Map<number, ToothRecord>();
  for (const t of teeth) recordMap.set(t.toothNumber, t);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full max-w-[744px] mx-auto"
        style={{ minWidth: 600 }}
        role="application"
        aria-label="牙位图"
      >
        <line x1={MARGIN} y1={(UPPER_Y + TOOTH_H + LOWER_Y) / 2} x2={SVG_W - MARGIN} y2={(UPPER_Y + TOOTH_H + LOWER_Y) / 2} stroke="#D6D3D1" strokeWidth={1} strokeDasharray="4 2" />
        <text x={4} y={UPPER_Y + TOOTH_H / 2} dominantBaseline="central" fontSize={10} fill="#78716C">上</text>
        <text x={4} y={LOWER_Y + TOOTH_H / 2} dominantBaseline="central" fontSize={10} fill="#78716C">下</text>
        <line x1={DIVIDER_X} y1={4} x2={DIVIDER_X} y2={SVG_H - 4} stroke="#D6D3D1" strokeWidth={1} />

        {UPPER_TEETH.map((n, i) => (
          <Tooth
            key={`u-${n}`}
            toothNumber={n}
            x={toothX(i)}
            y={UPPER_Y}
            record={recordMap.get(n)}
            selected={selectedTooth === n}
            onSelect={onSelectTooth}
          />
        ))}

        {LOWER_TEETH.map((n, i) => (
          <Tooth
            key={`l-${n}`}
            toothNumber={n}
            x={toothX(i)}
            y={LOWER_Y}
            record={recordMap.get(n)}
            selected={selectedTooth === n}
            onSelect={onSelectTooth}
          />
        ))}
      </svg>
    </div>
  );
});