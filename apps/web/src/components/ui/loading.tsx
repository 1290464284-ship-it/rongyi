import { Loader2 } from 'lucide-react';
import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { TableRow, TableCell } from './table';

// ===== Spinner =====
export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SPINNER_SIZE: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
};

export const Spinner = ({ size = 'md', className }: SpinnerProps) => (
  <Loader2 className={cn('animate-spin', SPINNER_SIZE[size], className)} />
);

// ===== LoadingButton =====
// 自动处理 pending 状态：显示 spinner + 文字 + 禁用
const loadingButtonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:from-primaryDark hover:to-secondary/90',
        outline: 'border border-border bg-white hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface LoadingButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof loadingButtonVariants> {
  loading?: boolean;
  loadingText?: string;
  // icon 位置：默认 left
  iconPosition?: 'left' | 'right';
}

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      loadingText,
      iconPosition = 'left',
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    // 当为 icon size 时，仅显示 spinner
    const isIconButton = size === 'icon';
    const displayText = loading ? loadingText ?? children : children;
    const spinnerSize = size === 'sm' || isIconButton ? 'sm' : 'md';

    return (
      <button
        ref={ref}
        className={cn(loadingButtonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        {...props}
      >
        {loading && iconPosition === 'left' && <Spinner size={spinnerSize} className={cn(!isIconButton && 'mr-1.5')} />}
        {!isIconButton && displayText}
        {loading && iconPosition === 'right' && <Spinner size={spinnerSize} className={cn(!isIconButton && 'ml-1.5')} />}
        {!loading && isIconButton && children}
      </button>
    );
  },
);
LoadingButton.displayName = 'LoadingButton';

// ===== TableLoading =====
// 表格加载占位：在 TableBody 内显示加载提示
export interface TableLoadingProps {
  colSpan: number;
  text?: string;
}

export const TableLoading = ({ colSpan, text = '加载中…' }: TableLoadingProps) => (
  <TableRow>
    <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
      <div className="inline-flex items-center gap-2">
        <Spinner size="sm" />
        <span>{text}</span>
      </div>
    </TableCell>
  </TableRow>
);

// ===== EmptyState =====
// 空状态占位
export interface EmptyStateProps {
  text?: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: { label: string; onClick: () => void };
  colSpan?: number;
  className?: string;
}

export const EmptyState = ({ text = '暂无数据', subtitle, icon: Icon, action, colSpan, className }: EmptyStateProps) => {
  const content = (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4', className)}>
      {Icon && <Icon className="w-10 h-10 text-muted-foreground/50 mb-3" />}
      <p className="text-sm text-muted-foreground">{text}</p>
      {subtitle && <p className="text-xs text-muted-foreground/60 mt-1">{subtitle}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 text-sm text-primary hover:text-primaryLight font-medium transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );

  if (colSpan !== undefined) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className={cn('text-center', className)}>
          {content}
        </TableCell>
      </TableRow>
    );
  }
  return content;
};

// ===== PageLoading =====
// 整页加载占位
export const PageLoading = ({ text = '加载中…' }: { text?: string }) => (
  <div className="flex items-center justify-center h-full min-h-[200px] text-muted-foreground">
    <div className="inline-flex items-center gap-2">
      <Spinner />
      <span>{text}</span>
    </div>
  </div>
);
