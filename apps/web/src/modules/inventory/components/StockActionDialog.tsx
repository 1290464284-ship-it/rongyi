import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { InventoryItem } from '@/lib/api/inventory/inventory';

export interface StockFormState {
  type: string;
  quantity: string;
  unitPrice: string;
  remark: string;
}

export function StockActionDialog({
  target,
  onClose,
  form,
  setForm,
  onSubmit,
  saving,
}: {
  target: InventoryItem | null;
  onClose: () => void;
  form: StockFormState;
  setForm: (form: StockFormState) => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open={!!target} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>出入库操作</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        {target && (
          <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">物品</span>
              <span className="font-medium">
                {target.name} ({target.code})
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-muted-foreground">当前库存</span>
              <span className="font-semibold text-primary">
                {target.stock} {target.unit}
              </span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="stock-type">类型</Label>
            <Select
              id="stock-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="IN">入库</option>
              <option value="OUT">出库</option>
              <option value="ADJUST">调整</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock-quantity">数量 *</Label>
            <Input
              id="stock-quantity"
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stock-unit-price">单价 (元)</Label>
          <Input
            id="stock-unit-price"
            type="number"
            min="0"
            step="0.01"
            value={form.unitPrice}
            onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stock-remark">备注</Label>
          <Textarea
            id="stock-remark"
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
          <LoadingButton onClick={onSubmit} loading={saving} loadingText="提交中…">
            确认
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
