import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
import { Badge } from '@/components/ui/badge';
import { usePatients } from '@/lib/patients';
import { debounce } from '@/lib/utils';

interface PatientSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (patient: { id: string; name: string; code: string; phone: string }) => void;
  title?: string;
}

export function PatientSelector({ open, onClose, onSelect, title = '选择患者' }: PatientSelectorProps) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  useEffect(() => {
    const debounceFn = debounce(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 300);
    debounceFn();
    return () => debounceFn.cancel();
  }, [keyword]);

  const { data, isLoading } = usePatients(debouncedKeyword, page, 20);

  const handleSelect = (patient: any) => {
    onSelect({ id: patient.id, name: patient.name, code: patient.code, phone: patient.phone });
    onClose();
  };

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  useEffect(() => {
    if (open) {
      setKeyword('');
      setDebouncedKeyword('');
      setPage(1);
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索患者姓名 / 手机 / 病历号"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            autoFocus
          />
        </div>

        <div className="rounded-md border border-border max-h-80 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">病历号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead className="w-32">手机</TableHead>
                <TableHead className="w-24">性别</TableHead>
                <TableHead className="w-24">年龄</TableHead>
                <TableHead className="w-20">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableLoading colSpan={6} />
              ) : !data?.items.length ? (
                <EmptyState colSpan={6} text={debouncedKeyword ? '未找到匹配的患者' : '请输入关键词搜索患者'} />
              ) : (
                data.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-primary/5">
                    <TableCell>
                      <Badge className="bg-muted text-muted-foreground font-mono">{p.code}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.phone}</TableCell>
                    <TableCell>
                      {p.gender === 'MALE' ? '男' : p.gender === 'FEMALE' ? '女' : '未知'}
                    </TableCell>
                    <TableCell>
                      {p.birthDate ? (
                        Math.floor((Date.now() - new Date(p.birthDate).getTime()) / (365 * 24 * 60 * 60 * 1000))
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => handleSelect(p)}>
                        选择
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>第 {page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}