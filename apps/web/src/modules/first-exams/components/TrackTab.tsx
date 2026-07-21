import { useState } from 'react';
import { Pencil, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useFirstExamTracks,
  useUpdateFirstExamTrack,
  useCreateFollowUp,
  type FirstExamTrack,
} from '@/lib/first-exams';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';

export function TrackTab() {
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [editOpen, setEditOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<FirstExamTrack | null>(null);

  const { data, isLoading } = useFirstExamTracks({
    page,
    pageSize,
  });

  const updateTrack = useUpdateFirstExamTrack();
  const createFollowUp = useCreateFollowUp();

  const tracks = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  function handleEdit(track: FirstExamTrack) {
    setSelectedTrack(track);
    setEditOpen(true);
  }

  function handleAddFollowUp(track: FirstExamTrack) {
    setSelectedTrack(track);
    setFollowUpOpen(true);
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">流失患者追踪记录</h3>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>患者</TableHead>
                <TableHead>首诊时间</TableHead>
                <TableHead>流失原因</TableHead>
                <TableHead>最近追踪时间</TableHead>
                <TableHead>下次追踪时间</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={8} />
              ) : tracks.length === 0 ? (
                <EmptyState colSpan={8} text="暂无流失追踪记录" />
              ) : (
                tracks.map((track) => (
                  <TableRow key={track.id}>
                    <TableCell className="font-medium">
                      {track.patientId ? `患者 ${track.patientId.slice(0, 8)}` : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {track.createdAt
                        ? format(new Date(track.createdAt), 'yyyy-MM-dd', { locale: zhCN })
                        : '-'}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {track.content || '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {track.updatedAt
                        ? format(new Date(track.updatedAt), 'yyyy-MM-dd', { locale: zhCN })
                        : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">-</TableCell>
                    <TableCell>{track.operator?.name || '-'}</TableCell>
                    <TableCell>
                      <Badge className="bg-warning/10 text-warning border-warning/30">
                        追踪中
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(track)}
                      >
                        <Pencil className="w-3 h-3 mr-1" />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAddFollowUp(track)}
                      >
                        <MessageSquare className="w-3 h-3 mr-1" />
                        添加回访
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

      {selectedTrack && (
        <>
          <EditTrackDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            track={selectedTrack}
            onUpdate={updateTrack.mutateAsync}
          />
          <FollowUpDialog
            open={followUpOpen}
            onClose={() => setFollowUpOpen(false)}
            trackId={selectedTrack.id}
            patientId={selectedTrack.patientId}
            onCreate={createFollowUp.mutateAsync}
          />
        </>
      )}
    </>
  );
}

function EditTrackDialog({
  open,
  onClose,
  track,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  track: FirstExamTrack;
  onUpdate: ({ examId, trackId, data }: { examId: string; trackId: string; data: { type?: string; content?: string } }) => Promise<FirstExamTrack>;
}) {
  const [type, setType] = useState(track.type || '');
  const [content, setContent] = useState(track.content || '');

  async function handleSubmit() {
    try {
      await onUpdate({ examId: track.examId, trackId: track.id, data: { type, content } });
      toast.success('更新成功');
      onClose();
    } catch {
      toast.error('更新失败');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>编辑追踪记录</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fe-track-type">追踪类型</Label>
            <Input
              id="fe-track-type"
              placeholder="请输入追踪类型"
              value={type}
              onChange={(e) => setType(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fe-track-content">追踪内容</Label>
            <Textarea
              id="fe-track-content"
              rows={4}
              placeholder="请输入追踪内容"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit}>
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDialog({
  open,
  onClose,
  trackId,
  patientId,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  trackId: string;
  patientId?: string;
  onCreate: (data: { patientId: string; type: string; content: string; followUpDate: string }) => Promise<any>;
}) {
  const [type, setType] = useState('');
  const [content, setContent] = useState('');

  async function handleSubmit() {
    if (!content.trim()) {
      toast.error('请输入回访内容');
      return;
    }
    try {
      await onCreate({ patientId: patientId || trackId, type: type || 'CALL', content, followUpDate: new Date().toISOString().split('T')[0] });
      toast.success('回访已添加');
      onClose();
      setContent('');
      setType('');
    } catch {
      toast.error('添加失败');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>添加回访记录</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fe-follow-up-type">回访类型</Label>
            <Input
              id="fe-follow-up-type"
              placeholder="请输入回访类型"
              value={type}
              onChange={(e) => setType(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fe-follow-up-content">回访内容 *</Label>
            <Textarea
              id="fe-follow-up-content"
              rows={4}
              placeholder="请输入回访内容"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!content.trim()}>
              添加
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
