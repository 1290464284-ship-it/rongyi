import {
  User,
  Activity,
  FileText,
  ClipboardList,
  Receipt,
  Pill,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VISIT_STATUS_LABEL, VISIT_STATUS_COLOR, type Visit } from '@/lib/api/clinical/visits';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function VisitDetailPanel({
  visit,
  onNavigate,
  onComplete,
}: {
  visit: Visit;
  onNavigate: (path: string) => void;
  onComplete: () => void;
}) {
  return (
    <div className='space-y-4'>
      <div className='space-y-3'>
        <div className='flex items-center gap-2'>
          <User className='w-4 h-4 text-muted-foreground' />
          <span className='font-medium'>{visit.patient?.name}</span>
          <Badge className={VISIT_STATUS_COLOR[visit.status]}>
            {VISIT_STATUS_LABEL[visit.status]}
          </Badge>
        </div>
        <div className='grid grid-cols-2 gap-2 text-sm'>
          <div>
            <span className='text-muted-foreground'>电话：</span>
            <span>{visit.patient?.phone ?? '-'}</span>
          </div>
          <div>
            <span className='text-muted-foreground'>医生：</span>
            <span>{visit.doctor?.name}</span>
          </div>
          <div>
            <span className='text-muted-foreground'>开始：</span>
            <span>{format(new Date(visit.startTime), 'yyyy-MM-dd HH:mm', { locale: zhCN })}</span>
          </div>
          {visit.endTime && (
            <div>
              <span className='text-muted-foreground'>结束：</span>
              <span>{format(new Date(visit.endTime), 'HH:mm', { locale: zhCN })}</span>
            </div>
          )}
        </div>
      </div>

      <div className='border-t border-border pt-3 space-y-3'>
        <div>
          <div className='flex items-center gap-1.5 mb-1 text-xs text-muted-foreground'>
            <Activity className='w-3 h-3' />
            <span>主诉</span>
          </div>
          <div className='text-sm bg-muted/30 p-2 rounded min-h-[2rem]'>
            {visit.chiefComplaint || '未填写'}
          </div>
        </div>
        <div>
          <div className='flex items-center gap-1.5 mb-1 text-xs text-muted-foreground'>
            <FileText className='w-3 h-3' />
            <span>诊断</span>
          </div>
          <div className='text-sm bg-muted/30 p-2 rounded min-h-[2rem]'>
            {visit.diagnosis || '未填写'}
          </div>
        </div>
        <div>
          <div className='flex items-center gap-1.5 mb-1 text-xs text-muted-foreground'>
            <ClipboardList className='w-3 h-3' />
            <span>治疗计划</span>
          </div>
          <div className='text-sm bg-muted/30 p-2 rounded min-h-[2rem]'>
            {visit.treatmentPlan || '未填写'}
          </div>
        </div>
      </div>

      {visit.treatments.length > 0 && (
        <div className='border-t border-border pt-3'>
          <div className='text-xs text-muted-foreground mb-2'>本次治疗记录</div>
          <div className='space-y-1'>
            {visit.treatments.map(t => (
              <div key={t.id} className='flex items-center justify-between text-sm'>
                <span>{t.name}</span>
                {t.teethNumbers.length > 0 && (
                  <span className='text-xs text-muted-foreground'>
                    牙位：{t.teethNumbers.join(', ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className='border-t border-border pt-3 grid grid-cols-2 gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={() => {
            const params = new URLSearchParams();
            params.set('patientId', visit.patientId);
            params.set('visitId', visit.id);
            onNavigate(`/charge?${params.toString()}`);
          }}
        >
          <Receipt className='w-3 h-3 mr-1' />
          收费
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => {
            const params = new URLSearchParams();
            params.set('patientId', visit.patientId);
            params.set('visitId', visit.id);
            onNavigate(`/prescriptions?${params.toString()}`);
          }}
        >
          <Pill className='w-3 h-3 mr-1' />
          处方
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => {
            const params = new URLSearchParams();
            params.set('patientId', visit.patientId);
            params.set('visitId', visit.id);
            onNavigate(`/treatment-plans?${params.toString()}`);
          }}
        >
          <ClipboardList className='w-3 h-3 mr-1' />
          治疗计划
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => onNavigate(`/patients/${encodeURIComponent(visit.patientId)}`)}
        >
          <User className='w-3 h-3 mr-1' />
          患者档案
        </Button>
      </div>

      {visit.status === 'IN_PROGRESS' && (
        <Button className='w-full' onClick={onComplete}>
          <Check className='w-4 h-4 mr-2' />
          完成就诊
        </Button>
      )}
    </div>
  );
}
