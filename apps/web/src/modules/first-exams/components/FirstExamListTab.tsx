import { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Search,
  Eye,
  CheckCircle,
  RotateCcw,
  UserMinus,
  X,
  Check,
  Trash2,
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
  useFirstExams,
  useFirstExam,
  useCreateFirstExam,
  useDeleteFirstExam,
  useCompleteFirstExam,
  useRestartFirstExam,
  useFirstExamTeeth,
  useUpdateTooth,
  DENTITION_TYPE_LABEL,
  TOOTH_STATUS_LABEL,
  TOOTH_STATUS_COLOR,
  FIRST_EXAM_STATUS_LABEL,
  FIRST_EXAM_STATUS_COLOR,
  type FirstExam,
  type FirstExamStatus,
  type DentitionType,
  type ToothStatus,
  type CreateFirstExamDto,
} from '@/lib/first-exams';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { useStaff } from '@/lib/staff';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';

const PERMANENT_TEETH_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const PERMANENT_TEETH_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const DECIDUOUS_TEETH_UPPER = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const DECIDUOUS_TEETH_LOWER = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

const DISEASE_OPTIONS = ['龋齿', '牙髓炎', '根尖周炎', '牙周炎', '智齿冠周炎', '其他'];

export function FirstExamListTab() {
  const [statusFilter, setStatusFilter] = useState<FirstExamStatus | ''>('');
  const [keyword, setKeyword] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedExam, setSelectedExam] = useState<FirstExam | null>(null);

  const { data, isLoading } = useFirstExams({
    status: statusFilter || undefined,
    page,
    pageSize,
  });

  const createExam = useCreateFirstExam();
  const completeExam = useCompleteFirstExam();
  const restartExam = useRestartFirstExam();
  const deleteExam = useDeleteFirstExam();

  const exams = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredExams = useMemo(() => {
    let result = exams;
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter(
        (e) =>
          e.patient?.name?.toLowerCase().includes(kw) ||
          e.patient?.phone?.includes(kw),
      );
    }
    if (dateFilter) {
      result = result.filter((e) => e.createdAt.slice(0, 10) === dateFilter);
    }
    return result;
  }, [exams, keyword, dateFilter]);

  function handleViewDetail(exam: FirstExam) {
    setSelectedExam(exam);
    setDetailOpen(true);
  }

  async function handleComplete(id: string) {
    try {
      await completeExam.mutateAsync(id);
      toast.success('已完成首诊');
    } catch {
      toast.error('操作失败');
    }
  }

  async function handleRestart(id: string) {
    try {
      await restartExam.mutateAsync(id);
      toast.success('已重新开始');
    } catch {
      toast.error('操作失败');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定要删除该首诊记录吗？')) return;
    try {
      await deleteExam.mutateAsync(id);
      toast.success('删除成功');
    } catch {
      toast.error('删除失败');
    }
  }

  function handleMarkLost(_exam: FirstExam) {
    toast.info('流失追踪功能请切换到「流失追踪」标签页');
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索患者姓名/电话"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as FirstExamStatus | '');
                setPage(1);
              }}
              className="w-36"
            >
              <option value="">全部状态</option>
              <option value="PENDING">待开始</option>
              <option value="IN_PROGRESS">进行中</option>
              <option value="COMPLETED">已完成</option>
            </Select>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-40"
            />
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              新建首诊
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>患者姓名</TableHead>
                <TableHead>性别</TableHead>
                <TableHead>年龄</TableHead>
                <TableHead>牙列类型</TableHead>
                <TableHead>主诉</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>医生</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={9} />
              ) : filteredExams.length === 0 ? (
                <EmptyState colSpan={9} text="暂无数据" />
              ) : (
                filteredExams.map((exam) => (
                  <TableRow key={exam.id}>
                    <TableCell className="font-medium">
                      {exam.patient?.name || '-'}
                    </TableCell>
                    <TableCell>{exam.patient?.gender || '-'}</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>{DENTITION_TYPE_LABEL[exam.dentitionType || 'PERMANENT']}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {exam.chiefComplaint || '-'}
                    </TableCell>
                    <TableCell>
                      <Badge className={FIRST_EXAM_STATUS_COLOR[exam.status]}>
                        {FIRST_EXAM_STATUS_LABEL[exam.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(exam.createdAt), 'yyyy-MM-dd HH:mm', {
                        locale: zhCN,
                      })}
                    </TableCell>
                    <TableCell>{exam.doctor?.name || '-'}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleViewDetail(exam)}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        详情
                      </Button>
                      {exam.status !== 'COMPLETED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleComplete(exam.id)}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          完成
                        </Button>
                      )}
                      {exam.status === 'COMPLETED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRestart(exam.id)}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          重新开始
                        </Button>
                      )}
                      {exam.status !== 'COMPLETED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMarkLost(exam)}
                        >
                          <UserMinus className="w-3 h-3 mr-1" />
                          标记流失
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(exam.id)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        删除
                      </Button>
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateFirstExamDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createExam.mutateAsync}
      />

      {selectedExam && (
        <FirstExamDetailDialog
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          examId={selectedExam.id}
        />
      )}
    </>
  );
}

