import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Check,
  Stethoscope,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
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
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { useAuthStore } from '@/lib/store/auth-store';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { VisitDetailPanel } from './components/VisitDetailPanel';
import { CreateVisitDialog } from './components/CreateVisitDialog';
import { CompleteVisitDialog } from './components/CompleteVisitDialog';

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
  const { data, isLoading, isError, refetch } = useVisitsList({
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
                {isError ? (
                  <tr><td colSpan={6}><QueryErrorAlert onRetry={refetch} /></td></tr>
                ) : isLoading ? (
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
