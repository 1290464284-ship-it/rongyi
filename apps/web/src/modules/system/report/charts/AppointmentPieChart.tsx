import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import type { CallbackDataParams } from 'echarts/types/dist/shared';
import { APPOINTMENT_STATUS_LABEL } from '@/lib/api/clinical/appointments';

const PALETTE = [
  '#1E5AA8', '#3A7BC8', '#00B3AA', '#27AE60', '#F39C12',
  '#3498DB', '#9B59B6', '#E74C3C', '#1ABC9C', '#E67E22',
  '#16A085', '#34495E',
];

interface AppointmentStatusItem {
  status: string;
  count: number;
  percentage: number;
}

export default function AppointmentPieChart({ data, loading }: { data?: AppointmentStatusItem[]; loading: boolean }) {
  const list = useMemo(() => data ?? [], [data]);
  
  const option = useMemo(() => ({
    color: PALETTE,
    tooltip: {
      trigger: 'item',
      formatter: (p: CallbackDataParams & { percent: number }) => {
        const item = list[p.dataIndex];
        const label = APPOINTMENT_STATUS_LABEL[item?.status as keyof typeof APPOINTMENT_STATUS_LABEL] ?? item?.status ?? p.name;
        return `${label}: ${p.value} 笔 (${p.percent}%)`;
      },
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { color: '#6B7C93', fontSize: 12 },
      itemWidth: 10,
      itemHeight: 10,
      formatter: (name: string) => APPOINTMENT_STATUS_LABEL[name as keyof typeof APPOINTMENT_STATUS_LABEL] ?? name,
    },
    series: [
      {
        name: '预约占比',
        type: 'pie',
        radius: ['0%', '65%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: true,
          formatter: '{d}%',
          fontSize: 11,
          color: '#2C3E50',
        },
        emphasis: {
          label: { show: true, fontSize: 13, fontWeight: 'bold' },
          itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.2)' },
        },
        data: list.map((i) => ({
          name: i.status,
          value: i.count,
        })),
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