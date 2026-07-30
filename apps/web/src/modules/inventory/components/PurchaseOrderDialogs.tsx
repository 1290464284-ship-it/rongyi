import { useState, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  type PurchaseOrder,
} from '@/lib/api/inventory/purchase-orders';
import { formatDateTime } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待收货',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning',
  RECEIVED: 'bg-success/10 text-success',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export { STATUS_LABEL, STATUS_CLASS };

interface OrderLine {
  itemId: string;
  name: string;
  spec: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_LINE: OrderLine = { itemId: '', name: '', spec: '', quantity: '1', unitPrice: '0' };

export function CreateOrderDialog({
  open,
  onClose,
  suppliers,
  invItems,
  onCreate,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  suppliers: { id: string; name: string }[];
  invItems: { id: string; name: string; code: string; spec?: string; price?: number }[];
  onCreate: (payload: {
    supplierId: string;
    remark?: string;
    items: { itemId: string; name: string; spec: string; quantity: number; unitPrice: string }[];
  }) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({ supplierId: '', remark: '' });
  const [lines, setLines] = useState<OrderLine[]>([{ ...EMPTY_LINE }]);

  const totalAmount = useMemo(() => {
    return lines.reduce((sum, l) => {
      const q = parseFloat(l.quantity) || 0;
      const p = parseFloat(l.unitPrice) || 0;
      return sum + q * p;
    }, 0);
  }, [lines]);

  const handleAddLine = () => setLines([...lines, { ...EMPTY_LINE }]);
  const handleRemoveLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const handleLineChange = (idx: number, patch: Partial<OrderLine>) =>
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const handleLineItemSelect = (idx: number, itemId: string) => {
    if (!itemId) {
      handleLineChange(idx, { itemId: '', name: '', spec: '', unitPrice: '0' });
      return;
    }
    const item = invItems.find((i) => i.id === itemId);
    if (item) {
      handleLineChange(idx, {
        itemId,
        name: item.name,
        spec: item.spec ?? '',
        unitPrice: String(item.price ?? 0),
      });
    }
  };

  const handleCreate = () => {
    if (!form.supplierId) return;
    const validLines = lines.filter((l) => l.name.trim() && (parseFloat(l.quantity) || 0) > 0);
    if (validLines.length === 0) return;
    onCreate({
      supplierId: form.supplierId,
      remark: form.remark.trim() || undefined,
      items: validLines.map((l) => ({
        itemId: l.itemId || '',
        name: l.name.trim(),
        spec: l.spec.trim() || '',
        quantity: parseFloat(l.quantity),
        unitPrice: (parseFloat(l.unitPrice) || 0).toString(),
      })),
    });
  };

  // Reset form when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setForm({ supplierId: '', remark: '' });
      setLines([{ ...EMPTY_LINE }]);
    }
    if (!isOpen) onClose();
  };

  return (
    <Dialog open={open} onClose={() => handleOpenChange(false)} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>新建采购订单</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="po-supplier">供应商 *</Label>
            <Select
              id="po-supplier"
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            >
              <option value="">请选择</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-remark">备注</Label>
            <Input
              id="po-remark"
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              placeholder="可选"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>明细</Label>
            <Button variant="outline" size="sm" onClick={handleAddLine}>
              <Plus className="h-4 w-4 mr-1" />添加
            </Button>
          </div>
          <div className="rounded-md border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>物品</TableHead>
                  <TableHead className="w-24 text-right">数量</TableHead>
                  <TableHead className="w-28 text-right">单价</TableHead>
                  <TableHead className="w-28 text-right">小计</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <div className="space-y-1">
                        <Select
                          value={l.itemId}
                          onChange={(e) => handleLineItemSelect(idx, e.target.value)}
                          className="w-full"
                        >
                          <option value="">手动输入</option>
                          {invItems.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.code})
                            </option>
                          ))}
                        </Select>
                        <Input
                          value={l.name}
                          onChange={(e) => handleLineChange(idx, { name: e.target.value })}
                          placeholder="物品名称"
                        />
                        <Input
                          value={l.spec}
                          onChange={(e) => handleLineChange(idx, { spec: e.target.value })}
                          placeholder="规格（可选）"
                          className="text-xs"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="align-top pt-2">
                      <Input
                        type="number"
                        min="1"
                        value={l.quantity}
                        onChange={(e) => handleLineChange(idx, { quantity: e.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell className="align-top pt-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.unitPrice}
                        onChange={(e) => handleLineChange(idx, { unitPrice: e.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right align-top font-medium pt-3">
                      ¥{((parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0)).toFixed(2)}
                    </TableCell>
                    <TableCell className="align-top pt-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveLine(idx)}
                        disabled={lines.length <= 1}
                        className="text-destructive hover:text-destructive"
                        title="删除"
                        aria-label="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end">
            <div className="text-sm">
              合计：<span className="text-lg font-semibold text-primary">¥{totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <LoadingButton onClick={handleCreate} loading={isPending} loadingText="创建中…">
            创建订单
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReceiveDialog({
  target,
  onClose,
  onReceive,
  isPending,
}: {
  target: PurchaseOrder | null;
  onClose: () => void;
  onReceive: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={!!target} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>确认收货</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        <p className="text-sm">
          确认收到采购订单 <span className="font-medium font-mono">{target?.number}</span>
          （{target?.supplierName}）的货物吗？收货后将自动入库。
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <LoadingButton
            onClick={onReceive}
            loading={isPending}
            loadingText="处理中…"
            className="bg-success hover:bg-success/90 text-white"
          >
            确认收货
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CancelOrderDialog({
  target,
  onClose,
  onCancel,
  isPending,
}: {
  target: PurchaseOrder | null;
  onClose: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={!!target} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>取消订单</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        <p className="text-sm">
          确定要取消采购订单 <span className="font-medium font-mono">{target?.number}</span>
          （{target?.supplierName}）吗？此操作不可撤销。
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <LoadingButton
            variant="destructive"
            onClick={onCancel}
            loading={isPending}
            loadingText="处理中…"
          >
            确认取消
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OrderDetailDialog({
  target,
  onClose,
}: {
  target: PurchaseOrder | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>订单详情</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        {target && (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">订单号</span>
                <span className="font-mono font-medium">{target.number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">状态</span>
                <Badge className={STATUS_CLASS[target.status]}>
                  {STATUS_LABEL[target.status] ?? target.status}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">供应商</span>
                <span className="font-medium">{target.supplierName ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">操作员</span>
                <span>{target.operatorName ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">创建时间</span>
                <span>{formatDateTime(target.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">总金额</span>
                <span className="font-semibold text-primary">
                  ¥{Number(target.totalAmount).toFixed(2)}
                </span>
              </div>
            </div>
            {target.remark && (
              <div className="text-sm">
                <span className="text-muted-foreground">备注：</span>
                {target.remark}
              </div>
            )}
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>规格</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">单价</TableHead>
                    <TableHead className="text-right">小计</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(target.items ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                        暂无明细
                      </TableCell>
                    </TableRow>
                  ) : (
                    (target.items ?? []).map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-medium">{it.name}</TableCell>
                        <TableCell className="text-muted-foreground">{it.spec ?? '-'}</TableCell>
                        <TableCell className="text-right">{it.quantity}</TableCell>
                        <TableCell className="text-right">¥{Number(it.unitPrice).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium">
                          ¥{Number(it.subtotal).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
