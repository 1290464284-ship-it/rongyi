import { useState, useEffect, useRef } from 'react';
import {
  AlertCircle, FileCheck, CheckCircle2, XCircle, Ban, Plus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  LEAVE_TYPE,
  LEAVE_STATUS,
  LEAVE_STATUS_COLOR,
  LEAVE_TYPE_COLOR,
  type LeaveType,
  type LeaveRequest,
  type LeaveStatus,
  type CreateLeaveDto,
} from '@/lib/api/system/hr';
import { useStaff } from '@/lib/staff';
import { useAuthStore } from '@/lib/store/auth-store';
import { cn } from '@/lib/utils';
import {
  DateRangePicker,
  combineDateTime,
  splitDateTime,
  type DateRangePickerValue,
} from './DateRangePicker';

export interface LeaveDialogProps {
  open: boolean;
  onClose: () => void;
  leave?: LeaveRequest | null;
  onCreate: (data: CreateLeaveDto) => Promise<LeaveRequest>;
  onSubmit?: (id: string) => Promise<LeaveRequest>;
  onApprove?: (id: string) => Promise<LeaveRequest>;
  onReject?: (payload: { id: string; rejectReason: string }) => Promise<LeaveRequest>;
  onCancel?: (id: string) => Promise<LeaveRequest>;
}

const ANNUAL_BALANCE_MOCK = 5;

function calcDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (e < s) return 0;
  const ms = e.getTime() - s.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1;
}

