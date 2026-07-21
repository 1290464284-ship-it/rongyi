import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Printer, Trash2, Eye, Check, X, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
  usePrescriptions,
  useCreatePrescription,
  useDeletePrescription,
  type Prescription,
} from '@/lib/prescriptions';
import { usePatients } from '@/lib/patients';
import { useStaff } from '@/lib/staff';
import { useAuthStore } from '@/lib/auth-store';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function PrescriptionPage() {
  const [searchParams] = useSearchParams();
  const presetPatientId = searchParams.get('patientId') ?? '';
  const presetVisitId = searchParams.get('visitId') ?? '';

  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [viewOpen, setViewOpen] = useState(false);
  const [selectedRx, setSelectedRx] = useState<Prescription | null>(null);
  const [createOpen, setCreateOpen] = useState(() => !!presetPatientId);

  const { data, isLoading } = usePrescriptions({ page, pageSize });
  const createRx = useCreatePrescription();
  const deleteRx = useDeletePrescription();

  const prescriptions = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filtered = keyword
    ? prescriptions.filter(
        r =>
          r.patient?.name?.includes(keyword) ||
          r.doctor?.name?.includes(keyword) ||
          r.id.includes(keyword),
      )
    : prescriptions;

  function handleView(rx: Prescription) {
    setSelectedRx(rx);
    setViewOpen(true);
  }

  function handlePrint(rx: Prescription) {
    setSelectedRx(rx);
    setTimeout(() => window.print(), 100);
  }

  function handleDelete(id: string) {
    if (!confirm('确定删除该处方？')) return;
    deleteRx.mutate(id);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">处方管理</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新开处方
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索患者/医生"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>患者</TableHead>
                <TableHead>医生</TableHead>
                <TableHead>药品数</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>开方时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={6} />
              ) : filtered.length === 0 ? (
                <EmptyState colSpan={6} text="暂无数据" />
              ) : (
                filtered.map(rx => (
                  <TableRow key={rx.id}>
                    <TableCell>
                      <div className="font-medium">{rx.patient?.name}</div>
                      <div className="text-xs text-muted-foreground">{rx.patient?.phone}</div>
                    </TableCell>
                    <TableCell>{rx.doctor?.name}</TableCell>
                    <TableCell>{rx.items.length} 种</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {rx.remark || '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(rx.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => handleView(rx)}>
                        <Eye className="w-3 h-3 mr-1" />
                        查看
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handlePrint(rx)}>
                        <Printer className="w-3 h-3 mr-1" />
                        打印
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(rx.id)} disabled={deleteRx.isPending}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                      {deleteRx.isPending ? '删除中…' : ''}
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
        </CardContent>
      </Card>

      {selectedRx && (
        <>
          <Dialog open={viewOpen} onClose={() => setViewOpen(false)} className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>处方详情</DialogTitle>
            </DialogHeader>
            <DialogContent>
              <PrescriptionPrintView rx={selectedRx} />
              <div className="no-print flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setViewOpen(false)}>关闭</Button>
                <Button onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-2" />
                  打印处方
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      <CreatePrescriptionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        presetPatientId={presetPatientId}
        presetVisitId={presetVisitId}
        onCreate={createRx.mutateAsync}
        isPending={createRx.isPending}
      />
    </div>
  );
}

interface EditableRxItem {
  id: string;
  drugName: string;
  spec: string;
  dosage: string;
  frequency: string;
  days: number;
  quantity: number;
  unit: string;
  drugCode?: string;
}

function CreatePrescriptionDialog({
  open,
  onClose,
  presetPatientId,
  presetVisitId,
  onCreate,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  presetPatientId?: string;
  presetVisitId?: string;
  onCreate: (data: any) => Promise<any>;
  isPending?: boolean;
}) {
  const user = useAuthStore(s => s.user);
  const { data: staff } = useStaff();
  const doctors = (staff ?? []).filter(s => s.role === 'DOCTOR');

  const [patientId, setPatientId] = useState(presetPatientId ?? '');
  const [patientName, setPatientName] = useState('');
  const [doctorId, setDoctorId] = useState(user?.role === 'DOCTOR' ? user.id : '');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<EditableRxItem[]>([
    { id: '1', drugName: '', spec: '', dosage: '', frequency: '每日三次', days: 3, quantity: 1, unit: '盒' },
  ]);
  const [openSelector, setOpenSelector] = useState(false);

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
    setOpenSelector(false);
  };

  function addItem() {
    setItems([
      ...items,
      { id: Date.now().toString(), drugName: '', spec: '', dosage: '', frequency: '每日三次', days: 3, quantity: 1, unit: '盒' },
    ]);
  }

  function removeItem(id: string) {
    if (items.length === 1) return;
    setItems(items.filter(i => i.id !== id));
  }

  function updateItem(id: string, field: keyof EditableRxItem, value: any) {
    setItems(items.map(i => (i.id === id ? { ...i, [field]: value } : i)));
  }

  async function handleSubmit() {
    if (!patientId || !doctorId || items.some(i => !i.drugName)) return;
    await onCreate({
      patientId,
      doctorId,
      visitId: presetVisitId || undefined,
      remark: remark || undefined,
      items: items.map(({ id: _id, ...rest }) => rest),
    });
    onClose();
    setRemark('');
    setItems([{ id: '1', drugName: '', spec: '', dosage: '', frequency: '每日三次', days: 3, quantity: 1, unit: '盒' }]);
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>新开处方</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>患者 *</Label>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <User className="w-4 h-4 mr-2" />
                {patientName || '请选择患者'}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rx-doctor">开方医生 *</Label>
              <Select id="rx-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                <option value="">请选择医生</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>药品明细</Label>
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3 h-3 mr-1" /> 添加药品
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 p-2 border border-border rounded-md items-center">
                  <span className="text-sm text-muted-foreground col-span-1">{idx + 1}</span>
                  <Input
                    placeholder="药品名称"
                    value={item.drugName}
                    onChange={e => updateItem(item.id, 'drugName', e.target.value)}
                    className="col-span-3"
                  />
                  <Input
                    placeholder="规格"
                    value={item.spec}
                    onChange={e => updateItem(item.id, 'spec', e.target.value)}
                    className="col-span-2"
                  />
                  <Input
                    placeholder="用量"
                    value={item.dosage}
                    onChange={e => updateItem(item.id, 'dosage', e.target.value)}
                    className="col-span-2"
                  />
                  <Input
                    placeholder="频次"
                    value={item.frequency}
                    onChange={e => updateItem(item.id, 'frequency', e.target.value)}
                    className="col-span-2"
                  />
                  <Input
                    type="number"
                    placeholder="天数"
                    value={item.days}
                    onChange={e => updateItem(item.id, 'days', Number(e.target.value))}
                    className="col-span-1"
                  />
                  <Input
                    type="number"
                    placeholder="数量"
                    value={item.quantity}
                    onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                    className="col-span-1"
                  />
                  <div className="col-span-1 flex items-center justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeItem(item.id)}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rx-remark">备注</Label>
            <Textarea
              id="rx-remark"
              placeholder="处方备注（可选）"
              value={remark}
              onChange={e => setRemark(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!patientId || !doctorId || items.some(i => !i.drugName) || isPending}>
              <Check className="w-4 h-4 mr-2" />
              {isPending ? '开具中…' : '开具处方'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <PatientSelector
      open={openSelector}
      onClose={() => setOpenSelector(false)}
      onSelect={handleSelectPatient}
      title="选择患者"
    />
    </>
  );
}

export function PrescriptionPrintView({ rx }: { rx: Prescription }) {
  return (
    <div className="print-area bg-white p-6 border border-border rounded-md">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold">口腔处方单</h2>
        <div className="text-xs text-muted-foreground mt-1">
          Prescription
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm mb-4 pb-4 border-b border-border">
        <div>
          <span className="text-muted-foreground">患者姓名：</span>
          <span className="font-medium">{rx.patient?.name}</span>
        </div>
        <div>
          <span className="text-muted-foreground">性别：</span>
          <span>{rx.patient?.gender === 'MALE' ? '男' : '女'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">联系电话：</span>
          <span>{rx.patient?.phone}</span>
        </div>
        <div>
          <span className="text-muted-foreground">开方医生：</span>
          <span>{rx.doctor?.name}</span>
        </div>
        <div>
          <span className="text-muted-foreground">开方日期：</span>
          <span>{format(new Date(rx.createdAt), 'yyyy-MM-dd', { locale: zhCN })}</span>
        </div>
        <div>
          <span className="text-muted-foreground">处方编号：</span>
          <span className="font-mono text-xs">{rx.id.slice(0, 12)}</span>
        </div>
      </div>

      <div className="mb-2 text-sm font-medium text-muted-foreground">Rp.</div>
      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 font-medium text-muted-foreground">序号</th>
            <th className="text-left py-2 font-medium text-muted-foreground">药品名称</th>
            <th className="text-left py-2 font-medium text-muted-foreground">规格</th>
            <th className="text-left py-2 font-medium text-muted-foreground">用法用量</th>
            <th className="text-right py-2 font-medium text-muted-foreground">数量</th>
          </tr>
        </thead>
        <tbody>
          {rx.items.map((item, idx) => (
            <tr key={item.id} className="border-b border-border/50">
              <td className="py-2">{idx + 1}</td>
              <td className="py-2 font-medium">{item.drugName}</td>
              <td className="py-2 text-muted-foreground">{item.spec}</td>
              <td className="py-2">
                {item.dosage} / {item.frequency} × {item.days}天
              </td>
              <td className="py-2 text-right">
                {item.quantity} {item.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rx.remark && (
        <div className="text-sm mb-4">
          <span className="text-muted-foreground">备注：</span>
          <span>{rx.remark}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm mt-8 pt-4 border-t border-border">
        <div>
          <div className="text-muted-foreground">医生签名：</div>
          <div className="mt-4 border-b border-border w-32" />
        </div>
        <div className="text-right">
          <div className="text-muted-foreground">药房核对：</div>
          <div className="mt-4 border-b border-border w-32 ml-auto" />
        </div>
      </div>
    </div>
  );
}
