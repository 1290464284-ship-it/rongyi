import { useState, useMemo } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import {
  usePeriodontalRecords,
  useCreatePeriodontalRecord,
  useUpdatePeriodontalRecord,
  useDeletePeriodontalRecord,
  type PeriodontalRecord,
} from '@/lib/api/clinical/periodontal-records';
import { formatDate } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  patientId: string;
}

// FDI牙位编号（用于牙周检查）
const TEETH_NUMBERS = [
  // 上颌
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
  // 下颌
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];

// 牙周检查6个位点
const SITES = ['颊侧近中', '颊侧中央', '颊侧远中', '舌侧近中', '舌侧中央', '舌侧远中'] as const;
type SiteKey = 'buccalMeso' | 'buccalMid' | 'buccalDist' | 'lingualMeso' | 'lingualMid' | 'lingualDist';
const SITE_KEYS: SiteKey[] = ['buccalMeso', 'buccalMid', 'buccalDist', 'lingualMeso', 'lingualMid', 'lingualDist'];

interface ToothData {
  [tooth: number]: Partial<Record<SiteKey, number>>;
}

const _buildEmptyData = (): { teeth: ToothData; general: { bleedingIndex: string; plaqueIndex: string; furcation: string; mobility: string } } => ({ teeth: {}, general: { bleedingIndex: '', plaqueIndex: '', furcation: '', mobility: '' } });

