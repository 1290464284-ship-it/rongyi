import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Calendar, Stethoscope, Pill } from 'lucide-react';
import type { Appointment } from '@/lib/api/clinical/appointments';
import type { Visit } from '@/lib/api/clinical/visits';
import type { Treatment } from '@/lib/api/clinical/treatments';
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_TYPE_LABEL,
} from '@/lib/api/clinical/appointments';
import { TREATMENT_STATUS_LABEL, TREATMENT_STATUS_COLOR } from '@/lib/api/clinical/treatments';
import { Badge } from '@/components/ui/badge';

type TimelineNode =
  | { kind: 'appointment'; time: string; data: Appointment }
  | { kind: 'visit'; time: string; data: Visit }
  | { kind: 'treatment'; time: string; data: Treatment };

interface Props {
  appointments: Appointment[];
  visits: Visit[];
  treatments: Treatment[];
  toothFilter?: number; // 选中牙位过滤（仅影响 treatment 节点）
}

export function Timeline({ appointments, visits, treatments, toothFilter }: Props) {
  const nodes = useMemo<TimelineNode[]>(() => {
    const filteredTreatments = toothFilter
      ? treatments.filter((t) => t.teethNumbers.includes(toothFilter))
      : treatments;

    const apptNodes: TimelineNode[] = appointments.map((a) => ({
      kind: 'appointment',
      time: a.startTime,
      data: a,
    }));
    const visitNodes: TimelineNode[] = visits.map((v) => ({
      kind: 'visit',
      time: v.startTime,
      data: v,
    }));
    const treatNodes: TimelineNode[] = filteredTreatments.map((t) => ({
      kind: 'treatment',
      time: t.createdAt,
      data: t,
    }));

    return [...apptNodes, ...visitNodes, ...treatNodes].sort(
      (a, b) => parseISO(b.time).getTime() - parseISO(a.time).getTime(),
    );
  }, [appointments, visits, treatments, toothFilter]);

  if (nodes.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12 text-sm">
        {toothFilter ? `该牙位暂无治疗记录` : '暂无就诊记录'}
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      {/* 竖线 */}
      <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

      {nodes.map((node, i) => {
        const time = parseISO(node.time);
        return (
          <div key={`${node.kind}-${node.data.id}-${i}`} className="relative pb-6 last:pb-0">
            {/* 节点圆点 */}
            <div
              className={`absolute -left-4 top-1 h-3 w-3 rounded-full border-2 border-white ${
                node.kind === 'appointment'
                  ? 'bg-primary'
                  : node.kind === 'visit'
                    ? 'bg-warning'
                    : 'bg-success'
              }`}
            />

            <div className="text-xs text-muted-foreground mb-1">
              {format(time, 'yyyy-MM-dd HH:mm', { locale: zhCN })}
            </div>

            {node.kind === 'appointment' && (
              <div className="rounded-md border border-border bg-white p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">预约 · {APPOINTMENT_TYPE_LABEL[node.data.type]}</span>
                  <Badge className="bg-primary/10 text-primary">{APPOINTMENT_STATUS_LABEL[node.data.status]}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {node.data.doctor.name} · {format(parseISO(node.data.startTime), 'HH:mm')}-{format(parseISO(node.data.endTime), 'HH:mm')}
                </div>
              </div>
            )}

            {node.kind === 'visit' && (
              <div className="rounded-md border border-border bg-white p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Stethoscope className="h-4 w-4 text-warning" />
                  <span className="font-medium text-sm">就诊 · {node.data.doctor.name}</span>
                  <Badge className={node.data.status === 'COMPLETED' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
                    {node.data.status === 'COMPLETED' ? '已完成' : '进行中'}
                  </Badge>
                </div>
                {node.data.chiefComplaint && (
                  <div className="text-xs text-muted-foreground">主诉：{node.data.chiefComplaint}</div>
                )}
                {node.data.diagnosis && (
                  <div className="text-xs text-muted-foreground">诊断：{node.data.diagnosis}</div>
                )}
                {node.data.treatments.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    治疗：{node.data.treatments.map((t) => t.name).join('、')}
                  </div>
                )}
              </div>
            )}

            {node.kind === 'treatment' && (
              <div className="rounded-md border border-border bg-white p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Pill className="h-4 w-4 text-success" />
                  <span className="font-medium text-sm">治疗 · {node.data.name}</span>
                  <Badge className={TREATMENT_STATUS_COLOR[node.data.status]}>
                    {TREATMENT_STATUS_LABEL[node.data.status]}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {node.data.doctor.name} · {node.data.category} · ¥{Number(node.data.price)}
                  {node.data.teethNumbers.length > 0 && (
                    <span> · 牙位：{node.data.teethNumbers.join(', ')}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
