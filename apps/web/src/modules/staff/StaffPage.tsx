import { useState } from 'react';
import { Plus, Edit, Trash2, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  useStaff,
  useCreateStaff,
  useUpdateStaff,
  useDeleteStaff,
  type StaffUser,
} from '@/lib/staff';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function StaffPage() {
  const { data: staff, isLoading } = useStaff();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<StaffUser | null>(null);

  function handleEdit(user: StaffUser) {
    setSelected(user);
    setEditOpen(true);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除员工「${name}」？删除后该账号将无法登录。`)) return;
    deleteStaff.mutate(id);
  }

  const users = staff ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">员工管理</h1>
          <Badge className="bg-muted text-muted-foreground">{users.length} 人</Badge>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          添加员工
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>手机</TableHead>
                <TableHead>入职时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={5} />
              ) : users.length === 0 ? (
                <EmptyState colSpan={5} text="暂无员工数据" />
              ) : (
                users.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
                          {u.name[0]}
                        </div>
                        {u.name}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{u.username}</TableCell>
                    <TableCell className="text-sm">{u.phone || '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(u.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => handleEdit(u)}>
                        <Edit className="w-3 h-3 mr-1" />
                        编辑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(u.id, u.name)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateStaffDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createStaff.mutateAsync}
      />

      {selected && (
        <EditStaffDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          user={selected}
          onUpdate={updateStaff.mutateAsync}
        />
      )}
    </div>
  );
}

function CreateStaffDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: any) => Promise<any>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('DOCTOR');
  const [phone, setPhone] = useState('');

  async function handleSubmit() {
    if (!username || !password || !name) return;
    await onCreate({ username, password, name, role, phone: phone || undefined });
    onClose();
    setUsername(''); setPassword(''); setName(''); setRole('DOCTOR'); setPhone('');
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>添加员工</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="create-staff-name">姓名 *</Label>
            <Input id="create-staff-name" value={name} onChange={e => setName(e.target.value)} placeholder="如：王医生" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-staff-username">用户名 *</Label>
              <Input id="create-staff-username" value={username} onChange={e => setUsername(e.target.value)} placeholder="登录账号" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-staff-password">密码 *</Label>
              <Input id="create-staff-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="4位数字" inputMode="numeric" maxLength={4} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-staff-role">角色</Label>
              <Select id="create-staff-role" value={role} onChange={e => setRole(e.target.value)}>
                <option value="DOCTOR">医生</option>
                <option value="RECEPTIONIST">前台</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-staff-phone">手机</Label>
              <Input id="create-staff-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="选填" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit} disabled={!username || !password || !name}>
              <Plus className="w-4 h-4 mr-2" />
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditStaffDialog({
  open,
  onClose,
  user,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  user: StaffUser;
  onUpdate: ({ id, data }: { id: string; data: any }) => Promise<any>;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [phone, setPhone] = useState(user.phone || '');
  const [password, setPassword] = useState('');

  async function handleSubmit() {
    const data: any = { name, role, phone: phone || undefined };
    if (password) data.password = password;
    await onUpdate({ id: user.id, data });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>编辑员工 - {user.username}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-name">姓名</Label>
            <Input id="edit-staff-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-staff-role">角色</Label>
              <Select id="edit-staff-role" value={role} onChange={e => setRole(e.target.value as any)}>
                <option value="DOCTOR">医生</option>
                <option value="RECEPTIONIST">前台</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-staff-phone">手机</Label>
              <Input id="edit-staff-phone" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-password">重置密码（留空不修改）</Label>
            <Input
              id="edit-staff-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="4位数字"
              inputMode="numeric"
              maxLength={4}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit}>
              <UserCog className="w-4 h-4 mr-2" />
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
