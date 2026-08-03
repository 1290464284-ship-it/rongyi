import { useState, useMemo } from 'react';
import {
  CalendarDays, CalendarClock, User, CheckCircle2, FileCheck,
  Plus, Printer,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { useStaff } from '@/lib/staff';
import { cn } from '@/lib/utils';
import {
  useScheduleCalendar,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useLeaves,
  SHIFT_TYPE,
  SHIFT_TYPE_SHORT,
  hashColor,
  getInitials,
  type ScheduleItem,
  type CalendarDay,
  type LeaveRequest,
} from '@/lib/api/system/hr';
import { ScheduleDialog } from '@/components/hr/ScheduleDialog';
import AttendanceTab from './components/AttendanceTab';
import LeaveTab from './components/LeaveTab';

type HrTab = 'schedule' | 'attendance' | 'leave';
type CalendarView = 'month' | 'week' | 'list';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function buildMonthGrid(year: number, month: number, days: CalendarDay[]): (CalendarDay | null)[][] {
  const firstDay = new Date(year, month - 1, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayMap = new Map(days.map((d) => [d.date, d]));

  const cells: (CalendarDay | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push(dayMap.get(dateStr) ?? { date: dateStr, schedules: [] });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const rows: (CalendarDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function ScheduleCard({
  s, onClick,
}: { s: ScheduleItem; onClick?: (e: React.MouseEvent) => void }) {
  const isLeave = s.shiftType === 'LEAVE';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded px-1.5 py-0.5 text-left text-[11px] leading-tight mb-0.5 text-white transition hover:brightness-110 flex items-center gap-1 overflow-hidden',
        isLeave && '!bg-[repeating-linear-gradient(45deg,#a855f7,#a855f7_6px,#c084fc_6px,#c084fc_12px)] text-white',
      )}
      style={!isLeave ? { background: s.color } : undefined}
      title={`${s.userName} - ${SHIFT_TYPE[s.shiftType]} ${s.startAt.slice(11, 16)}-${s.endAt.slice(11, 16)}`}
      data-testid={`schedule-card-${s.id}`}
    >
      <span className="shrink-0 font-semibold">{SHIFT_TYPE_SHORT[s.shiftType]}</span>
      <span className="truncate">{getInitials(s.userName)}</span>
    </button>
  );
}

export default function HrPage() {

  const [tab, setTab] = useState<HrTab>('schedule');
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [viewMode, setViewMode] = useState<CalendarView>('month');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleInitialDate, setScheduleInitialDate] = useState<string | undefined>();
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);
  const [scheduleConflict, setScheduleConflict] = useState<string | null>(null);

  const { data: staff = [] } = useStaff();
  const hrStaff = staff.filter((s) => s.role === 'DOCTOR' || s.role === 'RECEPTIONIST' || s.role === 'BOSS');

  const calendarUserId = selectedUserIds.length === 1 ? selectedUserIds[0] : undefined;
  const { data: calendar, isLoading: calendarLoading } = useScheduleCalendar({ year, month, userId: calendarUserId });

  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();

  const { data: leavesRaw = [] } = useLeaves({});
  const pendingCount = leavesRaw.filter((l: LeaveRequest) => l.status === 'PENDING').length;

  function goPrevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }
  function goNextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }

  function toggleUser(id: string) {
    setSelectedUserIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  }

  function openCreateSchedule(date?: string) {
    setEditingSchedule(null);
    setScheduleInitialDate(date);
    setScheduleConflict(null);
    setScheduleDialogOpen(true);
  }
  function openEditSchedule(s: ScheduleItem) {
    setEditingSchedule(s);
    setScheduleInitialDate(undefined);
    setScheduleConflict(null);
    setScheduleDialogOpen(true);
  }

  async function handleCreateSchedule(dto: Parameters<typeof createSchedule.mutateAsync>[0]) {
    try {
      setScheduleConflict(null);
      return await createSchedule.mutateAsync(dto);
    } catch (e: unknown) {
      const msg = (e as Error)?.message || '';
      if (msg.includes('SCHEDULE_CONFLICT') || msg.includes('冲突')) {
        setScheduleConflict('该时段已存在排班冲突，请调整时间或人员');
      }
      throw e;
    }
  }

  const visibleSchedules = (day: CalendarDay) => {
    if (selectedUserIds.length === 0) return day.schedules;
    return day.schedules.filter((s) => selectedUserIds.includes(s.userId));
  };

  const monthGrid = useMemo(
    () => calendar ? buildMonthGrid(calendar.year, calendar.month, calendar.days) : [],
    [calendar],
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">人力资源</h1>
            <p className="text-sm text-muted-foreground">排班、考勤与请假管理</p>
          </div>
        </div>
      </div>

      <div className="border-b border-border">
        <nav className="flex gap-1 -mb-px" role="tablist" data-testid="hr-tabs">
          {(
            [
              { k: 'schedule' as const, label: '排班日历', icon: CalendarDays },
              { k: 'attendance' as const, label: '考勤统计', icon: CheckCircle2 },
              { k: 'leave' as const, label: '请假管理', icon: FileCheck },
            ]
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.k;
            return (
              <button
                key={t.k}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.k)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition flex items-center gap-2',
                  active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                data-testid={`tab-${t.k}`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {t.k === 'leave' && pendingCount > 0 && (
                  <Badge className="!bg-warning !text-warning-foreground !ml-0">{pendingCount}</Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ========== 排班日历 ========== */}
      {tab === 'schedule' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="outline" onClick={goPrevMonth} data-testid="cal-prev">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(year)}
                      onChange={(e) => setYear(Number(e.target.value))}
                      className="w-28"
                      data-testid="cal-year-select"
                    >
                      {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
                        <option key={y} value={y}>{y} 年</option>
                      ))}
                    </Select>
                    <Select
                      value={String(month)}
                      onChange={(e) => setMonth(Number(e.target.value))}
                      className="w-24"
                      data-testid="cal-month-select"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>{m} 月</option>
                      ))}
                    </Select>
                  </div>
                  <Button size="icon" variant="outline" onClick={goNextMonth} data-testid="cal-next">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center rounded-md border border-border overflow-hidden" role="tablist">
                    {(['month', 'week', 'list'] as CalendarView[]).map((v, i) => (
                      <button
                        key={v}
                        role="tab"
                        aria-selected={viewMode === v}
                        onClick={() => setViewMode(v)}
                        className={cn(
                          'px-3 py-1.5 text-xs font-medium transition',
                          viewMode === v
                            ? 'bg-primary text-white'
                            : i > 0 ? 'border-l border-border text-muted-foreground hover:bg-muted' : 'text-muted-foreground hover:bg-muted',
                        )}
                        data-testid={`view-${v}`}
                      >
                        {v === 'month' ? '月' : v === 'week' ? '周' : '列表'}
                      </button>
                    ))}
                  </div>

                  <Button variant="outline" size="sm" className="h-9" data-testid="btn-new-schedule" onClick={() => openCreateSchedule()}>
                    <Plus className="w-4 h-4 mr-1.5" />新建班次
                  </Button>
                  <Button variant="outline" size="sm" className="h-9">
                    <Printer className="w-4 h-4 mr-1.5" />排班模板
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap border-t border-border pt-3">
                <span className="text-sm text-muted-foreground flex items-center gap-1 shrink-0">
                  <User className="w-3.5 h-3.5" />人员筛选：
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm" variant={selectedUserIds.length === 0 ? 'default' : 'outline'}
                    className="h-7 text-xs px-2"
                    onClick={() => setSelectedUserIds([])}
                  >
                    全部
                  </Button>
                  {hrStaff.map((u) => {
                    const active = selectedUserIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleUser(u.id)}
                        className={cn(
                          'h-7 px-2 rounded-md text-xs flex items-center gap-1.5 border transition',
                          active
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-white hover:border-primary/40',
                        )}
                      >
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                          style={{ background: hashColor(u.id) }}
                        >
                          {getInitials(u.name)}
                        </span>
                        {u.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {viewMode === 'month' && (
            <Card>
              <CardContent className="p-2 sm:p-3">
                {calendarLoading ? (
                  <div className="h-[600px] flex items-center justify-center">
                    <div className="animate-pulse text-muted-foreground">加载中…</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1" data-testid="month-calendar">
                    {WEEK_LABELS.map((w, i) => (
                      <div
                        key={w}
                        className={cn(
                          'text-center py-2 text-xs font-medium rounded-md',
                          i === 0 || i === 6 ? 'text-muted-foreground bg-muted/40' : 'text-foreground bg-muted/30',
                        )}
                      >
                        {w}
                      </div>
                    ))}
                    {monthGrid.flat().map((cell, idx) => {
                      const todayStr = today.toISOString().slice(0, 10);
                      const isToday = cell?.date === todayStr;
                      const isCurrentMonth = !!cell && cell.date.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`;
                      const dayNum = cell ? Number(cell.date.slice(8)) : null;
                      const schs = cell ? visibleSchedules(cell) : [];
                      return (
                        <div
                          key={idx}
                          className={cn(
                            'min-h-[110px] rounded-md border p-1.5 flex flex-col transition cursor-pointer',
                            cell ? 'bg-white hover:bg-muted/30' : 'bg-muted/20 border-dashed cursor-default',
                            isCurrentMonth ? 'border-border' : cell ? 'border-border/60 bg-muted/10' : '',
                            isToday && 'ring-2 ring-primary ring-offset-1',
                          )}
                          onClick={() => cell && openCreateSchedule(cell.date)}
                          data-testid={cell ? `cal-cell-${cell.date}` : `cal-empty-${idx}`}
                        >
                          <div className="flex items-start justify-between mb-1">
                            <span className={cn(
                              'text-xs font-medium rounded-full px-1.5 py-0.5 min-w-[22px] text-center',
                              isToday ? 'bg-primary text-white'
                                : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground',
                            )}>{dayNum}</span>
                          </div>
                          <div className="space-y-0.5 flex-1 min-h-0 overflow-hidden">
                            {schs.map((s) => (
                              <ScheduleCard key={s.id} s={s} onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                openEditSchedule(s);
                              }} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {viewMode === 'list' && (
            <Card>
              <CardContent className="p-0">
                <div className="py-12 text-center text-muted-foreground text-sm">
                  列表视图请使用月视图模式查看排班详情。
                </div>
              </CardContent>
            </Card>
          )}

          {viewMode === 'week' && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground text-center py-8">
                  周视图可基于月视图拓展；请使用月视图或列表模式。
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ========== 考勤统计 ========== */}
      {tab === 'attendance' && <AttendanceTab hrStaff={hrStaff} />}

      {/* ========== 请假管理 ========== */}
      {tab === 'leave' && <LeaveTab hrStaff={hrStaff} />}

      <ScheduleDialog
        open={scheduleDialogOpen}
        onClose={() => setScheduleDialogOpen(false)}
        initialDate={scheduleInitialDate}
        schedule={editingSchedule}
        onSubmit={handleCreateSchedule}
        onUpdate={updateSchedule.mutateAsync}
        onDelete={deleteSchedule.mutateAsync}
        conflictError={scheduleConflict}
      />
    </div>
  );
}
