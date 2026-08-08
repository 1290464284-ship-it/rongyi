interface BatchBarProps {
  count: number;
  onArchive?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}

export function BatchBar({ count, onArchive, onExport, onDelete }: BatchBarProps) {
  return (
    <div className="ui-batch-bar">
      <span className="ui-batch-count">已选 {count} 项</span>
      {onArchive && <button type="button" onClick={onArchive}>批量归档</button>}
      {onExport && <button type="button" onClick={onExport}>批量导出</button>}
      {onDelete && <button type="button" className="danger" onClick={onDelete}>批量删除</button>}
    </div>
  );
}
