import { useMemo, useState } from 'react';
import { Search, Send, Users, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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
  useWechatMessages,
  useBirthdayPatients,
  useAppointmentReminders,
  useSendWechat,
  useSendBatchWechat,
} from '@/lib/api/communication/wechat';
import { formatDate, formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';

type TabKey = 'logs' | 'birthday' | 'appointment';

const TYPE_LABEL: Record<string, string> = {
  APPOINTMENT_REMINDER: '预约提醒',
  BIRTHDAY_GREETING: '生日关怀',
  FOLLOW_UP: '随访',
  CUSTOM: '自定义',
};

const TYPE_CLASS: Record<string, string> = {
  APPOINTMENT_REMINDER: 'bg-primary/10 text-primary',
  BIRTHDAY_GREETING: 'bg-pink-100 text-pink-700',
  FOLLOW_UP: 'bg-success/10 text-success',
  CUSTOM: 'bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待发送',
  SENT: '已发送',
  FAILED: '失败',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning',
  SENT: 'bg-success/10 text-success',
  FAILED: 'bg-destructive/10 text-destructive',
};

export default function WechatPage() {
  const [tab, setTab] = useState<TabKey>('logs');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'logs', label: '消息记录' },
    { key: 'birthday', label: '生日关怀' },
    { key: 'appointment', label: '预约提醒' },
  ];

  return (
    <div className='p-6 space-y-4'>
      <div>
        <h1 className='text-xl font-semibold'>微信提醒</h1>
        <p className='text-sm text-muted-foreground mt-1'>查看微信提醒发送记录及批量发送关怀消息</p>
      </div>

      <div className='flex items-center gap-1 border-b border-border'>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'logs' && <WechatLogsTab />}
      {tab === 'birthday' && <BirthdayTab />}
      {tab === 'appointment' && <AppointmentTab />}
    </div>
  );
}

