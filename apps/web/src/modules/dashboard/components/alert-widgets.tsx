import {
  AlertTriangle, Clock, XCircle, AlertCircle, CheckCircle2,
  CheckCircle, Eye, ChevronRight, BarChart3,
} from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DataTableColumn } from '@/components/ui/data-table-wrapper';
import {
  ALERT_SEVERITY_LABELS, ALERT_STATUS_LABELS, ALERT_TYPE_LABELS,
  SEVERITY_BADGE_CLASS, STATUS_DOT_CLASS,
  type AlertSeverity, type BusinessAlert,
} from '@/lib/api/system/business-alerts';

const TIME_RANGES = [
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
  { label: '近 90 天', days: 90 },
  { label: '全部', days: 0 },
];

const TYPE_ICON: Record<string, typeof AlertTriangle> = {
  SCHEDULER_TASK_FAILED: Clock,
  DRUG_INTERACTION: AlertCircle,
  INVENTORY_LOW: XCircle,
  REVENUE_DROP: BarChart3,
  PATIENT_CHURN: AlertTriangle,
  DOCTOR_PERF: BarChart3,
  TREATMENT_LAGGED: Clock,
  BULK_IMPORT_WARN: AlertCircle,
  BACKUP_FAILED: XCircle,
  ENCRYPTION: AlertCircle,
  SATISFACTION_NEGATIVE: AlertTriangle,
  APPOINTMENT_CONFLICT: AlertTriangle,
  NEW_PATIENTS: BarChart3,
  NO_SHOW_RATE: AlertTriangle,
  AOV: BarChart3,
  PERFORMANCE_ANOMALY: BarChart3,
};

function getSeverityBadgeClass(severity: AlertSeverity): string {
  return SEVERITY_BADGE_CLASS[severity] ?? SEVERITY_BADGE_CLASS.INFO;
}

export function AlertKpiCard({
  label, value, icon: Icon, bgClass, iconClass, onClick, active, loading,
}: {
  label: string;
  value: number;
  icon: typeof AlertTriangle;
  bgClass: string;
  iconClass: string;
  onClick?: () => void;
  active?: boolean;
  loading?: boolean;
}) {
  return (
    <Card
      data-testid={`kpi-${label}`}
      onClick={onClick}
      className={`cursor-pointer transition-all ${
        active ? 'ring-2 ring-primary ring-offset-2' : ''
      } ${onClick ? 'hover:shadow-md' : ''}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            {loading ? (
              <div className="h-8 w-16 bg-muted/60 rounded animate-pulse mt-1" />
            ) : (
              <div className="text-2xl font-bold mt-1">{value}</div>
            )}
          </div>
          <div className={`p-3 rounded-lg ${bgClass}`}>
            <Icon className={`w-6 h-6 ${iconClass}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function buildAlertColumns(
  nav: NavigateFunction,
  onOpenDetail: (id: string) => void,
  onAcknowledge: (alert: BusinessAlert) => void,
  onResolve: (alert: BusinessAlert) => void,
  acknowledgePending: boolean,
  resolvePending: boolean,
): DataTableColumn<BusinessAlert>[] {
  return [
    {
      key: 'severity',
      header: '严重度',
      cell: (row) => (
        <Badge data-testid={`severity-badge-${row.id}`} className={getSeverityBadgeClass(row.severity)}>
          {ALERT_SEVERITY_LABELS[row.severity]}
        </Badge>
      ),
      width: '80px',
    },
    {
      key: 'type',
      header: '类型',
      cell: (row) => {
        const Icon = TYPE_ICON[row.type] ?? AlertTriangle;
        return (
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm">{ALERT_TYPE_LABELS[row.type] ?? row.type}</span>
          </div>
        );
      },
      width: '140px',
    },
    {
      key: 'message',
      header: '摘要',
      cell: (row) => {
        const short = row.message.length > 80 ? row.message.slice(0, 80) + '…' : row.message;
        return (
          <div data-testid={`message-${row.id}`} className="text-sm max-w-md truncate" title={row.message}>
            {short}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span
            data-testid={`status-dot-${row.id}`}
            className={`w-2 h-2 rounded-full ${STATUS_DOT_CLASS[row.status]} ${
              row.status === 'OPEN' ? 'animate-pulse' : ''
            }`}
          />
          <span>{ALERT_STATUS_LABELS[row.status]}</span>
          {row.status === 'OPEN' && <Clock className="w-3 h-3 text-yellow-600" />}
          {row.status === 'RESOLVED' && <CheckCircle className="w-3 h-3 text-green-600" />}
        </span>
      ),
      width: '100px',
    },
    {
      key: 'entity',
      header: '关联实体',
      cell: (row) => {
        if (!row.entityType || !row.entityId) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const label = `${row.entityType}#${row.entityId.slice(0, 8)}`;
        const go = () => {
          if (row.entityType === 'PATIENT') nav(`/patients/${row.entityId}`);
        };
        return (
          <button
            data-testid={`entity-link-${row.id}`}
            onClick={go}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            {label}
            {row.entityType === 'PATIENT' && <ChevronRight className="w-3 h-3" />}
          </button>
        );
      },
      width: '130px',
    },
    {
      key: 'createdAt',
      header: '创建时间',
      cell: (row) => (
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div data-testid={`created-at-${row.id}`}>
            {format(new Date(row.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
          </div>
          <div className="text-[11px] opacity-80">
            {formatDistanceToNow(new Date(row.createdAt), { locale: zhCN, addSuffix: true })}
          </div>
        </div>
      ),
      width: '150px',
    },
    {
      key: 'actions',
      header: '操作',
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            data-testid={`action-detail-${row.id}`}
            variant="ghost" size="sm" className="h-7 px-2 text-xs"
            onClick={() => onOpenDetail(row.id)}
          >
            <Eye className="w-3.5 h-3.5 mr-1" />详情
          </Button>
          {row.status === 'OPEN' && (
            <Button
              data-testid={`action-ack-${row.id}`}
              variant="outline" size="sm" className="h-7 px-2 text-xs"
              onClick={() => onAcknowledge(row)}
              disabled={acknowledgePending}
            >
              <Clock className="w-3 h-3 mr-1" />确认
            </Button>
          )}
          {row.status !== 'RESOLVED' && (
            <Button
              data-testid={`action-resolve-${row.id}`}
              size="sm" className="h-7 px-2 text-xs"
              onClick={() => onResolve(row)}
              disabled={resolvePending}
            >
              <CheckCircle2 className="w-3 h-3 mr-1" />解决
            </Button>
          )}
        </div>
      ),
      width: '200px',
      className: 'w-[200px]',
    },
  ];
}

export { TIME_RANGES };
