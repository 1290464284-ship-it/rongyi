import { useState, useMemo, useEffect, ChangeEvent } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Lock,
  FileText,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { PatientSelector } from '@/components/patient/PatientSelector';
import {
  MedicalRecord,
  CreateMedicalRecordDto,
  UpdateMedicalRecordDto,
  useMedicalRecords,
  useCreateMedicalRecord,
  useUpdateMedicalRecord,
  useDeleteMedicalRecord,
  useLockMedicalRecord,
} from '@/lib/api/clinical/medical-records';
import { ConfirmDialog } from './ConfirmDialog';

export function RecordsTab() {
  const [keyword, setKeyword] = useState('');
  const [page, _setPage] = useState(1);
  const pageSize = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmLockOpen, setConfirmLockOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingLockId, setPendingLockId] = useState<string | null>(null);

  const { data, isLoading } = useMedicalRecords({
    page,
    pageSize,
  });

  const createMutation = useCreateMedicalRecord();
  const updateMutation = useUpdateMedicalRecord();
  const deleteMutation = useDeleteMedicalRecord();
  const lockMutation = useLockMedicalRecord();

  const records = data?.items ?? [];
  const total = data?.total ?? 0;
  const _totalPages = Math.ceil(total / pageSize);

  const filteredRecords = useMemo(() => {
    if (!keyword) return records;
    const kw = keyword.toLowerCase();
    return records.filter(
      (r: MedicalRecord) =>
        r.chiefComplaint?.toLowerCase().includes(kw) ||
        r.patient?.name?.toLowerCase().includes(kw) ||
        r.patient?.phone?.includes(kw),
    );
  }, [records, keyword]);

  function handleEdit(record: MedicalRecord) {
    setSelectedRecord(record);
    setEditOpen(true);
  }

  function handleDelete(id: string) {
    setPendingDeleteId(id);
    setConfirmDeleteOpen(true);
  }

  function confirmDelete() {
    if (pendingDeleteId) {
      deleteMutation.mutate(pendingDeleteId, {
        onSuccess: () => toast.success('删除成功'),
        onError: () => toast.error('删除失败'),
      });
    }
    setConfirmDeleteOpen(false);
    setPendingDeleteId(null);
  }

  function handleLock(id: string) {
    setPendingLockId(id);
    setConfirmLockOpen(true);
  }

  function confirmLock() {
    if (pendingLockId) {
      lockMutation.mutate(pendingLockId, {
        onSuccess: () => toast.success('锁定成功'),
        onError: () => toast.error('锁定失败'),
      });
    }
    setConfirmLockOpen(false);
    setPendingLockId(null);
  }

  async function handleCreate(data: CreateMedicalRecordDto) {
    await createMutation.mutateAsync(data);
    toast.success('创建成功');
    setCreateOpen(false);
  }

  async function handleUpdate(id: string, data: UpdateMedicalRecordDto) {
    await updateMutation.mutateAsync({ id, data });
    toast.success('保存成功');
    setEditOpen(false);
    setSelectedRecord(null);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 max-w-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索患者姓名/电话/主诉"
                value={keyword}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            新建病历
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>患者姓名</TableHead>
              <TableHead>主诉</TableHead>
              <TableHead>诊断</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>创建医生</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
                <TableLoading colSpan={7} />
              ) : filteredRecords.length === 0 ? (
                <EmptyState colSpan={7} text="暂无数据" />
              ) : (
              filteredRecords.map((record: MedicalRecord) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">
                    {record.patient?.name || '-'}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {record.chiefComplaint || '-'}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {record.diagnosis || '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(record.createdAt), 'yyyy-MM-dd HH:mm', {
                      locale: zhCN,
                    })}
                  </TableCell>
                  <TableCell>{record.doctor?.name || '-'}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        record.isLocked === 1
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted/10 text-muted-foreground border-muted/30'
                      }
                    >
                      {record.isLocked === 1 ? '已锁定' : '正常'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(record)}
                      disabled={record.isLocked === 1}
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleLock(record.id)}
                      disabled={record.isLocked === 1}
                    >
                      <Lock className="w-3 h-3 mr-1" />
                      锁定
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(record.id)}
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



        {createOpen && (
          <CreateRecordDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreate={handleCreate}
          />
        )}

        {editOpen && selectedRecord && (
          <EditRecordDialog
            open={editOpen}
            onClose={() => {
              setEditOpen(false);
              setSelectedRecord(null);
            }}
            record={selectedRecord}
            onUpdate={data => handleUpdate(selectedRecord.id, data)}
          />
        )}

        <ConfirmDialog
          open={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          title="确认删除"
          description="确定要删除这份病历吗？"
          confirmText="确认删除"
          confirmVariant="destructive"
          onConfirm={confirmDelete}
          isPending={deleteMutation.isPending}
        />

        <ConfirmDialog
          open={confirmLockOpen}
          onClose={() => setConfirmLockOpen(false)}
          title="确认锁定"
          description="确定要锁定这份病历吗？锁定后将无法修改。"
          confirmText="确认锁定"
          onConfirm={confirmLock}
          isPending={lockMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}

function CreateRecordDialog({
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
              <Label>患者 *</Label>
              <Button
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

function EditRecordDialog({
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
