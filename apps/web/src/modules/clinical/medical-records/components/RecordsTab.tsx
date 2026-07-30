import { useState, useMemo, type ChangeEvent } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  type MedicalRecord,
  type CreateMedicalRecordDto,
  type UpdateMedicalRecordDto,
  useMedicalRecords,
  useCreateMedicalRecord,
  useUpdateMedicalRecord,
  useDeleteMedicalRecord,
  useLockMedicalRecord,
} from '@/lib/api/clinical/medical-records';
import { ConfirmDialog } from './ConfirmDialog';
import { CreateRecordDialog, EditRecordDialog } from './RecordDialogs';

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

  const records = useMemo(() => data?.items ?? [], [data?.items]);
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
