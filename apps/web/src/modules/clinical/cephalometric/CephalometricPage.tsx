/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState, useMemo, useCallback } from 'react';
import {
  Ruler, Save, Printer, PlusCircle, ChevronRight, Search, BarChart3,
  ArrowRightLeft, Calendar, User as UserIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CephalometricCanvas, useLandmarkEditor } from './CephalometricCanvas';
import { MetricsTable } from './MetricsTable';
import { CompareView } from './CompareView';
import { PatientSelector } from '@/components/patient/PatientSelector';
import {
  useCreateLandmarkSet,
  useUpdateLandmarkSet,
  useLandmarkSets,
  useAnalyzeLandmarkSet,
  ANALYSIS_METHODS,
  METHOD_LABEL,
  type LandmarkSet,
  type AnalysisMethod,
  type Landmark,
  type CreateLandmarkSetDto,
  type AnalyzeResult,
} from '@/lib/api/clinical/cephalometric';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function CephalometricPage() {
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientOpen, setPatientOpen] = useState(false);
  const [selectedSetId, setSelectedSetId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<'ALL' | AnalysisMethod | 'compare'>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [newSetMethod, setNewSetMethod] = useState<AnalysisMethod>('Steiner');
  const [lastAnalysis, setLastAnalysis] = useState<AnalyzeResult | null>(null);

  const editor = useLandmarkEditor();

  const { data: sets = [], refetch: refetchSets } = useLandmarkSets({ patientId: patientId || undefined });
  const createSet = useCreateLandmarkSet();
  const updateSet = useUpdateLandmarkSet();
  const analyze = useAnalyzeLandmarkSet();

  const metrics = useMemo(() => lastAnalysis?.metrics ?? [], [lastAnalysis]);

  const handleCreate = useCallback(() => {
    if (!patientId || !newSetName.trim()) return;
    const body: CreateLandmarkSetDto = {
      patientId,
      name: newSetName.trim(),
      analysisMethod: newSetMethod,
      landmarks: editor.landmarks,
    };
    createSet.mutate(body, {
      onSuccess: (set) => {
        setSelectedSetId(set.id);
        editor.load(set.landmarks);
        setCreateOpen(false);
        setNewSetName('');
        refetchSets();
      },
    });
  }, [patientId, newSetName, newSetMethod, editor, createSet, refetchSets]);

  const handleLoadSet = useCallback((set: LandmarkSet) => {
    setSelectedSetId(set.id);
    editor.load(set.landmarks);
    setLastAnalysis(null);
  }, [editor]);

  const handleSave = useCallback((landmarks: Landmark[]) => {
    if (!patientId) {
      alert('请先选择患者');
      return;
    }
    if (!selectedSetId) {
      setCreateOpen(true);
      return;
    }
    updateSet.mutate({
      id: selectedSetId,
      data: { landmarks },
    });
  }, [patientId, selectedSetId, updateSet]);

  const handleAnalyze = useCallback(async () => {
    if (!selectedSetId) {
      alert('请先保存标志点');
      return;
    }
    const missing = editor.getMissingRequired();
    if (missing.length > 0) {
      alert(`缺少必填点：${missing.join(', ')}`);
      return;
    }
    if (selectedSetId) {
      updateSet.mutate({ id: selectedSetId, data: { landmarks: editor.landmarks } }, {
        onSuccess: async () => {
          analyze.mutate(
            { id: selectedSetId!, method: activeTab === 'compare' || activeTab === 'ALL' ? undefined : activeTab },
            { onSuccess: (res) => setLastAnalysis(res) }
          );
        },
      });
    }
  }, [selectedSetId, editor, activeTab, analyze, updateSet]);

  const handlePrint = useCallback(() => {
    if (!lastAnalysis) {
      alert('请先执行分析');
      return;
    }
    const url = `#/print-preview?type=cephalometric&id=${lastAnalysis.id}`;
    window.open(url, '_blank');
  }, [lastAnalysis]);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col p-4 gap-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <nav className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <span>诊疗管理</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-foreground font-medium">头影测量</span>
          </nav>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Ruler className="w-6 h-6 text-primary" />头影测量分析
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            放置 30 个头影标志点，支持 Steiner/Downs/Tweed/McNamara 四种分析方法
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={!lastAnalysis}>
            <Printer className="w-4 h-4 mr-2" />打印报告
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => setActiveTab(activeTab === 'compare' ? 'ALL' : 'compare')}>
            <ArrowRightLeft className="w-4 h-4 mr-2" />历史对比
          </Button>
          <Button size="sm" onClick={() => handleSave(editor.landmarks)} disabled={createSet.isPending || updateSet.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {createSet.isPending || updateSet.isPending ? '保存中...' : '保存'}
          </Button>
          <Button size="sm" onClick={handleAnalyze} disabled={analyze.isPending}>
            <BarChart3 className="w-4 h-4 mr-2" />
            {analyze.isPending ? '分析中...' : '执行分析'}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[240px_1fr_360px] gap-4">
        <Card className="overflow-hidden flex flex-col">
          <CardHeader className="p-3 pb-2 space-y-3">
            <div>
              <Label className="text-xs mb-1 block">患者选择</Label>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-9 px-3 rounded-md border border-border bg-muted/30 flex items-center gap-2 text-sm truncate">
                  <UserIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  {patientName || patientId ? (
                    <span className="truncate">{patientName || patientId}</span>
                  ) : (
                    <span className="text-muted-foreground">未选择患者</span>
                  )}
                </div>
                <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => setPatientOpen(true)}>
                  <Search className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <Button size="sm" className="w-full" onClick={() => { if (!patientId) { alert('请先选择患者'); return; } setCreateOpen(true); }}>
              <PlusCircle className="w-4 h-4 mr-1" />新建测量
            </Button>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Search className="w-3 h-3 text-muted-foreground" />
                <Input placeholder="搜索记录..." size={1} className="h-7 text-xs" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto">
            {sets.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <Ruler className="w-8 h-8 mx-auto mb-2 opacity-30" />
                {patientId ? '暂无历史记录' : '请先选择患者'}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {sets.map((set: LandmarkSet) => (
                  <li key={set.id}
                    onClick={() => handleLoadSet(set)}
                    className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${set.id === selectedSetId ? 'bg-primary/10' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{set.name}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(set.createdAt), 'MM-dd HH:mm', { locale: zhCN })}
                        </div>
                        {set.analysisMethod && (
                          <Badge variant="outline" className="mt-1 text-[10px] h-4 px-1">
                            {set.analysisMethod}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground text-right font-mono">
                        {set.landmarks.filter((l) => l.x !== null).length}/30
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden flex flex-col p-0">
          <CephalometricCanvas
            editor={editor}
            onSave={handleSave}
            onAnalyze={handleAnalyze}
            saving={updateSet.isPending || createSet.isPending}
            analyzing={analyze.isPending}
          />
        </Card>

        <Card className="overflow-hidden flex flex-col min-h-0">
          <CardContent className="flex-1 min-h-0 flex flex-col p-0">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex flex-col h-full">
              <div className="border-b border-border px-2 pt-2 overflow-x-auto">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="ALL" className="text-xs">全部</TabsTrigger>
                  {ANALYSIS_METHODS.map((m) => (
                    <TabsTrigger key={m} value={m} className="text-xs">{m}</TabsTrigger>
                  ))}
                  <TabsTrigger value="compare" className="text-xs">对比</TabsTrigger>
                </TabsList>
              </div>
              <div className="flex-1 overflow-auto p-3 min-h-0">
                <TabsContent value="ALL" className="mt-0 h-full">
                  <MetricsTable metrics={metrics} methodFilter="ALL" />
                </TabsContent>
                {ANALYSIS_METHODS.map((m) => (
                  <TabsContent key={m} value={m} className="mt-0 h-full">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-sm">{METHOD_LABEL[m]}</h3>
                        <p className="text-xs text-muted-foreground">仅显示 {m} 分析法指标</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={handleAnalyze} disabled={analyze.isPending}>
                        <BarChart3 className="w-3 h-3 mr-1" />分析
                      </Button>
                    </div>
                    <MetricsTable metrics={metrics} methodFilter={m} />
                  </TabsContent>
                ))}
                <TabsContent value="compare" className="mt-0 h-full">
                  <CompareView patientId={patientId || undefined} />
                </TabsContent>
              </div>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建头影测量记录</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 p-6">
            <div>
              <Label className="text-xs mb-1 block">患者</Label>
              <div className="h-9 px-3 rounded-md border border-border bg-muted/30 flex items-center gap-2 text-sm">
                <UserIcon className="w-4 h-4 text-muted-foreground" />
                {patientName || patientId || <span className="text-muted-foreground">未选择</span>}
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">记录名称</Label>
              <Input placeholder="例如：初诊、矫治前 T1..."
                value={newSetName} onChange={(e) => setNewSetName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">默认分析方法</Label>
              <Select value={newSetMethod} onChange={(e) => setNewSetMethod(e.target.value as AnalysisMethod)}>
                {ANALYSIS_METHODS.map((m) => (
                  <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={!patientId || !newSetName.trim() || createSet.isPending}>
                {createSet.isPending ? '创建中...' : '创建并打开'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PatientSelector
        open={patientOpen}
        onClose={() => setPatientOpen(false)}
        onSelect={(p) => {
          setPatientId(p.id);
          setPatientName(p.name);
          setSelectedSetId(undefined);
          setLastAnalysis(null);
        }}
      />
    </div>
  );
}
