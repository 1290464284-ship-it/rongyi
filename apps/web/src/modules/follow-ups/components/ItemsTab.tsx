import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  FileText,
  ListTodo,
  Check,
  BarChart3,
  Calendar,
  Power,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
  useFollowUpItems,
  useCreateFollowUpItem,
  useUpdateFollowUpItem,
  useDeleteFollowUpItem,
  FOLLOW_UP_ITEM_TYPE_LABEL,
  type FollowUpItem,
} from '@/lib/api/communication/follow-ups';
import {
  CreateItemDialog,
  EditItemDialog,
} from './ItemDialogs';

export function ItemsTab() {
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<FollowUpItem | null>(null);

  const { data, isLoading } = useFollowUpItems(undefined);

  const createItem = useCreateFollowUpItem();
  const updateItem = useUpdateFollowUpItem();
  const deleteItem = useDeleteFollowUpItem();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredItems = useMemo(() => {
    let result = items;
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter(i => i.name.toLowerCase().includes(kw));
    }
    if (typeFilter) {
      result = result.filter(i => i.type === typeFilter);
    }
    return result;
  }, [items, keyword, typeFilter]);

  function handleEdit(item: FollowUpItem) {
    setSelectedItem(item);
    setEditOpen(true);
  }

  function handleDelete(id: string) {
    if (confirm('确定删除该项目吗？')) {
      deleteItem.mutate(id);
    }
  }

  const itemTypeIcons: Record<string, typeof FileText> = {
    TEXT: FileText,
    SINGLE_SELECT: ListTodo,
    MULTI_SELECT: Check,
    NUMBER: BarChart3,
    DATE: Calendar,
    BOOLEAN: Power,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索项目名称"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Select
          value={typeFilter}
          onChange={e => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="w-36"
        >
          <option value="">全部类型</option>
          <option value="TEXT">文本</option>
          <option value="SINGLE_SELECT">单选</option>
          <option value="MULTI_SELECT">多选</option>
          <option value="NUMBER">数字</option>
          <option value="DATE">日期</option>
          <option value="BOOLEAN">是/否</option>
        </Select>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建项目
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>项目名称</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>是否必填</TableHead>
            <TableHead>排序</TableHead>
            <TableHead>描述</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableLoading colSpan={6} />
          ) : filteredItems.length === 0 ? (
            <EmptyState colSpan={6} text="暂无数据" />
          ) : (
            filteredItems.map(item => {
              const Icon = itemTypeIcons[item.type] || FileText;
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      {item.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className="border border-border text-muted-foreground">
                        {FOLLOW_UP_ITEM_TYPE_LABEL[item.type]}
                      </Badge>
                  </TableCell>
                  <TableCell>
                    {item.isRequired ? (
                      <Badge className="bg-destructive/10 text-destructive border-destructive/30">
                        必填
                      </Badge>
                    ) : (
                      <Badge className="border border-border text-muted-foreground">
                        选填
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{item.sortOrder}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {item.description || '-'}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(item)} aria-label="编辑">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(item.id)}
                      disabled={deleteItem.isPending}
                      aria-label="删除"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
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

      <CreateItemDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createItem.mutateAsync}
      />

      {selectedItem && (
        <EditItemDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          item={selectedItem}
          onUpdate={(data) => updateItem.mutateAsync({ id: selectedItem.id, data })}
        />
      )}
    </div>
  );
}
