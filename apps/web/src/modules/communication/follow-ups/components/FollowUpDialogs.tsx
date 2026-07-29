import { useState, useEffect } from 'react';
import { Check, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useFollowUpTemplates,
  type FollowUpV2,
  type FollowUpPriority,
  type CreateFollowUpV2Dto,
  type UpdateFollowUpV2Dto,
  type CompleteFollowUpV2Dto,
} from '@/lib/api/communication/follow-ups';
import { useStaff } from '@/lib/staff';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { DROPDOWN_MAX_PAGE_SIZE } from '@/config/constants';

export function CreateFollowUpDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateFollowUpV2Dto) => Promise<FollowUpV2>;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const { data: staff } = useStaff();
  const { data: templates } = useFollowUpTemplates({ isEnabled: true, pageSize: DROPDOWN_MAX_PAGE_SIZE });

  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<FollowUpPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  useEffect(() => {
    if (open) {
      setPatientId('');
      setPatientName('');
      setTemplateId('');
      setAssigneeId('');
      setTitle('');
      setDescription('');
      setPriority('MEDIUM');
      setDueDate('');
    }
  }, [open]);

  async function handleSubmit() {
    if (!patientId || !title || !dueDate) return;
    await onCreate({
      patientId,
      templateId: templateId || undefined,
      assigneeId: assigneeId || undefined,
      title,
      description: description || undefined,
      priority,
      dueDate,
    });
    onClose();
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建回访</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>患者</Label>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <Users className="w-4 h-4 mr-2" />
                {patientName || '请选择患者'}
              </Button>
            </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-title">回访标题</Label>
            <Input
              id="fu-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="请输入回访标题"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fu-template">回访模板</Label>
              <Select id="fu-template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">自定义</option>
                {(templates?.items ?? []).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fu-assignee">负责人</Label>
              <Select id="fu-assignee" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                <option value="">请选择</option>
                {(staff ?? []).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fu-due-date">计划时间</Label>
              <Input
                id="fu-due-date"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fu-priority">优先级</Label>
              <Select
                id="fu-priority"
                value={priority}
                onChange={e => setPriority(e.target.value as FollowUpPriority)}
              >
                <option value="LOW">低</option>
                <option value="MEDIUM">中</option>
                <option value="HIGH">高</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-description">备注</Label>
            <Textarea
              id="fu-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="请输入备注信息"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!patientId || !title || !dueDate}>
              <Check className="w-4 h-4 mr-2" />
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
      <PatientSelector
        open={openSelector}
        onClose={() => setOpenSelector(false)}
        onSelect={handleSelectPatient}
        title="选择患者"
      />
    </>
  );
}

export function EditFollowUpDialog({
  open,
  onClose,
  followUp,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  followUp: FollowUpV2;
  onUpdate: (data: UpdateFollowUpV2Dto) => Promise<FollowUpV2>;
}) {
  const { data: staff } = useStaff();

  const [title, setTitle] = useState(followUp.title);
  const [assigneeId, setAssigneeId] = useState(followUp.assigneeId || '');
  const [priority, setPriority] = useState<FollowUpPriority>(followUp.priority);
  const [dueDate, setDueDate] = useState(followUp.dueDate?.split('T')[0] || '');
  const [description, setDescription] = useState(followUp.description || '');

  async function handleSubmit() {
    if (!title || !dueDate) return;
    await onUpdate({
      title,
      assigneeId: assigneeId || undefined,
      priority,
      dueDate,
      description: description || undefined,
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>编辑回访</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>患者</Label>
            <Input value={followUp.patient?.name || ''} disabled />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-title">回访标题</Label>
            <Input
              id="edit-fu-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="请输入回访标题"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-assignee">负责人</Label>
              <Select id="edit-fu-assignee" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                <option value="">请选择</option>
                {(staff ?? []).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-priority">优先级</Label>
              <Select
                id="edit-fu-priority"
                value={priority}
                onChange={e => setPriority(e.target.value as FollowUpPriority)}
              >
                <option value="LOW">低</option>
                <option value="MEDIUM">中</option>
                <option value="HIGH">高</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-due-date">计划时间</Label>
            <Input
              id="edit-fu-due-date"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-description">备注</Label>
            <Textarea
              id="edit-fu-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="请输入备注信息"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!title || !dueDate}>
              <Check className="w-4 h-4 mr-2" />
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CompleteFollowUpDialog({
  open,
  onClose,
  followUp,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  followUp: FollowUpV2;
  onComplete: (data: CompleteFollowUpV2Dto) => Promise<FollowUpV2>;
}) {
  const [npsScore, setNpsScore] = useState(10);
  const [resultText, setResultText] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');

  async function handleSubmit() {
    await onComplete({
      results: followUp.template?.items?.map(item => ({
        itemId: item.id,
        value: item.type === 'NUMBER' ? npsScore.toString() : resultText,
      })),
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>完成回访</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">患者</div>
              <div className="font-medium">{followUp.patient?.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">回访类型</div>
              <div className="font-medium">{followUp.template?.name || '自定义'}</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>NPS 评分（0-10分）</Label>
            <div className="flex gap-2">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                <button
                  key={score}
                  onClick={() => setNpsScore(score)}
                  className={`w-9 h-9 rounded-md text-sm font-medium transition-colors ${
                    npsScore === score
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>不满意</span>
              <span>非常满意</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="complete-fu-result">回访内容</Label>
            <Textarea
              id="complete-fu-result"
              value={resultText}
              onChange={e => setResultText(e.target.value)}
              placeholder="请输入回访内容和患者反馈"
              rows={4}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="complete-fu-next-date">下次回访时间（可选）</Label>
            <Input
              id="complete-fu-next-date"
              type="date"
              value={nextFollowUpDate}
              onChange={e => setNextFollowUpDate(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit}>
              <Check className="w-4 h-4 mr-2" />
              完成回访
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
