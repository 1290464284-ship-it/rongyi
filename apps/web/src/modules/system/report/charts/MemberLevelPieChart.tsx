import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';

const PALETTE = [
  '#1E5AA8', '#3A7BC8', '#00B3AA', '#27AE60', '#F39C12',
  '#3498DB', '#9B59B6', '#E74C3C', '#1ABC9C', '#E67E22',
  '#16A085', '#34495E',
];

interface MemberLevelItem {
  level: string;
  count: number;
}

export default function MemberLevelPieChart({ data, loading }: { data?: MemberLevelItem[]; loading: boolean }) {
  const levelDist = useMemo(() => data ?? [], [data]);
  
  const option = useMemo(() => ({
    color: PALETTE,
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} 人 ({d}%)',
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { color: '#6B7C93', fontSize: 12 },
      itemWidth: 10,
      itemHeight: 10,
    },
    series: [
      {
        name: '等级分布',
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
        data: levelDist.map((l) => ({ name: l.level, value: l.count })),
      },
    ],
  }), [levelDist]);

  if (loading) {
    return <div className='text-center text-muted-foreground py-8'>加载中...</div>;
  }
  if (levelDist.length === 0) {
    return <div className='text-center text-muted-foreground py-8'>暂无数据</div>;
  }
  return <ReactECharts echarts={echarts} option={option} style={{ height: '320px' }} />;
}