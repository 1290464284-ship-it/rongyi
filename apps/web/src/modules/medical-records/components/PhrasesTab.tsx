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
  MedicalRecordPhrase,
  CreateRecordPhraseDto,
  useRecordPhrases,
  useCreateRecordPhrase,
  useUpdateRecordPhrase,
  useDeleteRecordPhrase,
} from '@/lib/medical-records';
import { ConfirmDialog } from './ConfirmDialog';

const PHRASE_CATEGORY_OPTIONS = [
  { value: 'CHIEF_COMPLAINT', label: '主诉' },
  { value: 'EXAMINATION', label: '检查' },
  { value: 'DIAGNOSIS', label: '诊断' },
  { value: 'TREATMENT', label: '治疗方案' },
  { value: 'OTHER', label: '其他' },
];

export function PhrasesTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedPhrase, setSelectedPhrase] =
    useState<MedicalRecordPhrase | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const { data: phrasesData, isLoading } = useRecordPhrases({ page, pageSize });
  const phrases = phrasesData?.items ?? [];
  const total = phrasesData?.total ?? 0;
  const createMutation = useCreateRecordPhrase();
  const updateMutation = useUpdateRecordPhrase();
  const deleteMutation = useDeleteRecordPhrase();

  function handleEdit(phrase: MedicalRecordPhrase) {
    setSelectedPhrase(phrase);
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

  async function handleCreate(data: CreateRecordPhraseDto) {
    await createMutation.mutateAsync(data);
    toast.success('创建成功');
    setCreateOpen(false);
  }

  async function handleUpdate(id: string, data: Partial<CreateRecordPhraseDto>) {
    await updateMutation.mutateAsync({ id, data });
    toast.success('保存成功');
    setEditOpen(false);
    setSelectedPhrase(null);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">常用短语</h3>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            新建短语
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>短语名称</TableHead>
              <TableHead>分类</TableHead>
              <TableHead>内容</TableHead>
              <TableHead>是否共享</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
                <TableLoading colSpan={6} />
              ) : (phrases ?? []).length === 0 ? (
                <EmptyState colSpan={6} text="暂无数据" />
              ) : (
              (phrases ?? []).map((phrase: MedicalRecordPhrase) => (
                <TableRow key={phrase.id}>
                  <TableCell className="font-medium">{phrase.name}</TableCell>
                  <TableCell>
                    {PHRASE_CATEGORY_OPTIONS.find(
                      c => c.value === phrase.category,
                    )?.label || phrase.category || '-'}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{phrase.content}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        phrase.isPublic === 1
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted/10 text-muted-foreground border-muted/30'
                      }
                    >
                      {phrase.isPublic === 1 ? '共享' : '私有'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {phrase.createdAt
                      ? format(new Date(phrase.createdAt), 'yyyy-MM-dd', {
                          locale: zhCN,
                        })
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(phrase)}
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(phrase.id)}
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
          <PhraseDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            phrase={null}
            onSave={handleCreate}
            isPending={createMutation.isPending}
          />
        )}

        {editOpen && selectedPhrase && (
          <PhraseDialog
            open={editOpen}
            onClose={() => {
              setEditOpen(false);
              setSelectedPhrase(null);
            }}
            phrase={selectedPhrase}
            onSave={data => handleUpdate(selectedPhrase.id, data)}
            isPending={updateMutation.isPending}
          />
        )}

        <ConfirmDialog
          open={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          title="确认删除"
          description="确定要删除这个短语吗？"
          confirmText="确认删除"
          confirmVariant="destructive"
          onConfirm={confirmDelete}
          isPending={deleteMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}

function PhraseDialog({
  open,
  onClose,
  phrase,
  onSave,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  phrase: MedicalRecordPhrase | null;
  onSave: (data: CreateRecordPhraseDto) => Promise<void>;
  isPending?: boolean;
}) {
  const [name, setName] = useState(phrase?.name || '');
  const [category, setCategory] = useState(phrase?.category || '');
  const [content, setContent] = useState(phrase?.content || '');
  const [isPublic, setIsPublic] = useState(phrase?.isPublic === 1);

  async function handleSubmit() {
    if (!name || !content) return;
    await onSave({
      name,
      category: category || undefined,
      content,
      isPublic,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{phrase ? '编辑短语' : '新建短语'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="phrase-name">短语名称 *</Label>
              <Input
                id="phrase-name"
                placeholder="请输入短语名称"
                value={name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phrase-category">分类</Label>
              <Select id="phrase-category" value={category} onChange={(e: ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value)}>
                <option value="">请选择分类</option>
                {PHRASE_CATEGORY_OPTIONS.map(opt => (
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
              id="phraseIsPublic"
              checked={isPublic}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setIsPublic(e.target.checked)}
            />
            <Label htmlFor="phraseIsPublic" className="cursor-pointer">
              共享短语
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phrase-content">短语内容 *</Label>
            <Textarea
              id="phrase-content"
              placeholder="请输入短语内容"
              value={content}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
              rows={4}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!name || !content || isPending}>
              <Check className="w-4 h-4 mr-2" />
              {isPending ? '保存中…' : (phrase ? '保存修改' : '创建短语')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
