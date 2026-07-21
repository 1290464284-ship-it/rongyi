import { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Monitor, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Equipment,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_STATUS_COLOR,
  EQUIPMENT_CATEGORIES,
  useEquipmentList,
  useCreateEquipment,
  useUpdateEquipment,
  useDeleteEquipment,
  type EquipmentStatus,
} from '@/lib/equipment';
import { formatDate } from '@/lib/utils';
import { toast } from 'sonner';

export default function EquipmentPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState<EquipmentStatus | 'ALL'>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);

  const { data: list, isLoading } = useEquipmentList({
    name: search || undefined,
    category: category === 'ALL' ? undefined : category,
    status: status === 'ALL' ? undefined : status,
  });

  const filteredList = useMemo(() => {
    let arr = list ?? [];
    if (search) {
      const kw = search.toLowerCase();
      arr = arr.filter(
        (e) =>
          e.name.toLowerCase().includes(kw) ||
          (e.model ?? '').toLowerCase().includes(kw) ||
          (e.brand ?? '').toLowerCase().includes(kw)
      );
    }
    return arr;
  }, [list, search]);

  const createMut = useCreateEquipment();
  const updateMut = useUpdateEquipment();
  const deleteMut = useDeleteEquipment();

  const handleDelete = (id: string) => {
    if (!confirm('确定要删除该设备吗？')) return;
    deleteMut.mutate(id, {
      onSuccess: () => toast.success('删除成功'),
      onError: () => toast.error('删除失败'),
    });
  };

  return (
    <div className='p-6 space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-xl font-semibold'>设备管理</h1>
          <p className='text-sm text-muted-foreground mt-1'>管理诊所设备资产，记录设备信息和状态</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className='w-4 h-4 mr-2' />
          新增设备
        </Button>
      </div>

      <div className='flex items-center gap-3 flex-wrap'>
        <div className='relative w-64'>
          <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
          <Input className='pl-8' placeholder='搜索设备名称/型号' value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className='flex items-center gap-2'>
          <Label className='text-muted-foreground'>分类</Label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className='w-32'>
            <option value='ALL'>全部分类</option>
            {EQUIPMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className='flex items-center gap-2'>
          <Label className='text-muted-foreground'>状态</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value as EquipmentStatus | 'ALL')} className='w-28'>
            <option value='ALL'>全部状态</option>
            {Object.entries(EQUIPMENT_STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className='ml-auto text-sm text-muted-foreground'>共 {filteredList.length} 台设备</div>
      </div>

      <Card className='overflow-hidden'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-12'>图标</TableHead>
              <TableHead>设备名称</TableHead>
              <TableHead className='w-24'>型号</TableHead>
              <TableHead className='w-20'>品牌</TableHead>
              <TableHead className='w-20'>分类</TableHead>
              <TableHead className='w-20'>位置</TableHead>
              <TableHead className='w-20'>状态</TableHead>
              <TableHead className='w-24'>购买日期</TableHead>
              <TableHead className='w-20 text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={9} />
            ) : filteredList.length === 0 ? (
              <EmptyState colSpan={9} text="暂无设备记录" />
            ) : (
              filteredList.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className='flex items-center justify-center'>
                      {item.category === '电脑设备' || item.category === '扫描仪' || item.category === '打印机' ? (
                        <Monitor className='w-5 h-5 text-primary' />
                      ) : (
                        <Building2 className='w-5 h-5 text-muted-foreground' />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className='font-medium'>{item.name}</TableCell>
                  <TableCell className='text-muted-foreground'>{item.model ?? '-'}</TableCell>
                  <TableCell className='text-muted-foreground'>{item.brand ?? '-'}</TableCell>
                  <TableCell>
                    <span className='inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium'>{item.category ?? '-'}</span>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>{item.location ?? '-'}</TableCell>
                  <TableCell>
                    <Badge className={EQUIPMENT_STATUS_COLOR[item.status]}>
                      {EQUIPMENT_STATUS_LABEL[item.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    {item.purchaseDate ? formatDate(item.purchaseDate) : '-'}
                  </TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <Button variant='ghost' size='sm' onClick={() => setEditing(item)}>
                        <Edit2 className='w-4 h-4' />
                      </Button>
                      <Button variant='ghost' size='sm' onClick={() => handleDelete(item.id)} disabled={deleteMut.isPending}>
                        <Trash2 className='w-4 h-4' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <EquipmentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        isPending={createMut.isPending}
        onSubmit={(data) => {
          createMut.mutate(data, {
            onSuccess: () => {
              toast.success('创建成功');
              setCreateOpen(false);
            },
            onError: () => toast.error('创建失败'),
          });
        }}
      />

      {editing && (
        <EquipmentDialog
          open={!!editing}
          onClose={() => setEditing(null)}
          initialData={editing}
          isPending={updateMut.isPending}
          onSubmit={(data) => {
            updateMut.mutate({ id: editing.id, data }, {
              onSuccess: () => {
                toast.success('更新成功');
                setEditing(null);
              },
              onError: () => toast.error('更新失败'),
            });
          }}
        />
      )}
    </div>
  );
}

function EquipmentDialog({
  open,
  onClose,
  initialData,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: Equipment;
  isPending?: boolean;
  onSubmit: (data: {
    name: string;
    model?: string;
    brand?: string;
    serialNumber?: string;
    category?: string;
    location?: string;
    purchasePrice?: number;
    purchaseDate?: string;
    supplier?: string;
    status?: EquipmentStatus;
    remarks?: string;
  }) => void;
}) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [model, setModel] = useState(initialData?.model ?? '');
  const [brand, setBrand] = useState(initialData?.brand ?? '');
  const [serialNumber, setSerialNumber] = useState(initialData?.serialNumber ?? '');
  const [category, setCategory] = useState(initialData?.category ?? '');
  const [location, setLocation] = useState(initialData?.location ?? '');
  const [purchasePrice, setPurchasePrice] = useState(initialData?.purchasePrice?.toString() ?? '');
  const [purchaseDate, setPurchaseDate] = useState(initialData?.purchaseDate ?? '');
  const [supplier, setSupplier] = useState(initialData?.supplier ?? '');
  const [status, setStatus] = useState<EquipmentStatus>(initialData?.status ?? 'NORMAL');
  const [remarks, setRemarks] = useState(initialData?.remarks ?? '');

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error('请输入设备名称');
      return;
    }
    onSubmit({
      name: name.trim(),
      model: model.trim() || undefined,
      brand: brand.trim() || undefined,
      serialNumber: serialNumber.trim() || undefined,
      category: category || undefined,
      location: location.trim() || undefined,
      purchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
      purchaseDate: purchaseDate || undefined,
      supplier: supplier.trim() || undefined,
      status,
      remarks: remarks.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{initialData ? '编辑设备' : '新增设备'}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4 mt-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>设备名称 *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='如：办公电脑' />
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>型号</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder='如：ThinkPad X1' />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>品牌</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder='如：联想' />
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>序列号</Label>
              <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder='设备序列号' />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>分类</Label>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value=''>请选择分类</option>
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>存放位置</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder='如：一楼办公室' />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>购买日期</Label>
              <Input type='date' value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>购买价格</Label>
              <Input type='number' value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder='¥' />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>供应商</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder='供应商名称' />
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>状态</Label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as EquipmentStatus)}>
                {Object.entries(EQUIPMENT_STATUS_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className='space-y-2'>
            <Label className='text-sm font-medium'>备注</Label>
            <textarea
              className='w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder='设备备注信息'
            />
          </div>
        </div>
        <div className='flex justify-end gap-2 mt-4'>
          <Button variant='outline' onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? '提交中…' : '确认'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
