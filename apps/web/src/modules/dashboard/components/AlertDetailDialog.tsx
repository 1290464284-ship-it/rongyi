/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquarePlus,
  CheckCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  useAlertDetail,
  useAcknowledgeAlert,
  useResolveAlert,
  useAddAlertNote,
  SEVERITY_BADGE_CLASS,
  STATUS_DOT_CLASS,
  ALERT_SEVERITY_LABELS,
  ALERT_STATUS_LABELS,
  ALERT_TYPE_LABELS,
  type BusinessAlert,
} from '@/lib/api/system/business-alerts';
import { useAuthStore } from '@/lib/store/auth-store';

interface Props {
  open: boolean;
  onClose: () => void;
  alertId: string | undefined;
}

const SEVERITY_ICON: Record<string, typeof AlertTriangle> = {
  CRITICAL: XCircle,
  ERROR: AlertCircle,
  WARN: AlertTriangle,
  INFO: AlertCircle,
};

export default function AlertDetailDialog({ open, onClose, alertId }: Props) {
  const user = useAuthStore((s) => s.user);
  const currentUserId = user?.id ?? 'current-user';

  const { data: alert, isLoading } = useAlertDetail(alertId, {
    retry: false,
  });

  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();
  const addNote = useAddAlertNote();

  const [resolutionNote, setResolutionNote] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [showResolveForm, setShowResolveForm] = useState(false);

  const handleAcknowledge = () => {
    if (!alert) return;
    acknowledge.mutate(
      { id: alert.id, acknowledgedBy: currentUserId },
      { onSuccess: () => {} }
    );
  };

  const handleResolve = () => {
    if (!alert) return;
    resolve.mutate(
      {
        id: alert.id,
        resolvedBy: currentUserId,
        resolutionNote: resolutionNote || undefined,
      },
      {
        onSuccess: () => {
          setResolutionNote('');
          setShowResolveForm(false);
        },
      }
    );
  };

  const handleAddNote = () => {
    if (!alert || !newNoteText.trim()) return;
    addNote.mutate(
      { id: alert.id, text: newNoteText.trim() },
      {
        onSuccess: () => setNewNoteText(''),
      }
    );
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {alert && (
              <>
                {(() => {
                  const Icon = SEVERITY_ICON[alert.severity] ?? AlertCircle;
                  return (
                    <Icon
                      data-testid="detail-severity-icon"
                      className={`w-6 h-6 ${
                        alert.severity === 'CRITICAL'
                          ? 'text-red-600'
                          : alert.severity === 'ERROR'
                          ? 'text-orange-600'
                          : alert.severity === 'WARN'
                          ? 'text-orange-500'
                          : 'text-blue-600'
                      }`}
                    />
                  );
                })()}
                <div>
                  <DialogTitle data-testid="detail-title">
                    {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
                  </DialogTitle>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      data-testid="detail-severity-badge"
                      className={SEVERITY_BADGE_CLASS[alert.severity]}
                    >
                      {ALERT_SEVERITY_LABELS[alert.severity]}
                    </Badge>
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span
                        data-testid="detail-status-dot"
                        className={`w-2 h-2 rounded-full ${STATUS_DOT_CLASS[alert.status]}`}
                      />
                      {ALERT_STATUS_LABELS[alert.status]}
                    </span>
                    <span
                      data-testid="detail-created-at"
                      className="text-xs text-muted-foreground"
                    >
                      {format(new Date(alert.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogHeader>

      <DialogContent className="space-y-6">
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-4 bg-muted/50 rounded animate-pulse"
                style={{ width: `${60 + Math.random() * 40}%` }}
              />
            ))}
          </div>
        )}

        {alert && (
          <>
            <section>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                告警描述
              </Label>
              <p
                data-testid="detail-message"
                className="mt-2 text-sm leading-relaxed text-foreground"
              >
                {alert.message}
              </p>
            </section>

            {alert.metadata && Object.keys(alert.metadata).length > 0 && (
              <section data-testid="detail-metadata-section">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  元数据
                </Label>
                <div className="mt-2 border border-border rounded-md overflow-hidden">
                  <Table data-testid="detail-metadata-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-1/3 bg-muted/30">属性名</TableHead>
                        <TableHead className="bg-muted/30">属性值</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(alert.metadata).map(([k, v]) => (
                        <TableRow key={k}>
                          <TableCell
                            data-testid={`meta-key-${k}`}
                            className="font-mono text-xs text-muted-foreground"
                          >
                            {k}
                          </TableCell>
                          <TableCell data-testid={`meta-value-${k}`} className="text-sm">
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            <section>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                处理时间线
              </Label>
              <ol
                data-testid="detail-timeline"
                className="mt-3 relative border-l border-border ml-2 space-y-4"
              >
                <li className="pl-4 relative">
                  <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-yellow-500 border-2 border-white" />
                  <div className="text-sm font-medium">创建告警</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(alert.createdAt), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN })}
                    <span className="ml-2">
                      ({formatDistanceToNow(new Date(alert.createdAt), { locale: zhCN, addSuffix: true })})
                    </span>
                  </div>
                </li>

                {alert.acknowledgedAt && (
                  <li data-testid="timeline-ack" className="pl-4 relative">
                    <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
                    <div className="text-sm font-medium">已确认</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      操作人：{alert.acknowledgedBy ?? '未知'} ·{' '}
                      {format(new Date(alert.acknowledgedAt), 'yyyy-MM-dd HH:mm:ss', {
                        locale: zhCN,
                      })}
                    </div>
                  </li>
                )}

                {alert.resolvedAt && (
                  <li data-testid="timeline-resolve" className="pl-4 relative">
                    <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
                    <div className="text-sm font-medium">已解决</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      操作人：{alert.resolvedBy ?? '未知'} ·{' '}
                      {format(new Date(alert.resolvedAt), 'yyyy-MM-dd HH:mm:ss', {
                        locale: zhCN,
                      })}
                    </div>
                    {alert.resolutionNote && (
                      <div
                        data-testid="detail-resolution-note"
                        className="mt-2 text-sm bg-muted/40 p-2 rounded-md border border-border/60"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 inline mr-1 text-green-600" />
                        {alert.resolutionNote}
                      </div>
                    )}
                  </li>
                )}
              </ol>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <MessageSquarePlus className="w-4 h-4 text-muted-foreground" />
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  备注 ({alert.notes.length})
                </Label>
              </div>

              <div className="space-y-2 mb-4 max-h-40 overflow-auto">
                {alert.notes.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">暂无备注</p>
                ) : (
                  alert.notes.map((n) => (
                    <div
                      key={n.id}
                      data-testid={`note-${n.id}`}
                      className="border border-border rounded-md p-3 bg-muted/20"
                    >
                      <div className="text-xs text-muted-foreground flex justify-between">
                        <span>{n.createdBy}</span>
                        <span>
                          {format(new Date(n.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                        </span>
                      </div>
                      <div className="mt-1 text-sm">{n.text}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2">
                <Textarea
                  data-testid="detail-new-note"
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  placeholder="添加备注..."
                  className="min-h-[60px]"
                />
                <div className="flex justify-end">
                  <Button
                    data-testid="detail-add-note-btn"
                    size="sm"
                    variant="outline"
                    onClick={handleAddNote}
                    disabled={!newNoteText.trim() || addNote.isPending}
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5 mr-1" />
                    添加备注
                  </Button>
                </div>
              </div>
            </section>

            {showResolveForm && (
              <section
                data-testid="resolve-form"
                className="border border-border rounded-md p-4 bg-muted/20 space-y-2"
              >
                <Label htmlFor="resolution-note">解决备注</Label>
                <Textarea
                  id="resolution-note"
                  data-testid="resolution-note-textarea"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="请输入解决说明（可选）..."
                />
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowResolveForm(false);
                      setResolutionNote('');
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    data-testid="detail-confirm-resolve-btn"
                    size="sm"
                    onClick={handleResolve}
                    disabled={resolve.isPending}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                    确认解决
                  </Button>
                </div>
              </section>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              {alert.status === 'OPEN' && (
                <Button
                  data-testid="detail-ack-btn"
                  variant="outline"
                  size="sm"
                  onClick={handleAcknowledge}
                  disabled={acknowledge.isPending}
                >
                  <Clock className="w-3.5 h-3.5 mr-1" />
                  确认告警
                </Button>
              )}
              {alert.status !== 'RESOLVED' && !showResolveForm && (
                <Button
                  data-testid="detail-resolve-btn"
                  size="sm"
                  onClick={() => setShowResolveForm(true)}
                  disabled={resolve.isPending}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  标记解决
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>
                关闭
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
