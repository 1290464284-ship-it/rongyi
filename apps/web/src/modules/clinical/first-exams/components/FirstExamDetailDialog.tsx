import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useFirstExam,
  useFirstExamTeeth,
  useUpdateTooth,
  DENTITION_TYPE_LABEL,
  TOOTH_STATUS_LABEL,
  TOOTH_STATUS_COLOR,
  FIRST_EXAM_STATUS_LABEL,
  FIRST_EXAM_STATUS_COLOR,
  type ToothStatus,
} from '@/lib/api/clinical/first-exams';
import { toast } from 'sonner';

const PERMANENT_TEETH_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const PERMANENT_TEETH_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const DECIDUOUS_TEETH_UPPER = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const DECIDUOUS_TEETH_LOWER = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

const DISEASE_OPTIONS = ['龋齿', '牙髓炎', '根尖周炎', '牙周炎', '智齿冠周炎', '其他'];

export function FirstExamDetailDialog({
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
