import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useCreateAppointment, APPOINTMENT_TYPE_LABEL, type Appointment } from '@/lib/api/clinical/appointments';
import { useChairs } from '@/lib/chairs';
import { useDoctors } from '@/lib/staff';
import { usePatientSearch } from '@/lib/api/patients/patients';

interface Props {
  defaultStartTime: string; // ISO
  defaultEndTime: string; // ISO
  defaultChairId?: string; // 默认牙椅
  onClose: () => void;
}

// 预约类型选项（与后端 AppointmentType 枚举对齐）
const TYPE_OPTIONS: Appointment['type'][] = [
  'FIRST_VISIT',
  'RETURN',
  'CONSULTATION',
  'EMERGENCY',
  'RECALL',
  'OTHER',
];

const appointmentSchema = z.object({
  patientId: z.string().min(1, '请选择患者'),
  doctorId: z.string().min(1, '必填'),
  chairId: z.string().optional(),
  startTime: z.string().min(1, '必填'),
  endTime: z.string().min(1, '必填'),
  type: z.enum(['FIRST_VISIT', 'RETURN', 'CONSULTATION', 'EMERGENCY', 'RECALL', 'OTHER']),
  remark: z.string().optional(),
}).refine(
  (data) => {
    if (data.startTime && data.endTime) {
      return new Date(data.endTime) > new Date(data.startTime);
    }
    return true;
  },
  { message: '结束时间必须晚于开始时间', path: ['endTime'] },
);

type AppointmentFormValues = z.infer<typeof appointmentSchema>;

export default function AppointmentForm({ defaultStartTime, defaultEndTime, defaultChairId, onClose }: Props) {
  const create = useCreateAppointment();
  const { data: chairs } = useChairs();
  const activeChairs = chairs?.filter((c) => c.active) ?? [];

  const { register, handleSubmit, formState: { errors } } = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      patientId: '',
      doctorId: '',
      chairId: defaultChairId ?? '',
      startTime: defaultStartTime.slice(0, 16),
      endTime: defaultEndTime.slice(0, 16),
      type: 'FIRST_VISIT' as Appointment['type'],
      remark: '',
    },
  });
  const [patientKeyword, setPatientKeyword] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string } | null>(null);

  const { data: patients } = usePatientSearch(patientKeyword);
  const { data: doctors } = useDoctors();

  const onSubmit = async (data: AppointmentFormValues) => {
    const payload = {
      ...data,
      patientId: selectedPatient?.id ?? data.patientId,
      chairId: data.chairId || undefined,
      startTime: new Date(data.startTime).toISOString(),
      endTime: new Date(data.endTime).toISOString(),
      remark: data.remark || undefined,
    };
    await create.mutateAsync(payload);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label>患者 *</Label>
        {selectedPatient ? (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">{selectedPatient.name}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedPatient(null)}>更换</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input placeholder="姓名 / 手机 / 病历号" value={patientKeyword} onChange={(e) => setPatientKeyword(e.target.value)} />
            {patients && patients.items.length > 0 && (
              <div className="rounded-md border border-border max-h-40 overflow-auto">
                {patients.items.map((p) => (
                  <div
                    key={p.id}
                    className="cursor-pointer px-3 py-1.5 text-sm hover:bg-muted"
                    onClick={() => { setSelectedPatient({ id: p.id, name: p.name }); setPatientKeyword(''); }}
                  >
                    {p.name} · {p.phone} · {p.code}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="doctorId">医生 *</Label>
          <Select id="doctorId" {...register('doctorId')}>
            <option value="">请选择</option>
            {doctors?.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
          {errors.doctorId && <p className="text-xs text-destructive">{errors.doctorId.message as string}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="chairId">牙椅</Label>
          <Select id="chairId" {...register('chairId')}>
            <option value="">不指定</option>
            {activeChairs.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.location ? ` · ${c.location}` : ''}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type">预约类型 *</Label>
          <Select id="type" {...register('type')}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{APPOINTMENT_TYPE_LABEL[t]}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="startTime">开始时间 *</Label>
          <Input id="startTime" type="datetime-local" {...register('startTime')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endTime">结束时间 *</Label>
          <Input id="endTime" type="datetime-local" {...register('endTime')} />
          {errors.endTime && <p className="text-xs text-destructive">{errors.endTime.message as string}</p>}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="remark">备注</Label>
        <Input id="remark" {...register('remark')} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>取消</Button>
        <Button type="submit" disabled={create.isPending || !selectedPatient}>保存</Button>
      </div>
    </form>
  );
}
