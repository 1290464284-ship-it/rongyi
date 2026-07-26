import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import echarts from '@/lib/echarts';
import type { CallbackDataParams } from 'echarts/types/dist/shared';

interface RevenueDoctorItem {
  doctorId: string;
  doctorName: string;
  amount: number;
  count: number;
  percentage: number;
}

export default function RevenueDoctorBarChart({ data, loading }: { data?: RevenueDoctorItem[]; loading: boolean }) {
  const list = data ?? [];
  
  const option = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: CallbackDataParams[]) => {
        const p = params[0];
        const item = list[p.dataIndex];
        return `${item?.doctorName ?? p.name}<br/>收入：¥${item?.amount?.toFixed(2) ?? 0}<br/>笔数：${item?.count ?? 0}<br/>占比：${item?.percentage?.toFixed(1) ?? 0}%`;
      },
    },
    grid: { left: 60, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: list.map((i) => i.doctorName),
      axisLine: { lineStyle: { color: '#DCE2E8' } },
      axisLabel: { color: '#6B7C93', fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: '收入 (元)',
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
    ],
    series: [
      {
        name: '收入',
        type: 'bar',
        data: list.map((i) => Number(i.amount.toFixed(2))),
        itemStyle: { color: '#1E5AA8', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 36,
        emphasis: { itemStyle: { color: '#154A8A' } },
      },
    ],
  }), [list]);

  if (loading) {
    return <div className='text-center text-muted-foreground py-8'>加载中...</div>;
  }
  if (list.length === 0) {
    return <div className='text-center text-muted-foreground py-8'>暂无数据</div>;
  }
  return <ReactECharts echarts={echarts} option={option} style={{ height: '320px' }} />;
}