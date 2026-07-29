import { useState, useEffect } from 'react';
import { Check, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  type FirstExam,
  type DentitionType,
  type CreateFirstExamDto,
} from '@/lib/api/clinical/first-exams';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { useStaff } from '@/lib/staff';
import { toast } from 'sonner';

export function CreateFirstExamDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateFirstExamDto) => Promise<FirstExam>;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const { data: staffData } = useStaff();
  const doctors = (staffData ?? []).filter((s) => s.role === 'DOCTOR');

  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [dentitionType, setDentitionType] = useState<DentitionType>('PERMANENT');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [remark, setRemark] = useState('');

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  useEffect(() => {
    if (open) {
      setPatientId('');
      setPatientName('');
      setDentitionType('PERMANENT');
      setChiefComplaint('');
      setDoctorId('');
      setRemark('');
    }
  }, [open]);

  async function handleSubmit() {
    if (!patientId) {
      toast.error('请选择患者');
      return;
    }
    if (!doctorId) {
      toast.error('请选择医生');
      return;
    }
    try {
      await onCreate({
        patientId,
        doctorId,
        dentitionType,
        chiefComplaint: chiefComplaint || undefined,
        medicalHistory: remark || undefined,
      });
      toast.success('创建成功');
      onClose();
    } catch {
      toast.error('创建失败');
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建首诊</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>患者 *</Label>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <UserMinus className="w-4 h-4 mr-2" />
                {patientName || '请选择患者'}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fe-attending-doctor">主治医生</Label>
              <Select id="fe-attending-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">请选择医生</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fe-dentition-type">牙列类型 *</Label>
              <Select
                id="fe-dentition-type"
                value={dentitionType}
                onChange={(e) => setDentitionType(e.target.value as DentitionType)}
              >
                <option value="PERMANENT">恒牙</option>
                <option value="DECIDUOUS">乳牙</option>
                <option value="MIXED">混合</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fe-chief-complaint">主诉</Label>
              <Input
                id="fe-chief-complaint"
                placeholder="请输入患者主诉"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fe-remark">备注</Label>
              <Textarea
                id="fe-remark"
                rows={3}
                placeholder="请输入备注信息"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button onClick={handleSubmit} disabled={!patientId || !doctorId}>
                <Check className="w-4 h-4 mr-2" />
                创建
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
