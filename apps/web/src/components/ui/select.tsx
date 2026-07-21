import { forwardRef, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn('flex h-9 rounded-md border border-border bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary', className)}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
