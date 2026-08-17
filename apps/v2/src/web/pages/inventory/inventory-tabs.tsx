export function InventoryTabs({ activeTab, onChange }: {
  activeTab: 'overview' | 'report';
  onChange: (tab: 'overview' | 'report') => void;
}) {
  return (
    <div className="tabs" role="tablist">
      <button
        id="inventory-tab-overview"
        role="tab"
        aria-selected={activeTab === 'overview'}
        aria-controls="inventory-panel-overview"
        tabIndex={activeTab === 'overview' ? 0 : -1}
        className={activeTab === 'overview' ? 'tab active' : 'tab'}
        onClick={() => onChange('overview')}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            onChange('report');
            document.getElementById('inventory-tab-report')?.focus();
          }
        }}
      >
        库存概览
      </button>
      <button
        id="inventory-tab-report"
        role="tab"
        aria-selected={activeTab === 'report'}
        aria-controls="inventory-panel-report"
        tabIndex={activeTab === 'report' ? 0 : -1}
        className={activeTab === 'report' ? 'tab active' : 'tab'}
        onClick={() => onChange('report')}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            onChange('overview');
            document.getElementById('inventory-tab-overview')?.focus();
          }
        }}
      >
        库存明细报表
      </button>
    </div>
  );
}
