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
  type FollowUpItem,
  type CreateFollowUpItemDto,
  type UpdateFollowUpItemDto,
} from '@/lib/follow-ups-v2';

export function CreateItemDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateFollowUpItemDto) => Promise<FollowUpItem>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<FollowUpItem['type']>('TEXT');
  const [isRequired, setIsRequired] = useState(false);
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState('');
  const [sortOrder, setSortOrder] = useState(0);

  async function handleSubmit() {
    if (!name) return;
    await onCreate({
      name,
      type,
      isRequired,
      description: description || undefined,
      sortOrder,
      options: type === 'SINGLE_SELECT' || type === 'MULTI_SELECT'
        ? options.split('\n').filter(Boolean)
        : undefined,
    });
    onClose();
    setName('');
    setType('TEXT');
    setIsRequired(false);
    setDescription('');
    setOptions('');
    setSortOrder(0);
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>新建回访项目</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fu-item-name">项目名称</Label>
            <Input
              id="fu-item-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="请输入项目名称"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fu-item-type">项目类型</Label>
              <Select
                id="fu-item-type"
                value={type}
                onChange={e => setType(e.target.value as FollowUpItem['type'])}
              >
                <option value="TEXT">文本</option>
                <option value="SINGLE_SELECT">单选</option>
                <option value="MULTI_SELECT">多选</option>
                <option value="NUMBER">数字</option>
                <option value="DATE">日期</option>
                <option value="BOOLEAN">是/否</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fu-item-sort">排序</Label>
              <Input
                id="fu-item-sort"
                type="number"
                value={sortOrder}
                onChange={e => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>

          {(type === 'SINGLE_SELECT' || type === 'MULTI_SELECT') && (
            <div className="space-y-1.5">
              <Label htmlFor="fu-item-options">选项（每行一个）</Label>
              <Textarea
                id="fu-item-options"
                value={options}
                onChange={e => setOptions(e.target.value)}
                placeholder="选项1&#10;选项2&#10;选项3"
                rows={4}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label>是否必填</Label>
            <button
              onClick={() => setIsRequired(!isRequired)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isRequired ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isRequired ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-item-description">描述</Label>
            <Textarea
              id="fu-item-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="请输入项目描述"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!name}>
              <Check className="w-4 h-4 mr-2" />
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditItemDialog({
  open,
  onClose,
  item,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  item: FollowUpItem;
  onUpdate: (data: UpdateFollowUpItemDto) => Promise<FollowUpItem>;
}) {
  const [name, setName] = useState(item.name);
  const [type, setType] = useState<FollowUpItem['type']>(item.type);
  const [isRequired, setIsRequired] = useState(item.isRequired);
  const [description, setDescription] = useState(item.description || '');
  const [options, setOptions] = useState((item.options ?? []).join('\n'));
  const [sortOrder, setSortOrder] = useState(item.sortOrder);

  async function handleSubmit() {
    if (!name) return;
    await onUpdate({
      name,
      type,
      isRequired,
      description: description || undefined,
      sortOrder,
      options: type === 'SINGLE_SELECT' || type === 'MULTI_SELECT'
        ? options.split('\n').filter(Boolean)
        : undefined,
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>编辑回访项目</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-item-name">项目名称</Label>
            <Input
              id="edit-fu-item-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="请输入项目名称"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-item-type">项目类型</Label>
              <Select
                id="edit-fu-item-type"
                value={type}
                onChange={e => setType(e.target.value as FollowUpItem['type'])}
              >
                <option value="TEXT">文本</option>
                <option value="SINGLE_SELECT">单选</option>
                <option value="MULTI_SELECT">多选</option>
                <option value="NUMBER">数字</option>
                <option value="DATE">日期</option>
                <option value="BOOLEAN">是/否</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-item-sort">排序</Label>
              <Input
                id="edit-fu-item-sort"
                type="number"
                value={sortOrder}
                onChange={e => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>

          {(type === 'SINGLE_SELECT' || type === 'MULTI_SELECT') && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-item-options">选项（每行一个）</Label>
              <Textarea
                id="edit-fu-item-options"
                value={options}
                onChange={e => setOptions(e.target.value)}
                placeholder="选项1&#10;选项2&#10;选项3"
                rows={4}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label>是否必填</Label>
            <button
              onClick={() => setIsRequired(!isRequired)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isRequired ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isRequired ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-item-description">描述</Label>
            <Textarea
              id="edit-fu-item-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="请输入项目描述"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!name}>
              <Check className="w-4 h-4 mr-2" />
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
