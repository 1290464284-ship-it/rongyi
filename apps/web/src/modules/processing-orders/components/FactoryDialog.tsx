import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { ProcessingFactory } from '@/lib/api/inventory/processing-orders';

interface FactoryDialogProps {
  open: boolean;
  onClose: () => void;
  editing: ProcessingFactory | null;
  onSubmit: (data: Partial<ProcessingFactory>) => Promise<void>;
}

export function FactoryDialog({ open, onClose, editing, onSubmit }: FactoryDialogProps) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [remark, setRemark] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setContact(editing.contactName || '');
      setPhone(editing.phone || '');
      setAddress(editing.address || '');
      setRemark(editing.remark || '');
    } else {
      setName('');
      setContact('');
      setPhone('');
      setAddress('');
      setRemark('');
    }
  }, [editing, open]);

  const handleSubmit = async () => {
    if (!name) { toast.error('请输入名称'); return; }
    await onSubmit({ name: name || '', contactName: contact || '', phone: phone || '', address: address || '', remark: remark || '' });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{editing ? '编辑加工厂' : '新增加工厂'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="factory-name">名称 *</Label>
            <Input id="factory-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="factory-contact">联系人</Label>
              <Input id="factory-contact" value={contact} onChange={e => setContact(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="factory-phone">电话</Label>
              <Input id="factory-phone" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="factory-address">地址</Label>
            <Input id="factory-address" value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="factory-remark">备注</Label>
            <Input id="factory-remark" value={remark} onChange={e => setRemark(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit}>{editing ? '保存' : '创建'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
