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
  useFollowUpTemplates,
  useCreateFollowUpTemplate,
  useUpdateFollowUpTemplate,
  useDeleteFollowUpTemplate,
  useToggleFollowUpTemplate,
  type FollowUpTemplate,
} from '@/lib/follow-ups-v2';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  CreateTemplateDialog,
  EditTemplateDialog,
} from './TemplateDialogs';

export function TemplatesTab() {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<FollowUpTemplate | null>(null);

  const { data, isLoading } = useFollowUpTemplates({ page, pageSize });

  const createTemplate = useCreateFollowUpTemplate();
  const updateTemplate = useUpdateFollowUpTemplate();
  const deleteTemplate = useDeleteFollowUpTemplate();
  const toggleTemplate = useToggleFollowUpTemplate();

  const templates = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredTemplates = useMemo(() => {
    if (!keyword) return templates;
    const kw = keyword.toLowerCase();
    return templates.filter(t => t.name.toLowerCase().includes(kw));
  }, [templates, keyword]);

  function handleEdit(template: FollowUpTemplate) {
    setSelectedTemplate(template);
    setEditOpen(true);
  }

  function handleDelete(id: string) {
    if (confirm('确定删除该模板吗？')) {
      deleteTemplate.mutate(id);
    }
  }

  function handleToggle(id: string) {
    toggleTemplate.mutate(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索模板名称"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建模板
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>模板名称</TableHead>
            <TableHead>回访类型</TableHead>
            <TableHead>回访项目数</TableHead>
            <TableHead>是否启用</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableLoading colSpan={6} />
          ) : filteredTemplates.length === 0 ? (
            <EmptyState colSpan={6} text="暂无数据" />
          ) : (
            filteredTemplates.map(template => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">{template.name}</TableCell>
                <TableCell>{template.category || '-'}</TableCell>
                <TableCell>{template.items?.length || 0} 项</TableCell>
                <TableCell>
                  <button
                    onClick={() => handleToggle(template.id)}
                    className="cursor-pointer"
                  >
                    <Badge className={template.isEnabled
                      ? 'bg-success/10 text-success border-success/30'
                      : 'bg-muted/10 text-muted-foreground border-muted/30'
                    }>
                      {template.isEnabled ? '已启用' : '已停用'}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(template.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(template)} aria-label="编辑">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(template.id)}
                    disabled={deleteTemplate.isPending}
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

      <CreateTemplateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createTemplate.mutateAsync}
      />

      {selectedTemplate && (
        <EditTemplateDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          template={selectedTemplate}
          onUpdate={(data) => updateTemplate.mutateAsync({ id: selectedTemplate.id, data })}
        />
      )}
    </div>
  );
}
