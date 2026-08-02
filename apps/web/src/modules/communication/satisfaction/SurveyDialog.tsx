import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Star, Tag } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreateSatisfactionSurvey,
  POSITIVE_KEYWORDS,
  NEGATIVE_KEYWORDS,
  SOURCE_LABEL,
  type SurveySource,
  type CreateSurveyDto,
  getNpsCategory,
  NPS_CATEGORY_LABEL,
  NPS_CATEGORY_COLOR,
} from '@/lib/api/communication/satisfaction';
import { toastService } from '@/lib/utils/toast-service';

interface VisitOption {
  id: string;
  patientName: string;
  patientCode?: string;
  doctorId?: string;
  doctorName?: string;
  visitDate: string;
}

const MOCK_VISITS: VisitOption[] = [
  { id: 'v1', patientName: '张三', patientCode: 'P001', doctorId: 'd1', doctorName: '李医生', visitDate: '2026-07-28' },
  { id: 'v2', patientName: '李四', patientCode: 'P002', doctorId: 'd2', doctorName: '王医生', visitDate: '2026-07-29' },
  { id: 'v3', patientName: '王五', patientCode: 'P003', doctorId: 'd1', doctorName: '李医生', visitDate: '2026-07-30' },
  { id: 'v4', patientName: '赵六', patientCode: 'P004', doctorId: 'd3', doctorName: '陈医生', visitDate: '2026-07-31' },
  { id: 'v5', patientName: '孙七', patientCode: 'P005', doctorId: 'd2', doctorName: '王医生', visitDate: '2026-08-01' },
];

function NpsSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const category = getNpsCategory(value);
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs font-medium">
        <span className="text-destructive">贬损者 0-6</span>
        <span className="text-warning">中立者 7-8</span>
        <span className="text-success">推荐者 9-10</span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gradient-to-r from-destructive via-warning to-success"
          aria-label="NPS 评分"
        />
      </div>
      <div className="flex justify-between items-center gap-1">
        {Array.from({ length: 11 }).map((_, i) => (
          <span
            key={i}
            className={`text-xs flex-1 text-center py-1 rounded cursor-pointer transition-colors ${
              i <= value
                ? i <= 6 ? 'bg-destructive/10 text-destructive' : i <= 8 ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
                : 'text-muted-foreground/30'
            }`}
            onClick={() => onChange(i)}
          >
            {i}
          </span>
        ))}
      </div>
      <div className="flex justify-between items-center">
        <div>
          <span className="text-2xl font-bold mr-2">{value}</span>
          <Badge className={NPS_CATEGORY_COLOR[category]}>{NPS_CATEGORY_LABEL[category]}</Badge>
        </div>
        <span className="text-sm text-muted-foreground">您有多大可能向朋友推荐我们？</span>
      </div>
    </div>
  );
}

function RatingStars({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground w-20">{label}</span>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={`${label} 评分`}>
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className="p-0.5 transition-transform hover:scale-110"
            aria-label={`${label} ${s} 星`}
          >
            <Star
              className={`w-6 h-6 transition-colors ${
                s <= value ? 'fill-warning text-warning' : 'text-muted-foreground/20'
              }`}
            />
          </button>
        ))}
        <span className="ml-2 text-sm font-medium w-6 text-right">{value}</span>
      </div>
    </div>
  );
}

const DIMENSIONS: { key: keyof CreateSurveyDto; label: string }[] = [
  { key: 'ratingQuality', label: '医疗质量' },
  { key: 'ratingService', label: '服务态度' },
  { key: 'ratingEnvironment', label: '环境设施' },
  { key: 'ratingPrice', label: '价格合理' },
  { key: 'ratingWait', label: '等候时间' },
];

const SOURCES: SurveySource[] = ['QR_CODE', 'SMS', 'LINK', 'MANUAL'];

export interface SurveyDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SurveyDialog({ open, onClose }: SurveyDialogProps) {
  const [visitId, setVisitId] = useState('');
  const [nps, setNps] = useState(8);
  const [ratingQuality, setRatingQuality] = useState(5);
  const [ratingService, setRatingService] = useState(5);
  const [ratingEnvironment, setRatingEnvironment] = useState(5);
  const [ratingPrice, setRatingPrice] = useState(5);
  const [ratingWait, setRatingWait] = useState(5);
  const [comment, setComment] = useState('');
  const [source, setSource] = useState<SurveySource>('MANUAL');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');

  const { mutate: createSurvey, isPending } = useCreateSatisfactionSurvey();

