import { useMemo, useState } from 'react';
import { Plus, Search, Wallet, History, CreditCard } from 'lucide-react';
import { formatYuan } from '@dental/shared';
import { Button } from '@/components/ui/button';
import { LoadingButton, TableLoading, EmptyState } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useMemberCards,
  useCreateMemberCard,
  useRechargeMemberCard,
  useMemberCardLogs,
  type MemberCard,
  type MemberCardLog,
} from '@/lib/api/financial/member-cards';
import { usePatients } from '@/lib/api/patients/patients';
import { formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '正常',
  DISABLED: '已停用',
};

const LOG_TYPE_LABEL: Record<string, string> = {
  RECHARGE: '充值',
  CONSUME: '消费',
  REFUND: '退款',
};

export default function MemberCardPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const { data, isLoading } = useMemberCards(page, PAGE_SIZE);

  // 充值弹窗
  const [rechargeTarget, setRechargeTarget] = useState<MemberCard | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeRemark, setRechargeRemark] = useState('');

  // 记录弹窗
  const [logsTarget, setLogsTarget] = useState<MemberCard | null>(null);

  // 开通弹窗
  const [openCreate, setOpenCreate] = useState(false);
  const [patientKeyword, setPatientKeyword] = useState('');
  const [patientPage, setPatientPage] = useState(1);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const rechargeMut = useRechargeMemberCard();
  const createMut = useCreateMemberCard();

  const patientsQuery = usePatients(patientKeyword, patientPage, 10);

  const filtered = useMemo(() => {
    const list = data?.items ?? [];
    if (!keyword.trim()) return list;
    const kw = keyword.trim().toLowerCase();
    return list.filter(
      (c) =>
        c.cardNo.toLowerCase().includes(kw) ||
        (c.patientName ?? '').toLowerCase().includes(kw) ||
        (c.patientCode ?? '').toLowerCase().includes(kw) ||
        (c.patientPhone ?? '').toLowerCase().includes(kw),
    );
  }, [data, keyword]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleRecharge = () => {
    if (!rechargeTarget) return;
    const amount = parseFloat(rechargeAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('请输入正确的充值金额');
      return;
    }
    rechargeMut.mutate(
      { id: rechargeTarget.id, amount, remark: rechargeRemark.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`充值成功 ¥${amount.toFixed(2)}`);
          setRechargeTarget(null);
          setRechargeAmount('');
          setRechargeRemark('');
        },
      },
    );
  };

  const handleCreateCard = () => {
    if (!selectedPatientId) {
      toast.error('请先选择患者');
      return;
    }
    createMut.mutate(selectedPatientId, {
      onSuccess: () => {
        toast.success('会员卡已开通');
        setOpenCreate(false);
        setSelectedPatientId(null);
        setPatientKeyword('');
        setPatientPage(1);
        setPage(1);
      },
    });
  };

  const fmt = formatYuan;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">会员卡管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理患者会员卡及充值记录</p>
        </div>
        <Button onClick={() => setOpenCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />开通会员卡
        </Button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-80">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="卡号 / 患者姓名 / 病历号 / 手机"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="ml-auto text-sm text-muted-foreground">
            共 {total} 张会员卡
          </div>
        </div>

        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">卡号</TableHead>
                <TableHead>患者</TableHead>
                <TableHead className="w-36">手机</TableHead>
                <TableHead className="w-28 text-right">余额</TableHead>
                <TableHead className="w-28 text-right">累计充值</TableHead>
                <TableHead className="w-28 text-right">累计消费</TableHead>
                <TableHead className="w-20 text-center">状态</TableHead>
                <TableHead className="w-40 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={8} />
              ) : filtered.length === 0 ? (
                <EmptyState colSpan={8} text="暂无会员卡" />
              ) : (
                filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Badge className="bg-primary/10 text-primary font-mono">{c.cardNo}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{c.patientName ?? '-'}</div>
                      <div className="text-xs text-muted-foreground">{c.patientCode ?? ''}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.patientPhone ?? '-'}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">{fmt(c.balance)}</TableCell>
                    <TableCell className="text-right text-success">{fmt(c.totalRecharge)}</TableCell>
                    <TableCell className="text-right text-warning">{fmt(c.totalConsume)}</TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={
                          c.status === 'ACTIVE'
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {STATUS_LABEL[c.status] ?? c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRechargeTarget(c)}
                          disabled={c.status !== 'ACTIVE'}
                        >
                          <Wallet className="h-4 w-4 mr-1" />充值
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setLogsTarget(c)}>
                          <History className="h-4 w-4 mr-1" />记录
                        </Button>
                      </div>
                    </TableCell>
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
      </Card>

      {/* 充值弹窗 */}
      <Dialog open={!!rechargeTarget} onClose={() => setRechargeTarget(null)}>
        <DialogHeader>
          <DialogTitle>会员卡充值</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          {rechargeTarget && (
            <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">卡号</span>
                <span className="font-mono font-medium">{rechargeTarget.cardNo}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-muted-foreground">患者</span>
                <span className="font-medium">{rechargeTarget.patientName}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-muted-foreground">当前余额</span>
                <span className="font-semibold text-primary">{fmt(rechargeTarget.balance)}</span>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>充值金额 (元) *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={rechargeAmount}
              onChange={(e) => setRechargeAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Textarea
              rows={2}
              value={rechargeRemark}
              onChange={(e) => setRechargeRemark(e.target.value)}
              placeholder="可选"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRechargeTarget(null)}>
              取消
            </Button>
            <LoadingButton onClick={handleRecharge} loading={rechargeMut.isPending} loadingText="充值中…">
              确认充值
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* 记录弹窗 */}
      <Dialog open={!!logsTarget} onClose={() => setLogsTarget(null)} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>充值 / 消费记录</DialogTitle>
        </DialogHeader>
        <DialogContent>
          {logsTarget && <LogsView cardId={logsTarget.id} cardNo={logsTarget.cardNo} />}
        </DialogContent>
      </Dialog>

      {/* 开通会员卡弹窗 */}
      <Dialog open={openCreate} onClose={() => setOpenCreate(false)} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>开通会员卡</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="搜索患者姓名 / 手机 / 病历号"
              value={patientKeyword}
              onChange={(e) => {
                setPatientKeyword(e.target.value);
                setPatientPage(1);
              }}
            />
          </div>
          <div className="rounded-md border border-border max-h-72 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>病历号</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>手机</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patientsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      加载中…
                    </TableCell>
                  </TableRow>
                ) : !patientsQuery.data?.items.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      暂无患者
                    </TableCell>
                  </TableRow>
                ) : (
                  patientsQuery.data.items.map((p) => (
                    <TableRow
                      key={p.id}
                      className={`cursor-pointer ${selectedPatientId === p.id ? 'bg-primary/10' : ''}`}
                      onClick={() => setSelectedPatientId(p.id)}
                    >
                      <TableCell>
                        <input
                          type="radio"
                          checked={selectedPatientId === p.id}
                          onChange={() => setSelectedPatientId(p.id)}
                          className="accent-primary"
                        />
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-muted text-muted-foreground font-mono">{p.code}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.phone}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {patientsQuery.data && patientsQuery.data.total > 10 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>共 {patientsQuery.data.total} 位患者</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={patientPage <= 1}
                  onClick={() => setPatientPage(patientPage - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={patientPage * 10 >= patientsQuery.data.total}
                  onClick={() => setPatientPage(patientPage + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpenCreate(false)}>
              取消
            </Button>
            <LoadingButton
              onClick={handleCreateCard}
              disabled={!selectedPatientId}
              loading={createMut.isPending}
              loadingText="开通中…"
            >
              <CreditCard className="h-4 w-4 mr-1" />
              确认开通
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LogsView({ cardId, cardNo }: { cardId: string; cardNo: string }) {
  const { data, isLoading } = useMemberCardLogs(cardId);
  const fmt = formatYuan;

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        卡号：<span className="font-mono font-medium text-foreground">{cardNo}</span>
      </div>
      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">时间</TableHead>
              <TableHead className="w-24">类型</TableHead>
              <TableHead className="text-right w-28">金额</TableHead>
              <TableHead className="text-right w-28">变动后余额</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={5} />
            ) : !data?.length ? (
              <EmptyState colSpan={5} text="暂无记录" />
            ) : (
              data.map((log: MemberCardLog) => (
                <TableRow key={log.id}>
                  <TableCell className="text-muted-foreground">{formatDateTime(log.createdAt)}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        log.type === 'RECHARGE'
                          ? 'bg-success/10 text-success'
                          : log.type === 'CONSUME'
                          ? 'bg-warning/10 text-warning'
                          : 'bg-muted text-muted-foreground'
                      }
                    >
                      {LOG_TYPE_LABEL[log.type] ?? log.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {log.type === 'CONSUME' ? '-' : '+'}
                    {fmt(log.amount)}
                  </TableCell>
                  <TableCell className="text-right">{fmt(log.balanceAfter)}</TableCell>
                  <TableCell className="text-muted-foreground">{log.remark ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
