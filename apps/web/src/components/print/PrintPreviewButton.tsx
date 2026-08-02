import { Printer } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PrintType =
  | 'prescription'
  | 'receipt'
  | 'treatment'
  | 'clinicReport'
  | 'cephalometric'
  | 'template';

export interface PrintPreviewButtonProps extends Omit<ButtonProps, 'onClick' | 'type'> {
  type: PrintType;
  id?: string;
  code?: string;
  month?: string;
  label?: string;
  openInNewTab?: boolean;
}

function buildPrintUrl(
  type: PrintType,
  id?: string,
  code?: string,
  month?: string
): string {
  const params = new URLSearchParams();
  params.set('type', type);
  if (id) params.set('id', id);
  if (code) params.set('code', code);
  if (month) params.set('month', month);
  return `#/print-preview?${params.toString()}`;
}

export function PrintPreviewButton({
  type,
  id,
  code,
  month,
  label,
  openInNewTab = false,
  className,
  variant = 'outline',
  size = 'sm',
  children,
  ...props
}: PrintPreviewButtonProps) {
  const handleClick = () => {
    const url = buildPrintUrl(type, id, code, month);
    if (openInNewTab) {
      window.open(url, '_blank');
    } else {
      window.location.hash = url.slice(1);
    }
  };

  const buttonLabel = label ?? children ?? '打印预览';

  return (
    <Button
      variant={variant}
      size={size}
      type="button"
      onClick={handleClick}
      className={cn('gap-1.5', className)}
      {...props}
    >
      <Printer className="w-4 h-4" />
      {buttonLabel}
    </Button>
  );
}

export { buildPrintUrl };
