import React from 'react';
import { Calendar, Users, Receipt, TrendingUp, Clock, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useDashboard } from '@/lib/api/system/stats';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import AlertBanner from './components/AlertBanner';

export default React.memo(function DashboardPage() {
  const { data, isLoading, isError, error } = useDashboard();
  const nav = useNavigate();

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="h-64 bg-muted rounded-lg animate-pulse" />
          <div className="h-64 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-destructive font-medium">数据加载失败</p>
        <p className="text-xs text-muted-foreground mt-1">{error instanceof Error ? error.message : '请检查网络连接后重试'}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 text-sm text-primary hover:text-primaryLight font-medium"
        >
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const d = data;

  const stats = [
    {
      label: '今日预约',
      value: d.today.appointments,
      icon: Calendar,
      color: 'text-primary',
      bg: 'bg-primary/5',
    },
    {
      label: '今日就诊',
      value: d.today.visits,
      icon: Clock,
      color: 'text-warning',
      bg: 'bg-warning/5',
    },
    {
      label: '待收金额',
      value: `¥${d.finance.unpaidAmount}`,
      icon: Receipt,
      color: 'text-destructive',
      bg: 'bg-destructive/5',
    },
    {
      label: '本月营收',
      value: `¥${d.finance.monthRevenue}`,
      icon: TrendingUp,
      color: 'text-success',
      bg: 'bg-success/5',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        {/* 迷你牙位图 — 全局视觉锚点 */}
        <MiniToothChart />
        <h1 className="text-2xl font-bold">工作台</h1>
      </div>

      <AlertBanner />

      <div className="grid grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
                </div>
                <div className={`p-3 rounded-lg ${s.bg}`}>
                  <s.icon className={`w-6 h-6 ${s.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">待处理收费</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => nav('/charge')}>
              查看全部
            </Button>
          </CardHeader>
          <CardContent>
            {d.pendingCharges.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">暂无待收费单</p>
            ) : (
              <div className="space-y-2">
                {d.pendingCharges.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/30"
                    onClick={() => nav('/charge')}
                  >
                    <div>
                      <div className="text-sm font-medium">{c.patientName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.number}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-destructive">¥{c.totalAmount}</div>
                      {Number(c.paidAmount) > 0 && (
                        <div className="text-xs text-muted-foreground">已付 ¥{c.paidAmount}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">最近患者</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => nav('/patients')}>
              查看全部
            </Button>
          </CardHeader>
          <CardContent>
            {d.patients.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">暂无患者</p>
            ) : (
              <div className="space-y-2">
                {d.patients.recent.map(p => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/30"
                    onClick={() => nav(`/patients/${p.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
                        {p.name[0]}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(p.createdAt), 'yyyy-MM-dd', { locale: zhCN })} 入档
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="w-3 h-3" />
                      {p.phone}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-muted-foreground">总患者数：</span>
                <span className="font-medium">{d.patients.total}</span>
              </div>
              <div>
                <span className="text-muted-foreground">本月收费笔数：</span>
                <span className="font-medium">{d.finance.monthChargeCount}</span>
              </div>
              <div>
                <span className="text-muted-foreground">待收费单数：</span>
                <span className="font-medium">{d.finance.unpaidCount}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => nav('/reports')}>
              查看报表
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

/** 迷你牙位图 SVG — 只读，展示全口牙列概览 */
function MiniToothChart() {
  const size = 48;
  // FDI 牙位布局：上颌右→左 (18-11, 21-28)，下颌右→左 (48-41, 31-38)
  const upperRight = [18, 17, 16, 15, 14, 13, 12, 11];
  const upperLeft = [21, 22, 23, 24, 25, 26, 27, 28];
  const lowerRight = [48, 47, 46, 45, 44, 43, 42, 41];
  const lowerLeft = [31, 32, 33, 34, 35, 36, 37, 38];

  const toothGap = 0.5;
  const toothW = (size - toothGap * 7) / 8;
  const toothH = toothW * 1.2;

  return (
    <div className="flex-shrink-0 p-1.5 rounded-lg bg-gradient-to-br from-primary/5 to-secondary/5 border border-border/50" title="牙位总览">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="牙位总览" role="img">
        {/* 上颌 */}
        {/* 右上 (18-11) — 从左到右显示为 18..11 */}
        {upperRight.map((n, i) => (
          <rect
            key={`ur-${n}`}
            x={i * (toothW + toothGap)}
            y={0}
            width={toothW}
            height={toothH}
            rx={1.5}
            fill="none"
            stroke="#1E5AA8"
            strokeWidth={0.8}
            opacity={0.5}
          />
        ))}
        {/* 左上 (21-28) */}
        {upperLeft.map((n, i) => (
          <rect
            key={`ul-${n}`}
            x={i * (toothW + toothGap)}
            y={0}
            width={toothW}
            height={toothH}
            rx={1.5}
            fill="none"
            stroke="#1E5AA8"
            strokeWidth={0.8}
            opacity={0.5}
          />
        ))}

        {/* 中线 */}
        <line x1={size / 2} y1={0} x2={size / 2} y2={size} stroke="#00B3AA" strokeWidth={0.6} strokeDasharray="1,1" opacity={0.4} />

        {/* 下颌 */}
        {/* 右下 (48-41) — 从左到右 */}
        {lowerRight.map((n, i) => (
          <rect
            key={`lr-${n}`}
            x={i * (toothW + toothGap)}
            y={size - toothH}
            width={toothW}
            height={toothH}
            rx={1.5}
            fill="none"
            stroke="#1E5AA8"
            strokeWidth={0.8}
            opacity={0.5}
          />
        ))}
        {/* 左下 (31-38) */}
        {lowerLeft.map((n, i) => (
          <rect
            key={`ll-${n}`}
            x={i * (toothW + toothGap)}
            y={size - toothH}
            width={toothW}
            height={toothH}
            rx={1.5}
            fill="none"
            stroke="#1E5AA8"
            strokeWidth={0.8}
            opacity={0.5}
          />
        ))}
      </svg>
    </div>
  );
}
