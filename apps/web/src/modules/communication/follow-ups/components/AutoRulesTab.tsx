import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import {
  useFollowUpAutoRules,
  useCreateFollowUpAutoRule,
  useUpdateFollowUpAutoRule,
  useDeleteFollowUpAutoRule,
  useToggleFollowUpAutoRule,
  FOLLOW_UP_PRIORITY_LABEL,
  FOLLOW_UP_PRIORITY_COLOR,
  type FollowUpAutoRule,
} from '@/lib/api/communication/follow-ups';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  CreateAutoRuleDialog,
  EditAutoRuleDialog,
} from './AutoRuleDialogs';

const TRIGGER_TYPE_LABEL: Record<string, string> = {
  VISIT_COMPLETED: '就诊完成后',
  DIAGNOSIS: '确诊后',
  TREATMENT: '治疗完成后',
  SCHEDULED: '定时触发',
};

export function AutoRulesTab() {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<FollowUpAutoRule | null>(null);

  const { data, isLoading } = useFollowUpAutoRules({ page, pageSize });

  const createRule = useCreateFollowUpAutoRule();
  const updateRule = useUpdateFollowUpAutoRule();
  const deleteRule = useDeleteFollowUpAutoRule();
  const toggleRule = useToggleFollowUpAutoRule();

  const rules = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredRules = useMemo(() => {
    if (!keyword) return rules;
    const kw = keyword.toLowerCase();
    return rules.filter(r => r.name.toLowerCase().includes(kw));
  }, [rules, keyword]);

  function handleEdit(rule: FollowUpAutoRule) {
    setSelectedRule(rule);
    setEditOpen(true);
  }

  function handleDelete(id: string) {
    if (confirm('确定删除该规则吗？')) {
      deleteRule.mutate(id);
    }
  }

  function handleToggle(id: string) {
    toggleRule.mutate(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索规则名称"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建规则
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>规则名称</TableHead>
            <TableHead>触发条件</TableHead>
            <TableHead>回访模板</TableHead>
            <TableHead>优先级</TableHead>
            <TableHead>是否启用</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableLoading colSpan={7} />
          ) : filteredRules.length === 0 ? (
            <EmptyState colSpan={7} text="暂无数据" />
          ) : (
            filteredRules.map(rule => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell>
                  {TRIGGER_TYPE_LABEL[rule.triggerType] || rule.triggerType}
                  {rule.delayDays ? ` ${rule.delayDays} 天后` : ''}
                </TableCell>
                <TableCell>{rule.template?.name || '-'}</TableCell>
                <TableCell>
                  <Badge className={FOLLOW_UP_PRIORITY_COLOR[rule.priority || 'MEDIUM']}>
                    {FOLLOW_UP_PRIORITY_LABEL[rule.priority || 'MEDIUM']}
                  </Badge>
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => handleToggle(rule.id)}
                    className="cursor-pointer"
                  >
                    <Badge className={rule.isEnabled
                      ? 'bg-success/10 text-success border-success/30'
                      : 'bg-muted/10 text-muted-foreground border-muted/30'
                    }>
                      {rule.isEnabled ? '已启用' : '已停用'}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(rule.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(rule)} aria-label="编辑">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(rule.id)}
                    disabled={deleteRule.isPending}
                    aria-label="删除"
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            下一页
          </Button>
        </div>
      )}

      <CreateAutoRuleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createRule.mutateAsync}
      />

      {selectedRule && (
        <EditAutoRuleDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          rule={selectedRule}
          onUpdate={(data) => updateRule.mutateAsync({ id: selectedRule.id, data })}
        />
      )}
    </div>
  );
}
