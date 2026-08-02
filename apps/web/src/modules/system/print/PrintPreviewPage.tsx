/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Printer,
  Download,
  RefreshCw,
  FileText,
  X,
  Eye,
  Pill,
  Receipt,
  ClipboardList,
  BarChart3,
  Ruler,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner, PageLoading } from '@/components/ui/loading';
import {
  useTemplates,
  usePreviewTemplate,
  useRenderPrescription,
  useRenderReceipt,
  useRenderTreatmentPlan,
  useRenderClinicReport,
  useRenderCephalometricReport,
  type PrintTemplate,
  type SampleContext,
} from '@/lib/api/system/print';
import { cn } from '@/lib/utils';
import { toastService } from '@/lib/utils/toast-service';

type PrintType =
  | 'prescription'
  | 'receipt'
  | 'treatment'
  | 'clinicReport'
  | 'cephalometric'
  | 'template'
  | null;

type PaperSize = 'A4' | 'A5' | 'RECEIPT';

interface TabItem {
  key: PrintType;
  label: string;
  icon: typeof Pill;
}

const TAB_ITEMS: TabItem[] = [
  { key: 'prescription', label: '处方笺', icon: Pill },
  { key: 'receipt', label: '收费凭证', icon: Receipt },
  { key: 'treatment', label: '治疗计划', icon: ClipboardList },
  { key: 'clinicReport', label: '诊所月报', icon: BarChart3 },
  { key: 'cephalometric', label: '头影报告', icon: Ruler },
  { key: 'template', label: '自定义模板', icon: FileText },
];

const DEFAULT_SAMPLE_CONTEXTS: Record<string, SampleContext> = {
  prescriptionSample: {
    prescriptionSample: {
      patientName: '张三',
      patientAge: 35,
      patientGender: '男',
      diagnosis: '慢性牙周炎',
      medicines: [
        {
          name: '阿莫西林胶囊',
          specification: '0.5g*24粒',
          dosage: '0.5g',
          frequency: '每日3次',
          duration: '7天',
          quantity: 1,
        },
        {
          name: '甲硝唑片',
          specification: '0.2g*100片',
          dosage: '0.4g',
          frequency: '每日2次',
          duration: '7天',
          quantity: 1,
        },
      ],
      doctorName: '李医生',
      date: '2024-08-02',
      clinicName: '瑞益口腔诊所',
    },
  },
  receiptSample: {
    receiptSample: {
      receiptNo: 'SK202408020001',
      patientName: '张三',
      items: [
        { name: '洗牙', price: 200, quantity: 1, subtotal: 200 },
        { name: '补牙', price: 500, quantity: 2, subtotal: 1000 },
      ],
      total: 1200,
      paid: 1200,
      change: 0,
      paymentMethod: '微信支付',
      cashierName: '小王',
      date: '2024-08-02',
      clinicName: '瑞益口腔诊所',
    },
  },
  planSample: {
    planSample: {
      patientName: '张三',
      planName: '正畸治疗方案',
      stages: [
        {
          name: '第一阶段：检查与诊断',
          description: '口腔检查、X光片、取模分析',
          estimatedFee: 1500,
          duration: '1周',
        },
        {
          name: '第二阶段：矫正器安装',
          description: '安装托槽、弓丝',
          estimatedFee: 8000,
          duration: '2周',
        },
        {
          name: '第三阶段：定期复诊调整',
          description: '每月复诊调整',
          estimatedFee: 500,
          duration: '12-18个月',
        },
      ],
      totalFee: 16500,
      doctorName: '李医生',
      date: '2024-08-02',
      clinicName: '瑞益口腔诊所',
    },
  },
  reportSample: {
    reportSample: {
      month: '2024-08',
      revenue: 285600,
      patientCount: 328,
      visitCount: 512,
      topServices: [
        { name: '洗牙', count: 85, revenue: 17000 },
        { name: '补牙', count: 62, revenue: 31000 },
        { name: '正畸', count: 12, revenue: 144000 },
      ],
      doctorStats: [
        { name: '李医生', visitCount: 186, revenue: 125000 },
        { name: '王医生', visitCount: 165, revenue: 98600 },
        { name: '张医生', visitCount: 161, revenue: 62000 },
      ],
      clinicName: '瑞益口腔诊所',
      generatedAt: '2024-08-02 10:00:00',
    },
  },
};

