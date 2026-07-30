import { useState, useMemo } from 'react';
import { Plus, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type ChargeCombo, type CreateChargeComboDto } from '@/lib/api/financial/charge-v2';

export const COMBO_CATEGORIES = [
  '基础治疗',
  '修复治疗',
  '正畸治疗',
  '种植治疗',
  '美白治疗',
  '儿童牙科',
  '其他',
];

interface ComboItemInput {
  id: string;
  name: string;
  category: string;
  price: string;
  quantity: number;
}

export function ComboDialog({
  open,
  onClose,
  combo,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  combo?: ChargeCombo;
  onSubmit: (data: CreateChargeComboDto) => Promise<void>;
}) {
  const [name, setName] = useState(combo?.name ?? '');
  const [category, setCategory] = useState(combo?.category ?? COMBO_CATEGORIES[0]);
  const [description, setDescription] = useState(combo?.description ?? '');
  const [isActive, setIsActive] = useState(combo?.isActive ?? true);
  const [items, setItems] = useState<ComboItemInput[]>(
    combo?.items?.length
      ? combo.items.map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          price: String(i.price),
          quantity: i.quantity,
        }))
      : [{ id: '1', name: '', category: '', price: '0', quantity: 1 }],
  );

  const totalPrice = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    [items],
  );

  function addItem() {
    setItems([
      ...items,
      { id: Date.now().toString(), name: '', category: '', price: '0', quantity: 1 },
    ]);
  }

  function removeItem(id: string) {
    if (items.length === 1) return;
    setItems(items.filter((i) => i.id !== id));
  }

  function updateItem(
    id: string,
    field: keyof ComboItemInput,
    value: ComboItemInput[keyof ComboItemInput],
  ) {
    setItems(items.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  async function handleSubmit() {
    if (!name || items.some((i) => !i.name || Number(i.price) <= 0)) return;
    await onSubmit({
      name,
      category,
      description,
      discountPrice: totalPrice,
      items: items.map(({ id: _id, price, ...rest }) => ({
        ...rest,
        price: Number(price),
      })),
    });
  }

  const isValid = name && items.every((i) => i.name && Number(i.price) > 0 && i.quantity > 0);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{combo ? '编辑收费组合' : '新建收费组合'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="combo-name">组合名称</Label>
              <Input
                id="combo-name"
                placeholder="请输入组合名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="combo-category">分类</Label>
              <Select id="combo-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {COMBO_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="combo-description">描述</Label>
            <Textarea
              id="combo-description"
              placeholder="请输入组合描述（可选）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>启用状态</Label>
              <p className="text-xs text-muted-foreground">停用后将无法在收费时选择此组合</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsActive(!isActive)}
              className={isActive ? 'bg-success/10 text-success border-success/30' : ''}
            >
              {isActive ? '已启用' : '已停用'}
            </Button>
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <Label>包含项目</Label>
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3 h-3 mr-1" /> 添加项目
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 border border-border rounded-md"
                >
                  <span className="text-sm text-muted-foreground w-6">{idx + 1}</span>
                  <Input
                    placeholder="项目名称"
                    value={item.name}
                    onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="类别"
                    value={item.category}
                    onChange={(e) => updateItem(item.id, 'category', e.target.value)}
                    className="w-24"
                  />
                  <Input
                    type="number"
                    placeholder="单价"
                    value={item.price || ''}
                    onChange={(e) => updateItem(item.id, 'price', e.target.value)}
                    className="w-24"
                  />
                  <Input
                    type="number"
                    placeholder="数量"
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(item.id, 'quantity', Number(e.target.value))
                    }
                    className="w-20"
                  />
                  <span className="text-sm w-20 text-right">
                    ¥{(Number(item.price) * item.quantity).toFixed(2)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                    aria-label="删除"
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <div className="flex justify-between font-semibold text-lg">
              <span>总价（原价）</span>
              <span className="text-primary">¥{totalPrice.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!isValid}>
              <Check className="w-4 h-4 mr-2" />
              {combo ? '保存修改' : '创建组合'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