export default function PeriodontalRecordPanel({ patientId }: Props) {
  const { data: records = [] } = usePeriodontalRecords(patientId);
  const createMut = useCreatePeriodontalRecord();
  const updateMut = useUpdatePeriodontalRecord();
  const deleteMut = useDeletePeriodontalRecord();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PeriodontalRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PeriodontalRecord | null>(null);
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10));
  const [remark, setRemark] = useState('');
  const [teethData, setTeethData] = useState<ToothData>({});
  const [general, setGeneral] = useState({ bleedingIndex: '', plaqueIndex: '', furcation: '', mobility: '' });

  const resetForm = () => {
    setExamDate(new Date().toISOString().slice(0, 10));
    setRemark('');
    setTeethData({});
    setGeneral({ bleedingIndex: '', plaqueIndex: '', furcation: '', mobility: '' });
  };

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setOpen(true);
  };

  const openEdit = (rec: PeriodontalRecord) => {
    setEditing(rec);
    setExamDate(rec.examDate.slice(0, 10));
    setRemark(rec.remark ?? '');
    const d = rec.data || {};
    setTeethData(d.teeth || {});
    setGeneral({
      bleedingIndex: (d.general?.bleedingIndex ?? ''),
      plaqueIndex: (d.general?.plaqueIndex ?? ''),
      furcation: (d.general?.furcation ?? ''),
      mobility: (d.general?.mobility ?? ''),
    });
    setOpen(true);
  };

  const updateSite = (tooth: number, siteIdx: number, value: string) => {
    const v = value === '' ? undefined : Math.max(0, Math.min(99, Number(value)));
    setTeethData((prev) => {
      const next = { ...prev };
      if (!next[tooth]) next[tooth] = {};
      const key = SITE_KEYS[siteIdx];
      if (v === undefined) delete next[tooth][key];
      else next[tooth][key] = v;
      return next;
    });
  };

  const submit = async () => {
    if (!examDate) { toast.error('请选择检查日期'); return; }
    const data = { teeth: teethData, general };
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: { examDate, data, remark } });
        toast.success('修改成功');
      } else {
        await createMut.mutateAsync({ patientId, examDate, data, remark });
        toast.success('创建成功');
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      toast.success('删除成功');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const _hasToothData = useMemo(() => Object.keys(teethData).length > 0, [teethData]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">牙周检查表</h3>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增检查</Button>
      </div>

      {records.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 text-sm">暂无牙周检查记录</div>
      ) : (
        <div className="space-y-3">
          {records.map((rec) => (
            <div key={rec.id} className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium">检查日期：{formatDate(rec.examDate)}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(rec)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(rec)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </div>
              {rec.data?.general && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-2">
                  {rec.data.general.bleedingIndex && <div><span className="text-muted-foreground">出血指数：</span>{rec.data.general.bleedingIndex}</div>}
                  {rec.data.general.plaqueIndex && <div><span className="text-muted-foreground">菌斑指数：</span>{rec.data.general.plaqueIndex}</div>}
                  {rec.data.general.furcation && <div><span className="text-muted-foreground">根分叉：</span>{rec.data.general.furcation}</div>}
                  {rec.data.general.mobility && <div><span className="text-muted-foreground">松动度：</span>{rec.data.general.mobility}</div>}
                </div>
              )}
              {rec.data?.teeth && Object.keys(rec.data.teeth).length > 0 && (
                <div className="text-sm text-muted-foreground">已记录 {Object.keys(rec.data.teeth).length} 颗牙的6点位探诊数据</div>
              )}
              {rec.remark && <div className="mt-2 text-sm"><span className="text-muted-foreground">备注：</span>{rec.remark}</div>}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} className="max-w-6xl">
        <DialogHeader><DialogTitle>{editing ? '编辑牙周检查表' : '新增牙周检查表'}</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div>
                <Label htmlFor="perio-exam-date">检查日期 *</Label>
                <Input id="perio-exam-date" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} className="w-40" />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label htmlFor="perio-bleeding-index">出血指数</Label>
                <Input id="perio-bleeding-index" value={general.bleedingIndex} onChange={(e) => setGeneral({ ...general, bleedingIndex: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="perio-plaque-index">菌斑指数</Label>
                <Input id="perio-plaque-index" value={general.plaqueIndex} onChange={(e) => setGeneral({ ...general, plaqueIndex: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="perio-furcation">根分叉</Label>
                <Input id="perio-furcation" value={general.furcation} onChange={(e) => setGeneral({ ...general, furcation: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="perio-mobility">松动度</Label>
                <Input id="perio-mobility" value={general.mobility} onChange={(e) => setGeneral({ ...general, mobility: e.target.value })} />
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/50">
                    <tr>
                      <th className="border-b border-border px-2 py-2 text-left">牙位</th>
                      {SITES.map((s) => <th key={s} className="border-b border-border px-2 py-2 text-center">{s}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {TEETH_NUMBERS.map((tooth, idx) => {
                      // 在8和9之间，以及24和25之间插入分隔行（区分象限）
                      const showDivider = idx === 8 || idx === 24;
                      return (
                        <>
                          {showDivider && (
                            <tr key={`div-${tooth}`}><td colSpan={7} className="border-b border-border bg-muted/20 h-1"></td></tr>
                          )}
                          <tr key={tooth} className="hover:bg-muted/30">
                            <td className="border-b border-border px-2 py-1.5 font-medium">{tooth}</td>
                            {SITE_KEYS.map((_, siteIdx) => (
                              <td key={siteIdx} className="border-b border-border px-1 py-1 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={99}
                                  value={teethData[tooth]?.[SITE_KEYS[siteIdx]] ?? ''}
                                  onChange={(e) => updateSite(tooth, siteIdx, e.target.value)}
                                  className="w-12 text-center border border-border rounded px-1 py-0.5 focus:outline-none focus:border-primary"
                                />
                              </td>
                            ))}
                          </tr>
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">填写探诊深度（mm），留空表示未检查。共 {TEETH_NUMBERS.length} 颗牙，每颗6个位点。</p>

            <div>
              <Label htmlFor="perio-remark">备注</Label>
              <Textarea id="perio-remark" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={submit} disabled={createMut.isPending || updateMut.isPending}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} className="max-w-md">
        <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
        <DialogContent>
          <p className="text-sm">确定删除该牙周检查记录吗？此操作不可撤销。</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMut.isPending}>删除</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
