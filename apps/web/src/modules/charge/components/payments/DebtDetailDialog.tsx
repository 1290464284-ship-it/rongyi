import { DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DEBT_STATUS_LABEL, DEBT_STATUS_COLOR, type DebtRecord } from '@/lib/api/financial/charge-v2';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function DebtDetailDialog({
  open,
  onClose,
  debt,
  onPay,
}: {
  open: boolean;
  onClose: () => void;
  debt: DebtRecord;
  onPay: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>欠费详情</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">患者姓名</div>
              <div className="font-medium mt-0.5">{debt.patient?.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">联系电话</div>
              <div className="mt-0.5">{debt.patient?.phone}</div>
            </div>
            <div>
              <div className="text-muted-foreground">患者编号</div>
              <div className="font-mono mt-0.5">{debt.patient?.code}</div>
            </div>
            <div>
              <div className="text-muted-foreground">关联单号</div>
              <div className="font-mono mt-0.5">{debt.charge?.number ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">欠费日期</div>
              <div className="mt-0.5">
                {format(new Date(debt.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">最后还款日</div>
              <div className="mt-0.5">
                {debt.dueDate
                  ? format(new Date(debt.dueDate), 'yyyy-MM-dd', { locale: zhCN })
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">状态</div>
              <div className="mt-0.5">
                <Badge className={DEBT_STATUS_COLOR[debt.status]}>
                  {DEBT_STATUS_LABEL[debt.status]}
                </Badge>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
            <div className="text-center p-3 bg-muted/30 rounded-md">
              <div className="text-sm text-muted-foreground">欠费总额</div>
              <div className="text-xl font-bold mt-1">
                ¥{Number(debt.totalAmount).toFixed(2)}
              </div>
            </div>
            <div className="text-center p-3 bg-success/5 rounded-md">
              <div className="text-sm text-muted-foreground">已还金额</div>
              <div className="text-xl font-bold mt-1 text-success">
                ¥{Number(debt.paidAmount).toFixed(2)}
              </div>
            </div>
            <div className="text-center p-3 bg-destructive/5 rounded-md">
              <div className="text-sm text-muted-foreground">剩余金额</div>
              <div className="text-xl font-bold mt-1 text-destructive">
                ¥{Number(debt.remainAmount).toFixed(2)}
              </div>
            </div>
          </div>

          {debt.remark && (
            <div className="space-y-1.5 pt-2">
              <Label>备注</Label>
              <p className="text-sm text-muted-foreground">{debt.remark}</p>
            </div>
          )}

          {debt.payments && debt.payments.length > 0 && (
            <div className="pt-2">
              <Label>还款记录</Label>
              <div className="mt-2 border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">还款时间</TableHead>
                      <TableHead className="text-xs">金额</TableHead>
                      <TableHead className="text-xs">方式</TableHead>
                      <TableHead className="text-xs">操作员</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debt.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {payment.paidAt ? format(new Date(payment.paidAt), 'yyyy-MM-dd HH:mm', {
                            locale: zhCN,
                          }) : '-'}
                        </TableCell>
                        <TableCell className="text-xs font-medium text-success">
                          ¥{Number(payment.amount).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs">{payment.payMethod}</TableCell>
                        <TableCell className="text-xs">
                          {payment.operator?.name ?? '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            {debt.status !== 'PAID' && (
              <Button onClick={onPay}>
                <DollarSign className="w-4 h-4 mr-2" />
                立即还款
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
