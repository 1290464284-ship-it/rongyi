import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '@/lib/echarts';
import type { RevenueData } from '@/lib/api/system/stats';

const PALETTE = [
  '#1E5AA8', '#3A7BC8', '#00B3AA', '#27AE60', '#F39C12',
  '#3498DB', '#9B59B6', '#E74C3C', '#1ABC9C', '#E67E22',
  '#16A085', '#34495E',
];

const PAY_LABEL: Record<string, string> = {
  CASH: '现金',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  CARD: '银行卡',
  OTHER: '其他',
};

export default function PayMethodDoughnutChart({ data }: { data?: RevenueData }) {
  const option = useMemo(() => {
    const pms = data?.payMethods ?? [];
    const total = pms.reduce((s, p) => s + p.amount, 0);
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
      graphic: [
        {
          type: 'text',
          left: '32%',
          top: '44%',
          style: {
            text: '总金额',
            textAlign: 'center',
            fill: '#6B7C93',
            fontSize: 12,
          },
        },
        {
          type: 'text',
          left: '32%',
          top: '52%',
          style: {
            text: `¥${total.toFixed(0)}`,
            textAlign: 'center',
            fill: '#1E5AA8',
            fontSize: 16,
            fontWeight: 'bold',
          },
        },
      ],
      series: [
        {
          name: '支付方式',
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['38%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 13,
              fontWeight: 'bold',
              formatter: '{b}\n¥{c} ({d}%)',
            },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.2)' },
          },
          data: pms.map((p) => ({
            name: PAY_LABEL[p.method] || p.method,
            value: Number(p.amount.toFixed(2)),
          })),
        },
      ],
    };
  }, [data]);

  if (!data?.payMethods?.length) {
    return <div className='text-center text-muted-foreground py-4'>暂无数据</div>;
  }
  return <ReactECharts echarts={echarts} option={option} style={{ height: '300px' }} />;
}