function formatJson(json: unknown): string {
  try {
    return JSON.stringify(json, null, 2);
  } catch {
    return String(json);
  }
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getPaperSizeClass(paperSize: PaperSize): string {
  switch (paperSize) {
    case 'A4':
      return 'a4-preview';
    case 'A5':
      return 'a5-preview';
    case 'RECEIPT':
      return 'receipt-preview';
  }
}

export default function PrintPreviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const queryType = searchParams.get('type') as PrintType;
  const queryId = searchParams.get('id') || '';
  const queryCode = searchParams.get('code') || '';
  const queryMonth = searchParams.get('month') || '';

  const [activeTab, setActiveTab] = useState<PrintType>(queryType);
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedTemplateCode, setSelectedTemplateCode] = useState<string>(queryCode);
  const [sampleContextKey, setSampleContextKey] =
    useState<keyof typeof DEFAULT_SAMPLE_CONTEXTS>('prescriptionSample');
  const [sampleContextText, setSampleContextText] = useState<string>(
    formatJson(DEFAULT_SAMPLE_CONTEXTS.prescriptionSample)
  );
  const [copied, setCopied] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sampleContextTextRef = useRef<string>(sampleContextText);

  useEffect(() => {
    sampleContextTextRef.current = sampleContextText;
  }, [sampleContextText]);

  const { data: templates = [] } = useTemplates();

  const previewTemplate = usePreviewTemplate();
  const renderPrescription = useRenderPrescription();
  const renderReceipt = useRenderReceipt();
  const renderTreatmentPlan = useRenderTreatmentPlan();
  const renderClinicReport = useRenderClinicReport();
  const renderCephalometricReport = useRenderCephalometricReport();

  const updateQueryParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    if (queryType) {
      setActiveTab(queryType);
    }
  }, [queryType]);

  useEffect(() => {
    if (queryCode) {
      setSelectedTemplateCode(queryCode);
    }
  }, [queryCode]);

  const loadPreview = useCallback(async () => {
    if (!activeTab) return;

    setIsLoading(true);
    setError(null);
    setPreviewHtml('');

    try {
      let html = '';

      switch (activeTab) {
        case 'prescription':
          if (queryId) {
            html = await renderPrescription.mutateAsync(queryId);
          }
          break;
        case 'receipt':
          if (queryId) {
            html = await renderReceipt.mutateAsync(queryId);
          }
          break;
        case 'treatment':
          if (queryId) {
            html = await renderTreatmentPlan.mutateAsync(queryId);
          }
          break;
        case 'clinicReport':
          if (queryMonth) {
            html = await renderClinicReport.mutateAsync(queryMonth);
          }
          break;
        case 'cephalometric':
          if (queryId) {
            html = await renderCephalometricReport.mutateAsync(queryId);
          }
          break;
        case 'template':
          if (selectedTemplateCode) {
            const ctx = parseJson(sampleContextTextRef.current);
            html = await previewTemplate.mutateAsync({
              code: selectedTemplateCode,
              sampleContext: ctx as SampleContext | undefined,
            });
          }
          break;
      }

      setPreviewHtml(html);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
      if (axiosErr.response?.status === 403) {
        setError('权限不足，无法打印');
      } else if (axiosErr.response?.status === 500) {
        const msg = axiosErr.response?.data?.message || '服务器内部错误，请稍后重试';
        setError(msg);
      } else {
        setError(axiosErr.message || '加载预览失败');
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    activeTab,
    queryId,
    queryMonth,
    selectedTemplateCode,
    renderPrescription,
    renderReceipt,
    renderTreatmentPlan,
    renderClinicReport,
    renderCephalometricReport,
    previewTemplate,
  ]);

  useEffect(() => {
    if (activeTab) {
      void loadPreview();
    }
  }, [activeTab, loadPreview]);

  const handleTabClick = (tabKey: PrintType) => {
    setActiveTab(tabKey);
    setError(null);
    setPreviewHtml('');
    if (tabKey) {
      updateQueryParam('type', tabKey);
    }
    if (tabKey !== 'template') {
      setSampleContextKey('prescriptionSample');
      setSampleContextText(formatJson(DEFAULT_SAMPLE_CONTEXTS.prescriptionSample));
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!previewHtml) return;

    const typeName = activeTab ?? 'print';
    const idPart = queryId ? `-${queryId}` : '';
    const filename = `${typeName}${idPart}.html`;

    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toastService.success(`已下载：${filename}`);
  };

  const handleCopyHtml = async () => {
    if (!previewHtml) return;
    try {
      await navigator.clipboard.writeText(previewHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastService.error('复制失败，请手动复制');
    }
  };

  const handleSampleContextChange = (key: keyof typeof DEFAULT_SAMPLE_CONTEXTS) => {
    setSampleContextKey(key);
    setSampleContextText(formatJson(DEFAULT_SAMPLE_CONTEXTS[key]));
  };

  const handleFormatJson = () => {
    const parsed = parseJson(sampleContextText);
    if (parsed !== null) {
      setSampleContextText(formatJson(parsed));
    } else {
      toastService.error('JSON 格式错误，无法格式化');
    }
  };

  const handleCardEntry = (type: PrintType) => {
    setActiveTab(type);
    if (type) {
      updateQueryParam('type', type);
    }
  };

  if (!activeTab) {
    return (
      <div className="p-6 h-full overflow-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">打印预览</h1>
          <p className="text-muted-foreground mt-1">
            选择需要打印的单据类型，或从业务页面跳转并传入具体 ID 查看真实数据
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {TAB_ITEMS.slice(0, 5).map((tab) => {
            const Icon = tab.icon;
            return (
              <Card
                key={tab.key}
                className="cursor-pointer hover:shadow-md transition-all duration-200 hover:border-primary/50 group"
                onClick={() => handleCardEntry(tab.key)}
              >
                <CardHeader className="pb-3">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle className="text-base">{tab.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    无真实 ID 可用，点击进入模板预览
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col no-print">
      <div className="flex h-full">
        <aside className="w-56 border-r border-border bg-white flex-shrink-0 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Printer className="w-5 h-5 text-primary" />
              打印类型
            </h2>
            <nav className="flex flex-col gap-1">
              {TAB_ITEMS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => handleTabClick(tab.key)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left',
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {activeTab === 'template' && (
            <div className="p-4 border-t border-border space-y-4">
              <div>
                <Label className="mb-1.5 block">选择模板</Label>
                <Select
                  value={selectedTemplateCode}
                  onChange={(e) => {
                    setSelectedTemplateCode(e.target.value);
                    updateQueryParam('code', e.target.value);
                  }}
                  className="w-full"
                >
                  <option value="">-- 请选择模板 --</option>
                  {templates.map((t: PrintTemplate) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block">示例数据类型</Label>
                <Select
                  value={sampleContextKey}
                  onChange={(e) =>
                    handleSampleContextChange(
                      e.target.value as keyof typeof DEFAULT_SAMPLE_CONTEXTS
                    )
                  }
                  className="w-full"
                >
                  <option value="prescriptionSample">处方示例</option>
                  <option value="receiptSample">收费凭证示例</option>
                  <option value="planSample">治疗计划示例</option>
                  <option value="reportSample">诊所月报示例</option>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label>示例数据 JSON</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFormatJson}
                    className="h-7 px-2 text-xs"
                  >
                    格式化
                  </Button>
                </div>
                <textarea
                  value={sampleContextText}
                  onChange={(e) => setSampleContextText(e.target.value)}
                  className="w-full h-48 p-2 text-xs font-mono border border-border rounded-md resize-y"
                  spellCheck={false}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2 gap-1.5"
                  onClick={() => void loadPreview()}
                >
                  <Eye className="w-3.5 h-3.5" />
                  预览
                </Button>
              </div>
            </div>
          )}

          {activeTab && activeTab !== 'template' && (
            <div className="p-4 border-t border-border space-y-4">
              {activeTab === 'clinicReport' ? (
                <div>
                  <Label className="mb-1.5 block">报告月份</Label>
                  <Input
                    type="month"
                    value={queryMonth}
                    onChange={(e) => updateQueryParam('month', e.target.value)}
                  />
                </div>
              ) : (
                <div>
                  <Label className="mb-1.5 block">ID</Label>
                  <Input
                    type="text"
                    placeholder="输入业务ID，或从业务页面跳转"
                    value={queryId}
                    onChange={(e) => updateQueryParam('id', e.target.value)}
                  />
                  {!queryId && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      当前为模板预览模式，未加载真实数据
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white flex-shrink-0 gap-2 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-sm whitespace-nowrap">纸张：</Label>
                <Select
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                  className="w-28"
                >
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                  <option value="RECEIPT">小票</option>
                </Select>
              </div>

              <div className="text-sm text-muted-foreground">
                {activeTab && TAB_ITEMS.find((t) => t.key === activeTab)?.label}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadPreview()}
                className="gap-1.5"
                disabled={isLoading}
              >
                <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
                刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="gap-1.5"
                disabled={!previewHtml}
              >
                <Download className="w-4 h-4" />
                下载 HTML
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyHtml}
                className="gap-1.5"
                disabled={!previewHtml}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied ? '已复制' : '复制 HTML'}
              </Button>
              <Button
                size="sm"
                onClick={handlePrint}
                className="gap-1.5"
                disabled={!previewHtml}
              >
                <Printer className="w-4 h-4" />
                打印
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-muted/30 p-6 print-only">
            {isLoading && <PageLoading text="正在生成预览..." />}

            {!isLoading && error && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="w-8 h-8" />
                  <span className="text-base font-medium">{error}</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => void loadPreview()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  重试
                </Button>
              </div>
            )}

            {!isLoading && !error && !previewHtml && activeTab !== 'template' && !queryId && activeTab !== 'clinicReport' && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <FileText className="w-12 h-12 opacity-40" />
                <p className="text-sm">请输入 ID 查看真实数据，或从业务页面跳转</p>
              </div>
            )}

            {!isLoading && !error && !previewHtml && activeTab === 'clinicReport' && !queryMonth && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <BarChart3 className="w-12 h-12 opacity-40" />
                <p className="text-sm">请选择报告月份</p>
              </div>
            )}

            {!isLoading && !error && !previewHtml && activeTab === 'template' && !selectedTemplateCode && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <FileText className="w-12 h-12 opacity-40" />
                <p className="text-sm">请选择一个模板进行预览</p>
              </div>
            )}

            {!isLoading && !error && previewHtml && (
              <div
                className={cn(
                  'mx-auto bg-white shadow-lg',
                  getPaperSizeClass(paperSize)
                )}
              >
                <iframe
                  ref={iframeRef}
                  title="print-preview"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin"
                  className="w-full border-0"
                  style={{
                    minHeight: 'calc(100vh - 160px)',
                  }}
                />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
