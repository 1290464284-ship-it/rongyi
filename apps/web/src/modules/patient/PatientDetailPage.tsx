import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Receipt, Pill, ClipboardList, Image as ImageIcon, Phone, MapPin, Briefcase, AlertTriangle, Heart, Activity, Calendar, User, Pencil, BellRing, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToothChart } from '@/components/tooth/ToothChart';
import { Timeline } from '@/components/patient/Timeline';
import { usePatient, PATIENT_SOURCE_LABEL, PATIENT_SOURCE_COLOR } from '@/lib/patients';
import { useAppointments, APPOINTMENT_STATUS_LABEL } from '@/lib/appointments';
import { useVisits } from '@/lib/visits';
import { useTreatments } from '@/lib/treatments';
import { useToothRecords } from '@/lib/tooth-records';
import { useCharges, CHARGE_STATUS_LABEL, CHARGE_STATUS_COLOR, PAY_METHOD_LABEL } from '@/lib/charges';
import { usePrescriptions } from '@/lib/prescriptions';
import { useTreatmentPlans, PLAN_STATUS_LABEL, PLAN_STATUS_COLOR } from '@/lib/treatment-plans';
import { useImagingList, IMAGING_TYPE_LABEL, IMAGING_TYPE_COLOR } from '@/lib/imaging';
import {
  useFollowUpsV2 as usePatientFollowUps,
  useCreateFollowUpV2 as useCreateFollowUp,
  useUpdateFollowUpV2 as useUpdateFollowUp,
  FOLLOW_UP_STATUS_LABEL,
  FOLLOW_UP_STATUS_COLOR,
} from '@/lib/follow-ups-v2';
import { useStaff } from '@/lib/staff';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import PatientForm from './PatientForm';
import OralExaminationPanel from '../clinical/OralExaminationPanel';
import PeriodontalRecordPanel from '../clinical/PeriodontalRecordPanel';
import { PageLoading } from '@/components/ui/loading';

type Tab = 'timeline' | 'tooth' | 'oral-exam' | 'perio' | 'appointments' | 'follow-ups' | 'charges' | 'prescriptions' | 'treatment-plans' | 'imaging';

function calcAge(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}

const genderText = (g?: string) =>
  ({ MALE: '男', FEMALE: '女', UNKNOWN: '未知' } as Record<string, string>)[g ?? ''] ?? g;

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <span className="text-muted-foreground w-16 flex-shrink-0">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function TagList({ items, color, emptyText }: { items?: string[]; color: string; emptyText: string }) {
  if (!items || items.length === 0) return <span className="text-xs text-muted-foreground">{emptyText}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) => (
        <Badge key={t} className={color}>{t}</Badge>
      ))}
    </div>
  );
}

