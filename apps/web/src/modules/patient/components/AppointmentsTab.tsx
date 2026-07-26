import { Badge } from '@/components/ui/badge';
import { APPOINTMENT_STATUS_LABEL } from '@/lib/api/clinical/appointments';
import { formatDate } from '@/lib/utils';

interface Appointment {
  id: string;
  doctor: { name: string };
  type: string;
  startTime: string;
  status: string;
}

export function AppointmentsTab({ appointments }: { appointments: Appointment[] }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-2">
      <h2 className="text-sm font-medium mb-2">预约记录</h2>
      {appointments.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无预约</p>
      ) : (
        appointments.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
            <div>
              <div className="font-medium">{a.doctor.name} · {a.type}</div>
              <div className="text-xs text-muted-foreground">
                {formatDate(a.startTime)} {new Date(a.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <Badge className="bg-primary/10 text-primary">{APPOINTMENT_STATUS_LABEL[a.status as keyof typeof APPOINTMENT_STATUS_LABEL]}</Badge>
          </div>
        ))
      )}
    </div>
  );
}