  const selectedVisit = MOCK_VISITS.find((v) => v.id === visitId);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const t = customTag.trim();
    if (t && !selectedTags.includes(t)) {
      setSelectedTags((prev) => [...prev, t]);
    }
    setCustomTag('');
  };

  const reset = () => {
    setVisitId('');
    setNps(8);
    setRatingQuality(5);
    setRatingService(5);
    setRatingEnvironment(5);
    setRatingPrice(5);
    setRatingWait(5);
    setComment('');
    setSource('MANUAL');
    setSelectedTags([]);
    setCustomTag('');
  };

  const handleSubmit = () => {
    if (!visitId) {
      toastService.validationError('就诊记录', '请选择就诊记录');
      return;
    }
    createSurvey(
      {
        visitId,
        doctorId: selectedVisit?.doctorId,
        source,
        nps,
        ratingQuality,
        ratingService,
        ratingEnvironment,
        ratingPrice,
        ratingWait,
        comment: comment || undefined,
        tags: selectedTags.length ? selectedTags : undefined,
      },
      {
        onSuccess: () => {
          toastService.success('评价已提交');
          reset();
          onClose();
        },
        onError: (e) => toastService.error('提交失败', e as Error),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>发起满意度评价</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-5">
        <div>
          <Label>就诊记录</Label>
          <Select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
            <option value="">请选择近 15 日已结束的就诊</option>
            {MOCK_VISITS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.patientName}（{v.patientCode}）- {v.visitDate} - {v.doctorName}
              </option>
            ))}
          </Select>
        </div>

        {selectedVisit && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <span className="text-muted-foreground">接诊医生：</span>
            <span className="font-medium">{selectedVisit.doctorName ?? '-'}</span>
          </div>
        )}

        <div>
          <Label>推荐指数 (NPS)</Label>
          <NpsSlider value={nps} onChange={setNps} />
        </div>

        <div className="space-y-1 rounded-lg border border-border p-3">
          <Label className="text-base">多维度评分</Label>
          {DIMENSIONS.map((d) => (
            <RatingStars
              key={d.key}
              label={d.label}
              value={
                d.key === 'ratingQuality' ? ratingQuality :
                d.key === 'ratingService' ? ratingService :
                d.key === 'ratingEnvironment' ? ratingEnvironment :
                d.key === 'ratingPrice' ? ratingPrice : ratingWait
              }
              onChange={(v) => {
                if (d.key === 'ratingQuality') setRatingQuality(v);
                else if (d.key === 'ratingService') setRatingService(v);
                else if (d.key === 'ratingEnvironment') setRatingEnvironment(v);
                else if (d.key === 'ratingPrice') setRatingPrice(v);
                else setRatingWait(v);
              }}
            />
          ))}
        </div>

        <div>
          <Label>来源渠道</Label>
          <div className="flex flex-wrap gap-2 mt-2" role="radiogroup" aria-label="来源渠道">
            {SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                  source === s
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                }`}
                role="radio"
                aria-checked={source === s}
              >
                {SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>评价内容</Label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="请输入您的就诊体验和建议（选填）"
            rows={3}
          />
        </div>

        <div>
          <Label className="flex items-center gap-1">
            <Tag className="w-4 h-4" /> 关键词标签（可多选）
          </Label>
          <div className="mt-2 space-y-2">
            <div>
              <p className="text-xs text-success mb-1">正面关键词</p>
              <div className="flex flex-wrap gap-1">
                {POSITIVE_KEYWORDS.map((tag) => (
                  <Badge
                    key={tag}
                    role="checkbox"
                    aria-checked={selectedTags.includes(tag)}
                    tabIndex={0}
                    onClick={() => toggleTag(tag)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTag(tag); }}
                    className={`cursor-pointer select-none ${
                      selectedTags.includes(tag)
                        ? 'bg-success text-white hover:bg-success/90'
                        : 'bg-success/10 text-success hover:bg-success/20'
                    }`}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-destructive mb-1">负面关键词</p>
              <div className="flex flex-wrap gap-1">
                {NEGATIVE_KEYWORDS.map((tag) => (
                  <Badge
                    key={tag}
                    role="checkbox"
                    aria-checked={selectedTags.includes(tag)}
                    tabIndex={0}
                    onClick={() => toggleTag(tag)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTag(tag); }}
                    className={`cursor-pointer select-none ${
                      selectedTags.includes(tag)
                        ? 'bg-destructive text-white hover:bg-destructive/90'
                        : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                    }`}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Input
              placeholder="自定义标签"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={addCustomTag}>添加</Button>
            </div>
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                <span className="text-xs text-muted-foreground mr-1">已选：</span>
                {selectedTags.map((t) => (
                  <Badge key={t} className="bg-primary/5 border border-border">
                    {t} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>取消</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? '提交中...' : '提交评价'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
