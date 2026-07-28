import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Search, Play, Check, X, UserCheck, User } from 'lucide-react';
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
  useRegistrations,
  useCreateRegistration,
  useTriageRegistration,
  useStartVisitRegistration,
  useCompleteRegistration,
  useCancelRegistration,
  REGISTRATION_STATUS_LABEL,
  REGISTRATION_STATUS_COLOR,
  REGISTRATION_TYPE_LABEL,
  REGISTRATION_TYPE_COLOR,
  type Registration,
  type RegistrationStatus,
  type RegistrationType,
  type CreateRegistrationDto,
  type TriageRegistrationDto,
} from '@/lib/api/clinical/registrations';
import { useStaff } from '@/lib/staff';
import { useAuthStore } from '@/lib/store/auth-store';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';

type TabKey = 'registered' | 'triaged' | 'in-progress' | 'completed';

const TAB_STATUS_MAP: Record<TabKey, RegistrationStatus> = {
  registered: 'REGISTERED',
  triaged: 'TRIAGED',
  'in-progress': 'IN_PROGRESS',
  completed: 'COMPLETED',
};

const TAB_LABELS: Record<TabKey, string> = {
  registered: '挂号列表',
  triaged: '分诊列表',
  'in-progress': '接诊中',
  completed: '已完成',
};

const RegistrationPage = React.memo(function RegistrationPage() {
  const user = useAuthStore(s => s.user);
  const [activeTab, setActiveTab] = useState<TabKey>('registered');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState<Registration | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false);

  const status = TAB_STATUS_MAP[activeTab];

  const { data, isLoading, isError, refetch } = useRegistrations({
    status,
    page,
    pageSize,
  });

  const createRegistration = useCreateRegistration();
  const triageRegistration = useTriageRegistration();
  const startVisitRegistration = useStartVisitRegistration();
  const completeRegistration = useCompleteRegistration();
  const cancelRegistration = useCancelRegistration();

  const registrations = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredRegistrations = useMemo(() => {
    if (!keyword) return registrations;
    const kw = keyword.toLowerCase();
    return registrations.filter(
      r =>
        r.patient?.name?.toLowerCase().includes(kw) ||
        r.patient?.code?.toLowerCase().includes(kw) ||
        r.patient?.phone?.includes(kw) ||
        r.doctor?.name?.toLowerCase().includes(kw) ||
        r.chiefComplaint?.toLowerCase().includes(kw),
    );
  }, [registrations, keyword]);

  function handleTriage(registration: Registration) {
    setSelectedRegistration(registration);
    setTriageOpen(true);
  }

  async function handleStartVisit(registration: Registration) {
    try {
      await startVisitRegistration.mutateAsync(registration.id);
      toast.success('开始接诊成功');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '开始接诊失败');
    }
  }

  function handleComplete(registration: Registration) {
    setSelectedRegistration(registration);
    setConfirmCompleteOpen(true);
  }

  async function handleConfirmComplete() {
    if (!selectedRegistration) return;
    try {
      await completeRegistration.mutateAsync(selectedRegistration.id);
      toast.success('接诊完成');
      setConfirmCompleteOpen(false);
      setSelectedRegistration(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  }

  function handleCancel(registration: Registration) {
    setSelectedRegistration(registration);
    setConfirmCancelOpen(true);
  }

  async function handleConfirmCancel() {
    if (!selectedRegistration) return;
    try {
      await cancelRegistration.mutateAsync(selectedRegistration.id);
      toast.success('已取消挂号');
      setConfirmCancelOpen(false);
      setSelectedRegistration(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  }

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab);
    setPage(1);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">就诊任务</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建挂号
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索患者姓名/编号/电话/医生/主诉"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-1 mt-4 border-b border-border -mx-6 px-6">
            {(Object.keys(TAB_LABELS) as TabKey[]).map(tab => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>患者</TableHead>
                <TableHead>挂号类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>主治医生</TableHead>
                <TableHead>主诉</TableHead>
                <TableHead>挂号时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <tr><td colSpan={7}><QueryErrorAlert onRetry={refetch} /></td></tr>
              ) : isLoading ? (
                <TableLoading colSpan={7} />
              ) : filteredRegistrations.length === 0 ? (
                <EmptyState colSpan={7} text="暂无数据" />
              ) : (
                filteredRegistrations.map(registration => (
                  <TableRow key={registration.id}>
                    <TableCell>
                      <div className="font-medium">{registration.patient?.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {registration.patient?.code} · {registration.patient?.phone} · {registration.patient?.gender === 'MALE' ? '男' : registration.patient?.gender === 'FEMALE' ? '女' : '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={REGISTRATION_TYPE_COLOR[registration.type]}>
                        {REGISTRATION_TYPE_LABEL[registration.type]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={REGISTRATION_STATUS_COLOR[registration.status]}>
                        {REGISTRATION_STATUS_LABEL[registration.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{registration.doctor?.name || '-'}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {registration.chiefComplaint || '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {registration.registeredAt ? format(new Date(registration.registeredAt), 'yyyy-MM-dd HH:mm', { locale: zhCN }) : '-'}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {registration.status === 'REGISTERED' && (
                        <>
                          <Button size="sm" variant="default" onClick={() => handleTriage(registration)}>
                            <UserCheck className="w-3 h-3 mr-1" />
                            分诊
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleCancel(registration)}>
                            <X className="w-3 h-3 mr-1 text-destructive" />
                            取消
                          </Button>
                        </>
                      )}
                      {registration.status === 'TRIAGED' && (
                        <Button size="sm" variant="default" onClick={() => handleStartVisit(registration)}>
                          <Play className="w-3 h-3 mr-1" />
                          开始接诊
                        </Button>
                      )}
                      {registration.status === 'IN_PROGRESS' && (
                        <Button size="sm" variant="default" onClick={() => handleComplete(registration)}>
                          <Check className="w-3 h-3 mr-1" />
                          完成
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateRegistrationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createRegistration.mutateAsync}
        defaultDoctorId={user?.role === 'DOCTOR' ? user.id : undefined}
      />

      {selectedRegistration && (
        <>
          <TriageDialog
            open={triageOpen}
            onClose={() => {
              setTriageOpen(false);
              setSelectedRegistration(null);
            }}
            registration={selectedRegistration}
            onTriage={triageRegistration.mutateAsync}
          />

          <ConfirmDialog
            open={confirmCancelOpen}
            onClose={() => {
              setConfirmCancelOpen(false);
              setSelectedRegistration(null);
            }}
            title="确认取消挂号"
            description={`确定要取消 ${selectedRegistration.patient?.name} 的挂号吗？`}
            confirmText="确认取消"
            confirmVariant="destructive"
            onConfirm={handleConfirmCancel}
          />

          <ConfirmDialog
            open={confirmCompleteOpen}
            onClose={() => {
              setConfirmCompleteOpen(false);
              setSelectedRegistration(null);
            }}
            title="确认完成接诊"
            description={`确定要完成 ${selectedRegistration.patient?.name} 的接诊吗？`}
            confirmText="确认完成"
            onConfirm={handleConfirmComplete}
          />
        </>
      )}
    </div>
  );
});
export default RegistrationPage;

function CreateRegistrationDialog({
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

function TriageDialog({
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

function ConfirmDialog({
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
