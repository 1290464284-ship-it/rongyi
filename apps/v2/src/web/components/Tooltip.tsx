import { cloneElement, isValidElement, useId, useState, type FocusEventHandler, type ReactElement, type ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();
  const childProps = isValidElement(children)
    ? (children as ReactElement<{ onFocus?: FocusEventHandler; onBlur?: FocusEventHandler; 'aria-describedby'?: string }>).props ?? {}
    : {};
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ onFocus?: FocusEventHandler; onBlur?: FocusEventHandler; 'aria-describedby'?: string }>, {
        onFocus: (event) => {
          childProps.onFocus?.(event);
          setVisible(true);
        },
        onBlur: (event) => {
          childProps.onBlur?.(event);
          setVisible(false);
        },
        'aria-describedby': tooltipId,
      })
    : children;
  return (
    <span className="ui-tooltip-wrap">
      {child}
      <span className={`ui-tooltip${visible ? ' visible' : ''}`} role="tooltip" id={tooltipId}>{content}</span>
    </span>
  );
}
