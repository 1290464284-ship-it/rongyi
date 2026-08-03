import { useState, useEffect } from 'react';
import { Star, Inbox } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  NPS_CATEGORY_LABEL, NPS_CATEGORY_COLOR, DIMENSION_LABEL, getNpsColor,
  type SatisfactionSurvey,
} from '@/lib/api/communication/satisfaction';

export function RingProgress({ value, size = 140 }: { value: number; size?: number }) {
  const color = getNpsColor(value);
  const pct = Math.max(0, Math.min(100, (value + 100) / 2));
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e5e7eb" strokeWidth={12} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={12} fill="none"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }} data-testid="nps-ring-value">{value}</span>
        <span className="text-xs text-muted-foreground">NPS %</span>
      </div>
    </div>
  );
}

export function DimensionBar({ label, value }: { label: string; value: number }) {
  const pct = (value / 5) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value.toFixed(1)}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SatisfactionKpiCard({
  icon: Icon, label, value, subValue, tone,
}: {
  icon: typeof Star;
  label: string;
  value: string | number;
  subValue?: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'default';
}) {
  const toneClass =
    tone === 'success' ? 'bg-success/10 text-success' :
    tone === 'warning' ? 'bg-warning/10 text-warning' :
    tone === 'danger' ? 'bg-destructive/10 text-destructive' :
    tone === 'info' ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground';
  return (
    <Card data-testid={`kpi-${label}`}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${toneClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-2xl font-bold tracking-tight mt-0.5">{value}</p>
          {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="empty-state">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
        <Inbox className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function AutoScrollList({ items, interval = 5000 }: { items: SatisfactionSurvey[]; interval?: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (items.length <= 3) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), interval);
    return () => clearInterval(t);
  }, [items.length, interval]);
  if (items.length === 0) {
    return <EmptyState title="暂无最新评价" />;
  }
  return (
    <div className="space-y-2 max-h-[420px] overflow-hidden relative">
      <div className="space-y-2" style={{ transform: `translateY(-${idx * 92}px)`, transition: 'transform 0.5s ease' }}>
        {items.map((s) => (
          <div key={s.id} className="p-3 rounded-lg border border-border bg-white hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm truncate">{s.patientName ?? '匿名'}</span>
              <Badge className={`${NPS_CATEGORY_COLOR[s.npsCategory]} border border-border`}>
                {NPS_CATEGORY_LABEL[s.npsCategory]} {s.nps}
              </Badge>
            </div>
            <div className="flex items-center gap-1 mb-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  className={`w-3 h-3 ${i <= Math.round(s.avgRating) ? 'fill-warning text-warning' : 'text-muted-foreground/20'}`}
                />
              ))}
              <span className="text-xs text-muted-foreground ml-1">
                {s.doctorName ? `· ${s.doctorName}` : ''}
              </span>
            </div>
            {s.comment && (
              <p className="text-xs text-muted-foreground line-clamp-2">{s.comment}</p>
            )}
            <p className="text-[10px] text-muted-foreground/60 mt-1">{s.createdAt?.slice(5, 16) ?? ''}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export { DIMENSION_LABEL };
