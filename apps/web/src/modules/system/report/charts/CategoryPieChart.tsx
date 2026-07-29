import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import type { RevenueData } from '@/lib/api/system/stats';

const PALETTE = [
  '#1E5AA8', '#3A7BC8', '#00B3AA', '#27AE60', '#F39C12',
  '#3498DB', '#9B59B6', '#E74C3C', '#1ABC9C', '#E67E22',
  '#16A085', '#34495E',
];

export default function CategoryPieChart({ data }: { data?: RevenueData }) {
  const option = useMemo(() => {
    const cats = data?.categories ?? [];
    return {
      color: PALETTE,
      tooltip: {
        trigger: 'item',
        formatter: '{b}: ¥{c} ({d}%)',
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
          name: '收费分类',
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
          data: cats.map((c) => ({ name: c.category, value: Number(c.amount.toFixed(2)) })),
        },
      ],
    };
  }, [data]);

  if (!data?.categories?.length) {
    return <div className='text-center text-muted-foreground py-4'>暂无数据</div>;
  }
  return <ReactECharts echarts={echarts} option={option} style={{ height: '300px' }} />;
}