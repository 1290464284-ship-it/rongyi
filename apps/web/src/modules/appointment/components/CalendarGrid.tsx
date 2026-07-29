import React from 'react';
import { format, isSameDay, isSameMonth, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import {
  APPOINTMENT_STATUS_COLOR,
  APPOINTMENT_TYPE_LABEL,
  type Appointment,
} from '@/lib/api/clinical/appointments';
import { type Chair } from '@/lib/chairs';

export const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8:00 - 18:00
export const HOUR_H = 48; // 每小时行高 px

// ===== 日视图：时间轴 × 牙椅列 =====
export function DayView({
  chairs,
  dayAppts,
  onCellClick,
  renderCard,
}: {
  chairs: Chair[];
  dayAppts: Appointment[];
  onCellClick: (hour: number, chairId: string | undefined) => void;
  renderCard: (a: Appointment) => React.ReactNode;
}) {
  if (chairs.length === 0) {
    return (
      <div className="h-full rounded-lg border border-border bg-white flex items-center justify-center text-sm text-muted-foreground">
        暂无可用牙椅，请先在系统中添加牙椅。
      </div>
    );
  }
  const colWidth = 180;
  return (
    <div className="h-full rounded-lg border border-border bg-white overflow-auto">
      <div style={{ minWidth: 70 + chairs.length * colWidth }}>
        {/* 表头：牙椅 */}
        <div
          className="grid border-b border-border sticky top-0 bg-white z-10"
          style={{ gridTemplateColumns: `60px repeat(${chairs.length}, 1fr)` }}
        >
          <div className="p-2 text-xs text-muted-foreground text-right">时间</div>
          {chairs.map((c) => (
            <div key={c.id} className="p-2 text-center border-l border-border">
              <div className="text-sm font-medium text-foreground">{c.name}</div>
              {c.location && <div className="text-xs text-muted-foreground">{c.location}</div>}
            </div>
          ))}
        </div>

        {/* 主体：时间列 + 牙椅列 */}
        <div
          className="grid"
          style={{ gridTemplateColumns: `60px repeat(${chairs.length}, 1fr)` }}
        >
          <div className="border-r border-border">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-xs text-muted-foreground text-right pr-2"
                style={{ height: HOUR_H }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {chairs.map((c) => {
            const colAppts = dayAppts.filter((a) => (a.chairId ?? '__none__') === c.id);
            return (
              <div
                key={c.id}
                className="relative border-l border-border"
                style={{ height: HOURS.length * HOUR_H }}
              >
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="border-b border-border hover:bg-primary/5 cursor-pointer"
                    style={{ height: HOUR_H }}
                    onClick={() => onCellClick(h, c.id === '__none__' ? undefined : c.id)}
                  />
                ))}
                {colAppts.map((a) => renderCard(a))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===== 周视图：7 天 × 时间轴 =====
export function WeekView({
  weekDays,
  apptsByDay,
  onCellClick,
  renderCard,
}: {
  weekDays: Date[];
  apptsByDay: Map<string, Appointment[]>;
  onCellClick: (day: Date, hour: number) => void;
  renderCard: (a: Appointment) => React.ReactNode;
}) {
  return (
    <div className="h-full rounded-lg border border-border bg-white overflow-auto">
      <div className="min-w-[900px] h-full">
        {/* 表头：星期 */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border sticky top-0 bg-white z-10">
          <div className="p-2 text-xs text-muted-foreground text-right">时间</div>
          {weekDays.map((d) => {
            const isToday = isSameDay(d, new Date());
            return (
              <div
                key={d.toISOString()}
                className={`p-2 text-center border-l border-border ${isToday ? 'bg-primary/5' : ''}`}
              >
                <div className="text-xs text-muted-foreground">{format(d, 'EEE', { locale: zhCN })}</div>
                <div className={`text-sm font-medium ${isToday ? 'text-primary' : 'text-foreground'}`}>
                  {format(d, 'd')}
                </div>
              </div>
            );
          })}
        </div>

        {/* 时间格 + 预约卡片 */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          <div className="border-r border-border">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-xs text-muted-foreground text-right pr-2"
                style={{ height: HOUR_H }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {weekDays.map((d) => {
            const key = format(d, 'yyyy-MM-dd');
            const dayAppts = apptsByDay.get(key) ?? [];
            const isToday = isSameDay(d, new Date());
            return (
              <div
                key={key}
                className={`relative border-l border-border ${isToday ? 'bg-primary/[0.03]' : ''}`}
                style={{ height: HOURS.length * HOUR_H }}
              >
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="border-b border-border hover:bg-primary/5 cursor-pointer"
                    style={{ height: HOUR_H }}
                    onClick={() => onCellClick(d, h)}
                  />
                ))}
                {dayAppts.map((a) => renderCard(a))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===== 月视图：日历网格 =====
export function MonthView({
  days,
  monthDate,
  apptsByDay,
  onPickDay,
}: {
  days: Date[];
  monthDate: Date;
  apptsByDay: Map<string, Appointment[]>;
  onPickDay: (d: Date) => void;
}) {
  const weekHead = ['一', '二', '三', '四', '五', '六', '日'];
  return (
    <div className="h-full rounded-lg border border-border bg-white overflow-auto">
      <div className="grid grid-cols-7">
        {weekHead.map((w) => (
          <div
            key={w}
            className="p-2 text-center text-xs font-medium text-muted-foreground border-b border-border"
          >
            周{w}
          </div>
        ))}
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd');
          const dayAppts = apptsByDay.get(key) ?? [];
          const inMonth = isSameMonth(d, monthDate);
          const isToday = isSameDay(d, new Date());
          return (
            <div
              key={key}
              onClick={() => onPickDay(d)}
              className={`min-h-[96px] p-1.5 border-b border-r border-border cursor-pointer transition-colors hover:bg-primary/5 ${
                inMonth ? 'bg-white' : 'bg-muted/30'
              } ${isToday ? 'ring-2 ring-primary/40 ring-inset' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs h-5 min-w-5 flex items-center justify-center rounded-full px-1 ${
                    isToday
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : inMonth
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  {format(d, 'd')}
                </span>
                {dayAppts.length > 0 && (
                  <Badge className="bg-primary/10 text-primary">{dayAppts.length}</Badge>
                )}
              </div>
              <div className="mt-1 space-y-0.5">
                {dayAppts.slice(0, 3).map((a) => (
                  <div
                    key={a.id}
                    className={`truncate text-[11px] px-1 py-0.5 rounded border ${APPOINTMENT_STATUS_COLOR[a.status] ?? ''}`}
                    title={`${a.patient.name} ${format(parseISO(a.startTime), 'HH:mm')} ${APPOINTMENT_TYPE_LABEL[a.type] ?? a.type}`}
                  >
                    {format(parseISO(a.startTime), 'HH:mm')} {a.patient.name}
                  </div>
                ))}
                {dayAppts.length > 3 && (
                  <div className="text-[11px] text-muted-foreground px-1">
                    +{dayAppts.length - 3} 更多
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