function FollowUpPanel({ patientId }: { patientId: string }) {
  const { data: fuData } = usePatientFollowUps({ patientId });
  const followUps = fuData?.items ?? [];
  const { data: staff = [] } = useStaff();
  const createFu = useCreateFollowUp();
  const updateFu = useUpdateFollowUp();
  const [open, setOpen] = useState(false);
  const [planDate, setPlanDate] = useState('');
  const [content, setContent] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const submit = async () => {
    if (!planDate) return;
    await createFu.mutateAsync({ patientId, followUpDate: planDate, content: content || '' });
    setOpen(false);
    setPlanDate('');
    setContent('');
    setAssigneeId('');
  };

  const doctors = staff.filter((s) => s.role === 'DOCTOR' || s.role === 'BOSS');

  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">随访记录</h2>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新建随访</Button>
      </div>
      {followUps.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">暂无随访记录</p>
      ) : (
        <div className="space-y-2">
          {followUps.map((fu: any) => (
            <div key={fu.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Badge className={FOLLOW_UP_STATUS_COLOR[fu.status as keyof typeof FOLLOW_UP_STATUS_COLOR] ?? 'bg-muted text-muted-foreground'}>
                    {FOLLOW_UP_STATUS_LABEL[fu.status as keyof typeof FOLLOW_UP_STATUS_LABEL] ?? fu.status}
                  </Badge>
                  <span className="text-sm font-medium">{formatDate(fu.planDate)}</span>
                </div>
                {fu.status === 'PENDING' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={updateFu.isPending} onClick={() => updateFu.mutate({ id: fu.id, data: { status: 'COMPLETED' } })}>完成</Button>
                    <Button size="sm" variant="ghost" disabled={updateFu.isPending} onClick={() => updateFu.mutate({ id: fu.id, data: { status: 'CANCELLED' } })}>取消</Button>
                  </div>
                )}
              </div>
              {fu.content && <p className="text-sm text-foreground mb-1">{fu.content}</p>}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {fu.assigneeName && <span>负责人：{fu.assigneeName}</span>}
                {fu.result && <span>结果：{fu.result}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} className="max-w-md">
        <DialogHeader><DialogTitle>新建随访</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plan-date">计划日期 *</Label>
              <Input id="plan-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="follow-up-content">随访内容</Label>
              <Textarea id="follow-up-content" value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="随访事项..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assignee">负责人</Label>
              <Select id="assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full">
                <option value="">不指定</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button disabled={!planDate || createFu.isPending} onClick={submit}>创建</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PatientDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('timeline');
  const [selectedTooth, setSelectedTooth] = useState<number | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);

  const { data: patient, isLoading: patientLoading, isError: patientError, refetch: refetchPatient } = usePatient(id);
  const { data: apptData, isLoading: apptLoading } = useAppointments({ patientId: id });
  const { data: visitData } = useVisits(id);
  const { data: treatmentData } = useTreatments(id);
  const { data: teethData } = useToothRecords({ patientId: id });
  const teeth = teethData?.items ?? [];
  const { data: chargesData } = useCharges({ patientId: id, pageSize: 50 });
  const { data: rxData } = usePrescriptions({ patientId: id, pageSize: 50 });
  const { data: plansData } = useTreatmentPlans({ patientId: id, pageSize: 50 });
  const { data: imagingData } = useImagingList({ patientId: id, pageSize: 50 });

  const appointments = apptData?.items ?? [];
  const visits = visitData?.items ?? [];
  const treatments = treatmentData?.items ?? [];
  const charges = chargesData?.items ?? [];
  const prescriptions = rxData?.items ?? [];
  const plans = plansData?.items ?? [];
  const imagings = imagingData?.items ?? [];

  const age = patient ? calcAge(patient.birthDate) : null;

  const tabs: { key: Tab; label: string; icon?: any }[] = [
    { key: 'timeline', label: '就诊时间轴' },
    { key: 'tooth', label: '牙位详情' },
    { key: 'oral-exam', label: '口腔检查' },
    { key: 'perio', label: '牙周检查' },
    { key: 'appointments', label: '预约记录' },
    { key: 'follow-ups', label: '随访', icon: BellRing },
    { key: 'treatment-plans', label: '治疗计划', icon: ClipboardList },
    { key: 'prescriptions', label: '处方', icon: Pill },
    { key: 'charges', label: '收费', icon: Receipt },
    { key: 'imaging', label: '影像', icon: ImageIcon },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => nav('/patients')} aria-label="返回">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold">
            {patientLoading ? '加载中…' : patientError ? '加载失败' : patient?.name}
            {patient && <Badge className="ml-2 bg-muted text-muted-foreground font-mono">{patient.code}</Badge>}
          </h1>
        </div>
        {patientError && (
          <Button variant="outline" size="sm" onClick={() => refetchPatient()}>
            <RefreshCw className="h-4 w-4 mr-1" />重试
          </Button>
        )}
        {patient && (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" />编辑
          </Button>
        )}
      </div>

      {patientError && !patient && (
        <Card>
          <CardHeader><CardTitle className="text-destructive">加载失败</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">患者数据加载失败，请检查网络连接后重试。</p>
            <Button variant="outline" onClick={() => refetchPatient()}>
              <RefreshCw className="h-4 w-4 mr-1" />重新加载
            </Button>
          </CardContent>
        </Card>
      )}

      {patientLoading && !patient && (
        <div className="space-y-4">
          <PageLoading />
        </div>
      )}

      {patient && (
      <div className="grid grid-cols-[420px_1fr] gap-6">
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-4 space-y-3">
              <div className="flex items-center gap-3 pb-3 border-b border-border">
                <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-semibold flex-shrink-0">
                  {patient.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-base">{patient.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {genderText(patient.gender)}{age !== null && ` · ${age}岁`}
                  </div>
                  <div className="mt-1">
                    <Badge className={PATIENT_SOURCE_COLOR[patient.source] ?? 'bg-muted text-muted-foreground'}>
                      {PATIENT_SOURCE_LABEL[patient.source] ?? patient.source}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <InfoRow icon={Phone} label="手机" value={patient.phone} />
                <InfoRow icon={Calendar} label="生日" value={patient.birthDate ? formatDate(patient.birthDate) : undefined} />
                <InfoRow icon={User} label="身份证" value={patient.idCard} />
                <InfoRow icon={Briefcase} label="职业" value={patient.occupation} />
                <InfoRow icon={MapPin} label="地址" value={patient.address} />
                <InfoRow icon={User} label="紧急联系人" value={patient.emergencyContact} />
                <InfoRow icon={Phone} label="紧急电话" value={patient.emergencyPhone} />
                <InfoRow icon={User} label="推荐人" value={patient.referrer} />
              </div>

              {patient.tags && patient.tags.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1.5">标签</div>
                  <TagList items={patient.tags} color="bg-info/10 text-info" emptyText="" />
                </div>
              )}

              <div className="pt-2 border-t border-border space-y-2">
                <div>
                  <div className="text-xs text-destructive mb-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />过敏史</div>
                  <TagList items={patient.allergies} color="bg-destructive/10 text-destructive" emptyText="无" />
                </div>
                <div>
                  <div className="text-xs text-warning mb-1.5 flex items-center gap-1"><Heart className="w-3 h-3" />全身疾病</div>
                  <TagList items={patient.systemicDiseases} color="bg-warning/10 text-warning" emptyText="无" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><ClipboardList className="w-3 h-3" />既往史</div>
                  <TagList items={patient.medicalHistory} color="bg-primary/10 text-primary" emptyText="无" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Activity className="w-3 h-3" />用药史</div>
                  <TagList items={patient.medicationHistory} color="bg-primary/10 text-primary" emptyText="无" />
                </div>
              </div>

              {patient.remark && (
                <div className="pt-2 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1">备注</div>
                  <p className="text-sm text-foreground">{patient.remark}</p>
                </div>
              )}

              {patient.familyMembers && patient.familyMembers.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1.5">家庭成员</div>
                  <div className="space-y-1">
                    {patient.familyMembers.map((fm) => (
                      <button
                        key={fm.id}
                        className="flex items-center justify-between w-full text-sm hover:bg-muted/50 rounded px-2 py-1"
                        onClick={() => nav(`/patients/${fm.id}`)}
                      >
                        <span>{fm.name}</span>
                        <span className="text-xs text-muted-foreground">{fm.code}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

          <div className="rounded-lg border border-border bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">牙位图</h2>
              {selectedTooth && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedTooth(undefined)}>
                  清除筛选（牙位 {selectedTooth}）
                </Button>
              )}
            </div>
            <ToothChart
              teeth={teeth ?? []}
              selectedTooth={selectedTooth}
              onSelectTooth={(n) => setSelectedTooth((prev) => (prev === n ? undefined : n))}
            />
            <p className="text-xs text-muted-foreground mt-2">
              {selectedTooth
                ? `已选牙位 ${selectedTooth}，右侧时间轴已过滤为该牙的治疗记录`
                : '点击牙位筛选右侧时间轴'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-1 border-b border-border flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === t.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setTab(t.key)}
              >
                {t.icon && <t.icon className="w-3.5 h-3.5" />}
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'timeline' && (
            <div className="rounded-lg border border-border bg-white p-4">
              {selectedTooth && (
                <div className="mb-3 rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
                  时间轴已按牙位 {selectedTooth} 过滤治疗记录
                </div>
              )}
              <Timeline
                appointments={appointments}
                visits={visits}
                treatments={treatments}
                toothFilter={selectedTooth}
              />
            </div>
          )}

          {tab === 'tooth' && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-2">
              <h2 className="text-sm font-medium mb-2">牙位记录详情</h2>
              {(teeth ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无牙位记录</p>
              ) : (
                (teeth ?? []).map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold w-8">{t.toothNumber}</span>
                      <Badge className="bg-muted text-muted-foreground">{t.currentStatus}</Badge>
                      {t.conditions.map((c) => (
                        <Badge key={c} className="bg-primary/10 text-primary">{c}</Badge>
                      ))}
                    </div>
                    {t.remark && <span className="text-xs text-muted-foreground">{t.remark}</span>}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'oral-exam' && (
            <div className="rounded-lg border border-border bg-white p-4">
              <OralExaminationPanel patientId={id} />
            </div>
          )}

          {tab === 'perio' && (
            <div className="rounded-lg border border-border bg-white p-4">
              <PeriodontalRecordPanel patientId={id} />
            </div>
          )}

          {tab === 'appointments' && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-2">
              <h2 className="text-sm font-medium mb-2">预约记录</h2>
              {appointments.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无预约</p>
              ) : (
                appointments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{a.doctor.name} · {a.type}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(a.startTime)} {new Date(a.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <Badge className="bg-primary/10 text-primary">{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'follow-ups' && <FollowUpPanel patientId={id} />}

          {tab === 'treatment-plans' && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-3">
              <h2 className="text-sm font-medium mb-2">治疗计划</h2>
              {plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无治疗计划</p>
              ) : (
                plans.map((plan) => (
                  <div key={plan.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">{plan.title}</div>
                      <Badge className={PLAN_STATUS_COLOR[plan.status]}>
                        {PLAN_STATUS_LABEL[plan.status]}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      医生：{plan.doctor?.name} · {plan.items.length} 项 · 预计 ¥{Number(plan.totalPrice).toFixed(2)}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {plan.items.slice(0, 5).map(item => (
                        <Badge key={item.id} className="bg-muted text-muted-foreground">
                          {item.treatmentCatalogName}
                        </Badge>
                      ))}
                      {plan.items.length > 5 && (
                        <Badge className="bg-muted text-muted-foreground">+{plan.items.length - 5}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      {format(new Date(plan.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'prescriptions' && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-3">
              <h2 className="text-sm font-medium mb-2">处方记录</h2>
              {prescriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无处方</p>
              ) : (
                prescriptions.map((rx) => (
                  <div key={rx.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium">
                        {rx.items.length} 种药品
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(rx.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      医生：{rx.doctor?.name}
                    </div>
                    <div className="space-y-1">
                      {rx.items.map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span>{item.drugName} {item.spec}</span>
                          <span className="text-muted-foreground">
                            {item.dosage} {item.frequency} ×{item.days}天
                          </span>
                        </div>
                      ))}
                    </div>
                    {rx.remark && (
                      <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
                        备注：{rx.remark}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'charges' && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-3">
              <h2 className="text-sm font-medium mb-2">收费记录</h2>
              {charges.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无收费记录</p>
              ) : (
                charges.map((c) => (
                  <div key={c.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-mono text-xs">{c.number}</div>
                      <Badge className={CHARGE_STATUS_COLOR[c.status]}>
                        {CHARGE_STATUS_LABEL[c.status]}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="text-sm text-muted-foreground">
                          {c.items.length} 项
                          {c.payMethod && ` · ${PAY_METHOD_LABEL[c.payMethod]}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(c.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-primary">
                          ¥{Number(c.totalAmount).toFixed(2)}
                        </div>
                        {Number(c.paidAmount) > 0 && Number(c.paidAmount) < Number(c.totalAmount) && (
                          <div className="text-xs text-muted-foreground">
                            已付 ¥{Number(c.paidAmount).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                      {c.items.map(item => (
                        <div key={item.id} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{item.name}</span>
                          <span>¥{Number(item.subtotal).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'imaging' && (
            <div className="rounded-lg border border-border bg-white p-4 space-y-3">
              <h2 className="text-sm font-medium mb-2">影像记录</h2>
              {imagings.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无影像记录</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {imagings.map((img) => (
                    <div
                      key={img.id}
                      className="border border-border rounded-md overflow-hidden cursor-pointer hover:shadow-sm transition-shadow"
                      onClick={() => nav(`/imaging?patientId=${id}`)}
                    >
                      <div className="aspect-video bg-muted flex items-center justify-center relative">
                        {img.thumbnailUrl || img.imageUrl ? (
                          <img
                            src={img.thumbnailUrl || img.imageUrl}
                            alt={img.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                        )}
                        <div className="absolute top-1 left-1">
                          <Badge className={IMAGING_TYPE_COLOR[img.type]}>
                            {IMAGING_TYPE_LABEL[img.type]}
                          </Badge>
                        </div>
                      </div>
                      <div className="p-2">
                        <div className="text-sm font-medium truncate">{img.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {img.takenAt ? format(new Date(img.takenAt), 'yyyy-MM-dd', { locale: zhCN }) : '-'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} className="max-w-2xl">
        <DialogHeader><DialogTitle>编辑患者</DialogTitle></DialogHeader>
        <DialogContent>
          {patient && (
            <PatientForm
              onClose={() => setEditOpen(false)}
              onSaved={() => setEditOpen(false)}
              initialPatient={patient}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
