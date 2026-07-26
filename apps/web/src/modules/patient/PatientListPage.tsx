import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import { TableLoading, EmptyState } from '@/components/ui/loading';
import { usePatients, PATIENT_SOURCE_LABEL, PATIENT_SOURCE_COLOR, type Patient } from '@/lib/api/patients/patients';
import PatientForm from './PatientForm';
import { formatDate, debounce } from '@/lib/utils';

const genderText = (g: string) => ({ MALE: '男', FEMALE: '女', UNKNOWN: '未知' } as Record<string, string>)[g] ?? g;

const ROW_HEIGHT = 48;

interface VirtualPatientRowProps {
  patient: Patient;
  onClick: () => void;
  index: number;
  measureRef: (el: Element | null) => void;
  startY: number;
}

const VirtualPatientRow = memo(({ patient, onClick, index, measureRef, startY }: VirtualPatientRowProps) => {
  return (
    <tr
      key={patient.id}
      ref={measureRef}
      data-index={index}
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${startY}px)`,
        display: 'table',
        tableLayout: 'fixed',
        height: ROW_HEIGHT,
      }}
    >
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        <Badge className="bg-muted text-muted-foreground font-mono">{patient.code}</Badge>
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))', fontWeight: 500 }}>
        {patient.name}
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        {genderText(patient.gender)}
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        {patient.phone}
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        <div className="flex flex-wrap gap-1">
          {(patient.tags ?? []).slice(0, 3).map((t) => (
            <Badge key={t} className="bg-info/10 text-info">{t}</Badge>
          ))}
          {(patient.tags ?? []).length > 3 && (
            <Badge className="bg-muted text-muted-foreground">+{patient.tags.length - 3}</Badge>
          )}
        </div>
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))' }}>
        <Badge className={PATIENT_SOURCE_COLOR[patient.source] ?? 'bg-muted text-muted-foreground'}>
          {PATIENT_SOURCE_LABEL[patient.source] ?? patient.source}
        </Badge>
      </td>
      <td style={{ padding: '0 1rem', borderBottom: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
        {formatDate(patient.createdAt)}
      </td>
      <td
        style={{
          padding: '0 1rem',
          borderBottom: '1px solid hsl(var(--border))',
          color: 'hsl(var(--muted-foreground))',
          maxWidth: '200px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={patient.remark ?? ''}
      >
        {patient.remark ?? '-'}
      </td>
    </tr>
  );
});

VirtualPatientRow.displayName = 'VirtualPatientRow';

export default function PatientListPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // 从 URL 参数读取默认值
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [debouncedKeyword, setDebouncedKeyword] = useState(searchParams.get('keyword') || '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const [open, setOpen] = useState(false);
  const { data, isLoading } = usePatients(debouncedKeyword, page);
  const parentRef = useRef<HTMLDivElement>(null);

  const items = data?.items ?? [];

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // 关键词变化时更新 URL
  useEffect(() => {
    const debounceFn = debounce(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
      // 更新 URL 参数
      const params = new URLSearchParams(searchParams);
      if (keyword) {
        params.set('keyword', keyword);
      } else {
        params.delete('keyword');
      }
      params.set('page', '1');
      setSearchParams(params, { replace: true });
    }, 300);
    debounceFn();
    return () => debounceFn.cancel();
  }, [keyword]);

  // 页码变化时更新 URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (page > 1) {
      params.set('page', String(page));
    } else {
      params.delete('page');
    }
    setSearchParams(params, { replace: true });
  }, [page]);

  const handleRowClick = useCallback((patientId: string) => {
    nav(`/patients/${patientId}`);
  }, [nav]);

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

      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <div ref={parentRef} className="overflow-auto" style={{ height: '600px' }}>
          <Table style={{ display: 'table', width: '100%', tableLayout: 'fixed' }}>
            <TableHeader style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white' }}>
              <TableRow>
                <TableHead style={{ width: '100px' }}>病历号</TableHead>
                <TableHead style={{ width: '100px' }}>姓名</TableHead>
                <TableHead style={{ width: '60px' }}>性别</TableHead>
                <TableHead style={{ width: '120px' }}>手机</TableHead>
                <TableHead style={{ width: '150px' }}>标签</TableHead>
                <TableHead style={{ width: '100px' }}>来源</TableHead>
                <TableHead style={{ width: '100px' }}>建档日期</TableHead>
                <TableHead>备注</TableHead>
              </TableRow>
            </TableHeader>
            <tbody style={{ display: 'block', height: rowVirtualizer.getTotalSize() }}>
              {isLoading ? (
                <TableLoading colSpan={8} />
              ) : !items.length ? (
                <EmptyState colSpan={8} text="暂无患者" />
              ) : (
                rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const patient = items[virtualRow.index];
                  return (
                    <VirtualPatientRow
                      key={patient.id}
                      patient={patient}
                      index={virtualRow.index}
                      measureRef={(el) => {
                        if (el) rowVirtualizer.measureElement(el);
                      }}
                      startY={virtualRow.start}
                      onClick={() => handleRowClick(patient.id)}
                    />
                  );
                })
              )}
            </tbody>
          </Table>
        </div>
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
