import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { usePatients, PATIENT_SOURCE_LABEL, PATIENT_SOURCE_COLOR, type Patient } from '@/lib/patients';
import PatientForm from './PatientForm';
import { formatDate, debounce } from '@/lib/utils';

export default function PatientListPage() {
  const nav = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data, isLoading } = usePatients(debouncedKeyword, page);

  useEffect(() => {
    const debounceFn = debounce(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 300);
    debounceFn();
    return () => debounceFn.cancel();
  }, [keyword]);

  const genderText = (g: string) => ({ MALE: '男', FEMALE: '女', UNKNOWN: '未知' } as Record<string, string>)[g] ?? g;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">患者管理</h1>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新建患者</Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="姓名 / 手机 / 病历号" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">共 {data?.total ?? 0} 位患者</span>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>病历号</TableHead>
              <TableHead>姓名</TableHead>
              <TableHead>性别</TableHead>
              <TableHead>手机</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>建档日期</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoading colSpan={8} />
            ) : !data?.items.length ? (
              <EmptyState colSpan={8} text="暂无患者" />
            ) : data.items.map((p: Patient) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => nav(`/patients/${p.id}`)}>
                <TableCell><Badge className="bg-muted text-muted-foreground font-mono">{p.code}</Badge></TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{genderText(p.gender)}</TableCell>
                <TableCell>{p.phone}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(p.tags ?? []).slice(0, 3).map((t) => (
                      <Badge key={t} className="bg-info/10 text-info">{t}</Badge>
                    ))}
                    {(p.tags ?? []).length > 3 && (
                      <Badge className="bg-muted text-muted-foreground">+{p.tags.length - 3}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className={PATIENT_SOURCE_COLOR[p.source] ?? 'bg-muted text-muted-foreground'}>
                    {PATIENT_SOURCE_LABEL[p.source] ?? p.source}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate" title={p.remark ?? ''}>{p.remark ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {data.total} 条</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} className="max-w-2xl">
        <DialogHeader><DialogTitle>新建患者</DialogTitle></DialogHeader>
        <DialogContent>
          <PatientForm onClose={() => setOpen(false)} onSaved={(p) => nav(`/patients/${p.id}`)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
