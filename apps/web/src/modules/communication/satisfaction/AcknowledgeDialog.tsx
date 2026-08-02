import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Star, MessageSquare, Tag, User, Calendar } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
  useAcknowledgeSurvey,
  NPS_CATEGORY_LABEL,
  NPS_CATEGORY_COLOR,
  SOURCE_LABEL,
  SENTIMENT_COLOR,
  type SatisfactionSurvey,
  type AcknowledgeSurveyDto,
} from '@/lib/api/communication/satisfaction';
import { toastService } from '@/lib/utils/toast-service';
import { useAuthStore } from '@/lib/store/auth-store';

const DIMENSIONS: { key: string; label: string }[] = [
  { key: 'ratingQuality', label: '医疗质量' },
  { key: 'ratingService', label: '服务态度' },
  { key: 'ratingEnvironment', label: '环境设施' },
  { key: 'ratingPrice', label: '价格合理' },
  { key: 'ratingWait', label: '等候时间' },
];

function StarRow({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            className={`w-4 h-4 ${s <= value ? 'fill-warning text-warning' : 'text-muted-foreground/20'}`}
          />
        ))}
      </div>
    </div>
  );
}

export interface AcknowledgeDialogProps {
  open: boolean;
  onClose: () => void;
  survey?: SatisfactionSurvey | null;
}

export function AcknowledgeDialog({ open, onClose, survey }: AcknowledgeDialogProps) {
  const [note, setNote] = useState('');
  const user = useAuthStore((s) => s.user);
  const { mutate: acknowledge, isPending } = useAcknowledgeSurvey();

  if (!survey) return null;

  const handleSubmit = () => {
    if (!survey.id) return;
    const data: AcknowledgeSurveyDto = {
      acknowledgedBy: user?.id ?? user?.name ?? 'system',
      note: note || undefined,
    };
    acknowledge(
      { id: survey.id, data },
      {
        onSuccess: () => {
          toastService.success('已标记跟进');
          setNote('');
          onClose();
        },
        onError: (e) => toastService.error('操作失败', e as Error),
      },
    );
  };

  const sentimentOfTag = (_tag: string): string => 'NEUTRAL';

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>差评跟进处理</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">患者：</span>
            <span className="font-medium">{survey.patientName ?? '-'}</span>
          </div>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">医生：</span>
            <span className="font-medium">{survey.doctorName ?? '-'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">时间：</span>
            <span className="font-medium">{survey.createdAt?.slice(0, 16) ?? '-'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">来源：</span>
            <span className="font-medium">{SOURCE_LABEL[survey.source]}</span>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">NPS 评分</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{survey.nps}</span>
              <Badge className={NPS_CATEGORY_COLOR[survey.npsCategory]}>
                {NPS_CATEGORY_LABEL[survey.npsCategory]}
              </Badge>
            </div>
          </div>
          <div className="space-y-1">
            {DIMENSIONS.map((d) => (
              <StarRow
                key={d.key}
                label={d.label}
                value={
                  (survey as unknown as Record<string, number>)[d.key] ?? 0
                }
              />
            ))}
          </div>
        </div>

        {survey.comment && (
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium mb-1">
              <MessageSquare className="w-4 h-4" />
              评论内容
            </div>
            <p className="text-sm whitespace-pre-wrap">{survey.comment}</p>
          </div>
        )}

        {survey.tags && survey.tags.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <Tag className="w-4 h-4" /> 标签
            </div>
            <div className="flex flex-wrap gap-1">
              {survey.tags.map((t) => {
                const color = SENTIMENT_COLOR[sentimentOfTag(t) as keyof typeof SENTIMENT_COLOR] ?? SENTIMENT_COLOR.NEUTRAL;
                return (
                  <Badge key={t} style={{ backgroundColor: `${color}22`, color }}>
                    {t}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {survey.acknowledged && (
          <div className="rounded-md bg-success/10 p-3 text-sm text-success">
            <p className="font-medium">已跟进</p>
            {survey.acknowledgeNote && <p className="mt-1 text-success/80">备注：{survey.acknowledgeNote}</p>}
            {survey.acknowledgedAt && <p className="mt-1 text-xs text-success/60">时间：{survey.acknowledgedAt.slice(0, 16)}</p>}
          </div>
        )}

        <div>
          <Label>跟进记录</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="请填写跟进说明（选填）"
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button onClick={handleSubmit} disabled={isPending || survey.acknowledged}>
            {survey.acknowledged ? '已跟进' : isPending ? '处理中...' : '标记已跟进'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
