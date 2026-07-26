import { Card, CardContent } from '@/components/ui/card';
import { useProcessingStats } from '@/lib/api/inventory/processing-orders';

export function StatsTab() {
  const { data: stats } = useProcessingStats();

  return (
    <div className="grid grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">总单数</div>
          <div className="text-2xl font-bold mt-1">{stats?.total ?? 0}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">进行中</div>
          <div className="text-2xl font-bold mt-1 text-warning">{stats?.inProgress ?? 0}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">待交付</div>
          <div className="text-2xl font-bold mt-1 text-info">{stats?.ready ?? 0}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">已交付</div>
          <div className="text-2xl font-bold mt-1 text-success">{stats?.delivered ?? 0}</div>
        </CardContent>
      </Card>
    </div>
  );
}
