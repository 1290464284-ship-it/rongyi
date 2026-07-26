import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface FormState {
  code: string;
  name: string;
  spec: string;
  category: string;
  unit: string;
  stock: string;
  minStock: string;
  price: string;
  supplierId: string;
  expireDate: string;
  location: string;
  remark: string;
}

export const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  spec: '',
  category: '',
  unit: '',
  stock: '0',
  minStock: '0',
  price: '0',
  supplierId: '',
  expireDate: '',
  location: '',
  remark: '',
};

export function ItemFormDialog({
  open,
  onClose,
  isEditing,
  form,
  setForm,
  categories,
  suppliers,
  onSubmit,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  isEditing: boolean;
  form: FormState;
  setForm: (form: FormState) => void;
  categories: string[];
  suppliers: { id: string; name: string }[];
  onSubmit: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEditing ? '编辑库存物品' : '新建库存物品'}</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="inv-code">编码 *</Label>
            <Input
              id="inv-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="如 RV001"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-name">名称 *</Label>
            <Input
              id="inv-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如 一次性手套"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-spec">规格</Label>
            <Input
              id="inv-spec"
              value={form.spec}
              onChange={(e) => setForm({ ...form, spec: e.target.value })}
              placeholder="可选"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-category">分类 *</Label>
            <Input
              id="inv-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="如 耗材"
              list="inv-category-list"
            />
            <datalist id="inv-category-list">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-unit">单位 *</Label>
            <Input
              id="inv-unit"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="如 个/盒"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-supplier">供应商</Label>
            <Select
              id="inv-supplier"
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            >
              <option value="">无</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-stock">初始库存</Label>
            <Input
              id="inv-stock"
              type="number"
              min="0"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              disabled={isEditing}
              placeholder="0"
            />
            {isEditing && (
              <p className="text-xs text-muted-foreground">库存通过出入库操作调整</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-min-stock">最低库存</Label>
            <Input
              id="inv-min-stock"
              type="number"
              min="0"
              value={form.minStock}
              onChange={(e) => setForm({ ...form, minStock: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-price">单价 (元)</Label>
            <Input
              id="inv-price"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-expire-date">有效期</Label>
            <Input
              id="inv-expire-date"
              type="date"
              value={form.expireDate}
              onChange={(e) => setForm({ ...form, expireDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-location">位置</Label>
            <Input
              id="inv-location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="可选"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-remark">备注</Label>
          <Textarea
            id="inv-remark"
            rows={2}
            value={form.remark}
            onChange={(e) => setForm({ ...form, remark: e.target.value })}
            placeholder="可选"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <LoadingButton onClick={onSubmit} loading={saving} loadingText="保存中…">
            保存
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
