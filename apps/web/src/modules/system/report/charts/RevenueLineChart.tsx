import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import type { CallbackDataParams } from 'echarts/types/dist/shared';
import type { RevenueData } from '@/lib/api/system/stats';

type AxisCallbackParams = CallbackDataParams & { axisValue?: string };

export default function RevenueLineChart({ data, loading }: { data?: RevenueData; loading: boolean }) {
  const option = useMemo(() => {
    const timeline = data?.timeline ?? [];
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: AxisCallbackParams[]) => {
          const p = params[0];
          const item = timeline[p.dataIndex];
          return `${p.axisValue ?? ''}<br/>营收：¥${p.value}<br/>笔数：${item?.count ?? 0}`;
        },
      },
      grid: { left: 50, right: 20, top: 30, bottom: 40 },
      xAxis: {
        type: 'category',
        data: timeline.map((t) => t.date.slice(5)),
        axisLine: { lineStyle: { color: '#DCE2E8' } },
        axisLabel: { color: '#6B7C93', fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        name: '营收 (元)',
        nameTextStyle: { color: '#6B7C93', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#6B7C93',
          fontSize: 11,
          formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`),
        },
        splitLine: { lineStyle: { color: '#E8ECF0', type: 'dashed' } },
      },
      series: [
        {
          name: '营收',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: timeline.map((t) => t.revenue),
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
          emphasis: { focus: 'series' },
        },
      ],
    };
  }, [data]);

  if (loading) {
    return <div className='text-center text-muted-foreground py-8'>加载中...</div>;
  }
  if (!data?.timeline?.length) {
    return <div className='text-center text-muted-foreground py-8'>暂无数据</div>;
  }
  return <ReactECharts echarts={echarts} option={option} style={{ height: '300px' }} />;
}