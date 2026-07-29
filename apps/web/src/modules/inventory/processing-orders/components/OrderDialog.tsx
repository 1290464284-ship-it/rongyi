import { useState, useEffect } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { useProcessingProducts } from '@/lib/api/inventory/processing-orders';
import { toast } from 'sonner';
import type { ProcessingOrder, ProcessingFactory } from '@/lib/api/inventory/processing-orders';

interface OrderItemForm {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  teethNumbers: number[];
}

interface OrderDialogProps {
  open: boolean;
  onClose: () => void;
  editing: ProcessingOrder | null;
  factories: ProcessingFactory[];
  onSubmit: (data: {
    patientId: string;
    factoryId: string;
    doctorId?: string;
    remark: string;
    items: Array<{
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: string;
      teethNumbers: number[];
    }>;
  }) => Promise<void>;
}

export function OrderDialog({ open, onClose, editing, factories, onSubmit }: OrderDialogProps) {
  const [openSelector, setOpenSelector] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<OrderItemForm[]>([]);

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  const { data: factoryProductsData } = useProcessingProducts({ factoryId: factoryId || undefined });
  const factoryProducts = factoryProductsData?.items ?? [];

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setPatientId(editing.patientId);
      setPatientName(editing.patient?.name || '');
      setFactoryId(editing.factoryId);
      setDoctorId('');
      setRemark(editing.remark || '');
      setItems(
        editing.items?.map(item => ({
          id: item.id || Math.random().toString(),
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          teethNumbers: item.teethNumbers || [],
        })) || []
      );
    } else {
      setPatientId('');
      setPatientName('');
      setFactoryId('');
      setDoctorId('');
      setRemark('');
      setItems([]);
    }
  }, [editing, open]);

  const addItem = () => {
    if (factoryProducts.length > 0) {
      const first = factoryProducts[0];
      setItems([...items, {
        id: Math.random().toString(),
        productId: first.id,
        productName: first.name,
        quantity: 1,
        unitPrice: String(first.price),
        teethNumbers: [],
      }]);
    }
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItem = <K extends keyof OrderItemForm>(idx: number, field: K, value: OrderItemForm[K]) => {
    const newItems = [...items];
    newItems[idx][field] = value;
    if (field === 'productId') {
      const product = factoryProducts.find(p => p.id === value);
      if (product) {
        newItems[idx].productName = product.name;
        newItems[idx].unitPrice = String(product.price);
      }
    }
    setItems(newItems);
  };

  const totalAmount = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);

  const handleSubmit = async () => {
    if (!patientId) { toast.error('请选择患者'); return; }
    if (!factoryId) { toast.error('请选择加工厂'); return; }
    const data = {
      patientId,
      factoryId,
      doctorId: doctorId || undefined,
      remark,
      items: items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: String(item.unitPrice),
        teethNumbers: item.teethNumbers,
      })),
    };
    await onSubmit(data);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editing ? '编辑加工单' : '新建加工单'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>患者</Label>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <Search className="w-4 h-4 mr-2" />
                {patientName || '请选择患者'}
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-factory">加工厂</Label>
              <Select id="po-factory" value={factoryId} onChange={e => setFactoryId(e.target.value)}>
                <option value="">请选择</option>
                {factories.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>加工项目</Label>
              <Button variant="outline" size="sm" onClick={addItem} disabled={!factoryId}>
                <Plus className="w-3 h-3 mr-1" />添加
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.id} className="flex gap-2 items-end border p-2 rounded">
                  <div className="flex-1">
                    <Select
                      value={item.productId}
                      onChange={e => updateItem(idx, 'productId', e.target.value)}
                    >
                      {factoryProducts.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      value={item.unitPrice}
                      onChange={e => updateItem(idx, 'unitPrice', e.target.value)}
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeItem(idx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {items.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-4">
                  暂无项目，点击上方添加
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="po-remark">备注</Label>
            <Input id="po-remark" value={remark} onChange={e => setRemark(e.target.value)} />
          </div>
          <div className="flex justify-between items-center pt-2 border-t">
            <span className="text-sm text-muted-foreground">合计</span>
            <span className="text-xl font-bold">¥{totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit}>{editing ? '保存' : '创建'}</Button>
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
