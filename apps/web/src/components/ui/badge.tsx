import { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'outline' | 'secondary';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClass: Record<BadgeVariant, string> = {
  default: 'bg-primary/10 text-primary',
  outline: 'border border-border bg-white text-foreground',
  secondary: 'bg-secondary/10 text-secondary',
};

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', variantClass[variant], className)} {...props} />;
}
