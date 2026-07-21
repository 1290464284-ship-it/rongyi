import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useFollowUpItems,
  FOLLOW_UP_ITEM_TYPE_LABEL,
  type FollowUpTemplate,
  type CreateFollowUpTemplateDto,
  type UpdateFollowUpTemplateDto,
} from '@/lib/follow-ups-v2';

export function CreateTemplateDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateFollowUpTemplateDto) => Promise<FollowUpTemplate>;
}) {
  const { data: allItems } = useFollowUpItems(undefined);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  function toggleItem(id: string) {
    if (selectedItemIds.includes(id)) {
      setSelectedItemIds(selectedItemIds.filter(i => i !== id));
    } else {
      setSelectedItemIds([...selectedItemIds, id]);
    }
  }

  async function handleSubmit() {
    if (!name) return;
    const items = (allItems?.items ?? [])
      .filter(item => selectedItemIds.includes(item.id))
      .map(({ id, templateId, ...rest }) => ({
        ...rest,
        sortOrder: selectedItemIds.indexOf(id),
      }));

    await onCreate({
      name,
      category: category || undefined,
      description: description || undefined,
      items,
    });
    onClose();
    setName('');
    setCategory('');
    setDescription('');
    setSelectedItemIds([]);
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>新建模板</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fu-tpl-name">模板名称</Label>
            <Input
              id="fu-tpl-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="请输入模板名称"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fu-tpl-category">类型分类</Label>
              <Input
                id="fu-tpl-category"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="如：术后回访、常规回访"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>包含项目（点击选择）</Label>
            <div className="border border-border rounded-md p-3 max-h-64 overflow-y-auto space-y-2">
              {(allItems?.items ?? []).length === 0 ? (
                <div className="text-center text-muted-foreground py-4">暂无项目，请先创建回访项目</div>
              ) : (
                (allItems?.items ?? []).map(item => (
                  <div
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                      selectedItemIds.includes(item.id)
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-muted/50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                        selectedItemIds.includes(item.id)
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground/30'
                      }`}>
                        {selectedItemIds.includes(item.id) && (
                          <Check className="w-3 h-3 text-primary-foreground" />
                        )}
                      </div>
                      <span className="font-medium">{item.name}</span>
                      <Badge className="border border-border text-muted-foreground text-xs">
                        {FOLLOW_UP_ITEM_TYPE_LABEL[item.type]}
                      </Badge>
                    </div>
                    {item.isRequired && (
                      <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs">
                        必填
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              已选择 {selectedItemIds.length} 个项目
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-tpl-description">描述</Label>
            <Textarea
              id="fu-tpl-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="请输入模板描述"
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

export function EditTemplateDialog({
  open,
  onClose,
  template,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  template: FollowUpTemplate;
  onUpdate: (data: UpdateFollowUpTemplateDto) => Promise<FollowUpTemplate>;
}) {
  const { data: allItems } = useFollowUpItems(undefined);

  const [name, setName] = useState(template.name);
  const [category, setCategory] = useState(template.category || '');
  const [description, setDescription] = useState(template.description || '');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(
    (template.items ?? []).map(i => i.id),
  );

  function toggleItem(id: string) {
    if (selectedItemIds.includes(id)) {
      setSelectedItemIds(selectedItemIds.filter(i => i !== id));
    } else {
      setSelectedItemIds([...selectedItemIds, id]);
    }
  }

  async function handleSubmit() {
    if (!name) return;
    const items = (allItems?.items ?? [])
      .filter(item => selectedItemIds.includes(item.id))
      .map(({ id, templateId, ...rest }) => ({
        ...rest,
        sortOrder: selectedItemIds.indexOf(id),
      }));

    await onUpdate({
      name,
      category: category || undefined,
      description: description || undefined,
      items,
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>编辑模板</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-tpl-name">模板名称</Label>
            <Input
              id="edit-fu-tpl-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="请输入模板名称"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-fu-tpl-category">类型分类</Label>
              <Input
                id="edit-fu-tpl-category"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="如：术后回访、常规回访"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>包含项目（点击选择）</Label>
            <div className="border border-border rounded-md p-3 max-h-64 overflow-y-auto space-y-2">
              {(allItems?.items ?? []).length === 0 ? (
                <div className="text-center text-muted-foreground py-4">暂无项目</div>
              ) : (
                (allItems?.items ?? []).map(item => (
                  <div
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                      selectedItemIds.includes(item.id)
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-muted/50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                        selectedItemIds.includes(item.id)
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground/30'
                      }`}>
                        {selectedItemIds.includes(item.id) && (
                          <Check className="w-3 h-3 text-primary-foreground" />
                        )}
                      </div>
                      <span className="font-medium">{item.name}</span>
                      <Badge className="border border-border text-muted-foreground text-xs">
                        {FOLLOW_UP_ITEM_TYPE_LABEL[item.type]}
                      </Badge>
                    </div>
                    {item.isRequired && (
                      <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs">
                        必填
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              已选择 {selectedItemIds.length} 个项目
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-fu-tpl-description">描述</Label>
            <Textarea
              id="edit-fu-tpl-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="请输入模板描述"
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
