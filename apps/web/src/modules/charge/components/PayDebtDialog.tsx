import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  usePaymentMethods,
  type DebtRecord,
  type PayDebtDto,
} from '@/lib/api/financial/charge-v2';

export function PayDebtDialog({
  open,
  onClose,
  debt,
  onPay,
}: {
  open: boolean;
  onClose: () => void;
  debt: DebtRecord;
  onPay: (data: PayDebtDto) => Promise<void>;
}) {
  const remaining = Number(debt.remainAmount);
  const [amount, setAmount] = useState(remaining);
  const [payMethod, setPayMethod] = useState('WECHAT');
  const [remark, setRemark] = useState('');

  const { data: paymentMethodsData } = usePaymentMethods({ isEnabled: true });
  const paymentMethods = paymentMethodsData ?? [];

  async function handlePay() {
    if (amount <= 0 || amount > remaining) return;
    await onPay({
      amount,
      payMethod,
      remark,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>欠费还款</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">患者</div>
              <div className="font-medium">{debt.patient?.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">单号</div>
              <div className="font-mono">{debt.charge?.number ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">欠费总额</div>
              <div>¥{Number(debt.totalAmount).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">已还金额</div>
              <div className="text-success">¥{Number(debt.paidAmount).toFixed(2)}</div>
            </div>
          </div>

          <div className="p-4 bg-warning/5 rounded-md border border-warning/20 text-center">
            <div className="text-sm text-muted-foreground mb-1">待还金额</div>
            <div className="text-3xl font-bold text-warning">¥{remaining.toFixed(2)}</div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-pay-amount">还款金额</Label>
            <Input
              id="debt-pay-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="text-lg font-semibold"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-pay-method">还款方式</Label>
            <Select
              id="debt-pay-method"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
            >
              {paymentMethods.length > 0 ? (
                paymentMethods.map((m) => (
                  <option key={m.id} value={m.code}>
                    {m.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="CASH">现金</option>
                  <option value="WECHAT">微信支付</option>
                  <option value="ALIPAY">支付宝</option>
                  <option value="CARD">银行卡</option>
                  <option value="OTHER">其他</option>
                </>
              )}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-remark">备注</Label>
            <Textarea
              id="debt-remark"
              placeholder="请输入备注（可选）"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <Button
              onClick={handlePay}
              disabled={amount <= 0 || amount > remaining}
            >
              <Check className="w-4 h-4 mr-2" />
              确认还款
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
