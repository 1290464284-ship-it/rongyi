import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTableWrapper, type DataTableColumn } from '@/components/ui/data-table-wrapper';
import { NPS_CATEGORY_COLOR, type SatisfactionSurvey } from '@/lib/api/communication/satisfaction';

const NEGATIVE_TAGS = ['态度差', '等候太久', '价格贵', '环境差', '设备陈旧', '解释不清', '流程复杂', '医术一般', '不专业', '体验差'];

function buildColumns(onAck: (survey: SatisfactionSurvey) => void): DataTableColumn<SatisfactionSurvey>[] {
  return [
    {
      key: 'time',
      header: '时间',
      cell: (r) => <span className="text-xs">{r.createdAt?.slice(5, 16) ?? '-'}</span>,
    },
    {
      key: 'patient',
      header: '患者',
      cell: (r) => <span className="font-medium text-sm">{r.patientName ?? '匿名'}</span>,
    },
    {
      key: 'doctor',
      header: '医生',
      cell: (r) => <span className="text-sm">{r.doctorName ?? '-'}</span>,
    },
    {
      key: 'nps',
      header: 'NPS',
      cell: (r) => (
        <Badge className={NPS_CATEGORY_COLOR[r.npsCategory]}>
          {r.nps}
        </Badge>
      ),
    },
    {
      key: 'rating',
      header: '星级均分',
      cell: (r) => (
        <div className="flex items-center gap-1">
          <Star className="w-4 h-4 fill-warning text-warning" />
          <span className="font-medium text-sm">{r.avgRating.toFixed(1)}</span>
        </div>
      ),
    },
    {
      key: 'tags',
      header: '负面标签',
      cell: (r) => {
        const tags = r.tags?.filter((t) => NEGATIVE_TAGS.includes(t)) ?? [];
        return (
          <div className="flex flex-wrap gap-0.5">
            {tags.length === 0 && <span className="text-xs text-muted-foreground/60">-</span>}
            {tags.slice(0, 3).map((t) => (
              <Badge key={t} className="bg-destructive/10 text-destructive text-[10px] px-1.5 py-0">
                {t}
              </Badge>
            ))}
            {tags.length > 3 && <Badge key={`more-${r.id}`} className="text-[10px] px-1.5 py-0">+{tags.length - 3}</Badge>}
          </div>
        );
      },
    },
    {
      key: 'comment',
      header: '评论摘要',
      cell: (r) => (
        <p className="text-xs text-muted-foreground line-clamp-2 max-w-[220px]">
          {r.comment ?? '-'}
        </p>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (r) => r.acknowledged ? (
        <Badge className="bg-success/10 text-success">已跟进</Badge>
      ) : (
        <Badge className="bg-warning/10 text-warning">未跟进</Badge>
      ),
    },
    {
      key: 'action',
      header: '操作',
      cell: (r) => (
        <Button
          size="sm"
          variant={r.acknowledged ? 'ghost' : 'outline'}
          disabled={r.acknowledged}
          onClick={() => onAck(r)}
          data-testid={`ack-btn-${r.id}`}
        >
          {r.acknowledged ? '已查看' : '跟进'}
        </Button>
      ),
    },
  ];
}

interface BadSurveyTableProps {
  data: SatisfactionSurvey[];
  loading: boolean;
  onAcknowledge: (survey: SatisfactionSurvey) => void;
}

export default function BadSurveyTable({ data, loading, onAcknowledge }: BadSurveyTableProps) {
  const columns = buildColumns(onAcknowledge);
  return (
    <DataTableWrapper
      columns={columns as unknown as DataTableColumn[]}
      data={data as unknown as Record<string, unknown>[]}
      loading={loading}
      isEmpty={!loading && data.length === 0}
      emptyText="暂无差评记录"
      emptySubtitle="说明患者反馈良好"
      showPagination={false}
      rowKey={(r) => String((r as unknown as SatisfactionSurvey).id)}
    />
  );
}
