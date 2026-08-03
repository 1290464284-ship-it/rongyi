import { useState, useMemo } from 'react';
import {
  AlertCircle, CalendarClock, Smile, Filter, Search, Plus,
  CheckCircle2, XCircle, FileCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTableWrapper, type DataTableColumn } from '@/components/ui/data-table-wrapper';
import { useAuthStore } from '@/lib/store/auth-store';
import { useStaff, type StaffUser } from '@/lib/staff';
import { cn } from '@/lib/utils';
import {
  useLeaves,
  useCreateLeave,
  useSubmitLeave,
  useApproveLeave,
  useRejectLeave,
  useCancelLeave,
  LEAVE_TYPE,
  LEAVE_STATUS,
  LEAVE_STATUS_COLOR,
  LEAVE_TYPE_COLOR,
  hashColor,
  getInitials,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
} from '@/lib/api/system/hr';
import { LeaveDialog } from '@/components/hr/LeaveDialog';

export default function LeaveTab({ hrStaff }: { hrStaff: StaffUser[] }) {
  const currentUser = useAuthStore((s) => s.user);
  const isBoss = currentUser?.role === 'BOSS';
  const today = new Date();

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<LeaveRequest | null>(null);
  const [leaveFilters, setLeaveFilters] = useState<{
    status?: LeaveStatus;
    type?: LeaveType;
    userId?: string;
    search: string;
  }>({ search: '' });

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

  const pendingCount = leaves.filter((l) => l.status === 'PENDING').length;
  const monthLeaveCount = leaves.filter((l) => {
    const d = new Date(l.startAt);
    return d.getFullYear() === today.getFullYear() && d.getMonth() + 1 === today.getMonth() + 1;
  }).length;

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
