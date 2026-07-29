import { useState, useEffect } from 'react';
import { User, Stethoscope } from 'lucide-react';
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
import { type Visit } from '@/lib/api/clinical/visits';
import { type Appointment } from '@/lib/api/clinical/appointments';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { useStaff } from '@/lib/staff';
import { format } from 'date-fns';

export function CreateVisitDialog({
  open,
  onClose,
  preset,
  defaultDoctorId,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  preset: Appointment | null;
  defaultDoctorId?: string;
  onCreate: (data: {
    patientId: string;
    doctorId: string;
    appointmentId?: string;
    chiefComplaint?: string;
  }) => Promise<Visit>;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const { data: staff } = useStaff();
  const doctors = (staff ?? []).filter(s => s.role === 'DOCTOR');

  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? '');
  const [chiefComplaint, setChiefComplaint] = useState('');

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  useEffect(() => {
    if (preset) {
      setPatientId(preset.patientId);
      setPatientName(preset.patient?.name || '');
      setDoctorId(preset.doctorId);
    }
  }, [preset]);

  useEffect(() => {
    if (open && !preset) {
      setPatientId('');
      setPatientName('');
    }
  }, [open, preset]);

  async function handleSubmit() {
    if (!patientId || !doctorId) return;
    await onCreate({
      patientId,
      doctorId,
      appointmentId: preset?.id,
      chiefComplaint,
    });
    onClose();
    setPatientId('');
    setPatientName('');
    setChiefComplaint('');
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>开始就诊</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className='space-y-4'>
            {preset && (
              <div className='p-3 bg-primary/5 border border-primary/20 rounded-md text-sm'>
                <div className='font-medium'>来自预约</div>
                <div className='text-muted-foreground'>
                  {preset.patient?.name} - {format(new Date(preset.startTime), 'HH:mm')}
                </div>
              </div>
            )}

            <div className='space-y-1.5'>
              <Label htmlFor='create-visit-patient'>患者 *</Label>
              <Button
                id='create-visit-patient'
                variant='outline'
                className='w-full justify-start'
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <User className='w-4 h-4 mr-2' />
                {patientName || preset?.patient?.name || '请选择患者'}
              </Button>
            </div>

          <div className='space-y-1.5'>
            <Label htmlFor="create-doctor">主治医生 *</Label>
            <Select id="create-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
              <option value=''>请选择医生</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor="create-chief-complaint">主诉</Label>
            <Textarea
              id="create-chief-complaint"
              placeholder='请输入主诉描述'
              value={chiefComplaint}
              onChange={e => setChiefComplaint(e.target.value)}
              rows={3}
            />
          </div>

          <div className='flex justify-end gap-2 pt-2'>
            <Button variant='outline' onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!patientId || !doctorId}>
              <Stethoscope className='w-4 h-4 mr-2' />
              开始就诊
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
