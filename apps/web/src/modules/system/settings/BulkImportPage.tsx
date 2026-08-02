/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  ChevronDown,
  RefreshCw,
  Users,
  Pill,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingButton } from '@/components/ui/loading';
import { cn } from '@/lib/utils';
import { parseCSV, toObjects, detectDelimiter } from '@/lib/utils/csv-parser';
import {
  getTemplate,
  runImport,
  type BulkImportType,
  type TemplateColumn,
  type ImportSummary,
  type RowError,
} from '@/lib/api/system/bulk-import';

type TabKey = BulkImportType;

const TAB_CONFIG: Record<TabKey, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  patient: { label: '患者导入', icon: Users },
  drug: { label: '药品目录导入', icon: Pill },
  inventory: { label: '库存导入', icon: Package },
};

const STEPS = [
  { num: 1, label: '下载模板' },
  { num: 2, label: '上传文件' },
  { num: 3, label: '预览校验' },
  { num: 4, label: '确认导入' },
];

const ACCEPTED_EXT = ['.csv', '.tsv', '.txt'];
const REJECTED_EXT = ['.xlsx', '.xls', '.xlsm'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildCSVFromTemplate(columns: TemplateColumn[]): string {
  const header = columns.map((c) => c.key).join(',');
  const example = columns
    .map((c) => {
      const val = c.example ?? '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    })
    .join(',');
  return `${header}\r\n${example}\r\n`;
}

function triggerDownload(filename: string, content: string, mime = 'text/csv;charset=utf-8;') {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface ParsedData {
  fileName: string;
  fileSize: number;
  header: string[];
  rows: string[][];
  objects: Record<string, string>[];
}

export function BulkImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-5xl">
      <DialogHeader>
        <DialogTitle>批量数据导入</DialogTitle>
      </DialogHeader>
      <DialogContent className="p-0">
        <BulkImportContent onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function BulkImportContent({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<TabKey>('patient');
  const [step, setStep] = useState(1);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateColumns, setTemplateColumns] = useState<TemplateColumn[] | null>(null);

  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileAlert, setFileAlert] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const [dryRun, setDryRun] = useState(true);
  const [strict, setStrict] = useState(true);
  const [autoCreateDrug, setAutoCreateDrug] = useState(false);

  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    setParsedData(null);
    setParseError(null);
    setFileAlert(null);
    setSummary(null);
    setStep(1);
  }, [tab]);

  const handleDownloadTemplate = async () => {
    setTemplateLoading(true);
    try {
      const resp = await getTemplate(tab);
      setTemplateColumns(resp.columns);
      const csv = buildCSVFromTemplate(resp.columns);
      triggerDownload(`${tab}-template.csv`, csv);
      toast.success('模板已下载');
      setStep(2);
    } catch (err) {
      toast.error('下载模板失败');
    } finally {
      setTemplateLoading(false);
    }
  };

  const validateAndParseFile = useCallback(
    (file: File) => {
      const name = file.name.toLowerCase();
      const isRejected = REJECTED_EXT.some((ext) => name.endsWith(ext));
      if (isRejected) {
        setFileAlert('请另存为 CSV UTF-8 再上传，不支持直接上传 Excel 文件');
        setParseError(null);
        setParsedData(null);
        return;
      }
      const isAccepted = ACCEPTED_EXT.some((ext) => name.endsWith(ext));
      if (!isAccepted) {
        setFileAlert(`仅支持 ${ACCEPTED_EXT.join(' / ')} 格式文件`);
        setParseError(null);
        setParsedData(null);
        return;
      }
      setFileAlert(null);

      const delimiter = detectDelimiter(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = (e.target?.result as string) ?? '';
          const allRows = parseCSV(text, delimiter);
          if (allRows.length === 0 || (allRows.length === 1 && allRows[0].length === 1 && allRows[0][0] === '')) {
            setParseError('文件为空或格式不正确');
            setParsedData(null);
            return;
          }
          const header = allRows[0].filter((h) => h.trim() !== '');
          const dataRows = allRows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
          const objects = toObjects(header, dataRows);
          setParsedData({
            fileName: file.name,
            fileSize: file.size,
            header,
            rows: dataRows,
            objects,
          });
          setParseError(null);
          setStep(3);
          setSummary(null);
        } catch (err) {
          setParseError('文件解析失败，请检查格式');
          setParsedData(null);
        }
      };
      reader.onerror = () => {
        setParseError('读取文件失败');
        setParsedData(null);
      };
      reader.readAsText(file, 'UTF-8');
    },
    [],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndParseFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndParseFile(file);
  };

  const handleValidate = async () => {
    if (!parsedData) return;
    setValidating(true);
    try {
      const result = await runImport({
        type: tab,
        rows: parsedData.objects as Record<string, unknown>[],
        dryRun: true,
        strict: tab !== 'patient' ? strict : undefined,
        autoCreateDrug: tab === 'inventory' ? autoCreateDrug : undefined,
      });
      setSummary(result);
      if (result.failedCount > 0) {
        toast.warning(`校验完成：${result.failedCount} 条失败`);
      } else {
        toast.success(`校验通过：${result.successCount} 条可导入`);
        setStep(4);
      }
    } catch (err) {
      toast.error('校验失败');
    } finally {
      setValidating(false);
    }
  };

  const handleImport = async () => {
    if (!parsedData) return;
    setImporting(true);
    try {
      const start = performance.now();
      const result = await runImport({
        type: tab,
        rows: parsedData.objects as Record<string, unknown>[],
        dryRun: false,
        strict: tab !== 'patient' ? strict : undefined,
        autoCreateDrug: tab === 'inventory' ? autoCreateDrug : undefined,
      });
      const dur = Math.round(performance.now() - start);
      toast.success(`导入成功 ${result.successCount} 条，耗时 ${dur}ms`);
      setSummary(result);
      setParsedData(null);
      setStep(1);
    } catch (err) {
      toast.error('导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleReset = () => {
    setParsedData(null);
    setParseError(null);
    setFileAlert(null);
    setSummary(null);
    setStep(parsedData ? 2 : 1);
  };

  const showStrictOption = tab === 'drug' || tab === 'inventory';
  const showAutoCreateOption = tab === 'inventory';

  return (
    <div className="flex flex-col">
      <div className="flex border-b border-border px-6 pt-4">
        {(Object.keys(TAB_CONFIG) as TabKey[]).map((key) => {
          const cfg = TAB_CONFIG[key];
          const Icon = cfg.icon;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {cfg.label}
            </button>
          );
        })}
        {onClose && (
          <div className="ml-auto pb-2">
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
              <XCircle className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-6 p-6">
        <aside className="w-48 shrink-0">
          <div className="space-y-2">
            {STEPS.map((s) => (
              <div
                key={s.num}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  step === s.num
                    ? 'bg-primary/10 text-primary font-medium'
                    : step > s.num
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/60',
                )}
              >
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    step === s.num
                      ? 'bg-primary text-primary-foreground'
                      : step > s.num
                        ? 'bg-green-500 text-white'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {step > s.num ? <CheckCircle2 className="h-4 w-4" /> : s.num}
                </div>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-md border border-border p-3 text-xs text-muted-foreground space-y-2">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground mb-1">导入提示</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>请先下载模板填写</li>
                  <li>支持 CSV/TSV UTF-8</li>
                  <li>Excel 请另存为 CSV</li>
                </ul>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 space-y-5 min-w-0">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-medium">Step 1 · 下载导入模板</CardTitle>
                </div>
                <LoadingButton
                  size="sm"
                  onClick={handleDownloadTemplate}
                  loading={templateLoading}
                  loadingText="生成中…"
                  disabled={templateLoading}
                  data-testid="download-template-btn"
                >
                  <Download className="h-4 w-4 mr-1" />
                  下载模板
                </LoadingButton>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              下载{TAB_CONFIG[tab].label}模板文件，按列填写后保存为 CSV UTF-8 格式
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-medium">Step 2 · 上传文件</CardTitle>
                </div>
                {parsedData && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    data-testid="reset-btn"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    重新上传
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                  dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30',
                )}
                data-testid="drop-zone"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={handleFileInput}
                  className="hidden"
                  data-testid="file-input"
                />
                <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm font-medium">
                  拖放文件到此处，或 <span className="text-primary">点击选择文件</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  支持 .csv / .tsv / .txt UTF-8 编码
                </p>
              </div>

              {fileAlert && (
                <div
                  className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                  data-testid="excel-alert"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{fileAlert}</span>
                </div>
              )}

              {parseError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}

              {parsedData && (
                <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-5 w-5 text-primary" />
                    <div>
                      <div className="font-medium">{parsedData.fileName}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatFileSize(parsedData.fileSize)} · {parsedData.rows.length} 行数据 · {parsedData.header.length} 列
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-green-600 text-xs">
                    <CheckCircle2 className="h-4 w-4" />
                    解析成功
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {parsedData && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-medium">Step 3 · 数据预览（前 10 行）</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border overflow-hidden">
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <Table data-testid="preview-table">
                      <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur">
                        <TableRow>
                          <TableHead className="w-16 text-center">#</TableHead>
                          {parsedData.header.map((h) => {
                            const col = templateColumns?.find((c) => c.key === h);
                            const isRequired = col?.required;
                            return (
                              <TableHead key={h} className={cn(isRequired && 'text-primary font-semibold')}>
                                {col?.label ?? h}
                                {isRequired && <span className="text-destructive ml-0.5">*</span>}
                              </TableHead>
                            );
                          })}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsedData.rows.slice(0, 10).map((row, ri) => (
                          <TableRow key={ri}>
                            <TableCell className="text-center text-xs text-muted-foreground">
                              {ri + 1}
                            </TableCell>
                            {parsedData.header.map((h, ci) => (
                              <TableCell key={ci} className="text-xs">
                                {row[ci] || <span className="text-muted-foreground/40">-</span>}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                        {parsedData.rows.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={parsedData.header.length + 1}
                              className="text-center text-muted-foreground py-6"
                            >
                              无数据行
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {parsedData.rows.length > 10 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border bg-muted/20">
                      共 {parsedData.rows.length} 行，仅显示前 10 行
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {parsedData && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">导入选项</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <label
                  className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  data-testid="dry-run-checkbox"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">仅校验不写入（dry run）</div>
                    <div className="text-xs text-green-600 mt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        推荐开启：先校验数据正确性，通过后再正式导入
                      </span>
                    </div>
                  </div>
                </label>

                {showStrictOption && (
                  <label className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={strict}
                      onChange={(e) => setStrict(e.target.checked)}
                      data-testid="strict-checkbox"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {tab === 'drug' ? '药品 SKU 严格模式' : '库存 SKU 严格模式'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        严格校验 {tab === 'drug' ? '药品编码' : '库存 SKU'} 唯一性，关闭则自动去重
                      </div>
                    </div>
                  </label>
                )}

                {showAutoCreateOption && (
                  <label
                    className={cn(
                      'flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors',
                      autoCreateDrug
                        ? 'border-amber-200 bg-amber-50/50 hover:bg-amber-50'
                        : 'border-border hover:bg-muted/30',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={autoCreateDrug}
                      onChange={(e) => setAutoCreateDrug(e.target.checked)}
                      data-testid="auto-create-drug-checkbox"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        自动创建药品
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="text-xs text-amber-700 mt-0.5">
                        <span className="inline-flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          谨慎开启：库存导入时若药品不存在将自动创建，可能产生脏数据
                        </span>
                      </div>
                    </div>
                  </label>
                )}
              </CardContent>
            </Card>
          )}

          {parsedData && (
            <div className="flex items-center justify-end gap-3 pt-1">
              <LoadingButton
                onClick={handleValidate}
                loading={validating}
                loadingText="校验中…"
                disabled={validating || importing}
                data-testid="validate-btn"
              >
                {validating ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                )}
                开始校验
              </LoadingButton>
            </div>
          )}

          {summary && (
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  {summary.failedCount > 0 ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  )}
                  <CardTitle className="text-sm font-medium">
                    {summary.dryRun ? '校验结果' : '导入结果'}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div
                    className={cn(
                      'rounded-lg border p-4 text-center',
                      'border-green-200 bg-green-50',
                    )}
                    data-testid="kpi-success"
                  >
                    <div className="text-2xl font-bold text-green-700">{summary.successCount}</div>
                    <div className="text-xs text-green-700/80 mt-1">成功</div>
                  </div>
                  <div
                    className={cn(
                      'rounded-lg border p-4 text-center',
                      summary.failedCount > 0
                        ? 'border-destructive/30 bg-destructive/5'
                        : 'border-border bg-muted/30',
                    )}
                    data-testid="kpi-failed"
                  >
                    <div
                      className={cn(
                        'text-2xl font-bold',
                        summary.failedCount > 0 ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {summary.failedCount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">失败</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-4 text-center" data-testid="kpi-skipped">
                    <div className="text-2xl font-bold text-muted-foreground">{summary.skippedCount}</div>
                    <div className="text-xs text-muted-foreground mt-1">跳过</div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground text-center">
                  总计 {summary.total} 条记录
                  {summary.durationMs !== undefined && ` · 耗时 ${summary.durationMs}ms`}
                </div>

                {summary.failedCount > 0 && summary.errors.length > 0 && (
                  <div>
                    <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                      失败行详情（前 50 条）
                    </div>
                    <div className="rounded-md border border-border overflow-hidden">
                      <div className="overflow-x-auto max-h-72 overflow-y-auto">
                        <Table data-testid="error-table">
                          <TableHeader className="sticky top-0 bg-destructive/5 backdrop-blur">
                            <TableRow>
                              <TableHead className="w-20">行号</TableHead>
                              <TableHead className="w-32">字段</TableHead>
                              <TableHead className="w-32">错误码</TableHead>
                              <TableHead>错误信息</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {summary.errors.slice(0, 50).map((err: RowError, i: number) => (
                              <TableRow key={i} className="bg-destructive/5 hover:bg-destructive/10">
                                <TableCell className="font-mono text-xs text-destructive">
                                  {err.rowNumber}
                                </TableCell>
                                <TableCell className="text-xs">{err.field ?? '-'}</TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {err.errorCode}
                                </TableCell>
                                <TableCell className="text-xs text-destructive">{err.message}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )}

                {summary.dryRun && summary.failedCount === 0 && (
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <LoadingButton
                      onClick={handleImport}
                      loading={importing}
                      loadingText="导入中…"
                      disabled={importing}
                      data-testid="import-btn"
                    >
                      {importing ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-1" />
                      )}
                      正式导入 {summary.successCount} 条
                    </LoadingButton>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

export default function BulkImportPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">批量数据导入</h1>
        <p className="text-sm text-muted-foreground mt-1">
          批量导入患者、药品目录、库存数据，支持 CSV/TSV 格式
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          <BulkImportContent />
        </CardContent>
      </Card>
    </div>
  );
}

export { BulkImportPage };
