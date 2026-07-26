import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import echarts from '@/lib/echarts';
import type { CallbackDataParams } from 'echarts/types/dist/shared';
import type { PatientGrowthData } from '@/lib/api/system/stats';

export default function PatientGrowthChart({ data, loading }: { data?: PatientGrowthData; loading: boolean }) {
  const option = useMemo(() => {
    const items = data?.items ?? [];
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: CallbackDataParams[]) => {
          const p0 = params[0];
          const p1 = params[1];
          const item = items[p0.dataIndex];
          return `${item?.date ?? (p0 as any).axisValue ?? ''}<br/>${p0.marker}新增患者：${p0.value}<br/>${p1?.marker ?? ''}累计患者：${p1?.value ?? 0}`;
        },
      },
      legend: {
        data: ['新增患者', '累计患者'],
        top: 0,
        right: 10,
        textStyle: { color: '#6B7C93', fontSize: 12 },
        itemWidth: 12,
        itemHeight: 12,
      },
      grid: { left: 60, right: 60, top: 40, bottom: 40 },
      xAxis: {
        type: 'category',
        data: items.map((t) => t.date.slice(5)),
        axisLine: { lineStyle: { color: '#DCE2E8' } },
        axisLabel: { color: '#6B7C93', fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '新增',
          nameTextStyle: { color: '#6B7C93', fontSize: 11 },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#6B7C93', fontSize: 11 },
          splitLine: { lineStyle: { color: '#E8ECF0', type: 'dashed' } },
        },
        {
          type: 'value',
          name: '累计',
          nameTextStyle: { color: '#6B7C93', fontSize: 11 },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#6B7C93', fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '新增患者',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: items.map((t) => t.count),
          itemStyle: { color: '#1E5AA8' },
          lineStyle: { width: 2.5, color: '#1E5AA8' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(30, 90, 168, 0.25)' },
                { offset: 1, color: 'rgba(30, 90, 168, 0.02)' },
              ],
            },
          },
        },
        {
          name: '累计患者',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          yAxisIndex: 1,
          data: items.map((t) => t.total),
          itemStyle: { color: '#00B3AA' },
          lineStyle: { width: 2.5, color: '#00B3AA' },
        },
      ],
    };
  }, [data]);

  if (loading) {
    return <div className='text-center text-muted-foreground py-8'>加载中...</div>;
  }
  if (!data?.items?.length) {
    return <div className='text-center text-muted-foreground py-8'>暂无数据</div>;
  }
  return <ReactECharts echarts={echarts} option={option} style={{ height: '320px' }} />;
}