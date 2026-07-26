import { useState, ChangeEvent } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Plus, Edit, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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
import {
  MedicalRecordTemplate,
  CreateRecordTemplateDto,
  useRecordTemplates,
  useCreateRecordTemplate,
  useUpdateRecordTemplate,
  useDeleteRecordTemplate,
} from '@/lib/api/clinical/medical-records';
import { ConfirmDialog } from './ConfirmDialog';

const TEMPLATE_CATEGORY_OPTIONS = [
  { value: 'INITIAL', label: '初诊' },
  { value: 'FOLLOW_UP', label: '复诊' },
  { value: 'EMERGENCY', label: '急诊' },
  { value: 'CHECKUP', label: '体检' },
];

export function TemplatesTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MedicalRecordTemplate | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const { data: templatesData, isLoading } = useRecordTemplates({ page, pageSize });
  const templates = templatesData?.items ?? [];
  const total = templatesData?.total ?? 0;
  const createMutation = useCreateRecordTemplate();
  const updateMutation = useUpdateRecordTemplate();
  const deleteMutation = useDeleteRecordTemplate();

  function handleEdit(template: MedicalRecordTemplate) {
    setSelectedTemplate(template);
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

  async function handleCreate(data: CreateRecordTemplateDto) {
    await createMutation.mutateAsync(data);
    toast.success('创建成功');
    setCreateOpen(false);
  }

  async function handleUpdate(id: string, data: Partial<CreateRecordTemplateDto>) {
    await updateMutation.mutateAsync({ id, data });
    toast.success('保存成功');
    setEditOpen(false);
    setSelectedTemplate(null);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">病历模板</h3>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            新建模板
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>模板名称</TableHead>
              <TableHead>分类</TableHead>
              <TableHead>是否共享</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
                <TableLoading colSpan={5} />
              ) : (templates ?? []).length === 0 ? (
                <EmptyState colSpan={5} text="暂无数据" />
              ) : (
              (templates ?? []).map((template: MedicalRecordTemplate) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    {TEMPLATE_CATEGORY_OPTIONS.find(
                      c => c.value === template.category,
                    )?.label || template.category || '-'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        template.isPublic === 1
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted/10 text-muted-foreground border-muted/30'
                      }
                    >
                      {template.isPublic === 1 ? '共享' : '私有'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {template.createdAt
                      ? format(new Date(template.createdAt), 'yyyy-MM-dd', {
                          locale: zhCN,
                        })
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(template)}
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(template.id)}
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

        {total > pageSize && (
          <div className="flex items-center justify-between text-sm text-muted-foreground pt-4">
            <span>共 {total} 条</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}

        {createOpen && (
          <TemplateDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            template={null}
            onSave={handleCreate}
            isPending={createMutation.isPending}
          />
        )}

        {editOpen && selectedTemplate && (
          <TemplateDialog
            open={editOpen}
            onClose={() => {
              setEditOpen(false);
              setSelectedTemplate(null);
            }}
            template={selectedTemplate}
            onSave={data => handleUpdate(selectedTemplate.id, data)}
            isPending={updateMutation.isPending}
          />
        )}

        <ConfirmDialog
          open={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          title="确认删除"
          description="确定要删除这个模板吗？"
          confirmText="确认删除"
          confirmVariant="destructive"
          onConfirm={confirmDelete}
          isPending={deleteMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}

function TemplateDialog({
  open,
  onClose,
  template,
  onSave,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  template: MedicalRecordTemplate | null;
  onSave: (data: CreateRecordTemplateDto) => Promise<void>;
  isPending?: boolean;
}) {
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState(template?.category || '');
  const [chiefComplaint, setChiefComplaint] = useState(template?.chiefComplaint || '');
  const [presentIllness, setPresentIllness] = useState(template?.presentIllness || '');
  const [pastHistory, setPastHistory] = useState(template?.pastHistory || '');
  const [examination, setExamination] = useState(template?.examination || '');
  const [diagnosis, setDiagnosis] = useState(template?.diagnosis || '');
  const [treatmentPlan, setTreatmentPlan] = useState(template?.treatmentPlan || '');
  const [isPublic, setIsPublic] = useState(template?.isPublic === 1);

  async function handleSubmit() {
    if (!name) return;
    await onSave({
      name,
      category: category || undefined,
      chiefComplaint: chiefComplaint || undefined,
      presentIllness: presentIllness || undefined,
      pastHistory: pastHistory || undefined,
      examination: examination || undefined,
      diagnosis: diagnosis || undefined,
      treatmentPlan: treatmentPlan || undefined,
      isPublic,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{template ? '编辑模板' : '新建模板'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="mr-template-name">模板名称 *</Label>
              <Input
                id="mr-template-name"
                placeholder="请输入模板名称"
                value={name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mr-template-category">分类</Label>
              <Select id="mr-template-category" value={category} onChange={(e: ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value)}>
                <option value="">请选择分类</option>
                {TEMPLATE_CATEGORY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="checkbox"
              id="isPublic"
              checked={isPublic}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setIsPublic(e.target.checked)}
            />
            <Label htmlFor="isPublic" className="cursor-pointer">
              共享模板
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-template-chief-complaint">主诉</Label>
            <Textarea
              id="mr-template-chief-complaint"
              placeholder="请输入主诉"
              value={chiefComplaint}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setChiefComplaint(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-template-present-illness">现病史</Label>
            <Textarea
              id="mr-template-present-illness"
              placeholder="请输入现病史"
              value={presentIllness}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPresentIllness(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-template-past-history">既往史</Label>
            <Textarea
              id="mr-template-past-history"
              placeholder="请输入既往史"
              value={pastHistory}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPastHistory(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-template-examination">检查所见</Label>
            <Textarea
              id="mr-template-examination"
              placeholder="请输入检查所见"
              value={examination}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setExamination(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-template-diagnosis">诊断</Label>
            <Textarea
              id="mr-template-diagnosis"
              placeholder="请输入诊断"
              value={diagnosis}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDiagnosis(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mr-template-treatment-plan">治疗计划</Label>
            <Textarea
              id="mr-template-treatment-plan"
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
            <Button onClick={handleSubmit} disabled={!name || isPending}>
              <Check className="w-4 h-4 mr-2" />
              {isPending ? '保存中…' : (template ? '保存修改' : '创建模板')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