function WechatLogsTab() {
  const [type, setType] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');
  const [keyword, setKeyword] = useState('');

  const { data, isLoading } = useWechatMessages({
    type: type === 'ALL' ? undefined : type,
    status: status === 'ALL' ? undefined : status,
  });

  const list = useMemo(() => {
    const arr = data ?? [];
    if (!keyword.trim()) return arr;
    const kw = keyword.trim().toLowerCase();
    return arr.filter(
      (l) =>
        (l.patientName ?? '').toLowerCase().includes(kw) ||
        l.content.toLowerCase().includes(kw),
    );
  }, [data, keyword]);

  return (
    <Card className='p-4 space-y-3'>
      <div className='flex items-center gap-3 flex-wrap'>
        <div className='flex items-center gap-2'>
          <Label className='text-muted-foreground'>类型</Label>
          <Select value={type} onChange={(e) => setType(e.target.value)} className='w-32'>
            <option value='ALL'>全部类型</option>
            <option value='APPOINTMENT_REMINDER'>预约提醒</option>
            <option value='BIRTHDAY_GREETING'>生日关怀</option>
            <option value='FOLLOW_UP'>随访</option>
            <option value='CUSTOM'>自定义</option>
          </Select>
        </div>
        <div className='flex items-center gap-2'>
          <Label className='text-muted-foreground'>状态</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className='w-28'>
            <option value='ALL'>全部状态</option>
            <option value='PENDING'>待发送</option>
            <option value='SENT'>已发送</option>
            <option value='FAILED'>失败</option>
          </Select>
        </div>
        <div className='relative w-72'>
          <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
          <Input
            className='pl-8'
            placeholder='患者姓名 / 内容'
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className='ml-auto text-sm text-muted-foreground'>共 {list.length} 条</div>
      </div>

      <div className='rounded-md border border-border overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-40'>发送时间</TableHead>
              <TableHead>患者姓名</TableHead>
              <TableHead>内容</TableHead>
              <TableHead className='w-24'>类型</TableHead>
              <TableHead className='w-20 text-center'>状态</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={6} />
            ) : list.length === 0 ? (
              <EmptyState colSpan={6} text="暂无消息记录" />
            ) : (
              list.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className='text-muted-foreground'>
                    {l.sentAt ? formatDateTime(l.sentAt) : formatDateTime(l.createdAt)}
                  </TableCell>
                  <TableCell className='font-medium'>{l.patientName ?? '-'}</TableCell>
                  <TableCell className='max-w-xs truncate' title={l.content}>
                    {l.content}
                  </TableCell>
                  <TableCell>
                    <Badge className={TYPE_CLASS[l.type] ?? 'bg-muted text-muted-foreground'}>
                      {TYPE_LABEL[l.type] ?? l.type}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-center'>
                    <Badge className={STATUS_CLASS[l.status] ?? 'bg-muted text-muted-foreground'}>
                      {STATUS_LABEL[l.status] ?? l.status}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>{l.remark ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function BirthdayTab() {
  const { data, isLoading } = useBirthdayPatients();
  const sendWechatMut = useSendWechat();
  const sendBatchMut = useSendBatchWechat();

  const [batchContent, setBatchContent] = useState(
    '尊敬的{姓名}先生/女士，祝您生日快乐！愿您笑口常开，健康常伴。',
  );
  const list = data ?? [];

  const handleSingle = (id: string, name: string) => {
    const content = batchContent.replace(/\{姓名\}/g, name);
    sendWechatMut.mutate(
      {
        patientId: id,
        content,
        type: 'BIRTHDAY_GREETING',
      },
      {
        onSuccess: () => toast.success(`已向 ${name} 发送生日祝福`),
      },
    );
  };

  const handleBatch = () => {
    if (list.length === 0) {
      toast.error('没有可发送的患者');
      return;
    }
    if (!batchContent.trim()) {
      toast.error('请填写祝福内容');
      return;
    }
    sendBatchMut.mutate(
      {
        patientIds: list.map((p) => p.id),
        content: batchContent.trim(),
        type: 'BIRTHDAY_GREETING',
      },
      {
        onSuccess: () => toast.success(`已向 ${list.length} 位患者批量发送生日祝福`),
      },
    );
  };

  return (
    <Card className='p-4 space-y-3'>
      <div className='flex items-start gap-3 flex-col'>
        <div className='w-full'>
          <Label className='mb-1.5 block'>祝福内容</Label>
          <Textarea
            rows={3}
            value={batchContent}
            onChange={(e) => setBatchContent(e.target.value)}
            placeholder='可使用 {姓名} 占位符，发送时自动替换'
          />
        </div>
        <div className='flex items-center justify-between w-full'>
          <div className='text-sm text-muted-foreground'>
            本月过生日的患者共 <span className='font-semibold text-foreground'>{list.length}</span> 位
          </div>
          <Button onClick={handleBatch} disabled={sendBatchMut.isPending || list.length === 0}>
            <Users className='h-4 w-4 mr-1' />
            {sendBatchMut.isPending ? '发送中…' : '批量发送'}
          </Button>
        </div>
      </div>

      <div className='rounded-md border border-border overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead className='w-32'>病历号</TableHead>
              <TableHead className='w-36'>手机</TableHead>
              <TableHead className='w-32'>生日</TableHead>
              <TableHead className='w-24 text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={5} />
            ) : list.length === 0 ? (
              <EmptyState colSpan={5} text="本月无过生日患者" />
            ) : (
              list.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className='font-medium'>{p.name}</TableCell>
                  <TableCell>
                    <Badge className='bg-muted text-muted-foreground font-mono'>{p.code}</Badge>
                  </TableCell>
                  <TableCell className='text-muted-foreground font-mono'>{p.phone}</TableCell>
                  <TableCell className='text-muted-foreground'>
                    {p.birthDate ? formatDate(p.birthDate) : '-'}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => handleSingle(p.id, p.name)}
                      disabled={sendWechatMut.isPending}
                    >
                      <Send className='h-4 w-4 mr-1' />发送
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function AppointmentTab() {
  const { data, isLoading } = useAppointmentReminders();
  const sendWechatMut = useSendWechat();
  const sendBatchMut = useSendBatchWechat();

  const [batchContent, setBatchContent] = useState(
    '尊敬的{姓名}先生/女士，提醒您明天 {时间} 在我诊所 {医生} 医生处有预约，请准时就诊。',
  );
  const list = data ?? [];

  const buildContent = (item: {
    patientName: string;
    doctorName: string;
    startTime: string;
  }) => {
    return batchContent
      .replace(/\{姓名\}/g, item.patientName)
      .replace(/\{医生\}/g, item.doctorName)
      .replace(/\{时间\}/g, formatDateTime(item.startTime));
  };

  const handleSingle = (item: {
    patientId: string;
    patientName: string;
    doctorName: string;
    startTime: string;
  }) => {
    sendWechatMut.mutate(
      {
        patientId: item.patientId,
        content: buildContent(item),
        type: 'APPOINTMENT_REMINDER',
      },
      {
        onSuccess: () => toast.success(`已向 ${item.patientName} 发送预约提醒`),
      },
    );
  };

  const handleBatch = () => {
    if (list.length === 0) {
      toast.error('没有可发送的预约');
      return;
    }
    if (!batchContent.trim()) {
      toast.error('请填写提醒内容');
      return;
    }
    sendBatchMut.mutate(
      {
        patientIds: list.map((p) => p.patientId),
        content: batchContent.trim(),
        type: 'APPOINTMENT_REMINDER',
      },
      {
        onSuccess: () => toast.success(`已向 ${list.length} 位患者批量发送预约提醒`),
      },
    );
  };

  return (
    <Card className='p-4 space-y-3'>
      <div className='flex items-start gap-3 flex-col'>
        <div className='w-full'>
          <Label className='mb-1.5 block'>提醒内容</Label>
          <Textarea
            rows={3}
            value={batchContent}
            onChange={(e) => setBatchContent(e.target.value)}
            placeholder='可使用 {姓名} {医生} {时间} 占位符，发送时自动替换'
          />
        </div>
        <div className='flex items-center justify-between w-full'>
          <div className='text-sm text-muted-foreground'>
            明天预约共 <span className='font-semibold text-foreground'>{list.length}</span> 条
          </div>
          <Button onClick={handleBatch} disabled={sendBatchMut.isPending || list.length === 0}>
            <Users className='h-4 w-4 mr-1' />
            {sendBatchMut.isPending ? '发送中…' : '批量发送'}
          </Button>
        </div>
      </div>

      <div className='rounded-md border border-border overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>患者姓名</TableHead>
              <TableHead className='w-28'>医生</TableHead>
              <TableHead className='w-40'>预约时间</TableHead>
              <TableHead className='w-24 text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={4} />
            ) : list.length === 0 ? (
              <EmptyState colSpan={4} text="明天无预约" />
            ) : (
              list.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className='font-medium'>{item.patientName}</TableCell>
                  <TableCell className='text-muted-foreground'>{item.doctorName}</TableCell>
                  <TableCell className='text-muted-foreground'>
                    {formatDateTime(item.startTime)}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => handleSingle(item)}
                      disabled={sendWechatMut.isPending}
                    >
                      <Send className='h-4 w-4 mr-1' />发送
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
