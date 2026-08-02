import { useState, useEffect, useRef } from 'react';
import { AlertCircle, Plus, Edit2, Trash2 } from 'lucide-react';
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
  SHIFT_TYPE,
  SHIFT_TYPE_SHORT,
  type ShiftType,
  type ScheduleItem,
  type CreateScheduleDto,
  type UpdateScheduleDto,
  hashColor,
} from '@/lib/api/system/hr';
import { useStaff } from '@/lib/staff';
import {
  DateRangePicker,
  combineDateTime,
  splitDateTime,
  type DateRangePickerValue,
} from './DateRangePicker';

const COLOR_PRESETS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

const REPEAT_OPTIONS = [
  { value: 'NONE', label: '不重复' },
  { value: 'WEEKLY_MON', label: '每周一' },
  { value: 'WEEKLY_MON_WED_FRI', label: '每周一、三、五' },
  { value: 'WEEKLY_ALL', label: '每周循环' },
];

export interface ScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  initialDate?: string;
  schedule?: ScheduleItem | null;
  onSubmit: (data: CreateScheduleDto) => Promise<ScheduleItem>;
  onUpdate?: (payload: { id: string; data: UpdateScheduleDto }) => Promise<ScheduleItem>;
  onDelete?: (id: string) => Promise<void>;
  conflictError?: string | null;
}

export function ScheduleDialog({
  open,
  onClose,
  initialDate,
  schedule,
  onSubmit,
  onUpdate,
  onDelete,
  conflictError,
}: ScheduleDialogProps) {
  const { data: staff = [] } = useStaff();
  const doctors = staff.filter((s) => s.role === 'DOCTOR' || s.role === 'RECEPTIONIST');
  // doctors 每次渲染都是新数组引用，不能作为 useEffect 依赖（会无限循环渲染）；
  // 通过 ref 保持最新值，effect 仅在 open/schedule/initialDate 变化时执行
  const doctorsRef = useRef(doctors);
  doctorsRef.current = doctors;

  const [userId, setUserId] = useState('');
  const [shiftType, setShiftType] = useState<ShiftType>('FULL');
  const [range, setRange] = useState<DateRangePickerValue>({
    startDate: '', startTime: '09:00', endDate: '', endTime: '18:00',
  });
  const [note, setNote] = useState('');
  const [repeatRule, setRepeatRule] = useState('NONE');
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [submitting, setSubmitting] = useState(false);

  const isEdit = !!schedule;

  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setUserId(schedule.userId);
      setShiftType(schedule.shiftType);
      const s = splitDateTime(schedule.startAt);
      const e = splitDateTime(schedule.endAt);
      setRange({
        startDate: s.date, startTime: s.time,
        endDate: e.date, endTime: e.time,
      });
      setNote(schedule.note || '');
      setRepeatRule(schedule.repeatRule || 'NONE');
      setColor(schedule.color);
    } else {
      setUserId(doctorsRef.current[0]?.id || '');
      setShiftType('FULL');
      const d = initialDate || new Date().toISOString().slice(0, 10);
      setRange({
        startDate: d, startTime: '09:00',
        endDate: d, endTime: '18:00',
      });
      setNote('');
      setRepeatRule('NONE');
      setColor(doctorsRef.current[0]?.id ? hashColor(doctorsRef.current[0].id) : COLOR_PRESETS[0]);
    }
  }, [open, schedule, initialDate]);

  useEffect(() => {
    if (userId && !isEdit) {
      setColor(hashColor(userId));
    }
  }, [userId, isEdit]);

  async function handleSave() {
    if (!userId || !range.startDate || !range.endDate) return;
    const startAt = combineDateTime(range.startDate, range.startTime);
    const endAt = combineDateTime(range.endDate, range.endTime);
    if (new Date(startAt) >= new Date(endAt)) return;

    setSubmitting(true);
    try {
      const dto: CreateScheduleDto = {
        userId, shiftType, startAt, endAt, note,
        repeatRule: repeatRule === 'NONE' ? undefined : repeatRule,
        color,
      };
      if (isEdit && onUpdate && schedule) {
        await onUpdate({ id: schedule.id, data: dto });
      } else {
        await onSubmit(dto);
      }
      onClose();
    } catch {
      // 错误由外层（如 HrPage 的冲突检测 toast）处理
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!schedule || !onDelete) return;
    if (!confirm(`确定删除 ${schedule.userName} 的这个班次？`)) return;
    await onDelete(schedule.id);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {isEdit ? (
            <><Edit2 className="w-4 h-4" /> 编辑班次</>
          ) : (
            <><Plus className="w-4 h-4" /> 新建班次</>
          )}
          {schedule && (
            <Badge className="ml-2">{SHIFT_TYPE[schedule.shiftType]}</Badge>
          )}
        </DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        {conflictError && (
          <div className="rounded-md bg-destructive/10 text-destructive p-3 flex items-start gap-2" data-testid="conflict-alert">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">排班冲突</p>
              <p className="text-xs mt-0.5">{conflictError}</p>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="sch-user">人员 *</Label>
          <Select
            id="sch-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            data-testid="sch-user-select"
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}（{d.role === 'DOCTOR' ? '医生' : '前台'}）</option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label>班次类型 *</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" data-testid="shift-type-radio">
            {(Object.keys(SHIFT_TYPE) as ShiftType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={shiftType === t}
                onClick={() => setShiftType(t)}
                className={
                  'px-3 py-1.5 rounded-md border text-sm transition ' +
                  (shiftType === t
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border bg-white hover:border-primary/40')
                }
                data-testid={`shift-type-${t}`}
              >
                <span className="font-medium mr-1.5">{SHIFT_TYPE_SHORT[t]}</span>
                {SHIFT_TYPE[t]}
              </button>
            ))}
          </div>
        </div>

        <DateRangePicker value={range} onChange={setRange} />

        <div className="space-y-1.5">
          <Label htmlFor="sch-repeat">重复规则</Label>
          <Select id="sch-repeat" value={repeatRule} onChange={(e) => setRepeatRule(e.target.value)}>
            {REPEAT_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label>颜色</Label>
          <div className="flex items-center gap-3 flex-wrap">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`预设色${c}`}
                className={
                  'w-7 h-7 rounded-full border-2 transition ' +
                  (color === c ? 'border-primary scale-110' : 'border-transparent')
                }
                style={{ background: c }}
                data-testid={`color-preset-${c.replace('#', '')}`}
              />
            ))}
            <Input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-9 p-1 rounded cursor-pointer"
              data-testid="color-picker"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sch-note">备注</Label>
          <Input
            id="sch-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="选填"
            data-testid="sch-note"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div>
            {isEdit && onDelete && (
              <Button variant="ghost" onClick={handleDelete} disabled={submitting} data-testid="sch-delete">
                <Trash2 className="w-4 h-4 mr-1 text-destructive" />
                <span className="text-destructive">删除</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
            <Button
              onClick={handleSave}
              disabled={submitting || !userId || !range.startDate || !range.endDate}
              data-testid="sch-save"
            >
              {isEdit ? '保存修改' : '创建班次'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
