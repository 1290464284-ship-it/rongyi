import { useState, useEffect, type ChangeEvent } from 'react';
import { Check, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  type MedicalRecord,
  type CreateMedicalRecordDto,
  type UpdateMedicalRecordDto,
} from '@/lib/api/clinical/medical-records';
import { PatientSelector } from '@/components/patient/PatientSelector';

export function CreateRecordDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateMedicalRecordDto) => Promise<void>;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [presentIllness, setPresentIllness] = useState('');
  const [pastHistory, setPastHistory] = useState('');
  const [allergyHistory, setAllergyHistory] = useState('');
  const [examination, setExamination] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  useEffect(() => {
    if (open) {
      setPatientId('');
      setPatientName('');
      setChiefComplaint('');
      setPresentIllness('');
      setPastHistory('');
      setAllergyHistory('');
      setExamination('');
      setDiagnosis('');
      setTreatmentPlan('');
    }
  }, [open]);

  async function handleSubmit() {
    if (!patientId) return;
    await onCreate({
      patientId,
      chiefComplaint: chiefComplaint || undefined,
      presentIllness: presentIllness || undefined,
      pastHistory: pastHistory || undefined,
      allergyHistory: allergyHistory || undefined,
      examination: examination || undefined,
      diagnosis: diagnosis || undefined,
      treatmentPlan: treatmentPlan || undefined,
    });
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建病历</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
            <div className="space-y-1.5">
              <Label htmlFor="mr-patient">患者 *</Label>
              <Button
                id="mr-patient"
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <FileText className="w-4 h-4 mr-2" />
                {patientName || '请选择患者'}
              </Button>
            </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-chief-complaint">主诉</Label>
            <Textarea
              id="mr-chief-complaint"
              placeholder="请输入主诉"
              value={chiefComplaint}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setChiefComplaint(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-present-illness">现病史</Label>
            <Textarea
              id="mr-present-illness"
              placeholder="请输入现病史"
              value={presentIllness}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPresentIllness(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-past-history">既往史</Label>
            <Textarea
              id="mr-past-history"
              placeholder="请输入既往史"
              value={pastHistory}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPastHistory(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-allergy-history">过敏史</Label>
            <Textarea
              id="mr-allergy-history"
              placeholder="请输入过敏史"
              value={allergyHistory}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setAllergyHistory(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-examination">检查所见</Label>
            <Textarea
              id="mr-examination"
              placeholder="请输入检查所见"
              value={examination}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setExamination(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-diagnosis">诊断</Label>
            <Textarea
              id="mr-diagnosis"
              placeholder="请输入诊断"
              value={diagnosis}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDiagnosis(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-treatment-plan">治疗计划</Label>
            <Textarea
              id="mr-treatment-plan"
              placeholder="请输入治疗计划"
              value={treatmentPlan}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setTreatmentPlan(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!patientId}>
              <Check className="w-4 h-4 mr-2" />
              创建病历
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

export function EditRecordDialog({
  open,
  onClose,
  record,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  record: MedicalRecord;
  onUpdate: (data: UpdateMedicalRecordDto) => Promise<void>;
}) {
  const [chiefComplaint, setChiefComplaint] = useState(record.chiefComplaint || '');
  const [presentIllness, setPresentIllness] = useState(record.presentIllness || '');
  const [pastHistory, setPastHistory] = useState(record.pastHistory || '');
  const [allergyHistory, setAllergyHistory] = useState(record.allergyHistory || '');
  const [examination, setExamination] = useState(record.examination || '');
  const [diagnosis, setDiagnosis] = useState(record.diagnosis || '');
  const [treatmentPlan, setTreatmentPlan] = useState(record.treatmentPlan || '');

  async function handleSubmit() {
    await onUpdate({
      chiefComplaint: chiefComplaint || undefined,
      presentIllness: presentIllness || undefined,
      pastHistory: pastHistory || undefined,
      allergyHistory: allergyHistory || undefined,
      examination: examination || undefined,
      diagnosis: diagnosis || undefined,
      treatmentPlan: treatmentPlan || undefined,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>编辑病历</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="space-y-1.5">
            <Label>患者</Label>
            <div className="px-3 py-2 bg-muted/30 rounded-md text-sm">
              {record.patient?.name || '-'}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-mr-chief-complaint">主诉</Label>
            <Textarea
              id="edit-mr-chief-complaint"
              placeholder="请输入主诉"
              value={chiefComplaint}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setChiefComplaint(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-mr-present-illness">现病史</Label>
            <Textarea
              id="edit-mr-present-illness"
              placeholder="请输入现病史"
              value={presentIllness}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPresentIllness(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-mr-past-history">既往史</Label>
            <Textarea
              id="edit-mr-past-history"
              placeholder="请输入既往史"
              value={pastHistory}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPastHistory(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-mr-allergy-history">过敏史</Label>
            <Textarea
              id="edit-mr-allergy-history"
              placeholder="请输入过敏史"
              value={allergyHistory}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setAllergyHistory(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-mr-examination">检查所见</Label>
            <Textarea
              id="edit-mr-examination"
              placeholder="请输入检查所见"
              value={examination}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setExamination(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-mr-diagnosis">诊断</Label>
            <Textarea
              id="edit-mr-diagnosis"
              placeholder="请输入诊断"
              value={diagnosis}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDiagnosis(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-mr-treatment-plan">治疗计划</Label>
            <Textarea
              id="edit-mr-treatment-plan"
              placeholder="请输入治疗计划"
              value={treatmentPlan}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setTreatmentPlan(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit}>
              <Check className="w-4 h-4 mr-2" />
              保存修改
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
