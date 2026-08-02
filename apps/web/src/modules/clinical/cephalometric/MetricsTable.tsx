/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Info, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ANALYSIS_METHODS,
  METHOD_LABEL,
  type Metric,
  type AnalysisMethod,
} from '@/lib/api/clinical/cephalometric';

export interface MetricsTableProps {
  metrics: Metric[];
  methodFilter?: AnalysisMethod | 'ALL';
  defaultExpandedMethods?: AnalysisMethod[];
}

const DIRECTION_CONFIG: Record<string, { label: string; arrow: string; className: string }> = {
  UP: { label: '偏高', arrow: '↑', className: 'bg-red-500/10 text-red-600 border-red-500/20' },
  NORMAL: { label: '正常', arrow: '—', className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  DOWN: { label: '偏低', arrow: '↓', className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
};

export function computeDirection(
  value: number,
  range: [number, number]
): 'UP' | 'NORMAL' | 'DOWN' {
  const [min, max] = range;
  if (value > max) return 'UP';
  if (value < min) return 'DOWN';
  return 'NORMAL';
}

export function MetricsTable({ metrics, methodFilter = 'ALL', defaultExpandedMethods }: MetricsTableProps) {
  const [expanded, setExpanded] = useState<Set<AnalysisMethod | 'ALL'>>(
    () => new Set(defaultExpandedMethods ?? (methodFilter === 'ALL' ? ANALYSIS_METHODS : [methodFilter as AnalysisMethod]).filter(Boolean) as AnalysisMethod[])
  );
  const [hoverCode, setHoverCode] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const g: Record<string, Metric[]> = {};
    for (const m of metrics) {
      if (methodFilter !== 'ALL' && m.method !== methodFilter) continue;
      (g[m.method] = g[m.method] ?? []).push(m);
    }
    return g;
  }, [metrics, methodFilter]);

  const methods = Object.keys(grouped) as (AnalysisMethod | 'ALL')[];

  const toggle = (method: AnalysisMethod | 'ALL') => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(method)) n.delete(method);
      else n.add(method);
      return n;
    });
  };

  if (!metrics || metrics.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        <ArrowRightLeft className="w-8 h-8 mx-auto mb-2 opacity-30" />
        暂无指标数据，请先放置标志点并执行分析
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {methods.map((method) => {
        const items = grouped[method] ?? [];
        const isExpanded = expanded.has(method);
        const up = items.filter((i) => i.direction === 'UP').length;
        const down = items.filter((i) => i.direction === 'DOWN').length;
        const normal = items.filter((i) => i.direction === 'NORMAL').length;
        return (
          <Card key={method} className="overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(method)}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
            >
              {isExpanded ? <ChevronLeft className="w-4 h-4 -rotate-90" /> : <ChevronRight className="w-4 h-4" />}
              <span className="font-semibold text-sm">{METHOD_LABEL[method as AnalysisMethod] ?? method}</span>
              <Badge variant="outline" className="text-xs ml-auto">{items.length} 项</Badge>
              {up > 0 && <Badge className="text-xs bg-red-500/10 text-red-600 border-0">↑{up}</Badge>}
              {down > 0 && <Badge className="text-xs bg-blue-500/10 text-blue-600 border-0">↓{down}</Badge>}
              {normal > 0 && <Badge className="text-xs bg-green-500/10 text-green-600 border-0">—{normal}</Badge>}
            </button>
            {isExpanded && (
              <div className="border-t border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40%]">指标</TableHead>
                      <TableHead className="text-right">数值</TableHead>
                      <TableHead className="text-right">正常范围</TableHead>
                      <TableHead className="text-right w-[90px]">方向</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((m) => {
                      const dir = DIRECTION_CONFIG[m.direction] ?? DIRECTION_CONFIG.NORMAL;
                      return (
                        <TableRow
                          key={m.code}
                          className="cursor-pointer hover:bg-muted/30 relative group"
                          onMouseEnter={() => setHoverCode(m.code)}
                          onMouseLeave={() => setHoverCode(null)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{m.label}</span>
                              <span className="text-xs text-muted-foreground font-mono">{m.code}</span>
                              {m.description && (
                                <Info className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              )}
                            </div>
                            {hoverCode === m.code && m.description && (
                              <div className="absolute left-4 -top-1 -translate-y-full z-10 bg-popover border border-border rounded-md shadow-lg p-2 text-xs max-w-xs animate-in fade-in">
                                {m.description}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono text-sm font-semibold">{m.value.toFixed(2)}</span>
                            <span className="text-xs text-muted-foreground ml-1">{m.unit}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs text-muted-foreground font-mono">
                              [{m.normalRange[0].toFixed(1)}, {m.normalRange[1].toFixed(1)}] {m.unit}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={cn('text-xs border', dir.className)}>
                              {dir.arrow} {dir.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
