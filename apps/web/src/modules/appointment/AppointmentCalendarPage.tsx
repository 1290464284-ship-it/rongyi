import { useState, useMemo } from 'react';
import {
  startOfWeek,
  addDays,
  format,
  parseISO,
  addWeeks,
  addMonths,
  startOfMonth,
  endOfMonth,
  endOfWeek,
  eachDayOfInterval,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import {
  useAppointments,
  useUpdateAppointment,
  useDeleteAppointment,
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_COLOR,
  type Appointment,
} from '@/lib/api/clinical/appointments';
import { useChairs, type Chair } from '@/lib/chairs';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import AppointmentForm from './AppointmentForm';
import { AppointmentCard, ContextMenu, nextStatus, type MenuState } from './components/AppointmentCard';
import { DayView, WeekView, MonthView } from './components/CalendarGrid';

type ViewMode = 'day' | 'week' | 'month';

const toISO = (d: Date) => format(d, "yyyy-MM-dd'T'00:00:00xxx");

// startOfDay 局部实现
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

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
    const mStart = startOfMonth(currentDate);
    const mEnd = endOfMonth(currentDate);
    const gStart = startOfWeek(mStart, { weekStartsOn: 1 });
    const gEnd = endOfWeek(mEnd, { weekStartsOn: 1 });
    return { start: gStart, end: addDays(gEnd, 1) };
  }, [view, currentDate]);

  const { data, isLoading, isError, refetch } = useAppointments({
    startDate: toISO(range.start),
    endDate: toISO(range.end),
  });
  const update = useUpdateAppointment();
  const remove = useDeleteAppointment();
  const appts = useMemo(() => data?.items ?? [], [data?.items]);

  // 牙椅筛选
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

  // 日视图牙椅列
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

      {isError && <QueryErrorAlert onRetry={refetch} />}
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
