import { Users, Wallet, Award } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useMemberStats } from '@/lib/api/system/stats';
import { formatYuan } from '@dental/shared';
import MemberLevelPieChart from '../charts/MemberLevelPieChart';
import { Suspense } from 'react';

const SuspenseChart = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="text-center text-muted-foreground py-8">加载中...</div>}>
    {children}
  </Suspense>
);

export default function MemberTab() {
  const { data, isLoading } = useMemberStats({});

  const cards = [
    {
      label: '总会员',
      value: data?.totalMembers ?? 0,
      icon: <Users className='w-8 h-8 text-primary/30' />,
      color: 'text-primary',
    },
    {
      label: '总余额',
      value: formatYuan(data?.totalBalance),
      icon: <Wallet className='w-8 h-8 text-success/30' />,
      color: 'text-success',
    },
    {
      label: '总积分',
      value: data?.totalPoints ?? 0,
      icon: <Award className='w-8 h-8 text-warning/30' />,
      color: 'text-warning',
    },
  ];

  const levelDist = data?.levelDistribution ?? [];

  return (
    <>
      <div className='grid grid-cols-3 gap-4'>
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className='p-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='text-sm text-muted-foreground'>{c.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</div>
                </div>
                {c.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <span className='text-sm font-medium'>会员等级分布</span>
        </CardHeader>
        <CardContent>
          <SuspenseChart>
            <MemberLevelPieChart data={levelDist} loading={isLoading} />
          </SuspenseChart>
        </CardContent>
      </Card>
    </>
  );
}
