import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { ProcessingProduct } from '@/lib/api/inventory/processing-orders';

interface ProductDialogProps {
  open: boolean;
  onClose: () => void;
  editing: ProcessingProduct | null;
  factoryId: string;
  onSubmit: (data: Partial<ProcessingProduct>) => Promise<void>;
}

export function ProductDialog({ open, onClose, editing, factoryId, onSubmit }: ProductDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [remark, setRemark] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setCategory(editing.code || '');
      setPrice(String(editing.price));
      setUnit(editing.unit || '');
      setRemark(editing.remark || '');
    } else {
      setName('');
      setCategory('');
      setPrice('');
      setUnit('');
      setRemark('');
    }
  }, [editing, open]);

  const handleSubmit = async () => {
    if (!name) { toast.error('请输入名称'); return; }
    if (!price) { toast.error('请输入价格'); return; }
    await onSubmit({
      factoryId: editing?.factoryId || factoryId,
      name,
      code: category,
      price: parseFloat(price) || 0,
      unit,
      remark,
    });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{editing ? '编辑产品' : '新增产品'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product-name">产品名称 *</Label>
            <Input id="product-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="product-category">分类</Label>
              <Input id="product-category" value={category} onChange={e => setCategory(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-price">价格 *</Label>
              <Input id="product-price" type="number" value={price} onChange={e => setPrice(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-unit">单位</Label>
            <Input id="product-unit" value={unit} onChange={e => setUnit(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-remark">备注</Label>
            <Input id="product-remark" value={remark} onChange={e => setRemark(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit}>{editing ? '保存' : '创建'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
