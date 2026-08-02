import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  onChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onChange, ...props }, ref) => {
    return (
      <span className="relative inline-flex items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          className={cn(
            'peer h-4 w-4 rounded border border-border bg-white accent-primary opacity-0 absolute inset-0 cursor-pointer',
            className
          )}
          {...props}
        />
        <span
          className={cn(
            'h-4 w-4 rounded border border-border bg-white flex items-center justify-center pointer-events-none transition-colors',
            checked ? 'border-primary bg-primary text-primary-foreground' : ''
          )}
        >
          {checked && <Check className="h-3 w-3" />}
        </span>
      </span>
    );
  }
);
Checkbox.displayName = 'Checkbox';
