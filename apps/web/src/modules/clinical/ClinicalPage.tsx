import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Check,
  Stethoscope,
  Receipt,
  Pill,
  ClipboardList,
  Clock,
  User,
  Activity,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import {
  useVisitsList,
  useCreateVisit,
  useCompleteVisit,
  VISIT_STATUS_LABEL,
  VISIT_STATUS_COLOR,
  type Visit,
} from '@/lib/api/clinical/visits';
import { useAppointments, APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_COLOR, type Appointment } from '@/lib/api/clinical/appointments';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { useStaff } from '@/lib/staff';
import { useAuthStore } from '@/lib/store/auth-store';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function ClinicalPage() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [presetAppointment, setPresetAppointment] = useState<Appointment | null>(null);

  // 默认查询今日就诊
  const { data, isLoading } = useVisitsList({
    status: statusFilter || undefined,
    page: 1,
    pageSize: 100,
  });

  // 查询今日待就诊的预约（BOOKED/ARRIVED）
  const today = format(new Date(), 'yyyy-MM-dd');
  const { data: aptData } = useAppointments({
    startDate: today,
    endDate: today,
  });

  const createVisit = useCreateVisit();
  const completeVisit = useCompleteVisit();

  const visits = useMemo(() => data?.items ?? [], [data?.items]);
  const pendingAppointments = (aptData?.items ?? []).filter(
    a => a.status === 'BOOKED' || a.status === 'ARRIVED',
  );

  const filteredVisits = useMemo(() => {
    if (!keyword) return visits;
    const kw = keyword.toLowerCase();
    return visits.filter(
      v =>
        v.patient?.name?.toLowerCase().includes(kw) ||
        v.patient?.phone?.includes(kw) ||
        v.doctor?.name?.toLowerCase().includes(kw) ||
        v.chiefComplaint?.toLowerCase().includes(kw),
    );
  }, [visits, keyword]);

  function handleSelectVisit(visit: Visit) {
    setSelectedVisit(visit);
  }

  function handleStartFromAppointment(apt: Appointment) {
    setSelectedVisit(null);
    setCreateOpen(true);
    setPresetAppointment(apt);
  }

  function handleComplete(visit: Visit) {
    setSelectedVisit(visit);
    setCompleteOpen(true);
  }

  async function handleStartVisitDirectly() {
    setPresetAppointment(null);
    setCreateOpen(true);
  }

  return (
    <div className='p-6 space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>就诊任务</h1>
          <p className='text-sm text-muted-foreground mt-1'>
            管理今日就诊、创建就诊记录、完成就诊并跳转收费/处方
          </p>
        </div>
        <Button onClick={handleStartVisitDirectly}>
          <Plus className='w-4 h-4 mr-2' />
          开始就诊
        </Button>
      </div>

      {/* 待就诊预约 */}
      {pendingAppointments.length > 0 && (
        <Card>
          <CardHeader className='pb-3'>
            <div className='flex items-center gap-2'>
              <Clock className='w-4 h-4 text-warning' />
              <span className='font-medium'>今日待就诊预约</span>
              <Badge className='bg-warning/10 text-warning border-warning/30'>
                {pendingAppointments.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className='flex flex-wrap gap-2'>
              {pendingAppointments.map(apt => (
                <div
                  key={apt.id}
                  className='flex items-center gap-3 p-3 border border-border rounded-md hover:bg-muted/30 cursor-pointer'
                  onClick={() => handleStartFromAppointment(apt)}
                >
                  <div className='flex flex-col'>
                    <span className='font-medium text-sm'>{apt.patient.name}</span>
                    <span className='text-xs text-muted-foreground'>
                      {format(new Date(apt.startTime), 'HH:mm')} - {apt.doctor.name}
                    </span>
                  </div>
                  <Badge className={APPOINTMENT_STATUS_COLOR[apt.status]}>
                    {APPOINTMENT_STATUS_LABEL[apt.status]}
                  </Badge>
                  <Button size='sm' variant='outline' className='h-7'>
                    <Stethoscope className='w-3 h-3 mr-1' />
                    开始
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className='grid grid-cols-3 gap-4'>
        {/* 左侧：就诊列表 */}
        <Card className='col-span-2'>
          <CardHeader className='pb-3'>
            <div className='flex items-center gap-4'>
              <div className='flex-1 max-w-sm'>
                <div className='relative'>
                  <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
                  <Input
                    placeholder='搜索患者/医生/主诉'
                    value={keyword}
                    onChange={e => setKeyword(e.target.value)}
                    className='pl-10'
                  />
                </div>
              </div>
              <Select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className='w-32'
              >
                <option value=''>全部状态</option>
                <option value='IN_PROGRESS'>就诊中</option>
                <option value='COMPLETED'>已完成</option>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>患者</TableHead>
                  <TableHead>医生</TableHead>
                  <TableHead>主诉</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className='text-right'>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableLoading colSpan={6} />
                ) : filteredVisits.length === 0 ? (
                  <EmptyState colSpan={6} text="暂无就诊记录" />
                ) : (
                  filteredVisits.map(visit => (
                    <TableRow
                      key={visit.id}
                      className={`cursor-pointer hover:bg-muted/50 ${selectedVisit?.id === visit.id ? 'bg-muted/50' : ''}`}
                      onClick={() => handleSelectVisit(visit)}
                    >
                      <TableCell>
                        <div className='font-medium'>{visit.patient?.name ?? '-'}</div>
                        <div className='text-xs text-muted-foreground'>{visit.patient?.phone}</div>
                      </TableCell>
                      <TableCell>{visit.doctor?.name ?? '-'}</TableCell>
                      <TableCell className='max-w-xs truncate text-muted-foreground'>
                        {visit.chiefComplaint || '-'}
                      </TableCell>
                      <TableCell className='text-sm text-muted-foreground'>
                        {format(new Date(visit.startTime), 'HH:mm', { locale: zhCN })}
                      </TableCell>
                      <TableCell>
                        <Badge className={VISIT_STATUS_COLOR[visit.status]}>
                          {VISIT_STATUS_LABEL[visit.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right' onClick={e => e.stopPropagation()}>
                        {visit.status === 'IN_PROGRESS' && (
                          <Button size='sm' onClick={() => handleComplete(visit)}>
                            <Check className='w-3 h-3 mr-1' />
                            完成
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* 右侧：就诊详情 */}
        <Card>
          <CardHeader className='pb-3'>
            <span className='font-medium'>就诊详情</span>
          </CardHeader>
          <CardContent>
            {!selectedVisit ? (
              <div className='text-center py-12 text-muted-foreground'>
                <Stethoscope className='w-12 h-12 mx-auto mb-3 opacity-30' />
                <p className='text-sm'>点击左侧列表选择就诊记录</p>
              </div>
            ) : (
              <VisitDetailPanel
                visit={selectedVisit}
                onNavigate={navigate}
                onComplete={() => handleComplete(selectedVisit)}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <CreateVisitDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setPresetAppointment(null);
        }}
        preset={presetAppointment}
        defaultDoctorId={user?.role === 'DOCTOR' ? user.id : undefined}
        onCreate={createVisit.mutateAsync}
      />

      {selectedVisit && (
        <CompleteVisitDialog
          open={completeOpen}
          onClose={() => setCompleteOpen(false)}
          visit={selectedVisit}
          onComplete={completeVisit.mutateAsync}
        />
      )}
    </div>
  );
}

function VisitDetailPanel({
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
            onNavigate(`/charge-v2?${params.toString()}`);
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

function CreateVisitDialog({
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
              <Label>患者 *</Label>
              <Button
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

function CompleteVisitDialog({
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
