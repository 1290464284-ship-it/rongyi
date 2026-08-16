import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface DataTableColumn<T extends Record<string, unknown>> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** 自定义表头内容（如全选 checkbox），缺省渲染 label */
  header?: ReactNode;
}

// A15：真虚拟化。行高通过首行实测（缺省 36px），滚动时仅渲染可视窗口 + 上下过扫描行，
// 用等高 spacer 行撑起滚动高度，千行级列表 DOM 数量恒定。
const DEFAULT_ROW_HEIGHT = 36;
const OVERSCAN_ROWS = 8;
// M2：行数上限（500），超限仅渲染前 500 行并提示，避免千行级列表全量 DOM 渲染
const MAX_RENDER_ROWS = 500;

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  keyField,
  emptyText = '暂无数据',
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  keyField?: keyof T;
  emptyText?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowHeightRef = useRef(DEFAULT_ROW_HEIGHT);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [windowStart, setWindowStart] = useState(0);
  const [windowEnd, setWindowEnd] = useState(OVERSCAN_ROWS * 2);
  const [prevKeySet, setPrevKeySet] = useState<string | null>(null);
  const measureRef = useRef<HTMLTableRowElement | null>(null);
  const keySet = rows.map((row) => (keyField && row[keyField] != null ? String(row[keyField]) : '')).join('|');
  if (prevKeySet !== keySet) {
    setPrevKeySet(keySet);
    setWindowStart(0);
    setWindowEnd(OVERSCAN_ROWS * 2);
  }
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [keySet]);

  const visibleRows = rows.length > MAX_RENDER_ROWS ? rows.slice(0, MAX_RENDER_ROWS) : rows;
  const total = visibleRows.length;
  const clampedStart = Math.min(windowStart, Math.max(0, total - 1));
  const clampedEnd = Math.max(clampedStart + 1, Math.min(total, windowEnd));
  const renderedRows = visibleRows.slice(clampedStart, clampedEnd);
  const firstRenderedRow = renderedRows[0];

  // 首行实测行高（数据/字体变化后自动重测）
  useEffect(() => {
    if (measureRef.current && measureRef.current.offsetHeight > 0) {
      const measured = measureRef.current.offsetHeight;
      if (measured !== rowHeightRef.current) {
        rowHeightRef.current = measured;
        setRowHeight(measured);
      }
    }
  }, [firstRenderedRow]);

  if (rows.length === 0) return <div className="table-empty">{emptyText}</div>;

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - OVERSCAN_ROWS);
    const end = Math.min(total, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + OVERSCAN_ROWS);
    setWindowStart(start);
    setWindowEnd(end);
  }

  const spacer = (height: number, key: string) => (
    <tr key={key} aria-hidden="true" style={{ height }}>
      <td colSpan={columns.length} style={{ padding: 0, border: 0 }} />
    </tr>
  );

  const tableContent = (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>
              {column.header ?? column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {clampedStart > 0 && spacer(clampedStart * rowHeight, 'spacer-top')}
        {renderedRows.map((row, index) => (
          <tr
            key={keyField && row[keyField] != null ? String(row[keyField]) : `row-${clampedStart + index}`}
            ref={clampedStart === 0 && index === 0 ? measureRef : undefined}
          >
            {columns.map((column) => (
              <td key={column.key}>
                {column.render ? column.render(row) : String(row[column.key] ?? '')}
              </td>
            ))}
          </tr>
        ))}
        {clampedEnd < total && spacer((total - clampedEnd) * rowHeight, 'spacer-bottom')}
      </tbody>
    </table>
  );
  return (
    <div className="table-wrap">
      {rows.length > MAX_RENDER_ROWS && (
        <div className="table-note">仅显示前 {MAX_RENDER_ROWS} 行（共 {rows.length} 行），请使用搜索或筛选缩小范围</div>
      )}
      <div className="data-table-scroll" ref={scrollRef} onScroll={handleScroll}>
        {tableContent}
      </div>
    </div>
  );
}
