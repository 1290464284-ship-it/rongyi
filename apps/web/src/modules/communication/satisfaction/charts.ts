import type { NpsPoint, DoctorRankingItem, KeywordItem, KeywordSentiment } from '@/lib/api/communication/satisfaction';
import { getNpsColor, SENTIMENT_COLOR } from '@/lib/api/communication/satisfaction';

export function buildNpsTrendOption(trend: NpsPoint[] = []) {
  const dates = trend.map((t) => t.date.slice(5));
  const npsValues = trend.map((t) => t.nps);
  const totalValues = trend.map((t) => t.total);

  const npsColorStops = npsValues.map((v) => {
    if (v >= 60) return '#10b981';
    if (v >= 30) return '#f59e0b';
    return '#ef4444';
  });

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: unknown[]) => {
        const arr = params as Array<{ axisValueLabel?: string; seriesName: string; value: number; marker?: string }>;
        const date = arr[0]?.axisValueLabel ?? '';
        let html = `<strong>${date}</strong><br/>`;
        arr.forEach((p) => {
          const suffix = p.seriesName === 'NPS' ? '%' : ' 份';
          html += `${p.marker ?? ''}${p.seriesName}：<b>${p.value}${suffix}</b><br/>`;
        });
        return html;
      },
    },
    legend: {
      data: ['调查数', 'NPS'],
      right: 10,
      top: 0,
      textStyle: { color: '#6B7C93', fontSize: 11 },
    },
    grid: { left: 50, right: 60, top: 40, bottom: 40 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: '#DCE2E8' } },
      axisLabel: { color: '#6B7C93', fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: '调查数',
        nameTextStyle: { color: '#6B7C93', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#6B7C93', fontSize: 11 },
        splitLine: { lineStyle: { color: '#E8ECF0', type: 'dashed' } },
      },
      {
        type: 'value',
        name: 'NPS (%)',
        min: -100,
        max: 100,
        nameTextStyle: { color: '#6B7C93', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#6B7C93',
          fontSize: 11,
          formatter: (v: number) => `${v}`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '调查数',
        type: 'bar',
        yAxisIndex: 0,
        data: totalValues,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(30, 90, 168, 0.6)' },
              { offset: 1, color: 'rgba(30, 90, 168, 0.15)' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: 14,
      },
      {
        name: 'NPS',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        data: npsValues.map((v, i) => ({
          value: v,
          itemStyle: { color: npsColorStops[i] },
        })),
        lineStyle: { width: 2.5, color: '#1E5AA8' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(30, 90, 168, 0.18)' },
              { offset: 1, color: 'rgba(30, 90, 168, 0.02)' },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#94a3b8' },
          data: [{ yAxis: 0, label: { formatter: '0', color: '#94a3b8' } }],
        },
      },
    ],
  };
}

export function buildDoctorRankingOption(doctors: DoctorRankingItem[] = []) {
  const sorted = [...doctors].sort((a, b) => b.nps - a.nps);
  const names = sorted.map((d) => d.name);
  const values = sorted.map((d) => d.nps);
  const colors = sorted.map((d) => {
    if (d.sample < 30) return '#d1d5db';
    return getNpsColor(d.nps);
  });

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: Array<{ axisValueLabel?: string; dataIndex: number; value: number }>) => {
        const idx = params[0]?.dataIndex ?? 0;
        const d = sorted[idx];
        if (!d) return '';
        const sampleNote = d.sample < 30 ? '（样本不足）' : '';
        return `<strong>${d.name}</strong>${sampleNote}<br/>NPS：<b>${d.nps}%</b><br/>样本量：${d.sample}<br/>调查数：${d.count}`;
      },
    },
    grid: { left: 80, right: 40, top: 20, bottom: 40 },
    xAxis: {
      type: 'value',
      min: -100,
      max: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#6B7C93', fontSize: 11 },
      splitLine: { lineStyle: { color: '#E8ECF0', type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: names,
      inverse: true,
      axisLine: { lineStyle: { color: '#DCE2E8' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#475569',
        fontSize: 12,
        formatter: (_: string, idx: number) => {
          const d = sorted[idx];
          if (d && d.sample < 30) return `{gray|${d.name}}`;
          return names[idx];
        },
        rich: {
          gray: { color: '#9ca3af' },
        },
      },
    },
    series: [
      {
        type: 'bar',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: {
            color: colors[i],
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barWidth: 18,
        label: {
          show: true,
          position: 'right',
          formatter: (p: { value: number; dataIndex: number }) => {
            const d = sorted[p.dataIndex];
            if (d && d.sample < 30) return `${p.value}% (样本不足)`;
            return `${p.value}%`;
          },
          color: '#475569',
          fontSize: 11,
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#94a3b8' },
          data: [{ xAxis: 0 }],
        },
      },
    ],
  };
}

export function buildKeywordFreqOption(
  keywords: KeywordItem[] = [],
  sentimentFilter?: KeywordSentiment | 'ALL'
) {
  const filtered = sentimentFilter && sentimentFilter !== 'ALL'
    ? keywords.filter((k) => k.sentiment === sentimentFilter)
    : keywords;

  const sorted = [...filtered]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const tags = sorted.map((k) => k.tag);
  const counts = sorted.map((k) => k.count);
  const colors = sorted.map((k) => SENTIMENT_COLOR[k.sentiment]);

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: Array<{ axisValueLabel?: string; dataIndex: number; value: number }>) => {
        const idx = params[0]?.dataIndex ?? 0;
        const k = sorted[idx];
        if (!k) return '';
        const sentimentLabel = k.sentiment === 'POSITIVE' ? '正面' : k.sentiment === 'NEGATIVE' ? '负面' : '中性';
        return `<strong>${k.tag}</strong><br/>出现次数：<b>${k.count}</b><br/>情感：${sentimentLabel}`;
      },
    },
    grid: { left: 100, right: 40, top: 20, bottom: 20 },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#6B7C93', fontSize: 11 },
      splitLine: { lineStyle: { color: '#E8ECF0', type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: tags,
      inverse: true,
      axisLine: { lineStyle: { color: '#DCE2E8' } },
      axisTick: { show: false },
      axisLabel: { color: '#475569', fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        data: counts.map((v, i) => ({
          value: v,
          itemStyle: {
            color: colors[i],
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barWidth: 16,
        label: {
          show: true,
          position: 'right',
          color: '#475569',
          fontSize: 11,
        },
      },
    ],
  };
}
