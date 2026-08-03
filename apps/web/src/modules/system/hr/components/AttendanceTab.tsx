import { useState, useMemo } from 'react';
import {
  CheckCircle2, XCircle, Clock, Smile, RefreshCw, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import type { StaffUser } from '@/lib/staff';
import { cn } from '@/lib/utils';
import {
  useAttendance,
  type AttendanceStatus,
} from '@/lib/api/system/hr';

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

export default function AttendanceTab({ hrStaff }: { hrStaff: StaffUser[] }) {
  const [attendanceUserId, setAttendanceUserId] = useState<string | undefined>();
  const [attendanceRange, setAttendanceRange] = useState<'thisMonth' | 'lastMonth' | 'custom'>('thisMonth');

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

  const present = attendance?.daysPresent ?? 0;
  const absent = attendance?.daysAbsent ?? 0;
  const lv = attendance?.daysLeave ?? 0;
  const off = attendance?.daysOff ?? 0;
  const shouldAttend = present + absent;
  const rate = shouldAttend > 0 ? Math.round((present / shouldAttend) * 100) : 0;

  return (
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
  );
}
