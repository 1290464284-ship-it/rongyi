import { useState, useEffect } from 'react';
import { Check, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  type Registration,
  type RegistrationType,
  type CreateRegistrationDto,
  type TriageRegistrationDto,
  REGISTRATION_TYPE_LABEL,
} from '@/lib/api/clinical/registrations';
import { useStaff } from '@/lib/staff';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { toast } from 'sonner';

export function CreateRegistrationDialog({
  open,
  onClose,
  onCreate,
  defaultDoctorId,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateRegistrationDto) => Promise<Registration>;
  defaultDoctorId?: string;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const { data: staff } = useStaff();
  const doctors = (staff ?? []).filter(s => s.role === 'DOCTOR');

  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? '');
  const [type, setType] = useState<RegistrationType>('FIRST_VISIT');
  const [chiefComplaint, setChiefComplaint] = useState('');

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  async function handleSubmit() {
    if (!patientId || !doctorId) return;
    try {
      await onCreate({
        patientId,
        doctorId,
        type,
        chiefComplaint,
      });
      toast.success('挂号成功');
      onClose();
      setPatientId('');
      setPatientName('');
      setDoctorId(defaultDoctorId ?? '');
      setType('FIRST_VISIT');
      setChiefComplaint('');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '挂号失败');
    }
  }

  useEffect(() => {
    if (open) {
      setPatientId('');
      setPatientName('');
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建挂号</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                患者 <span className="text-destructive">*</span>
              </Label>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <User className="w-4 h-4 mr-2" />
                {patientName ? patientName : '请选择患者'}
              </Button>
            </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-type">
              挂号类型 <span className="text-destructive">*</span>
            </Label>
            <Select id="reg-type" value={type} onChange={e => setType(e.target.value as RegistrationType)}>
              <option value="FIRST_VISIT">初诊</option>
              <option value="RETURN_VISIT">复诊</option>
              <option value="EMERGENCY">急诊</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-doctor">
              主治医生 <span className="text-destructive">*</span>
            </Label>
            <Select id="reg-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
              <option value="">请选择医生</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-chief-complaint">主诉</Label>
            <Textarea
              id="reg-chief-complaint"
              placeholder="请输入主诉描述"
              value={chiefComplaint}
              onChange={e => setChiefComplaint(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!patientId || !doctorId}>
              <Check className="w-4 h-4 mr-2" />
              确认挂号
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <PatientSelector
      open={openSelector}
      onClose={() => setOpenSelector(false)}
      onSelect={handleSelectPatient}
      title="选择患者"
    />
  </>
  );
}

export function TriageDialog({
  open,
  onClose,
  registration,
  onTriage,
}: {
  open: boolean;
  onClose: () => void;
  registration: Registration;
  onTriage: ({ id, data }: { id: string; data: TriageRegistrationDto }) => Promise<Registration>;
}) {
  const { data: staff } = useStaff();
  const doctors = (staff ?? []).filter(s => s.role === 'DOCTOR');

  const [doctorId, setDoctorId] = useState(registration.doctorId || '');
  const [triageNote, setTriageNote] = useState(registration.triageNote || '');
  const [chiefComplaint, setChiefComplaint] = useState(registration.chiefComplaint || '');

  async function handleSubmit() {
    if (!doctorId) return;
    try {
      await onTriage({
        id: registration.id,
        data: {
          doctorId,
          triageNote,
        },
      });
      toast.success('分诊成功');
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '分诊失败');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>分诊</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="p-3 bg-muted/50 rounded-md text-sm">
            <div className="font-medium mb-1">患者信息</div>
            <div className="text-muted-foreground">
              {registration.patient?.name} · {registration.patient?.phone}
            </div>
            <div className="text-muted-foreground">
              挂号类型：{REGISTRATION_TYPE_LABEL[registration.type]}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="triage-doctor">分配医生 *</Label>
            <Select id="triage-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
              <option value="">请选择医生</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="triage-chief-complaint">主诉</Label>
            <Textarea
              id="triage-chief-complaint"
              placeholder="请输入主诉"
              value={chiefComplaint}
              onChange={e => setChiefComplaint(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="triage-note">分诊备注</Label>
            <Textarea
              id="triage-note"
              placeholder="请输入分诊备注"
              value={triageNote}
              onChange={e => setTriageNote(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!doctorId}>
              <Check className="w-4 h-4 mr-2" />
              确认分诊
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmText,
  confirmVariant = 'default',
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmText: string;
  confirmVariant?: 'default' | 'destructive';
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button variant={confirmVariant} onClick={onConfirm}>
              {confirmText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
