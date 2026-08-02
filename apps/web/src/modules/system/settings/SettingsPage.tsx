import { useEffect, useState } from 'react';
import { Save, Building2, ScrollText, MonitorPlay } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingButton, TableLoading, EmptyState } from '@/components/ui/loading';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useSettings, useUpdateSettings } from '@/lib/api/system/settings';
import { useOperationLogs, type OperationLog } from '@/lib/api/system/operation-logs';
import { formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type TabKey = 'clinic' | 'logs' | 'desktop';

const FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: 'clinicName', label: '诊所名称', placeholder: '如：明亮口腔诊所' },
  { key: 'clinicPhone', label: '联系电话', placeholder: '如：021-12345678' },
  { key: 'clinicAddress', label: '诊所地址', placeholder: '如：上海市XX区XX路XX号' },
  { key: 'clinicLogo', label: 'Logo URL', placeholder: 'https://...', type: 'url' },
];

const PAGE_SIZE = 20;

const ACTION_LABEL: Record<string, string> = {
  CREATE: '创建',
  UPDATE: '更新',
  DELETE: '删除',
  LOGIN: '登录',
  LOGOUT: '登出',
  RECHARGE: '充值',
  PAY: '支付',
};

const LS_START_MINIMIZED = 'dental.desktop.startMinimized';
const LS_MINIMIZE_ON_CLOSE = 'dental.desktop.minimizeOnClose';
const LS_AUTO_LAUNCH = 'dental.desktop.autoLaunch';

function readLSBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeLSBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('clinic');
  const bridge = typeof window !== 'undefined' ? window.dentalBridge : undefined;
  const showDesktopTab = !!bridge;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">系统设置</h1>
        <p className="text-sm text-muted-foreground mt-1">管理诊所信息与查看操作日志</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === 'clinic'} onClick={() => setTab('clinic')} icon={<Building2 className="h-4 w-4" />}>
          诊所信息
        </TabButton>
        {showDesktopTab && (
          <TabButton active={tab === 'desktop'} onClick={() => setTab('desktop')} icon={<MonitorPlay className="h-4 w-4" />}>
            桌面端
          </TabButton>
        )}
        <TabButton active={tab === 'logs'} onClick={() => setTab('logs')} icon={<ScrollText className="h-4 w-4" />}>
          操作日志
        </TabButton>
      </div>

      {tab === 'clinic' && <ClinicInfoTab />}
      {tab === 'desktop' && showDesktopTab && <DesktopSettingsTab />}
      {tab === 'logs' && <OperationLogsTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ClinicInfoTab() {
  const { data, isLoading } = useSettings();
  const updateMut = useUpdateSettings();
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      const next: Record<string, string> = {};
      FIELDS.forEach((f) => {
        const dataMap = data as unknown as Record<string, string>;
        next[f.key] = dataMap[f.key] ?? '';
      });
      setForm(next);
    }
  }, [data]);

  const handleSave = () => {
    if (!form.clinicName?.trim()) {
      toast.error('请填写诊所名称');
      return;
    }
    updateMut.mutate(form, {
      onSuccess: () => toast.success('诊所信息已保存'),
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">加载中…</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">诊所基本信息</span>
          <LoadingButton
            onClick={handleSave}
            loading={updateMut.isPending}
            loadingText="保存中…"
            size="sm"
          >
            <Save className="h-4 w-4 mr-1" />
            保存
          </LoadingButton>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label>{f.label}</Label>
              {f.key === 'clinicAddress' ? (
                <Textarea
                  rows={2}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                />
              ) : (
                <Input
                  type={f.type ?? 'text'}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                />
              )}
            </div>
          ))}
        </div>
        {form.clinicLogo && (
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Logo 预览</Label>
            <div className="rounded-md border border-border p-3 inline-block">
              <img
                src={form.clinicLogo}
                alt="诊所 Logo"
                loading="lazy"
                className="max-h-20 max-w-xs object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DesktopSettingsTab() {
  const bridge = window.dentalBridge!;

  const [startMinimized, setStartMinimized] = useState<boolean>(() => readLSBool(LS_START_MINIMIZED));
  const [minimizeOnClose, setMinimizeOnClose] = useState<boolean>(() => readLSBool(LS_MINIMIZE_ON_CLOSE));
  const [autoLaunch, setAutoLaunch] = useState<boolean>(() => readLSBool(LS_AUTO_LAUNCH));
  const [loadingAutoLaunch, setLoadingAutoLaunch] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    bridge.tray.getAutoLaunch().then((v) => {
      if (cancelled) return;
      setAutoLaunch(!!v);
      writeLSBool(LS_AUTO_LAUNCH, !!v);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const toggleStartMinimized = () => {
    const next = !startMinimized;
    setStartMinimized(next);
    writeLSBool(LS_START_MINIMIZED, next);
    toast.success(next ? '下次启动时将最小化到托盘' : '已取消启动最小化');
  };

  const toggleMinimizeOnClose = () => {
    const next = !minimizeOnClose;
    setMinimizeOnClose(next);
    writeLSBool(LS_MINIMIZE_ON_CLOSE, next);
    toast.success(next ? '关闭窗口时将最小化到托盘而不退出' : '关闭窗口将直接退出程序');
  };

  const toggleAutoLaunch = async () => {
    setLoadingAutoLaunch(true);
    try {
      const next = !autoLaunch;
      const res = await bridge.tray.setAutoLaunch(next);
      if (res?.success) {
        setAutoLaunch(next);
        writeLSBool(LS_AUTO_LAUNCH, next);
        toast.success(next ? '已启用开机自启' : '已禁用开机自启');
      } else {
        toast.error('设置开机自启失败');
      }
    } catch (err) {
      toast.error(`设置开机自启失败: ${(err as Error).message}`);
    } finally {
      setLoadingAutoLaunch(false);
    }
  };

  const CheckboxRow = ({
    title,
    desc,
    checked,
    onChange,
    disabled,
  }: {
    title: string;
    desc?: string;
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
  }) => (
    <label
      className={cn(
        'flex items-start gap-3 p-3 rounded-md border border-border transition-colors',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/30',
      )}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
      </div>
    </label>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <span className="text-sm font-medium">桌面端设置</span>
        </CardHeader>
        <CardContent className="space-y-3">
          <CheckboxRow
            title="启动时最小化到托盘（不显示主窗口）"
            desc="下次启动应用生效"
            checked={startMinimized}
            onChange={toggleStartMinimized}
          />
          <CheckboxRow
            title="关闭窗口时最小化到托盘而不退出程序"
            desc="关闭右上角 × 按钮时最小化后台运行，可在托盘菜单中退出"
            checked={minimizeOnClose}
            onChange={toggleMinimizeOnClose}
          />
          <CheckboxRow
            title="系统开机自动启动"
            desc="登录操作系统时自动启动牙科管家"
            checked={autoLaunch}
            onChange={toggleAutoLaunch}
            disabled={loadingAutoLaunch}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function OperationLogsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useOperationLogs({ page, pageSize: PAGE_SIZE });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">操作日志</span>
          <span className="text-sm text-muted-foreground">共 {total} 条记录</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">时间</TableHead>
                <TableHead className="w-32">操作人</TableHead>
                <TableHead className="w-24">动作</TableHead>
                <TableHead className="w-32">目标</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={5} />
              ) : !data?.items?.length ? (
                <EmptyState colSpan={5} text="暂无日志" />
              ) : (
                data.items.map((log: OperationLog) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground">{formatDateTime(log.createdAt)}</TableCell>
                    <TableCell className="font-medium">{log.userName ?? '-'}</TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          'bg-primary/10 text-primary',
                          log.action === 'DELETE' && 'bg-destructive/10 text-destructive',
                          log.action === 'CREATE' && 'bg-success/10 text-success',
                          log.action === 'UPDATE' && 'bg-warning/10 text-warning',
                        )}
                      >
                        {ACTION_LABEL[log.action] ?? log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{log.target ?? '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{log.detail ?? '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
