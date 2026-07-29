import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type Visit } from '@/lib/api/clinical/visits';

export function CompleteVisitDialog({
  open,
  onClose,
  visit,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  visit: Visit;
  onComplete: ({ id, data }: { id: string; data: { diagnosis?: string; treatmentPlan?: string } }) => Promise<Visit>;
}) {
  const [diagnosis, setDiagnosis] = useState(visit.diagnosis ?? '');
  const [treatmentPlan, setTreatmentPlan] = useState(visit.treatmentPlan ?? '');

  async function handleSubmit() {
    await onComplete({
      id: visit.id,
      data: { diagnosis, treatmentPlan },
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className='max-w-lg'>
      <DialogHeader>
        <DialogTitle>完成就诊</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className='space-y-4'>
          <div className='p-3 bg-muted/30 rounded-md text-sm'>
            <div className='font-medium'>{visit.patient?.name}</div>
            <div className='text-muted-foreground'>
              主诉：{visit.chiefComplaint || '未填写'}
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor="complete-diagnosis">诊断结果</Label>
            <Textarea
              id="complete-diagnosis"
              placeholder='请输入诊断结果'
              value={diagnosis}
              onChange={e => setDiagnosis(e.target.value)}
              rows={3}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor="complete-treatment-plan">治疗计划</Label>
            <Textarea
              id="complete-treatment-plan"
              placeholder='请输入治疗计划描述'
              value={treatmentPlan}
              onChange={e => setTreatmentPlan(e.target.value)}
              rows={3}
            />
          </div>

          <div className='flex justify-end gap-2 pt-2'>
            <Button variant='outline' onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit}>
              <Check className='w-4 h-4 mr-2' />
              确认完成
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
