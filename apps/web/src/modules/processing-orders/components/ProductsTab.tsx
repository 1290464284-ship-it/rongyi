import { useState } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
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
  useProcessingProducts,
  useCreateProcessingProduct,
  useUpdateProcessingProduct,
  useDeleteProcessingProduct,
  type ProcessingProduct,
} from '@/lib/api/inventory/processing-orders';
import { toast } from 'sonner';
import { ProductDialog } from './ProductDialog';

export function ProductsTab() {
  const [productOpen, setProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProcessingProduct | null>(null);
  const [productFactoryId, setProductFactoryId] = useState('');

  const { data: factoriesData } = useProcessingFactories();
  const factories = factoriesData?.items ?? [];
  const { data: productsData } = useProcessingProducts({ factoryId: productFactoryId || undefined });
  const products = productsData?.items ?? [];

  const createProduct = useCreateProcessingProduct();
  const updateProduct = useUpdateProcessingProduct();
  const deleteProduct = useDeleteProcessingProduct();

  const handleCreateProduct = () => {
    if (!productFactoryId) {
      toast.error('请先选择加工厂');
      return;
    }
    setEditingProduct(null);
    setProductOpen(true);
  };

  const handleEditProduct = (p: ProcessingProduct) => {
    setEditingProduct(p);
    setProductOpen(true);
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('确定删除此产品？')) return;
    await deleteProduct.mutateAsync(id);
    toast.success('删除成功');
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex gap-2 items-center">
          <Select value={productFactoryId} onChange={e => setProductFactoryId(e.target.value)}>
            <option value="">选择加工厂</option>
            {factories.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </Select>
        </div>
        <Button onClick={handleCreateProduct}>
          <Plus className="w-4 h-4 mr-2" />
          新增产品
        </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>产品名称</TableHead>
                <TableHead>分类</TableHead>
                <TableHead>价格</TableHead>
                <TableHead>单位</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.code || '-'}</TableCell>
                  <TableCell>¥{p.price}</TableCell>
                  <TableCell>{p.unit || '-'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{p.remark || '-'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEditProduct(p)}>
                        <Edit className="w-3 h-3 mr-1" />编辑
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteProduct(p.id)}>
                        <Trash2 className="w-3 h-3 mr-1" />删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {productsData && products.length === 0 && (
                <EmptyState colSpan={6} text={productFactoryId ? '暂无产品' : '请先选择加工厂'} />
              )}
              {!productsData && productFactoryId && (
                <TableLoading colSpan={6} />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProductDialog
        open={productOpen}
        onClose={() => setProductOpen(false)}
        editing={editingProduct}
        factoryId={productFactoryId}
        onSubmit={async (data) => {
          if (editingProduct) {
            await updateProduct.mutateAsync({ id: editingProduct.id, data });
            toast.success('更新成功');
          } else {
            await createProduct.mutateAsync(data);
            toast.success('创建成功');
          }
          setProductOpen(false);
        }}
      />
    </>
  );
}
