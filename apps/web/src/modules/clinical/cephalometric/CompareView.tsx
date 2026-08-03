import { useState, useMemo } from 'react';
import { ArrowRightLeft, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { DataTableWrapper, type DataTableColumn } from '@/components/ui/data-table-wrapper';
import {
  useAnalyses,
  useCompareAnalyses,
  type AnalyzeResult,
  type CompareItem,
} from '@/lib/api/clinical/cephalometric';

export interface CompareViewProps {
  patientId?: string;
}

function diffClass(delta: number): string {
  if (delta > 0) return 'text-red-600';
  if (delta < 0) return 'text-blue-600';
  return 'text-muted-foreground';
}

export function CompareView({ patientId }: CompareViewProps) {
  const [id1, setId1] = useState('');
  const [id2, setId2] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const compare = useCompareAnalyses();

  const { data: analyses = [] } = useAnalyses({ patientId });

  const displayData = useMemo((): CompareItem[] => {
    if (!compare.data) return [];
    if (onlyDiff) return compare.data.filter((d) => d.delta !== 0);
    return compare.data;
  }, [compare.data, onlyDiff]);

  const runCompare = () => {
    if (!id1 || !id2) return;
    compare.mutate({ id1, id2 });
  };

  const columns: DataTableColumn<CompareItem>[] = [
    {
      key: 'label',
      header: '指标',
      cell: (row) => (
        <div>
          <div className="font-medium text-sm">{row.label}</div>
          <div className="text-[11px] text-muted-foreground font-mono">{row.code}</div>
        </div>
      ),
    },
    { key: 'value1', header: '记录1', cell: (r) => <span className="font-mono text-sm">{r.value1.toFixed(2)} {r.unit}</span>, className: 'text-right' },
    { key: 'value2', header: '记录2', cell: (r) => <span className="font-mono text-sm">{r.value2.toFixed(2)} {r.unit}</span>, className: 'text-right' },
    {
      key: 'delta',
      header: '差值',
      cell: (r) => (
        <span className={cn('font-mono text-sm font-semibold text-right block', diffClass(r.delta))}>
          {r.delta > 0 ? '+' : ''}{r.delta.toFixed(2)} {r.unit}
        </span>
      ),
      className: 'text-right',
    },
    {
      key: 'arrow',
      header: '变化',
      cell: (r) => {
        const color = r.arrow === '↗' ? 'text-red-600' : r.arrow === '↘' ? 'text-blue-600' : 'text-muted-foreground';
        return <Badge className={cn('text-sm border justify-self-end', color)}>{r.arrow}</Badge>;
      },
      className: 'text-right',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4" />历史对比
          </h3>
          <label htmlFor="compare-only-diff" className="flex items-center gap-2 text-xs">
            <Checkbox id="compare-only-diff" checked={onlyDiff} onChange={(v) => setOnlyDiff(v)} className="h-3 w-3" />
            只看差异项
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">左侧记录</Label>
            <Select value={id1} onChange={(e) => setId1(e.target.value)}>
              <option value="">选择记录1...</option>
              {analyses.map((a: AnalyzeResult) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {new Date(a.createdAt).toLocaleDateString()}
                  {a.method ? ` (${a.method})` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">右侧记录</Label>
            <Select value={id2} onChange={(e) => setId2(e.target.value)}>
              <option value="">选择记录2...</option>
              {analyses.map((a: AnalyzeResult) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {new Date(a.createdAt).toLocaleDateString()}
                  {a.method ? ` (${a.method})` : ''}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={runCompare} disabled={!id1 || !id2 || compare.isPending} className="w-full">
          {compare.isPending ? '对比中...' : <><ChevronLeft className="w-4 h-4 mr-1 rotate-180" />开始对比</>}
        </Button>
        {compare.data && (
          <DataTableWrapper<CompareItem>
            columns={columns}
            data={displayData}
            isEmpty={displayData.length === 0}
            emptyText={onlyDiff ? '无差异项' : '暂无数据'}
            showPagination={false}
            rowKey={(r) => r.code}
          />
        )}
      </CardContent>
    </Card>
  );
}
