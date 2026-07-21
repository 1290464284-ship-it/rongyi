import { useState } from 'react';
import { Check } from 'lucide-react';
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
  FOLLOW_UP_PRIORITY_LABEL,
  FOLLOW_UP_PRIORITY_COLOR,
  type FollowUpAutoRule,
  type FollowUpPriority,
  type CreateFollowUpAutoRuleDto,
  type UpdateFollowUpAutoRuleDto,
} from '@/lib/follow-ups-v2';
import { useStaff } from '@/lib/staff';

export function CreateAutoRuleDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateFollowUpAutoRuleDto) => Promise<FollowUpAutoRule>;
}) {
  const { data: templates } = useFollowUpTemplates({ isEnabled: true, pageSize: 200 });
  const { data: staff } = useStaff();

  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<FollowUpAutoRule['triggerType']>('VISIT_COMPLETED');
  const [delayDays, setDelayDays] = useState(1);
  const [templateId, setTemplateId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState<FollowUpPriority>('MEDIUM');
  const [isEnabled, setIsEnabled] = useState(true);
  const [description, setDescription] = useState('');

  async function handleSubmit() {
    if (!name || !templateId) return;
    await onCreate({
      name,
      triggerType,
      delayDays,
      templateId,
      assigneeId: assigneeId || undefined,
      priority,
      isEnabled,
      description: description || undefined,
    });
    onClose();
    setName('');
    setTriggerType('VISIT_COMPLETED');
    setDelayDays(1);
    setTemplateId('');
    setAssigneeId('');
    setPriority('MEDIUM');
    setIsEnabled(true);
    setDescription('');
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>新建自动规则</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fu-rule-name">规则名称</Label>
            <Input
              id="fu-rule-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="请输入规则名称"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fu-rule-trigger">触发类型</Label>
              <Select
                id="fu-rule-trigger"
                value={triggerType}
                onChange={e => setTriggerType(e.target.value as FollowUpAutoRule['triggerType'])}
              >
                <option value="VISIT_COMPLETED">就诊完成后</option>
                <option value="TREATMENT">治疗完成后</option>
                <option value="DIAGNOSIS">确诊后</option>
                <option value="SCHEDULED">定时触发</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fu-rule-delay">延迟天数</Label>
              <Input
                id="fu-rule-delay"
                type="number"
                value={delayDays}
                onChange={e => setDelayDays(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fu-rule-template">回访模板</Label>
              <Select id="fu-rule-template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">请选择模板</option>
                {(templates?.items ?? []).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fu-rule-assignee">负责人</Label>
              <Select id="fu-rule-assignee" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                <option value="">请选择</option>
                {(staff ?? []).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-rule-priority">优先级</Label>
            <Select
              id="fu-rule-priority"
              value={priority}
              onChange={e => setPriority(e.target.value as FollowUpPriority)}
            >
              <option value="LOW">低</option>
              <option value="MEDIUM">中</option>
              <option value="HIGH">高</option>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label>启用规则</Label>
            <button
              onClick={() => setIsEnabled(!isEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-rule-description">描述</Label>
            <Textarea
              id="fu-rule-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="请输入规则描述"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!name || !templateId}>
              <Check className="w-4 h-4 mr-2" />
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditAutoRuleDialog({
  open,
  onClose,
  rule,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  rule: FollowUpAutoRule;
  onUpdate: (data: UpdateFollowUpAutoRuleDto) => Promise<FollowUpAutoRule>;
}) {
  const { data: templates } = useFollowUpTemplates({ isEnabled: true, pageSize: 200 });
  const { data: staff } = useStaff();

  const [name, setName] = useState(rule.name);
  const [triggerType, setTriggerType] = useState(rule.triggerType);
  const [delayDays, setDelayDays] = useState(rule.delayDays);
  const [templateId, setTemplateId] = useState(rule.templateId);
  const [assigneeId, setAssigneeId] = useState(rule.assigneeId || '');
  const [priority, setPriority] = useState<FollowUpPriority>(rule.priority || 'MEDIUM');
  const [isEnabled, setIsEnabled] = useState(rule.isEnabled);
  const [description, setDescription] = useState(rule.description || '');

  async function handleSubmit() {
    if (!name || !templateId) return;
    await onUpdate({
      name,
      triggerType,
      delayDays,
      templateId,
      assigneeId: assigneeId || undefined,
      priority,
      isEnabled,
      description: description || undefined,
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>编辑自动规则</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-rule-name">规则名称</Label>
            <Input
              id="edit-fu-rule-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="请输入规则名称"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-rule-trigger">触发类型</Label>
              <Select
                id="edit-fu-rule-trigger"
                value={triggerType}
                onChange={e => setTriggerType(e.target.value as FollowUpAutoRule['triggerType'])}
              >
                <option value="VISIT_COMPLETED">就诊完成后</option>
                <option value="TREATMENT">治疗完成后</option>
                <option value="DIAGNOSIS">确诊后</option>
                <option value="SCHEDULED">定时触发</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-rule-delay">延迟天数</Label>
              <Input
                id="edit-fu-rule-delay"
                type="number"
                value={delayDays}
                onChange={e => setDelayDays(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-rule-template">回访模板</Label>
              <Select id="edit-fu-rule-template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">请选择模板</option>
                {(templates?.items ?? []).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-rule-assignee">负责人</Label>
              <Select id="edit-fu-rule-assignee" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                <option value="">请选择</option>
                {(staff ?? []).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-rule-priority">优先级</Label>
            <Select
              id="edit-fu-rule-priority"
              value={priority}
              onChange={e => setPriority(e.target.value as FollowUpPriority)}
            >
              <option value="LOW">低</option>
              <option value="MEDIUM">中</option>
              <option value="HIGH">高</option>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label>启用规则</Label>
            <button
              onClick={() => setIsEnabled(!isEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-rule-description">描述</Label>
            <Textarea
              id="edit-fu-rule-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="请输入规则描述"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!name || !templateId}>
              <Check className="w-4 h-4 mr-2" />
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
