import { memo } from 'react';
import { CreditCard, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_COLOR,
  PAY_METHOD_LABEL,
  type Charge,
} from '@/lib/api/financial/charge';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export const ROW_HEIGHT = 64;

export const VirtualChargeRow = memo(({
  charge,
  onPay,
  onRefund,
}: {
  charge: Charge;
  onPay: (charge: Charge) => void;
  onRefund: (charge: Charge) => void;
}) => {
  return (
    <tr style={{ height: ROW_HEIGHT }}>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))', fontFamily: 'monospace', fontSize: '0.875rem' }}>
        {charge.number}
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        <div>{charge.patient?.name}</div>
        <div style={{ fontSize: '0.75rem', color: 'hsl(var(--muted-foreground))' }}>
          {charge.patient?.phone}
        </div>
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))', fontWeight: 600 }}>
        ¥{Number(charge.totalAmount).toFixed(2)}
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        ¥{Number(charge.paidAmount).toFixed(2)}
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        <Badge className={CHARGE_STATUS_COLOR[charge.status]}>
          {CHARGE_STATUS_LABEL[charge.status]}
        </Badge>
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        {charge.payMethod ? PAY_METHOD_LABEL[charge.payMethod] : '-'}
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))', fontSize: '0.875rem', color: 'hsl(var(--muted-foreground))' }}>
        {format(new Date(charge.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))', textAlign: 'right' }}>
        {(charge.status === 'UNPAID' || charge.status === 'PARTIAL') && (
          <Button size="sm" variant="default" onClick={() => onPay(charge)} style={{ marginRight: '0.5rem' }}>
            <CreditCard className="w-3 h-3 mr-1" />
            收款
          </Button>
        )}
        {charge.status === 'PAID' && (
          <Button size="sm" variant="outline" onClick={() => onRefund(charge)}>
            <ArrowLeftRight className="w-3 h-3 mr-1" />
            退款
          </Button>
        )}
      </td>
    </tr>
  );
});

VirtualChargeRow.displayName = 'VirtualChargeRow';
