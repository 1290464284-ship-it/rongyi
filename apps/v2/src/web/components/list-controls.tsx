/**
 * 列表页共用控件：防抖搜索框 + 上一页/下一页。
 * CrudPage / ResourcePage / DispenseListPanel 等此前各自手写同一套结构，
 * 现在统一由这两个组件提供，行为与文案保持一致。
 */
export function SearchInput({
  value,
  onChange,
  placeholder = '搜索...',
  ariaLabel = '搜索',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      className="search"
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function PagePager({
  page,
  hasNext,
  onPageChange,
  disabled,
}: {
  page: number;
  hasNext: boolean;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pager">
      <button type="button" disabled={disabled || page <= 1} onClick={() => { if (!disabled) onPageChange(page - 1); }}>上一页</button>
      <span>第 {page} 页</span>
      <button type="button" disabled={disabled || !hasNext} onClick={() => { if (!disabled) onPageChange(page + 1); }}>下一页</button>
    </div>
  );
}

/** Keep a native select visibly selected when its value is not in the loaded options. */
export function MissingSelectOption({ value, label }: { value: unknown; label?: string }) {
  if (value === '' || value === null || value === undefined) return null;
  return <option value={String(value)}>{label ?? String(value)}</option>;
}
