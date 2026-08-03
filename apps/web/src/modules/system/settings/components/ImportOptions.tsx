import { CheckCircle2, AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingButton } from '@/components/ui/loading';
import { cn } from '@/lib/utils';
import type { BulkImportType } from '@/lib/api/system/bulk-import';

interface ImportOptionsProps {
  tab: BulkImportType;
  dryRun: boolean;
  strict: boolean;
  autoCreateDrug: boolean;
  validating: boolean;
  importing: boolean;
  onDryRunChange: (v: boolean) => void;
  onStrictChange: (v: boolean) => void;
  onAutoCreateDrugChange: (v: boolean) => void;
  onValidate: () => void;
}

export default function ImportOptions({
  tab, dryRun, strict, autoCreateDrug,
  validating, importing,
  onDryRunChange, onStrictChange, onAutoCreateDrugChange, onValidate,
}: ImportOptionsProps) {
  const showStrictOption = tab === 'drug' || tab === 'inventory';
  const showAutoCreateOption = tab === 'inventory';

  return (
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
            onChange={(e) => onDryRunChange(e.target.checked)}
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
              onChange={(e) => onStrictChange(e.target.checked)}
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
              onChange={(e) => onAutoCreateDrugChange(e.target.checked)}
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

        <div className="flex items-center justify-end gap-3 pt-1">
          <LoadingButton
            onClick={onValidate}
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
      </CardContent>
    </Card>
  );
}
