import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Check,
  Play,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  useFollowUpsV2,
  useCreateFollowUpV2,
  useUpdateFollowUpV2,
  useDeleteFollowUpV2,
  useCompleteFollowUpV2,
  FOLLOW_UP_STATUS_LABEL,
  FOLLOW_UP_STATUS_COLOR,
  FOLLOW_UP_PRIORITY_LABEL,
  FOLLOW_UP_PRIORITY_COLOR,
  type FollowUpV2,
  type FollowUpStatus,
} from '@/lib/api/communication/follow-ups';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  CreateFollowUpDialog,
  EditFollowUpDialog,
  CompleteFollowUpDialog,
} from './FollowUpDialogs';

export function WorkbenchTab() {
  const [statusFilter, setStatusFilter] = useState<FollowUpStatus | ''>('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [selectedFollowUp, setSelectedFollowUp] = useState<FollowUpV2 | null>(null);

  const { data, isLoading } = useFollowUpsV2({
    status: statusFilter || undefined,
    page,
    pageSize,
  });

  const createFollowUp = useCreateFollowUpV2();
  const updateFollowUp = useUpdateFollowUpV2();
  const deleteFollowUp = useDeleteFollowUpV2();
  const completeFollowUp = useCompleteFollowUpV2();

  const followUps = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredFollowUps = useMemo(() => {
    if (!keyword) return followUps;
    const kw = keyword.toLowerCase();
    return followUps.filter(
      f =>
        f.patient?.name?.toLowerCase().includes(kw) ||
        f.title?.toLowerCase().includes(kw),
    );
  }, [followUps, keyword]);

  function handleStart(followUp: FollowUpV2) {
    updateFollowUp.mutate({ id: followUp.id, data: { status: 'IN_PROGRESS' } });
  }

  function handleComplete(followUp: FollowUpV2) {
    setSelectedFollowUp(followUp);
    setCompleteOpen(true);
  }

  function handleEdit(followUp: FollowUpV2) {
    setSelectedFollowUp(followUp);
    setEditOpen(true);
  }

  function handleDelete(id: string) {
    if (confirm('确定删除该回访记录吗？')) {
      deleteFollowUp.mutate(id);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索患者姓名/回访标题"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Select
          value={statusFilter}
          onChange={e => {
            setStatusFilter(e.target.value as FollowUpStatus | '');
            setPage(1);
          }}
          className="w-36"
        >
          <option value="">全部状态</option>
          <option value="PENDING">待回访</option>
          <option value="IN_PROGRESS">回访中</option>
          <option value="COMPLETED">已完成</option>
          <option value="CANCELLED">已取消</option>
        </Select>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建回访
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>患者姓名</TableHead>
            <TableHead>回访类型</TableHead>
            <TableHead>回访项目</TableHead>
            <TableHead>计划时间</TableHead>
            <TableHead>负责人</TableHead>
            <TableHead>优先级</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableLoading colSpan={8} />
          ) : filteredFollowUps.length === 0 ? (
            <EmptyState colSpan={8} text="暂无数据" />
          ) : (
            filteredFollowUps.map(followUp => (
              <TableRow key={followUp.id}>
                <TableCell>
                  <div className="font-medium">{followUp.patient?.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {followUp.patient?.phone}
                  </div>
                </TableCell>
                <TableCell>{followUp.template?.name || '自定义'}</TableCell>
                <TableCell className="text-muted-foreground">
                  {followUp.template?.items?.length || 0} 项
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {followUp.dueDate ? format(new Date(followUp.dueDate), 'yyyy-MM-dd', { locale: zhCN }) : '-'}
                  </div>
                </TableCell>
                <TableCell>{followUp.assignee?.name || '-'}</TableCell>
                <TableCell>
                  <Badge className={FOLLOW_UP_PRIORITY_COLOR[followUp.priority]}>
                    {FOLLOW_UP_PRIORITY_LABEL[followUp.priority]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={FOLLOW_UP_STATUS_COLOR[followUp.status]}>
                    {FOLLOW_UP_STATUS_LABEL[followUp.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {followUp.status === 'PENDING' && (
                    <Button size="sm" variant="outline" onClick={() => handleStart(followUp)} disabled={updateFollowUp.isPending}>
                      <Play className="w-3 h-3 mr-1" />
                      开始
                    </Button>
                  )}
                  {followUp.status === 'IN_PROGRESS' && (
                    <Button size="sm" variant="default" onClick={() => handleComplete(followUp)}>
                      <Check className="w-3 h-3 mr-1" />
                      完成
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(followUp)} aria-label="编辑">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(followUp.id)}
                    disabled={deleteFollowUp.isPending}
                    aria-label="删除"
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
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

      <CreateFollowUpDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createFollowUp.mutateAsync}
      />

      {selectedFollowUp && (
        <>
          <EditFollowUpDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            followUp={selectedFollowUp}
            onUpdate={(data) => updateFollowUp.mutateAsync({ id: selectedFollowUp.id, data })}
          />
          <CompleteFollowUpDialog
            open={completeOpen}
            onClose={() => setCompleteOpen(false)}
            followUp={selectedFollowUp}
            onComplete={(data) => completeFollowUp.mutateAsync({ id: selectedFollowUp.id, data })}
          />
        </>
      )}
    </div>
  );
}
