import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import {
  useFollowUpsV2 as usePatientFollowUps,
  useCreateFollowUpV2 as useCreateFollowUp,
  useUpdateFollowUpV2 as useUpdateFollowUp,
  FOLLOW_UP_STATUS_LABEL,
  FOLLOW_UP_STATUS_COLOR,
  type FollowUpV2,
} from '@/lib/api/communication/follow-ups';
import { useStaff } from '@/lib/staff';
import { formatDate } from '@/lib/utils';
import { Plus } from 'lucide-react';

export function FollowUpPanel({ patientId }: { patientId: string }) {
  const { data: fuData } = usePatientFollowUps({ patientId });
  const followUps = fuData?.items ?? [];
  const { data: staff = [] } = useStaff();
  const createFu = useCreateFollowUp();
  const updateFu = useUpdateFollowUp();
  const [open, setOpen] = useState(false);
  const [planDate, setPlanDate] = useState('');
  const [content, setContent] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const submit = async () => {
    if (!planDate) return;
    await createFu.mutateAsync({ patientId, followUpDate: planDate, content: content || '' });
    setOpen(false);
    setPlanDate('');
    setContent('');
    setAssigneeId('');
  };

  const doctors = staff.filter((s) => s.role === 'DOCTOR' || s.role === 'BOSS');

  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">随访记录</h2>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新建随访</Button>
      </div>
      {followUps.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">暂无随访记录</p>
      ) : (
        <div className="space-y-2">
          {followUps.map((fu: FollowUpV2) => (
            <div key={fu.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Badge className={FOLLOW_UP_STATUS_COLOR[fu.status as keyof typeof FOLLOW_UP_STATUS_COLOR] ?? 'bg-muted text-muted-foreground'}>
                    {FOLLOW_UP_STATUS_LABEL[fu.status as keyof typeof FOLLOW_UP_STATUS_LABEL] ?? fu.status}
                  </Badge>
                  <span className="text-sm font-medium">{fu.planDate ? formatDate(fu.planDate) : '-'}</span>
                </div>
                {fu.status === 'PENDING' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={updateFu.isPending} onClick={() => updateFu.mutate({ id: fu.id, data: { status: 'COMPLETED' } })}>完成</Button>
                    <Button size="sm" variant="ghost" disabled={updateFu.isPending} onClick={() => updateFu.mutate({ id: fu.id, data: { status: 'CANCELLED' } })}>取消</Button>
                  </div>
                )}
              </div>
              {fu.content && <p className="text-sm text-foreground mb-1">{fu.content}</p>}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {fu.assigneeName && <span>负责人：{fu.assigneeName}</span>}
                {fu.result && <span>结果：{fu.result}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} className="max-w-md">
        <DialogHeader><DialogTitle>新建随访</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plan-date">计划日期 *</Label>
              <Input id="plan-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="follow-up-content">随访内容</Label>
              <Textarea id="follow-up-content" value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="随访事项..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assignee">负责人</Label>
              <Select id="assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full">
                <option value="">不指定</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button disabled={!planDate || createFu.isPending} onClick={submit}>创建</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
