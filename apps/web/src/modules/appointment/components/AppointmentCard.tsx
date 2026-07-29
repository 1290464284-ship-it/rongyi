import { useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_COLOR,
  APPOINTMENT_TYPE_LABEL,
  APPOINTMENT_TYPE_COLOR,
  type Appointment,
} from '@/lib/api/clinical/appointments';

// 计算时间轴定位
const HOUR_H = 48;

export function calcTop(startISO: string): number {
  const d = parseISO(startISO);
  const h = d.getHours() + d.getMinutes() / 60;
  return (h - 8) * HOUR_H;
}

export function calcHeight(startISO: string, endISO: string): number {
  const s = parseISO(startISO);
  const e = parseISO(endISO);
  return ((e.getTime() - s.getTime()) / 3600000) * HOUR_H;
}

// 左键切换状态的循环顺序
const STATUS_CYCLE: Appointment['status'][] = ['BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED'];

export function nextStatus(s: Appointment['status']): Appointment['status'] | null {
  const idx = STATUS_CYCLE.indexOf(s);
  if (idx >= 0 && idx < STATUS_CYCLE.length - 1) return STATUS_CYCLE[idx + 1];
  return null;
}

// ===== 预约卡片 =====
export function AppointmentCard({
  appt,
  showChair,
  onClick,
  onMenu,
}: {
  appt: Appointment;
  showChair?: boolean;
  onClick: (a: Appointment) => void;
  onMenu: (a: Appointment, x: number, y: number) => void;
}) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const startLongPress = (x: number, y: number) => {
    firedRef.current = false;
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onMenu(appt, x, y);
    }, 500);
  };
  const cancelLongPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      className={`absolute left-1 right-1 rounded border px-1.5 py-1 text-xs cursor-pointer overflow-hidden select-none ${APPOINTMENT_STATUS_COLOR[appt.status] ?? 'bg-muted text-muted-foreground border-border'}`}
      style={{ top: calcTop(appt.startTime), height: Math.max(calcHeight(appt.startTime, appt.endTime), 24) }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(appt, e.clientX, e.clientY);
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        startLongPress(t.clientX, t.clientY);
      }}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onClick={(e) => {
        e.stopPropagation();
        if (!firedRef.current) onClick(appt);
        firedRef.current = false;
      }}
      title={`${appt.patient.name} - ${APPOINTMENT_STATUS_LABEL[appt.status]}（左键切换状态，右键/长按操作菜单）`}
    >
      <div className="flex items-center gap-1">
        <span className={`h-2 w-2 rounded-full shrink-0 ${APPOINTMENT_TYPE_COLOR[appt.type] ?? 'bg-muted-foreground'}`} />
        <span className="font-medium truncate">{appt.patient.name}</span>
      </div>
      <div className="truncate opacity-80">
        {format(parseISO(appt.startTime), 'HH:mm')} {APPOINTMENT_TYPE_LABEL[appt.type] ?? appt.type}
      </div>
      <div className="truncate opacity-60">
        {APPOINTMENT_STATUS_LABEL[appt.status]}
        {showChair && appt.chair ? ` · ${appt.chair.name}` : ''}
      </div>
    </div>
  );
}

// ===== 操作菜单 =====
export interface MenuState {
  appt: Appointment;
  x: number;
  y: number;
}

const MENU_ACTIONS: { key: string; label: string; danger?: boolean }[] = [
  { key: 'ARRIVED', label: '确认到诊' },
  { key: 'NO_SHOW', label: '标记爽约' },
  { key: 'CANCELLED', label: '取消预约' },
  { key: 'DELETE', label: '删除预约', danger: true },
];

export function ContextMenu({
  menu,
  onClose,
  onAction,
}: {
  menu: MenuState;
  onClose: () => void;
  onAction: (appt: Appointment, action: string) => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 min-w-[150px] rounded-md border border-border bg-white shadow-dropdown py-1 animate-scale-in"
        style={{
          left: Math.min(menu.x, window.innerWidth - 180),
          top: Math.min(menu.y, window.innerHeight - 220),
        }}
      >
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
          {menu.appt.patient.name} · {format(parseISO(menu.appt.startTime), 'HH:mm')}-
          {format(parseISO(menu.appt.endTime), 'HH:mm')}
        </div>
        {MENU_ACTIONS.map((it) => (
          <button
            key={it.key}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted ${it.danger ? 'text-destructive' : 'text-foreground'}`}
            onClick={() => {
              onAction(menu.appt, it.key);
              onClose();
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
