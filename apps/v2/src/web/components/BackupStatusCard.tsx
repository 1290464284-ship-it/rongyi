import { Cloud } from 'lucide-react';

export interface BackupStatusCardProps {
  hasBackups: boolean;
  isLoading: boolean;
  isError: boolean;
  timeLabel: string;
  onOpenBackups: () => void;
}

export function BackupStatusCard({
  hasBackups,
  isLoading,
  isError,
  timeLabel,
  onOpenBackups,
}: BackupStatusCardProps) {
  return (
    <div className="sidebar-card">
      <div className="sidebar-card-row">
        <span className="sidebar-card-icon"><Cloud size={16} /></span>
        <div>
          <strong>{hasBackups ? '数据已同步' : '暂无备份'}</strong>
          <span>{isLoading ? '读取中...' : isError ? '备份状态不可用' : timeLabel}</span>
        </div>
        <span className="sync-status-dot" aria-hidden="true"></span>
      </div>
      <button className="sidebar-card-btn" onClick={onOpenBackups}>备份设置</button>
    </div>
  );
}
