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
}: {
  page: number;
  hasNext: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="pager">
      <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
      <span>第 {page} 页</span>
      <button disabled={!hasNext} onClick={() => onPageChange(page + 1)}>下一页</button>
    </div>
  );
}
