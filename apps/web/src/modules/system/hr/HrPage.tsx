/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState, useMemo } from 'react';
import {
  CalendarDays, CalendarClock, User, CheckCircle2, XCircle, AlertCircle,
  Plus, RefreshCw, Search, Filter, Printer, FileCheck,
  ChevronLeft, ChevronRight, ArrowRight, Clock, Smile, Frown, Edit2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTableWrapper, type DataTableColumn } from '@/components/ui/data-table-wrapper';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { useAuthStore } from '@/lib/store/auth-store';
import { useStaff, type StaffUser } from '@/lib/staff';
import { cn } from '@/lib/utils';
import {
  useScheduleCalendar,
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useLeaves,
  useCreateLeave,
  useSubmitLeave,
  useApproveLeave,
  useRejectLeave,
  useCancelLeave,
  useAttendance,
  SHIFT_TYPE,
  SHIFT_TYPE_SHORT,
  LEAVE_TYPE,
  LEAVE_STATUS,
  LEAVE_STATUS_COLOR,
  LEAVE_TYPE_COLOR,
  hashColor,
  getInitials,
  type ScheduleItem,
  type CalendarDay,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
  type ShiftType,
  type AttendanceStatus,
} from '@/lib/api/system/hr';
import { ScheduleDialog } from '@/components/hr/ScheduleDialog';
import { LeaveDialog } from '@/components/hr/LeaveDialog';

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

