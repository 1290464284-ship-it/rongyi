import { useState, useMemo } from 'react';
import { Plus, Trash2, User, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  type TreatmentPlan,
  type CreateTreatmentPlanDto,
} from '@/lib/api/clinical/treatment-plans';
import { useAuthStore } from '@/lib/store/auth-store';
import { useStaff } from '@/lib/staff';
import { PatientSelector } from '@/components/patient/PatientSelector';

interface EditablePlanItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: number[];
}

export function CreateTreatmentPlanDialog({
  open,
  onClose,
  presetPatientId,
  presetVisitId: _presetVisitId,
  onCreate,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  presetPatientId?: string;
  presetVisitId?: string;
  onCreate: (data: CreateTreatmentPlanDto) => Promise<TreatmentPlan>;
  isPending?: boolean;
}) {
  const user = useAuthStore(s => s.user);
  const { data: staff } = useStaff();
  const doctors = (staff ?? []).filter(s => s.role === 'DOCTOR');

  const [patientId, setPatientId] = useState(presetPatientId ?? '');
  const [patientName, setPatientName] = useState('');
  const [doctorId, setDoctorId] = useState(user?.role === 'DOCTOR' ? user.id : '');
  const [planName, setPlanName] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<EditablePlanItem[]>([
    { id: '1', code: '', name: '', category: '修复', price: 0, quantity: 1, teethNumbers: [] },
  ]);
  const [openSelector, setOpenSelector] = useState(false);

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
    setOpenSelector(false);
  };

  const totalFee = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items],
  );

  function addItem() {
    setItems([
      ...items,
      { id: Date.now().toString(), code: '', name: '', category: '修复', price: 0, quantity: 1, teethNumbers: [] },
    ]);
  }

  function removeItem(id: string) {
    if (items.length === 1) return;
    setItems(items.filter(i => i.id !== id));
  }

  function updateItem(id: string, field: keyof EditablePlanItem, value: EditablePlanItem[keyof EditablePlanItem]) {
    setItems(items.map(i => (i.id === id ? { ...i, [field]: value } : i)));
  }

  async function handleSubmit() {
    if (!patientId || !doctorId || !planName || items.some(i => !i.name)) return;
    await onCreate({
      patientId,
      title: planName,
      description: remark || undefined,
      items: items.map(({ id: _id, code, name, price, quantity }) => ({
        treatmentCatalogId: code,
        treatmentCatalogName: name,
        price,
        quantity,
      })),
    });
    onClose();
    setPlanName('');
    setRemark('');
    setItems([{ id: '1', code: '', name: '', category: '修复', price: 0, quantity: 1, teethNumbers: [] }]);
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>新建治疗计划</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
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
                <Label htmlFor="plan-doctor">主治医生 *</Label>
                <Select id="plan-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                  <option value="">请选择医生</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-name">计划名称 *</Label>
                <Input
                  id="plan-name"
                  placeholder="如：根管治疗计划"
                  value={planName}
                  onChange={e => setPlanName(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>治疗项目</Label>
                <Button size="sm" variant="outline" onClick={addItem}>
                  <Plus className="w-3 h-3 mr-1" /> 添加项目
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 p-2 border border-border rounded-md items-center">
                    <span className="text-sm text-muted-foreground col-span-1">{idx + 1}</span>
                    <Input
                      placeholder="项目编码"
                      value={item.code}
                      onChange={e => updateItem(item.id, 'code', e.target.value)}
                      className="col-span-2"
                    />
                    <Input
                      placeholder="项目名称"
                      value={item.name}
                      onChange={e => updateItem(item.id, 'name', e.target.value)}
                      className="col-span-3"
                    />
                    <Select
                      value={item.category}
                      onChange={e => updateItem(item.id, 'category', e.target.value)}
                      className="col-span-2"
                    >
                      <option value="修复">修复</option>
                      <option value="外科">外科</option>
                      <option value="牙体牙髓">牙体牙髓</option>
                      <option value="牙周">牙周</option>
                      <option value="正畸">正畸</option>
                      <option value="儿童口腔">儿童口腔</option>
                      <option value="种植">种植</option>
                      <option value="检查">检查</option>
                      <option value="其他">其他</option>
                    </Select>
                    <Input
                      type="number"
                      placeholder="单价"
                      value={item.price || ''}
                      onChange={e => updateItem(item.id, 'price', Number(e.target.value))}
                      className="col-span-2"
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

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="text-sm text-muted-foreground">
                共 {items.length} 项
              </div>
              <div className="text-lg font-semibold">
                预计总费用：<span className="text-primary">¥{totalFee.toFixed(2)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-remark">备注</Label>
              <Textarea
                id="plan-remark"
                placeholder="计划备注（可选）"
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
              <Button onClick={handleSubmit} disabled={!patientId || !doctorId || !planName || items.some(i => !i.name) || isPending}>
                <Check className="w-4 h-4 mr-2" />
                {isPending ? '创建中…' : '创建计划'}
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