export function LeaveDialog({
  open,
  onClose,
  leave,
  onCreate,
  onSubmit,
  onApprove,
  onReject,
  onCancel,
}: LeaveDialogProps) {
  const currentUser = useAuthStore((s) => s.user);
  const isBoss = currentUser?.role === 'BOSS';
  const { data: staff = [] } = useStaff();
  // staff 在测试 mock 下每次渲染都是新数组引用，不能作为 useEffect 依赖（会无限循环渲染）；
  // 通过 ref 保持最新值，effect 仅在 open/leave/isBoss/currentUser 变化时执行
  const staffRef = useRef(staff);
  staffRef.current = staff;

  const [userId, setUserId] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('ANNUAL');
  const [allDay, setAllDay] = useState(true);
  const [range, setRange] = useState<DateRangePickerValue>({
    startDate: '', startTime: '09:00', endDate: '', endTime: '18:00',
  });
  const [reason, setReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isView = !!leave;
  const isPending = leave?.status === 'PENDING';
  const canCancel = !!leave && (leave.status === 'SAVED' || leave.status === 'PENDING') && leave.userId === currentUser?.id;
  const canApprove = isBoss && isPending && leave?.userId !== currentUser?.id;

  const totalDays = allDay
    ? calcDays(range.startDate, range.endDate)
    : (range.startDate && range.endDate ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    setValidationError(null);
    setRejectReason('');
    if (leave) {
      setUserId(leave.userId);
      setLeaveType(leave.leaveType);
      const s = splitDateTime(leave.startAt);
      const e = splitDateTime(leave.endAt);
      setRange({
        startDate: s.date, startTime: s.time,
        endDate: e.date, endTime: e.time,
      });
      setReason(leave.reason);
      setAllDay(true);
    } else {
      const me = currentUser?.id || staffRef.current[0]?.id || '';
      setUserId(isBoss ? (staffRef.current[0]?.id || me) : me);
      setLeaveType('ANNUAL');
      const d = new Date().toISOString().slice(0, 10);
      setRange({
        startDate: d, startTime: '09:00',
        endDate: d, endTime: '18:00',
      });
      setReason('');
      setAllDay(true);
    }
  }, [open, leave, isBoss, currentUser]);

  function validateDates(): boolean {
    if (!range.startDate || !range.endDate) {
      setValidationError('请选择日期');
      return false;
    }
    const s = combineDateTime(range.startDate, allDay ? '00:00' : range.startTime);
    const e = combineDateTime(range.endDate, allDay ? '23:59' : range.endTime);
    if (new Date(s) > new Date(e)) {
      setValidationError('结束日期必须晚于开始日期');
      return false;
    }
    setValidationError(null);
    return true;
  }

  async function handleSave(asDraft: boolean) {
    // 校验顺序：先日期范围，再请假原因；错误提示不互相覆盖
    if (!validateDates()) return;
    if (!reason.trim()) {
      setValidationError('请假原因必填');
      return;
    }
    setSubmitting(true);
    try {
      const startAt = combineDateTime(range.startDate, allDay ? '00:00' : range.startTime);
      const endAt = combineDateTime(range.endDate, allDay ? '23:59' : range.endTime);
      const dto: CreateLeaveDto = {
        userId, leaveType, startAt, endAt, reason: reason.trim(),
        totalDays,
      };
      let created: LeaveRequest;
      if (isView && leave) {
        created = leave;
      } else {
        created = await onCreate(dto);
      }
      if (!asDraft && onSubmit) {
        await onSubmit(created.id);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    if (!leave || !onApprove) return;
    setSubmitting(true);
    try {
      await onApprove(leave.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!leave || !onReject) return;
    if (!rejectReason.trim()) {
      setValidationError('拒绝原因必填');
      return;
    }
    setSubmitting(true);
    try {
      await onReject({ id: leave.id, rejectReason: rejectReason.trim() });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!leave || !onCancel) return;
    if (!confirm(`确定撤销该请假申请？`)) return;
    setSubmitting(true);
    try {
      await onCancel(leave.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const readonly = isView && !(leave?.status === 'SAVED' && leave.userId === currentUser?.id);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 flex-wrap">
          {leave ? (
            <><FileCheck className="w-4 h-4" /> 请假详情</>
          ) : (
            <><Plus className="w-4 h-4" /> 申请请假</>
          )}
          {leave && (
            <Badge className={cn('ml-2', LEAVE_STATUS_COLOR[leave.status as LeaveStatus])} data-testid="leave-status-badge">
              {LEAVE_STATUS[leave.status as LeaveStatus]}
            </Badge>
          )}
        </DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        {validationError && (
          <div className="rounded-md bg-destructive/10 text-destructive p-3 flex items-start gap-2" data-testid="leave-validation-alert">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-sm font-medium">{validationError}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="lv-user">申请人</Label>
          <Select
            id="lv-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={readonly || !isBoss || !!leave}
            data-testid="lv-user-select"
          >
            {(isBoss ? staff : staff.filter((s) => s.id === currentUser?.id || !currentUser)).map((s) => (
              <option key={s.id} value={s.id}>{s.name}（{s.role === 'BOSS' ? '老板' : s.role === 'DOCTOR' ? '医生' : '前台'}）</option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label>请假类型 *</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" data-testid="leave-type-radio">
            {(Object.keys(LEAVE_TYPE) as LeaveType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={leaveType === t}
                onClick={() => !readonly && setLeaveType(t)}
                disabled={readonly}
                className={cn(
                  'px-3 py-1.5 rounded-md border text-sm transition flex items-center gap-1.5',
                  leaveType === t
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border bg-white hover:border-primary/40',
                  readonly && 'opacity-70 cursor-not-allowed',
                )}
                data-testid={`leave-type-${t}`}
              >
                <span className={cn('w-2.5 h-2.5 rounded-full', LEAVE_TYPE_COLOR[t])} />
                {LEAVE_TYPE[t]}
              </button>
            ))}
          </div>
          {leaveType === 'ANNUAL' && (
            <p className="text-xs text-muted-foreground" data-testid="annual-balance-tip">
              您的年假剩余 {ANNUAL_BALANCE_MOCK} 天
            </p>
          )}
        </div>

        {!isView && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="lv-all-day"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              disabled={readonly}
              className="w-4 h-4"
              data-testid="lv-all-day"
            />
            <Label htmlFor="lv-all-day" className="!mb-0 cursor-pointer">全天（默认）</Label>
          </div>
        )}

        <DateRangePicker
          value={range}
          onChange={(r) => { setRange(r); validateDates(); }}
          showTime={!allDay}
          disabled={readonly}
        />

        <div className="flex items-center justify-between bg-muted/30 rounded-md p-2.5 text-sm">
          <span className="text-muted-foreground">共</span>
          <span className="font-semibold text-foreground" data-testid="leave-total-days">
            {totalDays} 天
          </span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lv-reason">请假原因 *</Label>
          <Input
            id="lv-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请填写请假原因"
            disabled={readonly}
            data-testid="lv-reason"
          />
        </div>

        {canApprove && (
          <div className="space-y-1.5 pt-2 border-t border-border">
            <Label htmlFor="lv-reject-reason">拒绝原因（拒绝时必填）</Label>
            <Input
              id="lv-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="填写拒绝原因（通过时无需填写）"
              data-testid="lv-reject-reason"
            />
          </div>
        )}

        {leave && (leave.approverName || leave.rejectReason || leave.submitAt) && (
          <div className="text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-md p-3">
            {leave.submitAt && <p>提交时间：{leave.submitAt.slice(0, 16).replace('T', ' ')}</p>}
            {leave.approverName && <p>审批人：{leave.approverName}</p>}
            {leave.approveAt && <p>审批时间：{leave.approveAt.slice(0, 16).replace('T', ' ')}</p>}
            {leave.rejectReason && <p className="text-destructive">拒绝备注：{leave.rejectReason}</p>}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div>
            {canCancel && (
              <Button variant="ghost" onClick={handleCancel} disabled={submitting} data-testid="lv-cancel">
                <Ban className="w-4 h-4 mr-1 text-muted-foreground" />
                撤销申请
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {isView ? '关闭' : '取消'}
            </Button>
            {canApprove && (
              <>
                <Button variant="destructive" onClick={handleReject} disabled={submitting} data-testid="lv-reject">
                  <XCircle className="w-4 h-4 mr-1.5" />
                  拒绝
                </Button>
                <Button onClick={handleApprove} disabled={submitting} data-testid="lv-approve">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  通过
                </Button>
              </>
            )}
            {!isView && (
              <>
                <Button variant="outline" onClick={() => handleSave(true)} disabled={submitting} data-testid="lv-save-draft">
                  保存草稿
                </Button>
                <Button onClick={() => handleSave(false)} disabled={submitting} data-testid="lv-submit">
                  提交审批
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
