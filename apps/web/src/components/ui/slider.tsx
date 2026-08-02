import { forwardRef, InputHTMLAttributes, useId } from 'react';
import { cn } from '@/lib/utils';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  showValue?: boolean;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, label, showValue, min = 0, max = 100, value, ...props }, ref) => {
    const id = useId();
    return (
      <div className="w-full">
        {(label || showValue) && (
          <div className="flex items-center justify-between mb-1.5">
            {label && (
              <label htmlFor={id} className="text-xs font-medium text-foreground">
                {label}
              </label>
            )}
            {showValue && (
              <span className="text-xs font-mono text-muted-foreground">{value ?? 0}</span>
            )}
          </div>
        )}
        <input
          ref={ref}
          id={id}
          type="range"
          min={min}
          max={max}
          value={value}
          className={cn(
            'w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary',
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
Slider.displayName = 'Slider';
