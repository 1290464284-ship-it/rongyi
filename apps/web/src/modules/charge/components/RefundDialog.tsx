import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Charge } from '@/lib/api/financial/charges';
import { LoadingButton } from '@/components/ui/loading';
import { toastService } from '@/lib/utils/toast-service';

export function RefundDialog({
  open,
  onClose,
  charge,
  onRefund,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  charge: Charge;
  onRefund: ({ id, patientId, amount, reason }: { id: string; patientId: string; amount: number; reason?: string }) => Promise<Charge>;
  isPending: boolean;
}) {
  const refundable = Number(charge.paidAmount) - Number(charge.refundedAmount || 0);
  const [amount, setAmount] = useState(refundable);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setAmount(refundable);
      setReason('');
    }
  }, [open, charge.id]);

  async function handleRefund() {
    if (amount <= 0 || amount > refundable) return;
    try {
      await onRefund({ id: charge.id, patientId: charge.patientId, amount, reason: reason || undefined });
      toastService.success('退款成功');
      onClose();
    } catch (e: unknown) {
      toastService.error('退款失败', e instanceof Error ? e : undefined);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>退款</DialogTitle>
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
          </div>
          <div className="p-4 bg-destructive/5 rounded-md border border-destructive/20 text-center">
            <div className="text-sm text-muted-foreground mb-1">可退金额</div>
            <div className="text-3xl font-bold text-destructive">
              ¥{refundable.toFixed(2)}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">退款金额</Label>
            <Input
              id="refund-amount"
              type="number"
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="text-lg font-semibold"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">退款原因（可选）</Label>
            <Input
              id="refund-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="请输入退款原因"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <LoadingButton variant="destructive" onClick={handleRefund} loading={isPending} loadingText="处理中..." disabled={amount <= 0 || amount > refundable}>
              确认退款
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
