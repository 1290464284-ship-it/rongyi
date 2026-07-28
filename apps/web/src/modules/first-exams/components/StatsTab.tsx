import { Users, TrendingUp, BarChart3, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useFirstExamStats } from '@/lib/api/clinical/first-exams';

export function StatsTab() {
  const { data: stats, isLoading } = useFirstExamStats();

  // 后端 stats 接口当前仅返回 { total }，其余字段（inProgress/pending/completed/thisMonth）
  // 尚未实现。此处仅展示真实可用数据，避免展示 mock 假数据误导用户。
  const total = stats?.total ?? 0;

  const statCards = [
    {
      label: '首诊总数',
      value: total,
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      label: '完成率',
      value: '—',
      icon: TrendingUp,
      color: 'bg-green-500',
    },
    {
      label: '进行中',
      value: '—',
      icon: BarChart3,
      color: 'bg-yellow-500',
    },
    {
      label: '待开始',
      value: '—',
      icon: TrendingDown,
      color: 'bg-gray-500',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="text-3xl font-bold mt-2">{card.value}</p>
                </div>
                <div className={`${card.color} p-3 rounded-lg`}>
                  <card.icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">首诊状态分布</h3>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center text-muted-foreground py-8">加载中...</div>
          ) : total === 0 ? (
            <div className="text-center text-muted-foreground py-8">暂无数据</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>首诊总数</span>
                  <span>{total}</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                注：状态细分统计（待开始/进行中/已完成）暂未实现，仅展示总数。
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">疾病分布</h3>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            暂无数据
            <p className="text-xs mt-2">疾病分布统计功能尚未实现</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">本月首诊趋势</h3>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            暂无数据
            <p className="text-xs mt-2">按日趋势统计功能尚未实现</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
