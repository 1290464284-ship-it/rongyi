import { useState, useMemo, useEffect } from 'react';
import { Plus, Check, Trash2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CreateChargeDto, Charge } from '@/lib/api/financial/charges';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { LoadingButton } from '@/components/ui/loading';
import { toastService } from '@/lib/utils/toast-service';

interface EditableItem {
  id: string;
  name: string;
  category: string;
  price: string;
  quantity: number;
  teethNumbers: string[];
}

const DEFAULT_ITEMS: EditableItem[] = [
  { id: '1', name: '', category: '', price: '0', quantity: 1, teethNumbers: [] },
];

// 从错误响应中提取字段错误
function extractFieldErrors(error: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!error) return errors;

  // 尝试从 axios 错误响应中提取
  const err = error as Record<string, unknown>;
  const response = err.response as Record<string, unknown> | undefined;
  const data = response?.data as Record<string, unknown> | undefined;

  if (data?.message) {
    // 如果 message 是数组，尝试解析字段错误
    if (Array.isArray(data.message)) {
      (data.message as string[]).forEach((msg: string) => {
        // 尝试匹配 "字段名 - 错误信息" 或 "字段名: 错误信息" 格式
        const match = msg.match(/^([\w.]+)\s*[-:：]\s*(.+)$/);
        if (match) {
          errors[match[1]] = match[2];
        }
      });
    }
  }

  return errors;
}

export function CreateChargeDialog({
  open,
  onClose,
  onCreate,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateChargeDto) => Promise<Charge>;
  isPending: boolean;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [items, setItems] = useState<EditableItem[]>(DEFAULT_ITEMS);
  const [discount, setDiscount] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
    // 清除患者选择后清除对应字段错误
    setFieldErrors(prev => {
      const { patientId: _, ...rest } = prev;
      return rest;
    });
  };

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    [items],
  );
  const total = Math.max(0, subtotal - discount);

  function addItem() {
    setItems([...items, { id: Date.now().toString(), name: '', category: '', price: '0', quantity: 1, teethNumbers: [] }]);
  }

  function removeItem(id: string) {
    if (items.length === 1) return;
    setItems(items.filter(i => i.id !== id));
  }

  function updateItem(id: string, field: keyof EditableItem, value: EditableItem[keyof EditableItem]) {
    setItems(items.map(i => (i.id === id ? { ...i, [field]: value } : i)));
    // 修改项目时清除相关字段错误
    setFieldErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[`items.${id}.${String(field)}`];
      return newErrors;
    });
  }

  async function handleSubmit() {
    // 前端校验
    const errors: Record<string, string> = {};
    if (!patientId) {
      errors.patientId = '请选择患者';
    }
    items.forEach((item, index) => {
      if (!item.name) {
        errors[`items.${index}.name`] = '请输入项目名称';
      }
      if (Number(item.price) <= 0) {
        errors[`items.${index}.price`] = '单价必须大于0';
      }
    });

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});

    try {
      await onCreate({
        patientId,
        items: items.map(({ id: _id, ...rest }) => rest),
        discount,
      });
      toastService.success('收费单创建成功');
      onClose();
    } catch (e: unknown) {
      // 尝试从后端错误中提取字段错误
      const serverErrors = extractFieldErrors(e);
      if (Object.keys(serverErrors).length > 0) {
        setFieldErrors(serverErrors);
      } else {
        toastService.error('创建收费单失败', e instanceof Error ? e : undefined);
      }
    }
  }

  useEffect(() => {
    if (open) {
      setPatientId('');
      setPatientName('');
      setItems(DEFAULT_ITEMS);
      setDiscount(0);
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onClose={onClose} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建收费单</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                患者 <span className="text-destructive">*</span>
              </Label>
              <Button
                variant="outline"
                className={`w-full justify-start ${fieldErrors.patientId ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                onClick={() => setOpenSelector(true)}
                disabled={openSelector}
              >
                <User className="w-4 h-4 mr-2" />
                {patientName ? patientName : '请选择患者'}
              </Button>
              {fieldErrors.patientId && (
                <p className="text-xs text-destructive">{fieldErrors.patientId}</p>
              )}
            </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>
                收费项目 <span className="text-destructive">*</span>
              </Label>
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="w-3 h-3 mr-1" /> 添加项目
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => {
                const nameError = fieldErrors[`items.${idx}.name`] || fieldErrors[`items.${item.id}.name`];
                const priceError = fieldErrors[`items.${idx}.price`] || fieldErrors[`items.${item.id}.price`];
                return (
                  <div key={item.id} className="space-y-1">
                    <div className="flex items-center gap-2 p-2 border border-border rounded-md">
                      <span className="text-sm text-muted-foreground w-6">{idx + 1}</span>
                      <Input
                        placeholder="项目名称"
                        value={item.name}
                        onChange={e => updateItem(item.id, 'name', e.target.value)}
                        className={`flex-1 ${nameError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      />
                      <Input
                        placeholder="类别"
                        value={item.category}
                        onChange={e => updateItem(item.id, 'category', e.target.value)}
                        className="w-24"
                      />
                      <Input
                        type="number"
                        placeholder="单价"
                        value={item.price || ''}
                        onChange={e => updateItem(item.id, 'price', Number(e.target.value))}
                        className={`w-24 ${priceError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      />
                      <Input
                        type="number"
                        placeholder="数量"
                        value={item.quantity}
                        onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                        className="w-20"
                      />
                      <span className="text-sm w-20 text-right">
                        ¥{(Number(item.price) * item.quantity).toFixed(2)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeItem(item.id)}
                        disabled={items.length === 1}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                    {(nameError || priceError) && (
                      <div className="pl-8 space-y-0.5">
                        {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                        {priceError && <p className="text-xs text-destructive">{priceError}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">小计</span>
              <span>¥{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">优惠减免</span>
              <div className="flex items-center gap-2">
                <span>¥</span>
                <Input
                  type="number"
                  value={discount || ''}
                  onChange={e => setDiscount(Number(e.target.value))}
                  className="w-24 text-right"
                />
              </div>
            </div>
            <div className="flex justify-between font-semibold text-lg pt-2 border-t border-border">
              <span>应收金额</span>
              <span className="text-primary">¥{total.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <LoadingButton onClick={handleSubmit} loading={isPending} loadingText="创建中..." disabled={!patientId || items.every(i => !i.name)}>
              <Check className="w-4 h-4 mr-2" />
              创建收费单
            </LoadingButton>
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
