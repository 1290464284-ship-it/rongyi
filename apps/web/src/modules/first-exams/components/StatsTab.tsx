import { Users, TrendingUp, BarChart3, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useFirstExamStats } from '@/lib/api/clinical/first-exams';

export function StatsTab() {
  const { data: stats, isLoading } = useFirstExamStats();

  const statCards = [
    {
      label: '首诊总数',
      value: stats?.total ?? 0,
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      label: '完成率',
      value: stats?.conversionRate ?? '0%',
      icon: TrendingUp,
      color: 'bg-green-500',
    },
    {
      label: '进行中',
      value: stats?.inProgress ?? 0,
      icon: BarChart3,
      color: 'bg-yellow-500',
    },
    {
      label: '待开始',
      value: stats?.pending ?? 0,
      icon: TrendingDown,
      color: 'bg-gray-500',
    },
  ];

  const mockDiseaseStats = [
    { name: '龋齿', count: 45, percent: 35 },
    { name: '牙周炎', count: 32, percent: 25 },
    { name: '牙髓炎', count: 20, percent: 16 },
    { name: '根尖周炎', count: 15, percent: 12 },
    { name: '智齿冠周炎', count: 10, percent: 8 },
    { name: '其他', count: 5, percent: 4 },
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

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">首诊状态分布</h3>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center text-muted-foreground py-8">加载中...</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>待开始</span>
                    <span>{stats?.pending ?? 0}</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gray-500 rounded-full"
                      style={{
                        width: `${stats?.total ? ((stats.pending ?? 0) / stats.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>进行中</span>
                    <span>{stats?.inProgress ?? 0}</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-yellow-500 rounded-full"
                      style={{
                        width: `${stats?.total ? ((stats.inProgress ?? 0) / stats.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>已完成</span>
                    <span>{stats?.completed ?? 0}</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{
                        width: `${stats?.total ? ((stats.completed ?? 0) / stats.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">疾病分布</h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mockDiseaseStats.map((item) => (
                <div key={item.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{item.name}</span>
                    <span className="text-muted-foreground">
                      {item.count} ({item.percent}%)
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">本月首诊趋势</h3>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-end justify-between gap-2 px-4">
            {Array.from({ length: 30 }, (_, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-primary/70 rounded-t-sm hover:bg-primary transition-colors"
                  style={{
                    height: `${Math.random() * 60 + 20}%`,
                  }}
                />
                <span className="text-xs text-muted-foreground">{i + 1}</span>
              </div>
            ))}
          </div>
          <div className="text-center text-sm text-muted-foreground mt-4">
            本月首诊：{stats?.thisMonth?.total ?? 0} 例
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
