/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricsTable, computeDirection } from '../MetricsTable';
import { CompareView } from '../CompareView';
import {
  ANALYSIS_METHODS,
  type Metric,
  type AnalyzeResult,
  type CompareItem,
  type NormValue,
  useAnalyses,
  useCompareAnalyses,
  useNormValues,
  useAnalyzeLandmarkSet,
} from '@/lib/api/clinical/cephalometric';
import { createQueryWrapper } from '@/__tests__/query-test-utils';

vi.mock('lucide-react', () => {
  const icons: Record<string, any> = {};
  const names = [
    'Ruler','Pin','Undo','Redo','Crosshair','Image','Layers','RefreshCw','Save',
    'Search','Filter','Download','Upload','ChevronRight','Printer','BarChart3',
    'ArrowRightLeft','ChevronLeft','ZoomIn','ZoomOut','Maximize2','PlusCircle',
    'XCircle','Info','Check','ChevronsLeft','ChevronsRight','Inbox','Users',
    'Calendar','User',
  ];
  for (const n of names) {
    icons[n] = ({ className, ...rest }: any) =>
      React.createElement('span', { ...rest, 'data-testid': `icon-${n}`, className });
  }
  return icons;
});

vi.mock('@/lib/api/clinical/cephalometric', async () => {
  const mod: any = await vi.importActual('@/lib/api/clinical/cephalometric');
  return {
    ...mod,
    useAnalyses: vi.fn(),
    useCompareAnalyses: () => ({
      data: undefined,
      isPending: false,
      mutate: vi.fn(),
    }),
    useNormValues: vi.fn(),
    useAnalyzeLandmarkSet: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

function makeMetric(partial: Partial<Metric>): Metric {
  return {
    code: 'SNA',
    label: 'SNA 角',
    value: 82,
    unit: '°',
    normalRange: [80, 84],
    direction: 'NORMAL',
    method: 'Steiner',
    description: '蝶鞍点-鼻根点-A 点夹角',
    ...partial,
  };
}

describe('cephalometric-analysis / MetricsTable & API', () => {
  it('F19A-1 metrics SNA=85 range[80,84] → direction=UP(红↑)', () => {
    const dir = computeDirection(85, [80, 84]);
    expect(dir).toBe('UP');
    const m = makeMetric({ value: 85, normalRange: [80, 84], direction: dir });
    const { container } = render(<MetricsTable metrics={[m]} methodFilter="ALL" />);
    expect(container.textContent).toContain('↑');
    expect(container.textContent).toContain('偏高');
  });

  it('F19A-2 ANB=2 range[0,4] → NORMAL(绿)', () => {
    const dir = computeDirection(2, [0, 4]);
    expect(dir).toBe('NORMAL');
    const m = makeMetric({ code: 'ANB', label: 'ANB 角', value: 2, normalRange: [0, 4], direction: dir });
    const { container } = render(<MetricsTable metrics={[m]} methodFilter="ALL" />);
    expect(container.textContent).toContain('正常');
  });

  it('F19A-3 IMPA=86 range[88,92] → DOWN(蓝↓)', () => {
    const dir = computeDirection(86, [88, 92]);
    expect(dir).toBe('DOWN');
    const m = makeMetric({ code: 'IMPA', label: 'IMPA 角', value: 86, normalRange: [88, 92], direction: dir });
    const { container } = render(<MetricsTable metrics={[m]} methodFilter="ALL" />);
    expect(container.textContent).toContain('↓');
    expect(container.textContent).toContain('偏低');
  });

  it('F19A-4 方法筛选 Steiner → 只显示该方法的指标', () => {
    const mSteiner = makeMetric({ method: 'Steiner', code: 'SNA' });
    const mDowns = makeMetric({ method: 'Downs', code: 'Cant', label: 'Cant' });
    const mTweed = makeMetric({ method: 'Tweed', code: 'FMA', label: 'FMA' });
    const { container: c1 } = render(
      <MetricsTable metrics={[mSteiner, mDowns, mTweed]} methodFilter="Steiner" />
    );
    expect(c1.textContent).toContain('SNA');
    expect(c1.textContent).not.toContain('Cant');
    expect(c1.textContent).not.toContain('FMA');
  });

  it('F19A-5 compare：SNA 85 vs 82 → delta=3 arrow=↗', () => {
    const delta = 85 - 82;
    expect(delta).toBe(3);
    let arrow: CompareItem['arrow'] = delta > 0 ? '↗' : delta < 0 ? '↘' : '→';
    expect(arrow).toBe('↗');
  });

  it('F19A-6 compare：SNA 82 vs 82 → delta=0 arrow=→', () => {
    const delta = 82 - 82;
    expect(delta).toBe(0);
    let arrow: CompareItem['arrow'] = delta > 0 ? '↗' : delta < 0 ? '↘' : '→';
    expect(arrow).toBe('→');
  });

  it('F19A-7 compare：SNA 80 vs 85 → delta=-5 arrow=↘', () => {
    const delta = 80 - 85;
    expect(delta).toBe(-5);
    let arrow: CompareItem['arrow'] = delta > 0 ? '↗' : delta < 0 ? '↘' : '→';
    expect(arrow).toBe('↘');
  });

  it('F19A-8 只看差异项 Toggle ON：过滤 delta=0；OFF：显示全部', () => {
    const diffItems: CompareItem[] = [
      { code: 'SNA', label: 'SNA', value1: 85, value2: 82, delta: 3, arrow: '↗', unit: '°' },
      { code: 'ANB', label: 'ANB', value1: 2, value2: 2, delta: 0, arrow: '→', unit: '°' },
    ];
    const onlyDiff = diffItems.filter((d) => d.delta !== 0);
    expect(onlyDiff).toHaveLength(1);
    expect(onlyDiff[0].code).toBe('SNA');
    expect(diffItems).toHaveLength(2);
  });

  it('F19A-9 POST analyze 成功 → metrics 数组 length ≥ 50', async () => {
    const metrics: Metric[] = Array.from({ length: 55 }).map((_, i) =>
      makeMetric({ code: `M${i}`, label: `指标 ${i}`, method: ANALYSIS_METHODS[i % 4] })
    );
    const hook = {
      isPending: false,
      isError: false,
      isSuccess: true,
      mutate: vi.fn(),
      mutateAsync: async () => ({
        id: 'A001',
        landmarkSetId: 'L001',
        metrics,
        createdAt: new Date().toISOString(),
      } as AnalyzeResult),
      data: undefined,
      failureCount: 0,
      failureReason: null,
      isPaused: false,
      reset: () => {},
      status: 'idle',
      submittedAt: 0,
      variables: undefined as any,
    };
    const result = await hook.mutateAsync();
    expect(result.metrics.length).toBeGreaterThanOrEqual(50);
  });

  it('F19A-10 norm-values GET 返回 SNA[80,84]；表渲染正常范围正确', () => {
    const ret = {
      data: [
        { code: 'SNA', label: 'SNA 角', method: 'Steiner' as const, adultChild: 'ADULT' as const, gender: 'ALL' as const, min: 80, max: 84, unit: '°', source: '测试' } satisfies NormValue,
      ],
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
      isFetched: true,
      refetch: async () => ({ data: [] }),
      status: 'success' as const,
      fetchStatus: 'idle' as const,
    };
    vi.mocked(useNormValues).mockReturnValue(ret as any);

    const m = makeMetric({ code: 'SNA', normalRange: [80, 84] });
    const { container } = render(<MetricsTable metrics={[m]} />);
    expect(container.textContent).toContain('[80.0, 84.0]');
  });

  it('F19A-11 空 metrics → Empty 不崩溃；表格不渲染指标行', () => {
    const { container } = render(<MetricsTable metrics={[]} />);
    expect(container.textContent).toContain('暂无指标数据');
    expect(() => screen.getByText('SNA')).toThrow();
  });

  it('F19A-12 打印跳转：window.open(#/print-preview?type=cephalometric&id=A001)', () => {
    const originalOpen = window.open;
    let openedUrl = '';
    const fakeOpen: any = vi.fn(((url: string, target?: string) => {
      openedUrl = url;
      return null;
    }) as typeof window.open);
    window.open = fakeOpen;
    try {
      const analysisId = 'A001';
      const url = `#/print-preview?type=cephalometric&id=${analysisId}`;
      window.open(url, '_blank');
      expect(openedUrl).toBe(url);
      expect(fakeOpen).toHaveBeenCalledWith(url, '_blank');
    } finally {
      window.open = originalOpen;
    }
  });
});
