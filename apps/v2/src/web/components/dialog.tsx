import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 关闭动画时长 120ms，移除延时须大于动画时长（防闪回：fill-mode forwards） */
const DIALOG_CLOSE_MS = 140;

export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 关闭代际：每次重新打开递增；迟到的关闭定时器若发现代际已变则不再通知父组件
  const closeEpochRef = useRef(0);
  const [closing, setClosing] = useState(false);
  // 渲染期调整：重新打开时复位关闭动画状态（避免在 effect 里同步 setState）
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setClosing(false);
  }

  // 打开时记录触发元素并把焦点移入弹窗；关闭/卸载时还原焦点并清理关闭定时器
  useEffect(() => {
    if (!open) return;
    closeEpochRef.current += 1;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    if (modal) {
      const firstFocusable = modal.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? modal).focus();
    }
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    };
  }, [open]);

  if (!open) return null;

  // 统一关闭出口：先播 120ms 对称淡出动画，动画结束后才真正通知父组件
  function requestClose() {
    if (closing) return;
    setClosing(true);
    const epoch = closeEpochRef.current;
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      // 若弹窗在动画期间已被重新打开（代际变化），丢弃这次迟到的关闭通知
      if (closeEpochRef.current !== epoch) return;
      onClose();
    }, DIALOG_CLOSE_MS);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== 'Tab') return;
    // 焦点陷阱：Tab/Shift+Tab 在弹窗内循环，焦点逃逸到弹窗外时拉回第一个可聚焦元素
    const modal = modalRef.current;
    if (!modal) return;
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={`modal-backdrop${closing ? ' closing' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-head">
          <h2>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title = '确认操作',
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>{cancelText}</button>
        <button type="button" className={danger ? 'danger' : undefined} onClick={onConfirm}>{confirmText}</button>
      </div>
    </Dialog>
  );
}

export function PromptDialog({
  open,
  title = '请输入',
  message,
  value = '',
  inputType = 'text',
  placeholder = '',
  confirmText = '确认',
  cancelText = '取消',
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message?: string;
  value?: string;
  inputType?: 'text' | 'number' | 'textarea';
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);

  // 外部 value 变化（如重新打开对话框时清空/回填）时同步内部状态；
  // 在渲染期间调整 state，避免 effect 内同步 setState 引发级联渲染
  if (syncedValue !== value) {
    setSyncedValue(value);
    setCurrent(value);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(current);
  }

  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <form onSubmit={submit}>
        {message && <p>{message}</p>}
        {inputType === 'textarea' ? (
          <textarea value={current} onChange={(event) => setCurrent(event.target.value)} placeholder={placeholder} />
        ) : (
          <input
            autoFocus
            type={inputType === 'number' ? 'number' : 'text'}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            placeholder={placeholder}
          />
        )}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>{cancelText}</button>
          <button type="submit">{confirmText}</button>
        </div>
      </form>
    </Dialog>
  );
}
