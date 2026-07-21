import { useState, useMemo, useRef, useEffect } from 'react';
import {
  startOfWeek,
  addDays,
  format,
  isSameDay,
  parseISO,
  addWeeks,
  addMonths,
  startOfMonth,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  eachDayOfInterval,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import {
  useAppointments,
  useUpdateAppointment,
  useDeleteAppointment,
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_COLOR,
  APPOINTMENT_TYPE_LABEL,
  APPOINTMENT_TYPE_COLOR,
  type Appointment,
} from '@/lib/appointments';
import { useChairs, type Chair } from '@/lib/chairs';
import AppointmentForm from './AppointmentForm';

type ViewMode = 'day' | 'week' | 'month';

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8:00 - 18:00
const HOUR_H = 48; // 每小时行高 px
const STATUS_CYCLE: Appointment['status'][] = ['BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED'];

// 左键切换状态的循环顺序
function nextStatus(s: Appointment['status']): Appointment['status'] | null {
  const idx = STATUS_CYCLE.indexOf(s);
  if (idx >= 0 && idx < STATUS_CYCLE.length - 1) return STATUS_CYCLE[idx + 1];
  return null;
}

// 计算时间轴定位
function calcTop(startISO: string): number {
  const d = parseISO(startISO);
  const h = d.getHours() + d.getMinutes() / 60;
  return (h - 8) * HOUR_H;
}
function calcHeight(startISO: string, endISO: string): number {
  const s = parseISO(startISO);
  const e = parseISO(endISO);
  return ((e.getTime() - s.getTime()) / 3600000) * HOUR_H;
}

const toISO = (d: Date) => format(d, "yyyy-MM-dd'T'00:00:00xxx");

// ===== 预约卡片（支持左键切换状态、右键/长按弹出操作菜单）=====
function AppointmentCard({
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

  // 组件卸载时清除定时器，防止内存泄漏
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

// ===== 操作菜单（确认/爽约/取消/删除）=====
interface MenuState {
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
function ContextMenu({
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

// ===== 主页面 =====
export default function AppointmentCalendarPage() {
  const [view, setView] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedChairId, setSelectedChairId] = useState<string>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [createSlot, setCreateSlot] = useState<{ start: string; end: string; chairId?: string }>({
    start: '',
    end: '',
  });
  const [menu, setMenu] = useState<MenuState | null>(null);

  const { data: chairs } = useChairs();
  const activeChairs = useMemo(() => (chairs?.filter((c) => c.active) ?? []), [chairs]);

  // 根据视图计算数据拉取范围
  const range = useMemo(() => {
    if (view === 'day') {
      return { start: startOfDay(currentDate), end: addDays(startOfDay(currentDate), 1) };
    }
    if (view === 'week') {
      const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
      return { start: ws, end: addDays(ws, 7) };
    }
    // month：拉取整月（含网格溢出天）
    const mStart = startOfMonth(currentDate);
    const mEnd = endOfMonth(currentDate);
    const gStart = startOfWeek(mStart, { weekStartsOn: 1 });
    const gEnd = endOfWeek(mEnd, { weekStartsOn: 1 });
    return { start: gStart, end: addDays(gEnd, 1) };
  }, [view, currentDate]);

  const { data, isLoading } = useAppointments({
    startDate: toISO(range.start),
    endDate: toISO(range.end),
  });
  const update = useUpdateAppointment();
  const remove = useDeleteAppointment();
  const appts = data?.items ?? [];

  // 牙椅筛选（客户端兜底，保证选定牙椅时仅显示该牙椅预约）
  const filteredAppts = useMemo(() => {
    if (selectedChairId === 'ALL') return appts;
    return appts.filter((a) => (a.chairId ?? '') === selectedChairId);
  }, [appts, selectedChairId]);

  // 按天分组
  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of filteredAppts) {
      const key = format(parseISO(a.startTime), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [filteredAppts]);

  // 周视图数据
  const weekStart = useMemo(
    () => startOfWeek(currentDate, { weekStartsOn: 1 }),
    [currentDate],
  );
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // 日视图牙椅列：选定牙椅时只显示该列；全部时显示所有牙椅 + 未分配列
  const dayChairs = useMemo<Chair[]>(() => {
    if (selectedChairId !== 'ALL') {
      const c = activeChairs.find((ch) => ch.id === selectedChairId);
      return c ? [c] : [];
    }
    const list: Chair[] = [...activeChairs];
    const dayKey = format(currentDate, 'yyyy-MM-dd');
    const dayAppts = apptsByDay.get(dayKey) ?? [];
    if (dayAppts.some((a) => !a.chairId)) {
      list.push({ id: '__none__', name: '未分配', location: null, active: 1, createdAt: '', updatedAt: '' });
    }
    return list;
  }, [activeChairs, selectedChairId, apptsByDay, currentDate]);

  // 月视图网格天
  const monthDays = useMemo(() => {
    const mStart = startOfMonth(currentDate);
    const mEnd = endOfMonth(currentDate);
    const gStart = startOfWeek(mStart, { weekStartsOn: 1 });
    const gEnd = endOfWeek(mEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gStart, end: gEnd });
  }, [currentDate]);

  // 日期范围标题
  const rangeLabel = useMemo(() => {
    if (view === 'day') return format(currentDate, 'yyyy年M月d日 EEEE', { locale: zhCN });
    if (view === 'week') {
      return `${format(weekStart, 'yyyy-MM-dd', { locale: zhCN })} ~ ${format(addDays(weekStart, 6), 'yyyy-MM-dd', { locale: zhCN })}`;
    }
    return format(currentDate, 'yyyy年M月', { locale: zhCN });
  }, [view, currentDate, weekStart]);

  function handleCellClick(day: Date, hour: number, chairId?: string) {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(start.getMinutes() + 30);
    setCreateSlot({ start: start.toISOString(), end: end.toISOString(), chairId });
    setCreateOpen(true);
  }

  function cycleStatus(a: Appointment) {
    const ns = nextStatus(a.status);
    if (ns) update.mutate({ id: a.id, data: { status: ns } });
  }

  function openMenu(a: Appointment, x: number, y: number) {
    setMenu({ appt: a, x, y });
  }

  function handleMenuAction(appt: Appointment, action: string) {
    if (action === 'DELETE') {
      remove.mutate(appt.id);
    } else {
      update.mutate({ id: appt.id, data: { status: action as Appointment['status'] } });
    }
  }

  function goToday() {
    setCurrentDate(new Date());
  }
  function goPrev() {
    if (view === 'day') setCurrentDate((d) => addDays(d, -1));
    else if (view === 'week') setCurrentDate((d) => addWeeks(d, -1));
    else setCurrentDate((d) => addMonths(d, -1));
  }
  function goNext() {
    if (view === 'day') setCurrentDate((d) => addDays(d, 1));
    else if (view === 'week') setCurrentDate((d) => addWeeks(d, 1));
    else setCurrentDate((d) => addMonths(d, 1));
  }

  const VIEW_OPTIONS: { key: ViewMode; label: string }[] = [
    { key: 'day', label: '日' },
    { key: 'week', label: '周' },
    { key: 'month', label: '月' },
  ];

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      {/* 顶部标题与新建 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">预约排班</h1>
        <Button
          onClick={() => {
            const now = new Date();
            now.setMinutes(0, 0, 0);
            const end = new Date(now);
            end.setMinutes(now.getMinutes() + 30);
            setCreateSlot({
              start: now.toISOString(),
              end: end.toISOString(),
              chairId: selectedChairId === 'ALL' ? undefined : selectedChairId,
            });
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />新建预约
        </Button>
      </div>

      {/* 工具栏：视图切换 / 日期导航 / 牙椅筛选 */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          {/* 视图切换 */}
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {VIEW_OPTIONS.map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  view === v.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-white text-foreground hover:bg-muted'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* 日期导航 */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToday}>
              今天
            </Button>
            <Button variant="outline" size="icon" onClick={goPrev} aria-label="上一页">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="text-sm text-foreground min-w-[200px] text-center font-medium">
              {rangeLabel}
            </span>
            <Button variant="outline" size="icon" onClick={goNext} aria-label="下一页">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* 牙椅筛选 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">牙椅</span>
          <Select
            value={selectedChairId}
            onChange={(e) => setSelectedChairId(e.target.value)}
            className="w-44"
          >
            <option value="ALL">全部牙椅</option>
            {activeChairs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.location ? ` · ${c.location}` : ''}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* 状态图例 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(['BOOKED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as Appointment['status'][]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${APPOINTMENT_STATUS_COLOR[s] ?? ''}`} />
            {APPOINTMENT_STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {/* 日历主体 */}
      <div className="flex-1 min-h-0">
        {view === 'day' && (
          <DayView
            chairs={dayChairs}
            dayAppts={apptsByDay.get(format(currentDate, 'yyyy-MM-dd')) ?? []}
            onCellClick={(hour, chairId) => handleCellClick(currentDate, hour, chairId)}
            renderCard={(a) => (
              <AppointmentCard key={a.id} appt={a} onClick={cycleStatus} onMenu={openMenu} />
            )}
          />
        )}

        {view === 'week' && (
          <WeekView
            weekDays={weekDays}
            apptsByDay={apptsByDay}
            onCellClick={(day, hour) =>
              handleCellClick(day, hour, selectedChairId === 'ALL' ? undefined : selectedChairId)
            }
            renderCard={(a) => (
              <AppointmentCard key={a.id} appt={a} showChair onClick={cycleStatus} onMenu={openMenu} />
            )}
          />
        )}

        {view === 'month' && (
          <MonthView
            days={monthDays}
            monthDate={currentDate}
            apptsByDay={apptsByDay}
            onPickDay={(d) => {
              setCurrentDate(d);
              setView('day');
            }}
          />
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {/* 新建预约弹窗 */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>新建预约</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <AppointmentForm
            defaultStartTime={createSlot.start}
            defaultEndTime={createSlot.end}
            defaultChairId={createSlot.chairId}
            onClose={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* 操作菜单 */}
      {menu && (
        <ContextMenu menu={menu} onClose={() => setMenu(null)} onAction={handleMenuAction} />
      )}
    </div>
  );
}

// ===== 日视图：时间轴 × 牙椅列 =====
function DayView({
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
function WeekView({
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
function MonthView({
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

// startOfDay 局部实现（避免额外 date-fns 导入）
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
