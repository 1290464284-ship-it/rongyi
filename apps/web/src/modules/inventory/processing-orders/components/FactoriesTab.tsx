import { useState } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  useProcessingFactories,
  useCreateProcessingFactory,
  useUpdateProcessingFactory,
  useDeleteProcessingFactory,
  type ProcessingFactory,
} from '@/lib/api/inventory/processing-orders';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';
import { FactoryDialog } from './FactoryDialog';

export function FactoriesTab() {
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [editingFactory, setEditingFactory] = useState<ProcessingFactory | null>(null);

  const { data: factoriesData } = useProcessingFactories();
  const factories = factoriesData?.items ?? [];

  const createFactory = useCreateProcessingFactory();
  const updateFactory = useUpdateProcessingFactory();
  const deleteFactory = useDeleteProcessingFactory();

  const handleCreateFactory = () => {
    setEditingFactory(null);
    setFactoryOpen(true);
  };

  const handleEditFactory = (f: ProcessingFactory) => {
    setEditingFactory(f);
    setFactoryOpen(true);
  };

  const handleDeleteFactory = async (id: string) => {
    if (!confirm('确定删除此加工厂？')) return;
    await deleteFactory.mutateAsync(id);
    toast.success('删除成功');
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <h3 className="font-semibold">加工厂管理</h3>
          <Button onClick={handleCreateFactory}>
            <Plus className="w-4 h-4 mr-2" />
            新增加工厂
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>联系人</TableHead>
                <TableHead>电话</TableHead>
                <TableHead>地址</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {factories.map(f => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell>{f.contactName || '-'}</TableCell>
                  <TableCell>{f.phone || '-'}</TableCell>
                  <TableCell>{f.address || '-'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{f.remark || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(f.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEditFactory(f)}>
                        <Edit className="w-3 h-3 mr-1" />编辑
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteFactory(f.id)}>
                        <Trash2 className="w-3 h-3 mr-1" />删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {factoriesData && factories.length === 0 && (
                <EmptyState colSpan={7} text="暂无加工厂" />
              )}
              {!factoriesData && (
                <TableLoading colSpan={7} />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FactoryDialog
        open={factoryOpen}
        onClose={() => setFactoryOpen(false)}
        editing={editingFactory}
        onSubmit={async (data) => {
          if (editingFactory) {
            await updateFactory.mutateAsync({ id: editingFactory.id, data });
            toast.success('更新成功');
          } else {
            await createFactory.mutateAsync(data);
            toast.success('创建成功');
          }
          setFactoryOpen(false);
        }}
      />
    </>
  );
}
