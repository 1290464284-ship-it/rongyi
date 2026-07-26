import { useState } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/ui/dialog';
import {
  useOralExaminations,
  useCreateOralExamination,
  useUpdateOralExamination,
  useDeleteOralExamination,
  type OralExamination,
  type CreateOralExaminationDto,
} from '@/lib/api/clinical/oral-examinations';
import { formatDate } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  patientId: string;
}

const EMPTY_FORM: CreateOralExaminationDto = {
  patientId: '',
  examDate: new Date().toISOString().slice(0, 10),
  plaqueIndex: '',
  calculusIndex: '',
  bleedingIndex: '',
  caries: [],
  looseTeeth: [],
  percussionPain: [],
  pulpVitality: [],
  mucosa: '',
  tmj: '',
  remark: '',
};

export default function OralExaminationPanel({ patientId }: Props) {
  const { data: exams = [] } = useOralExaminations(patientId);
  const createMut = useCreateOralExamination();
  const updateMut = useUpdateOralExamination();
  const deleteMut = useDeleteOralExamination();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OralExamination | null>(null);
  const [form, setForm] = useState<CreateOralExaminationDto>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<OralExamination | null>(null);

  // 列表辅助输入
  const [cariesInput, setCariesInput] = useState('');
  const [looseInput, setLooseInput] = useState('');
  const [percussionInput, setPercussionInput] = useState('');
  const [pulpInput, setPulpInput] = useState('');

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, patientId });
    setCariesInput(''); setLooseInput(''); setPercussionInput(''); setPulpInput('');
    setOpen(true);
  };

  const openEdit = (exam: OralExamination) => {
    setEditing(exam);
    setForm({
      patientId: exam.patientId,
      visitId: exam.visitId ?? undefined,
      doctorId: exam.doctorId ?? undefined,
      examDate: exam.examDate.slice(0, 10),
      plaqueIndex: exam.plaqueIndex ?? '',
      calculusIndex: exam.calculusIndex ?? '',
      bleedingIndex: exam.bleedingIndex ?? '',
      caries: exam.caries ?? [],
      looseTeeth: exam.looseTeeth ?? [],
      percussionPain: exam.percussionPain ?? [],
      pulpVitality: exam.pulpVitality ?? [],
      mucosa: exam.mucosa ?? '',
      tmj: exam.tmj ?? '',
      remark: exam.remark ?? '',
    });
    setCariesInput(''); setLooseInput(''); setPercussionInput(''); setPulpInput('');
    setOpen(true);
  };

  const addToList = (key: 'caries' | 'looseTeeth' | 'percussionPain' | 'pulpVitality', value: string, resetFn: () => void) => {
    const v = value.trim();
    if (!v) return;
    if ((form[key] as string[]).includes(v)) { toast.error('已存在'); return; }
    setForm((f) => ({ ...f, [key]: [...(f[key] as string[]), v] }));
    resetFn();
  };

  const removeFromList = (key: 'caries' | 'looseTeeth' | 'percussionPain' | 'pulpVitality', idx: number) => {
    setForm((f) => ({ ...f, [key]: (f[key] as string[]).filter((_, i) => i !== idx) }));
  };

  const submit = async () => {
    if (!form.examDate) { toast.error('请选择检查日期'); return; }
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: form });
        toast.success('修改成功');
      } else {
        await createMut.mutateAsync({ ...form, patientId });
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">口腔检查记录</h3>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增检查</Button>
      </div>

      {exams.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 text-sm">暂无口腔检查记录</div>
      ) : (
        <div className="space-y-3">
          {exams.map((exam) => (
            <div key={exam.id} className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">检查日期：{formatDate(exam.examDate)}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(exam)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(exam)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {exam.plaqueIndex && <div><span className="text-muted-foreground">菌斑指数：</span>{exam.plaqueIndex}</div>}
                {exam.calculusIndex && <div><span className="text-muted-foreground">牙结石：</span>{exam.calculusIndex}</div>}
                {exam.bleedingIndex && <div><span className="text-muted-foreground">出血指数：</span>{exam.bleedingIndex}</div>}
                {exam.mucosa && <div><span className="text-muted-foreground">黏膜：</span>{exam.mucosa}</div>}
                {exam.tmj && <div><span className="text-muted-foreground">颞下颌关节：</span>{exam.tmj}</div>}
              </div>
              {(exam.caries?.length ?? 0) > 0 && (
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">龋齿：</span>
                  <div className="inline-flex flex-wrap gap-1 ml-2">
                    {(exam.caries ?? []).map((c: string) => <Badge key={c} className="bg-warning/10 text-warning">{c}</Badge>)}
                  </div>
                </div>
              )}
              {(exam.looseTeeth?.length ?? 0) > 0 && (
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">松动牙：</span>
                  <div className="inline-flex flex-wrap gap-1 ml-2">
                    {(exam.looseTeeth ?? []).map((c: string) => <Badge key={c} className="bg-destructive/10 text-destructive">{c}</Badge>)}
                  </div>
                </div>
              )}
              {(exam.percussionPain?.length ?? 0) > 0 && (
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">叩痛：</span>
                  <div className="inline-flex flex-wrap gap-1 ml-2">
                    {(exam.percussionPain ?? []).map((c: string) => <Badge key={c} className="bg-destructive/10 text-destructive">{c}</Badge>)}
                  </div>
                </div>
              )}
              {(exam.pulpVitality?.length ?? 0) > 0 && (
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">牙髓活力：</span>
                  <div className="inline-flex flex-wrap gap-1 ml-2">
                    {(exam.pulpVitality ?? []).map((c: string) => <Badge key={c} className="bg-info/10 text-info">{c}</Badge>)}
                  </div>
                </div>
              )}
              {exam.remark && <div className="mt-2 text-sm"><span className="text-muted-foreground">备注：</span>{exam.remark}</div>}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? '编辑口腔检查' : '新增口腔检查'}</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="oral-exam-date">检查日期 *</Label>
                <Input id="oral-exam-date" type="date" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="oral-plaque-index">菌斑指数</Label>
                <Input id="oral-plaque-index" value={form.plaqueIndex} onChange={(e) => setForm({ ...form, plaqueIndex: e.target.value })} placeholder="如：1级" />
              </div>
              <div>
                <Label htmlFor="oral-calculus-index">牙结石</Label>
                <Input id="oral-calculus-index" value={form.calculusIndex} onChange={(e) => setForm({ ...form, calculusIndex: e.target.value })} placeholder="如：轻度" />
              </div>
              <div>
                <Label htmlFor="oral-bleeding-index">出血指数</Label>
                <Input id="oral-bleeding-index" value={form.bleedingIndex} onChange={(e) => setForm({ ...form, bleedingIndex: e.target.value })} placeholder="如：2级" />
              </div>
            </div>

            {/* 龋齿 */}
            <ListInput label="龋齿（牙位）" placeholder="如：16, 26" value={cariesInput} onChange={setCariesInput} onAdd={() => addToList('caries', cariesInput, () => setCariesInput(''))} items={form.caries ?? []} onRemove={(i) => removeFromList('caries', i)} color="bg-warning/10 text-warning" />

            {/* 松动牙 */}
            <ListInput label="松动牙" placeholder="如：21(II度)" value={looseInput} onChange={setLooseInput} onAdd={() => addToList('looseTeeth', looseInput, () => setLooseInput(''))} items={form.looseTeeth ?? []} onRemove={(i) => removeFromList('looseTeeth', i)} color="bg-destructive/10 text-destructive" />

            {/* 叩痛 */}
            <ListInput label="叩痛" placeholder="如：16(+)" value={percussionInput} onChange={setPercussionInput} onAdd={() => addToList('percussionPain', percussionInput, () => setPercussionInput(''))} items={form.percussionPain ?? []} onRemove={(i) => removeFromList('percussionPain', i)} color="bg-destructive/10 text-destructive" />

            {/* 牙髓活力 */}
            <ListInput label="牙髓活力" placeholder="如：16(正常)" value={pulpInput} onChange={setPulpInput} onAdd={() => addToList('pulpVitality', pulpInput, () => setPulpInput(''))} items={form.pulpVitality ?? []} onRemove={(i) => removeFromList('pulpVitality', i)} color="bg-info/10 text-info" />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="oral-mucosa">黏膜情况</Label>
                <Input id="oral-mucosa" value={form.mucosa} onChange={(e) => setForm({ ...form, mucosa: e.target.value })} placeholder="如：正常" />
              </div>
              <div>
                <Label htmlFor="oral-tmj">颞下颌关节</Label>
                <Input id="oral-tmj" value={form.tmj} onChange={(e) => setForm({ ...form, tmj: e.target.value })} placeholder="如：正常" />
              </div>
            </div>
            <div>
              <Label htmlFor="oral-remark">备注</Label>
              <Textarea id="oral-remark" rows={2} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
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
          <p className="text-sm">确定删除该口腔检查记录吗？此操作不可撤销。</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMut.isPending}>删除</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ListInput({ label, placeholder, value, onChange, onAdd, items, onRemove, color }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void; onAdd: () => void;
  items: string[]; onRemove: (i: number) => void; color: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }} />
        <Button type="button" size="sm" onClick={onAdd} aria-label="添加"><Plus className="h-4 w-4" /></Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {items.map((it, i) => (
            <button key={i} type="button" onClick={() => onRemove(i)} aria-label={`移除${it}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${color}`}>
              {it} <span className="text-xs opacity-60">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
