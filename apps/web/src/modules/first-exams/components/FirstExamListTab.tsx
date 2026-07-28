import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Eye,
  CheckCircle,
  RotateCcw,
  UserMinus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  useFirstExams,
  useCreateFirstExam,
  useDeleteFirstExam,
  useCompleteFirstExam,
  useRestartFirstExam,
  DENTITION_TYPE_LABEL,
  FIRST_EXAM_STATUS_LABEL,
  FIRST_EXAM_STATUS_COLOR,
  type FirstExam,
  type FirstExamStatus,
} from '@/lib/api/clinical/first-exams';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';
import { CreateFirstExamDialog } from './CreateFirstExamDialog';
import { FirstExamDetailDialog } from './FirstExamDetailDialog';

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
              <option value="DRAFT">草稿</option>
              <option value="SUBMITTED">已提交</option>
              <option value="APPROVED">已批准</option>
              <option value="REJECTED">已驳回</option>
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
                      {exam.status !== 'APPROVED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleComplete(exam.id)}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          完成
                        </Button>
                      )}
                      {exam.status === 'APPROVED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRestart(exam.id)}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          重新开始
                        </Button>
                      )}
                      {exam.status !== 'APPROVED' && (
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
