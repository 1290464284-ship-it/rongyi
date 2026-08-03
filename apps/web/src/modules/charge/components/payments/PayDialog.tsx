import { useState, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PayMethod, Charge } from '@/lib/api/financial/charge';
import { LoadingButton } from '@/components/ui/loading';
import { toastService } from '@/lib/utils/toast-service';

export function PayDialog({
  open,
  onClose,
  charge,
  onPay,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  charge: Charge;
  onPay: ({ id, amount, payMethod }: { id: string; amount: number; payMethod: PayMethod }) => Promise<Charge>;
  isPending: boolean;
}) {
  const remaining = Number(charge.totalAmount) - Number(charge.paidAmount);
  const [amount, setAmount] = useState(remaining);
  const [payMethod, setPayMethod] = useState<PayMethod>('WECHAT');

  useEffect(() => {
    if (open) {
      setAmount(remaining);
      setPayMethod('WECHAT');
    }
  }, [open, charge.id, remaining]);

  async function handlePay() {
    if (amount <= 0) return;
    try {
      await onPay({ id: charge.id, amount, payMethod });
      toastService.success('收款成功');
      onClose();
    } catch (e: unknown) {
      toastService.error('收款失败', e instanceof Error ? e : undefined);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>收款</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">单号</div>
              <div className="font-mono">{charge.number}</div>
            </div>
            <div>
              <div className="text-muted-foreground">患者</div>
              <div>{charge.patient?.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">应收金额</div>
              <div>¥{Number(charge.totalAmount).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">已付金额</div>
              <div>¥{Number(charge.paidAmount).toFixed(2)}</div>
            </div>
          </div>
          <div className="p-4 bg-warning/5 rounded-md border border-warning/20 text-center">
            <div className="text-sm text-muted-foreground mb-1">待收金额</div>
            <div className="text-3xl font-bold text-warning">¥{remaining.toFixed(2)}</div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">收款金额</Label>
            <Input
              id="pay-amount"
              type="number"
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="text-lg font-semibold"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">支付方式</Label>
            <Select id="pay-method" value={payMethod} onChange={e => setPayMethod(e.target.value as PayMethod)}>
              <option value="CASH">现金</option>
              <option value="WECHAT">微信支付</option>
              <option value="ALIPAY">支付宝</option>
              <option value="CARD">银行卡</option>
              <option value="OTHER">其他</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <LoadingButton onClick={handlePay} loading={isPending} loadingText="处理中..." disabled={amount <= 0 || amount > remaining}>
              <Check className="w-4 h-4 mr-2" />
              确认收款
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
