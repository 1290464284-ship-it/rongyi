import {
  ListTodo,
  Check,
  TrendingUp,
  Award,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/loading';
import {
  useFollowUpWorkloadStats,
  useFollowUpNpsStats,
} from '@/lib/follow-ups-v2';
import { StatCard, StatusBar } from './StatsComponents';

export function StatsTab() {
  const { data: workload, isLoading: workloadLoading } = useFollowUpWorkloadStats({});
  const { data: nps, isLoading: npsLoading } = useFollowUpNpsStats({});

  const isLoading = workloadLoading || npsLoading;

  const completionRate = workload?.total
    ? ((workload.completed / workload.total) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="总回访数"
          value={workload?.total ?? 0}
          icon={ListTodo}
          color="text-primary"
          bgColor="bg-primary/10"
        />
        <StatCard
          title="已完成"
          value={workload?.completed ?? 0}
          icon={Check}
          color="text-success"
          bgColor="bg-success/10"
        />
        <StatCard
          title="完成率"
          value={`${completionRate}%`}
          icon={TrendingUp}
          color="text-warning"
          bgColor="bg-warning/10"
        />
        <StatCard
          title="NPS评分"
          value={nps?.npsScore ?? 0}
          icon={Award}
          color="text-info"
          bgColor="bg-info/10"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">回访状态分布</h3>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center text-muted-foreground py-8">加载中...</div>
            ) : (
              <div className="space-y-3">
                <StatusBar label="待回访" value={workload?.pending ?? 0} total={workload?.total ?? 1} color="bg-muted" />
                <StatusBar label="进行中" value={workload?.inProgress ?? 0} total={workload?.total ?? 1} color="bg-warning" />
                <StatusBar label="已完成" value={workload?.completed ?? 0} total={workload?.total ?? 1} color="bg-success" />
                <StatusBar label="已逾期" value={workload?.overdue ?? 0} total={workload?.total ?? 1} color="bg-destructive" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">NPS 评分详情</h3>
          </CardHeader>
          <CardContent>
            {npsLoading ? (
              <div className="text-center text-muted-foreground py-8">加载中...</div>
            ) : (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <div className="text-5xl font-bold text-primary">{nps?.npsScore ?? 0}</div>
                  <div className="text-sm text-muted-foreground mt-1">NPS 净推荐值</div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-success/10 rounded-lg">
                    <div className="text-2xl font-bold text-success">{nps?.promoters ?? 0}</div>
                    <div className="text-xs text-muted-foreground">推荐者</div>
                  </div>
                  <div className="p-3 bg-warning/10 rounded-lg">
                    <div className="text-2xl font-bold text-warning">{nps?.passives ?? 0}</div>
                    <div className="text-xs text-muted-foreground">中立者</div>
                  </div>
                  <div className="p-3 bg-destructive/10 rounded-lg">
                    <div className="text-2xl font-bold text-destructive">{nps?.detractors ?? 0}</div>
                    <div className="text-xs text-muted-foreground">贬损者</div>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground text-center">
                  总回复数: {nps?.totalResponses ?? 0} | 平均评分: {nps?.averageScore?.toFixed(1) ?? 0}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">回访员工作量</h3>
        </CardHeader>
        <CardContent>
          {workloadLoading ? (
            <div className="text-center text-muted-foreground py-8">加载中...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>回访员</TableHead>
                  <TableHead>总任务数</TableHead>
                  <TableHead>已完成</TableHead>
                  <TableHead>待处理</TableHead>
                  <TableHead>完成率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(workload?.byAssignee ?? []).length === 0 ? (
                  <EmptyState colSpan={5} text="暂无数据" />
                ) : (
                  (workload?.byAssignee ?? []).map(item => (
                    <TableRow key={item.assigneeId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Users className="w-4 h-4 text-primary" />
                          </div>
                          <span className="font-medium">{item.assigneeName}</span>
                        </div>
                      </TableCell>
                      <TableCell>{item.total}</TableCell>
                      <TableCell className="text-success">{item.completed}</TableCell>
                      <TableCell className="text-warning">{item.pending}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-success rounded-full"
                              style={{
                                width: `${item.total ? (item.completed / item.total) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {item.total ? ((item.completed / item.total) * 100).toFixed(1) : 0}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