function AttendanceBadge({ status }: { status?: AttendanceStatus }) {
  if (!status) return null;
  const map: Record<AttendanceStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
    PRESENT: { icon: CheckCircle2, cls: 'text-success bg-success/10', label: '出勤' },
    ABSENT: { icon: XCircle, cls: 'text-destructive bg-destructive/10', label: '缺勤' },
    LEAVE: { icon: Clock, cls: 'text-info bg-info/10', label: '请假' },
    OFF: { icon: Smile, cls: 'text-muted-foreground bg-muted', label: '休息' },
  };
  const m = map[status];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium', m.cls)}>
      <Icon className="w-3 h-3" />
      {m.label}
    </span>
  );
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
  const currentUser = useAuthStore((s) => s.user);
  const isBoss = currentUser?.role === 'BOSS';

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

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<LeaveRequest | null>(null);

  const [leaveFilters, setLeaveFilters] = useState<{
    status?: LeaveStatus;
    type?: LeaveType;
    userId?: string;
    search: string;
  }>({ search: '' });

  const [attendanceUserId, setAttendanceUserId] = useState<string | undefined>();
  const [attendanceRange, setAttendanceRange] = useState<'thisMonth' | 'lastMonth' | 'custom'>('thisMonth');

  const { data: staff = [] } = useStaff();
  const hrStaff = staff.filter((s) => s.role === 'DOCTOR' || s.role === 'RECEPTIONIST' || s.role === 'BOSS');

  const calendarUserId = selectedUserIds.length === 1 ? selectedUserIds[0] : undefined;
  const { data: calendar, isLoading: calendarLoading } = useScheduleCalendar({ year, month, userId: calendarUserId });

  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();

  const createLeave = useCreateLeave();
  const submitLeave = useSubmitLeave();
  const approveLeave = useApproveLeave();
  const rejectLeave = useRejectLeave();
  const cancelLeave = useCancelLeave();

  const { data: leavesRaw = [] } = useLeaves({
    status: leaveFilters.status,
    userId: leaveFilters.userId || (!isBoss ? currentUser?.id : undefined),
    search: leaveFilters.search || undefined,
  });

  const leaves: LeaveRequest[] = useMemo(() => {
    let list = leavesRaw;
    if (leaveFilters.type) list = list.filter((l) => l.leaveType === leaveFilters.type);
    return list;
  }, [leavesRaw, leaveFilters.type]);

  const attendanceFromTo = useMemo(() => {
    const now = new Date();
    if (attendanceRange === 'thisMonth') {
      const y = now.getFullYear(), m = now.getMonth();
      return {
        from: new Date(y, m, 1).toISOString().slice(0, 10),
        to: new Date(y, m + 1, 0).toISOString().slice(0, 10),
      };
    } else if (attendanceRange === 'lastMonth') {
      const y = now.getFullYear(), m = now.getMonth() - 1;
      return {
        from: new Date(y, m, 1).toISOString().slice(0, 10),
        to: new Date(y, m + 1, 0).toISOString().slice(0, 10),
      };
    }
    return { from: undefined, to: undefined };
  }, [attendanceRange]);

  const { data: attendance, isLoading: attendanceLoading } = useAttendance({
    from: attendanceFromTo.from,
    to: attendanceFromTo.to,
    userId: attendanceUserId,
  });

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

  const pendingCount = leaves.filter((l) => l.status === 'PENDING').length;
  const monthLeaveCount = leaves.filter((l) => {
    const d = new Date(l.startAt);
    return d.getFullYear() === today.getFullYear() && d.getMonth() + 1 === today.getMonth() + 1;
  }).length;

  const visibleSchedules = (day: CalendarDay) => {
    if (selectedUserIds.length === 0) return day.schedules;
    return day.schedules.filter((s) => selectedUserIds.includes(s.userId));
  };

  const monthGrid = useMemo(
    () => calendar ? buildMonthGrid(calendar.year, calendar.month, calendar.days) : [],
    [calendar],
  );

  const present = attendance?.daysPresent ?? 0;
  const absent = attendance?.daysAbsent ?? 0;
  const lv = attendance?.daysLeave ?? 0;
  const off = attendance?.daysOff ?? 0;
  const shouldAttend = present + absent;
  const rate = shouldAttend > 0 ? Math.round((present / shouldAttend) * 100) : 0;

  const leaveColumns: DataTableColumn<LeaveRequest>[] = [
    {
      key: 'user',
      header: '申请人',
      cell: (row) => (
        <div className="flex items-center gap-2 min-w-[100px]">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
            style={{ background: hashColor(row.userId) }}>
            {getInitials(row.userName)}
          </div>
          <span className="font-medium text-sm">{row.userName}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: '类型',
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', LEAVE_TYPE_COLOR[row.leaveType])} />
          {LEAVE_TYPE[row.leaveType]}
        </span>
      ),
    },
    {
      key: 'period',
      header: '时段',
      cell: (row) => (
        <div className="text-xs leading-tight min-w-[150px]">
          <div className="font-mono">{row.startAt.slice(0, 10)} → {row.endAt.slice(0, 10)}</div>
          <div className="text-muted-foreground mt-0.5">共 {row.totalDays} 天</div>
        </div>
      ),
    },
    {
      key: 'reason',
      header: '原因',
      cell: (row) => (
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-[240px]" title={row.reason}>
          {row.reason.length > 50 ? row.reason.slice(0, 50) + '…' : row.reason}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => (
        <Badge className={cn(LEAVE_STATUS_COLOR[row.status as LeaveStatus])}>
          {LEAVE_STATUS[row.status as LeaveStatus]}
        </Badge>
      ),
    },
    {
      key: 'submitAt',
      header: '提交时间',
      cell: (row) => row.submitAt ? (
        <span className="text-xs text-muted-foreground font-mono">{row.submitAt.slice(0, 16).replace('T', ' ')}</span>
      ) : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      key: 'approver',
      header: '审批人',
      cell: (row) => row.approverName || <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      key: 'note',
      header: '审批备注',
      cell: (row) => row.rejectReason ? (
        <span className="text-xs text-destructive max-w-[140px] inline-block truncate" title={row.rejectReason}>{row.rejectReason}</span>
      ) : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      key: 'actions',
      header: '操作',
      className: 'text-right whitespace-nowrap',
      cell: (row) => {
        const isMine = row.userId === currentUser?.id;
        const pendingMine = isMine && (row.status === 'SAVED' || row.status === 'PENDING');
        const bossCanApprove = isBoss && row.status === 'PENDING' && row.userId !== currentUser?.id;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="sm" variant="ghost" className="h-7 px-2 text-xs"
              onClick={() => { setEditingLeave(row); setLeaveDialogOpen(true); }}
              data-testid={`leave-detail-${row.id}`}
            >
              <FileCheck className="w-3.5 h-3.5 mr-1" />详情
            </Button>
            {pendingMine && (
              <Button
                size="sm" variant="outline" className="h-7 px-2 text-xs"
                onClick={() => cancelLeave.mutate(row.id)}
                data-testid={`leave-cancel-${row.id}`}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />撤销
              </Button>
            )}
            {bossCanApprove && (
              <>
                <Button
                  size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive"
                  onClick={() => { setEditingLeave(row); setLeaveDialogOpen(true); }}
                  data-testid={`leave-reject-btn-${row.id}`}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1" />拒绝
                </Button>
                <Button
                  size="sm" className="h-7 px-2 text-xs"
                  onClick={() => approveLeave.mutate(row.id)}
                  data-testid={`leave-approve-btn-${row.id}`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />通过
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

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
                            {cell?.attendanceStatus && <AttendanceBadge status={cell.attendanceStatus} />}
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
                <ScheduleListView calendar={calendar} onEdit={openEditSchedule} onCreate={openCreateSchedule} />
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
      {tab === 'attendance' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Label className="!mb-0">时间范围</Label>
                <div className="inline-flex rounded-md border border-border overflow-hidden">
                  {([
                    ['thisMonth', '本月'],
                    ['lastMonth', '上月'],
                    ['custom', '自定义'],
                  ] as const).map(([k, label], i) => (
                    <button
                      key={k}
                      onClick={() => setAttendanceRange(k)}
                      className={cn(
                        'px-3 py-1.5 text-xs transition',
                        attendanceRange === k ? 'bg-primary text-white'
                          : i > 0 ? 'border-l border-border text-muted-foreground hover:bg-muted' : 'text-muted-foreground hover:bg-muted',
                      )}
                    >{label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <Select
                    value={attendanceUserId ?? ''}
                    onChange={(e) => setAttendanceUserId(e.target.value || undefined)}
                    className="w-40"
                  >
                    <option value="">全部人员</option>
                    {hrStaff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </div>
              </div>
              <Button variant="outline" size="sm" className="h-9" onClick={() => { /* refresh */ }}>
                <RefreshCw className="w-4 h-4 mr-1.5" />刷新
              </Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="attendance-kpi">
            <KpiCard icon={CheckCircle2} label="出勤天数" value={present} tone="success" />
            <KpiCard icon={XCircle} label="缺勤天数" value={absent} tone="destructive" />
            <KpiCard icon={Clock} label="请假天数" value={lv} tone="info" />
            <KpiCard icon={Smile} label="休息天数" value={off} tone="muted" extra={
              <div className="text-xs text-muted-foreground mt-1">出勤率 <span className="font-semibold text-foreground" data-testid="attendance-rate">{rate}%</span></div>
            } />
          </div>

          <Card>
            <CardHeader className="py-3 px-4 border-b border-border">
              <CardTitle className="text-sm font-medium">每日明细</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {attendanceLoading ? (
                <TableLoading colSpan={3} />
              ) : !attendance || attendance.listDaily.length === 0 ? (
                <EmptyState colSpan={3} text="暂无考勤数据" />
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2.5 text-left">日期</th>
                      <th className="px-4 py-2.5 text-left">状态</th>
                      <th className="px-4 py-2.5 text-left">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.listDaily.map((d) => (
                      <tr key={d.date} className="border-t border-border">
                        <td className="px-4 py-2 font-mono">{d.date}</td>
                        <td className="px-4 py-2"><AttendanceBadge status={d.status} /></td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">{d.reason || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========== 请假管理 ========== */}
      {tab === 'leave' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">待我审批</p>
                  <p className="text-2xl font-bold" data-testid="kpi-pending">{isBoss ? pendingCount : '-'}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-info/10 text-info flex items-center justify-center shrink-0">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">本月已请</p>
                  <p className="text-2xl font-bold" data-testid="kpi-month-leaves">{monthLeaveCount} 天</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-success/10 text-success flex items-center justify-center shrink-0">
                  <Smile className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">年假剩余</p>
                  <p className="text-2xl font-bold" data-testid="kpi-annual-left">5 天</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                  <Filter className="w-3.5 h-3.5" />图例：
                </span>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(LEAVE_TYPE) as LeaveType[]).map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 text-xs">
                      <span className={cn('w-2.5 h-2.5 rounded-full', LEAVE_TYPE_COLOR[t])} />
                      {LEAVE_TYPE[t]}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between flex-wrap gap-3 border-t border-border pt-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <Input
                      value={leaveFilters.search}
                      onChange={(e) => setLeaveFilters({ ...leaveFilters, search: e.target.value })}
                      placeholder="搜索申请人/原因"
                      className="w-56 pl-8 h-9"
                      data-testid="leave-search"
                    />
                  </div>
                  <Select
                    value={leaveFilters.status ?? ''}
                    onChange={(e) => setLeaveFilters({ ...leaveFilters, status: (e.target.value || undefined) as LeaveStatus })}
                    className="w-32 h-9"
                    data-testid="leave-filter-status"
                  >
                    <option value="">全部状态</option>
                    {(Object.keys(LEAVE_STATUS) as LeaveStatus[]).map((s) => (
                      <option key={s} value={s}>{LEAVE_STATUS[s]}</option>
                    ))}
                  </Select>
                  <Select
                    value={leaveFilters.type ?? ''}
                    onChange={(e) => setLeaveFilters({ ...leaveFilters, type: (e.target.value || undefined) as LeaveType })}
                    className="w-28 h-9"
                    data-testid="leave-filter-type"
                  >
                    <option value="">全部类型</option>
                    {(Object.keys(LEAVE_TYPE) as LeaveType[]).map((t) => (
                      <option key={t} value={t}>{LEAVE_TYPE[t]}</option>
                    ))}
                  </Select>
                  <Select
                    value={leaveFilters.userId ?? ''}
                    onChange={(e) => setLeaveFilters({ ...leaveFilters, userId: e.target.value || undefined })}
                    className="w-32 h-9"
                    data-testid="leave-filter-user"
                  >
                    <option value="">全部人员</option>
                    {hrStaff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </div>
                <Button onClick={() => { setEditingLeave(null); setLeaveDialogOpen(true); }} data-testid="btn-new-leave">
                  <Plus className="w-4 h-4 mr-1.5" />申请请假
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <DataTableWrapper<LeaveRequest>
                columns={leaveColumns}
                data={leaves}
                loading={false}
                isEmpty={leaves.length === 0}
                emptyText="暂无请假记录"
                emptySubtitle="点击右上角「申请请假」发起新申请"
                rowKey={(row) => row.id}
                showPagination={false}
                tableClassName="text-sm"
              />
            </CardContent>
          </Card>
        </div>
      )}

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

      <LeaveDialog
        open={leaveDialogOpen}
        onClose={() => setLeaveDialogOpen(false)}
        leave={editingLeave}
        onCreate={createLeave.mutateAsync}
        onSubmit={submitLeave.mutateAsync}
        onApprove={approveLeave.mutateAsync}
        onReject={rejectLeave.mutateAsync}
        onCancel={cancelLeave.mutateAsync}
      />
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, tone, extra,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  tone: 'success' | 'destructive' | 'info' | 'muted';
  extra?: React.ReactNode;
}) {
  const tones: Record<typeof tone, string> = {
    success: 'bg-success/10 text-success',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {extra}
          </div>
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', tones[tone])}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleListView({
  calendar, onEdit, onCreate,
}: {
  calendar?: { days: CalendarDay[] } | null;
  onEdit: (s: ScheduleItem) => void;
  onCreate: (date?: string) => void;
}) {
  const rows: { date: string; schedule: ScheduleItem }[] = [];
  calendar?.days.forEach((d) => d.schedules.forEach((s) => rows.push({ date: d.date, schedule: s })));
  const days = calendar?.days ?? [];

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        暂无排班记录
        <div className="mt-3">
          <Button size="sm" onClick={() => onCreate()}>
            <Plus className="w-4 h-4 mr-1.5" />新建第一个班次
          </Button>
        </div>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/40 text-xs text-muted-foreground uppercase">
        <tr>
          <th className="px-4 py-2.5 text-left w-32">日期</th>
          <th className="px-4 py-2.5 text-left w-24">类型</th>
          <th className="px-4 py-2.5 text-left">人员</th>
          <th className="px-4 py-2.5 text-left w-40">时段</th>
          <th className="px-4 py-2.5 text-left">备注</th>
          <th className="px-4 py-2.5 text-right w-28">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.schedule.id}-${i}`} className="border-t border-border">
            <td className="px-4 py-2 font-mono">{r.date}</td>
            <td className="px-4 py-2">
              <Badge className="text-xs" style={{ background: r.schedule.color, color: '#fff' }}>
                {SHIFT_TYPE[r.schedule.shiftType]}
              </Badge>
            </td>
            <td className="px-4 py-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                  style={{ background: hashColor(r.schedule.userId) }}
                >
                  {getInitials(r.schedule.userName)}
                </span>
                {r.schedule.userName}
              </div>
            </td>
            <td className="px-4 py-2 font-mono text-xs">
              {r.schedule.startAt.slice(11, 16)} → {r.schedule.endAt.slice(11, 16)}
            </td>
            <td className="px-4 py-2 text-muted-foreground text-xs">{r.schedule.note || '-'}</td>
            <td className="px-4 py-2 text-right">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onEdit(r.schedule)}>
                <Edit2 className="w-3.5 h-3.5 mr-1" />编辑
              </Button>
            </td>
          </tr>
        ))}
        {days.length > 0 && null}
      </tbody>
    </table>
  );
}