function CreateFirstExamDialog({
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

function FirstExamDetailDialog({
  open,
  onClose,
  examId,
}: {
  open: boolean;
  onClose: () => void;
  examId: string;
}) {
  const { data: exam } = useFirstExam(open ? examId : undefined);
  const { data: teeth = [] } = useFirstExamTeeth(open ? examId : undefined);
  const updateToothMut = useUpdateTooth();

  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [toothStatus, setToothStatus] = useState<ToothStatus>('SOUND');
  const [diseases, setDiseases] = useState<string[]>([]);
  const [diseaseInput, setDiseaseInput] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');

  const upperTeeth =
    exam?.dentitionType === 'DECIDUOUS' ? DECIDUOUS_TEETH_UPPER : PERMANENT_TEETH_UPPER;
    const lowerTeeth =
    exam?.dentitionType === 'DECIDUOUS' ? DECIDUOUS_TEETH_LOWER : PERMANENT_TEETH_LOWER;

  const selectedToothData = useMemo(() => {
    if (selectedTooth === null) return null;
    return teeth.find((t) => t.toothNumber === selectedTooth);
  }, [selectedTooth, teeth]);

  function handleToothClick(toothNumber: number) {
    setSelectedTooth(toothNumber);
    const toothData = teeth.find((t) => t.toothNumber === toothNumber);
    setToothStatus(toothData?.status || 'SOUND');
    setDiseases(toothData?.notes ? toothData.notes.split(',') : []);
  }

  async function handleStatusChange(status: ToothStatus) {
    if (selectedTooth === null || !exam) return;
    setToothStatus(status);
    const toothData = teeth.find((t) => t.toothNumber === selectedTooth);
    if (toothData) {
      try {
        await updateToothMut.mutateAsync({
          examId: exam.id,
          toothNumber: selectedTooth.toString(),
          data: { status },
        });
        toast.success('已更新牙位状态');
      } catch {
        toast.error('更新失败');
      }
    }
  }

  function addDisease(disease: string) {
    if (!disease.trim() || diseases.includes(disease)) return;
    setDiseases([...diseases, disease]);
    setDiseaseInput('');
  }

  function removeDisease(disease: string) {
    setDiseases(diseases.filter((d) => d !== disease));
  }

  async function saveDiseases() {
    if (selectedTooth === null || !exam) return;
    const toothData = teeth.find((t) => t.toothNumber === selectedTooth);
    if (toothData) {
      try {
        await updateToothMut.mutateAsync({
          examId: exam.id,
          toothNumber: selectedTooth.toString(),
          data: { notes: diseases.join(',') },
        });
        toast.success('已保存疾病标注');
      } catch {
        toast.error('保存失败');
      }
    }
  }

  function getToothStatus(toothNumber: number): ToothStatus {
    const tooth = teeth.find((t) => t.toothNumber === toothNumber);
    return tooth?.status || 'SOUND';
  }

  function getToothColorClass(toothNumber: number): string {
    const status = getToothStatus(toothNumber);
    const colorMap: Record<ToothStatus, string> = {
      SOUND: 'bg-green-100 border-green-300 text-green-700 hover:bg-green-200',
      NORMAL: 'bg-green-100 border-green-300 text-green-700 hover:bg-green-200',
      CARIES: 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200',
      MISSING: 'bg-gray-200 border-gray-400 text-gray-600 hover:bg-gray-300',
      UNERUPTED: 'bg-gray-100 border-gray-300 text-gray-500 hover:bg-gray-200',
      IMPACTED: 'bg-yellow-100 border-yellow-300 text-yellow-700 hover:bg-yellow-200',
      RESTORED: 'bg-blue-100 border-blue-300 text-blue-700 hover:bg-blue-200',
      EXTRACTED: 'bg-gray-200 border-gray-400 text-gray-600 hover:bg-gray-300',
    };
    return colorMap[status];
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-6xl">
      <DialogHeader>
        <DialogTitle>首诊详情</DialogTitle>
      </DialogHeader>
      <DialogContent>
        {exam && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
              <div>
                <div className="text-xs text-muted-foreground mb-1">患者</div>
                <div className="font-medium">{exam.patient?.name || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">牙列类型</div>
                <div className="font-medium">{DENTITION_TYPE_LABEL[exam.dentitionType || 'PERMANENT']}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">主诉</div>
                <div className="font-medium truncate">{exam.chiefComplaint || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">状态</div>
                <Badge className={FIRST_EXAM_STATUS_COLOR[exam.status]}>
                  {FIRST_EXAM_STATUS_LABEL[exam.status]}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-3">牙位图</h3>
                  <div className="p-4 bg-white border border-border rounded-lg space-y-4">
                    <div className="flex justify-center">
                      <div className="grid grid-cols-16 gap-1">
                        {upperTeeth.map((toothNum) => (
                          <button
                            key={toothNum}
                            onClick={() => handleToothClick(toothNum)}
                            className={`w-9 h-10 rounded border-2 text-xs font-medium transition-all ${
                              selectedTooth === toothNum
                                ? 'ring-2 ring-primary ring-offset-1'
                                : ''
                            } ${getToothColorClass(toothNum)}`}
                          >
                            {toothNum}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-center">
                      <div className="w-full h-px bg-border" />
                    </div>
                    <div className="flex justify-center">
                      <div className="grid grid-cols-16 gap-1">
                        {lowerTeeth.map((toothNum) => (
                          <button
                            key={toothNum}
                            onClick={() => handleToothClick(toothNum)}
                            className={`w-9 h-10 rounded border-2 text-xs font-medium transition-all ${
                              selectedTooth === toothNum
                                ? 'ring-2 ring-primary ring-offset-1'
                                : ''
                            } ${getToothColorClass(toothNum)}`}
                          >
                            {toothNum}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 justify-center pt-2 border-t border-border">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-green-100 border border-green-300" />
                        <span className="text-xs text-muted-foreground">健康</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-gray-200 border border-gray-400" />
                        <span className="text-xs text-muted-foreground">缺失</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-gray-100 border border-gray-300" />
                        <span className="text-xs text-muted-foreground">未萌出</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />
                        <span className="text-xs text-muted-foreground">阻生</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" />
                        <span className="text-xs text-muted-foreground">已修复</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">治疗计划</h3>
                  <Textarea
                    rows={4}
                    placeholder="请输入治疗建议和计划..."
                    value={treatmentPlan}
                    onChange={(e) => setTreatmentPlan(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-white border border-border rounded-lg">
                  <h3 className="text-sm font-semibold mb-3">
                    {selectedTooth ? `牙位 ${selectedTooth} - 状态设置` : '请选择牙位'}
                  </h3>
                  {selectedTooth ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        {(Object.keys(TOOTH_STATUS_LABEL) as ToothStatus[]).map((status) => (
                          <Button
                            key={status}
                            variant={toothStatus === status ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handleStatusChange(status)}
                            className="text-xs"
                          >
                            {TOOTH_STATUS_LABEL[status]}
                          </Button>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                        当前状态：
                        <Badge className={TOOTH_STATUS_COLOR[toothStatus]}>
                          {TOOTH_STATUS_LABEL[toothStatus]}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">点击左侧牙位进行选择</p>
                  )}
                </div>

                <div className="p-4 bg-white border border-border rounded-lg">
                  <h3 className="text-sm font-semibold mb-3">疾病标注</h3>
                  {selectedTooth ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1">
                        {diseases.length === 0 ? (
                          <p className="text-xs text-muted-foreground">暂无疾病标注</p>
                        ) : (
                          diseases.map((d) => (
                            <Badge
                              key={d}
                              className="bg-red-100 text-red-700 border-red-200 cursor-pointer hover:bg-red-200"
                              onClick={() => removeDisease(d)}
                            >
                              {d}
                              <X className="w-3 h-3 ml-1" />
                            </Badge>
                          ))
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Select
                          value={diseaseInput}
                          onChange={(e) => setDiseaseInput(e.target.value)}
                          className="flex-1"
                        >
                          <option value="">选择疾病</option>
                          {DISEASE_OPTIONS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => addDisease(diseaseInput)}
                          disabled={!diseaseInput}
                        >
                          添加
                        </Button>
                      </div>
                      <Button size="sm" onClick={saveDiseases} className="w-full">
                        保存疾病标注
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">请先选择牙位</p>
                  )}
                </div>

                {selectedToothData && selectedToothData.notes && (
                  <div className="p-4 bg-white border border-border rounded-lg">
                    <h3 className="text-sm font-semibold mb-2">牙位备注</h3>
                    <p className="text-sm text-muted-foreground">{selectedToothData.notes}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
