import { useMemo, useState } from 'react';
import { Plus, RotateCcw, Trash2, DatabaseBackup } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingButton, TableLoading, EmptyState } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useBackups,
  useCreateBackup,
  useRestoreBackup,
  useDeleteBackup,
  type BackupRecord,
} from '@/lib/api/system/backups';
import { formatDateTime } from '@/lib/utils';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { toast } from 'sonner';

const TYPE_LABEL: Record<string, string> = {
  MANUAL: '手动',
  AUTO: '自动',
};

const TYPE_CLASS: Record<string, string> = {
  MANUAL: 'bg-primary/10 text-primary',
  AUTO: 'bg-muted text-muted-foreground',
};

const formatFileSize = (bytes?: number | null) => {
  if (!bytes) return '-';
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

interface CreateForm {
  type: 'MANUAL' | 'AUTO';
  remark: string;
}

const EMPTY_FORM: CreateForm = {
  type: 'MANUAL',
  remark: '',
};

export default function BackupPage() {
  const { data, isLoading, isError, refetch } = useBackups();
  const createMut = useCreateBackup();
  const restoreMut = useRestoreBackup();
  const deleteMut = useDeleteBackup();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRecord | null>(null);

  const list = useMemo(() => data?.items ?? [], [data]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  };

  const handleCreate = () => {
    createMut.mutate(
      {
        type: form.type,
        remark: form.remark.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('备份已创建');
          setCreateOpen(false);
        },
      },
    );
  };

  const handleRestore = () => {
    if (!restoreTarget) return;
    restoreMut.mutate(restoreTarget.filename, {
      onSuccess: () => {
        toast.success('恢复请求已提交，应用将重启');
        setRestoreTarget(null);
      },
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMut.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success('备份已删除');
        setDeleteTarget(null);
      },
    });
  };

  return (
    <div className='p-6 space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-xl font-semibold'>数据备份</h1>
          <p className='text-sm text-muted-foreground mt-1'>管理数据库备份与恢复</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className='h-4 w-4 mr-1' />立即备份
        </Button>
      </div>

      <Card className='p-4 bg-primary/5 border-primary/20'>
        <div className='flex items-start gap-3'>
          <DatabaseBackup className='h-5 w-5 text-primary mt-0.5 shrink-0' />
          <div className='text-sm text-muted-foreground'>
            建议定期创建手动备份，确保数据安全。系统也会在每日凌晨自动创建备份。恢复备份将覆盖当前数据库，且需要重启应用才能生效。
          </div>
        </div>
      </Card>

      <Card className='p-4 space-y-3'>
        <div className='flex items-center justify-between'>
          <span className='text-sm font-medium'>备份记录</span>
          <span className='text-sm text-muted-foreground'>共 {list.length} 条</span>
        </div>

        <div className='rounded-md border border-border overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-64'>文件名</TableHead>
                <TableHead className='w-28 text-right'>文件大小</TableHead>
                <TableHead className='w-20'>类型</TableHead>
                <TableHead className='w-28'>操作员</TableHead>
                <TableHead>备注</TableHead>
                <TableHead className='w-36'>创建时间</TableHead>
                <TableHead className='w-32 text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <tr><td colSpan={7}><QueryErrorAlert onRetry={refetch} /></td></tr>
              ) : isLoading ? (
                <TableLoading colSpan={7} />
              ) : list.length === 0 ? (
                <EmptyState colSpan={7} text="暂无备份记录" />
              ) : (
                list.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className='font-mono text-xs'>{b.filename}</TableCell>
                    <TableCell className='text-right text-muted-foreground'>
                      {formatFileSize(b.size)}
                    </TableCell>
                    <TableCell>
                      <Badge className={TYPE_CLASS[b.type || ''] ?? 'bg-muted text-muted-foreground'}>
                        {TYPE_LABEL[b.type || ''] ?? b.type ?? '-'}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {b.operatorName ?? '-'}
                    </TableCell>
                    <TableCell className='text-muted-foreground'>{b.remark ?? '-'}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {formatDateTime(b.createdAt)}
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => setRestoreTarget(b)}
                          title='恢复'
                        >
                          <RotateCcw className='h-4 w-4 mr-1' />恢复
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => setDeleteTarget(b)}
                          title='删除'
                          className='text-destructive hover:text-destructive'
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* 创建备份弹窗 */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogHeader>
          <DialogTitle>创建备份</DialogTitle>
        </DialogHeader>
        <DialogContent className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor="backup-type">类型</Label>
            <Select
              id="backup-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'MANUAL' | 'AUTO' })}
            >
              <option value='MANUAL'>手动</option>
              <option value='AUTO'>自动</option>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor="backup-remark">备注</Label>
            <Textarea
              id="backup-remark"
              rows={3}
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              placeholder='可选'
            />
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <LoadingButton onClick={handleCreate} loading={createMut.isPending} loadingText="备份中…">
              确认备份
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* 恢复确认弹窗 */}
      <Dialog open={!!restoreTarget} onClose={() => setRestoreTarget(null)}>
        <DialogHeader>
          <DialogTitle>确认恢复备份</DialogTitle>
        </DialogHeader>
        <DialogContent className='space-y-4'>
          {restoreTarget && (
            <div className='rounded-md bg-warning/5 border border-warning/20 p-3 text-sm space-y-1'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>文件名</span>
                <span className='font-mono text-xs'>{restoreTarget.filename}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>大小</span>
                <span className='font-medium'>{formatFileSize(restoreTarget.size)}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>创建时间</span>
                <span className='font-medium'>
                  {formatDateTime(restoreTarget.createdAt)}
                </span>
              </div>
            </div>
          )}
          <p className='text-sm text-destructive'>
            恢复备份将覆盖当前数据库内容，且应用需要重启后才能生效。建议在确认无人使用系统时执行此操作。确定要继续吗？
          </p>
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => setRestoreTarget(null)}>
              取消
            </Button>
            <LoadingButton
              variant='destructive'
              onClick={handleRestore}
              loading={restoreMut.isPending}
              loadingText="恢复中…"
            >
              确认恢复
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>确认删除备份</DialogTitle>
        </DialogHeader>
        <DialogContent className='space-y-4'>
          <p className='text-sm'>
            确定要删除备份文件{' '}
            <span className='font-mono text-xs font-medium'>{deleteTarget?.filename}</span>{' '}
            吗？此操作不可撤销。
          </p>
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <LoadingButton
              variant='destructive'
              onClick={handleDelete}
              loading={deleteMut.isPending}
              loadingText="删除中…"
            >
              删除
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
