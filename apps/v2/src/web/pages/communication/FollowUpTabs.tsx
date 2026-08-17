export function FollowUpTabs({ activeTab, onSelect }: { activeTab: 'list' | 'dicts'; onSelect: (tab: 'list' | 'dicts') => void }) {
  return (
    <div className="tabs" role="tablist">
      <button
        id="followup-tab-list"
        role="tab"
        aria-selected={activeTab === 'list'}
        aria-controls="followup-panel-list"
        tabIndex={activeTab === 'list' ? 0 : -1}
        className={activeTab === 'list' ? 'tab active' : 'tab'}
        onClick={() => onSelect('list')}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            onSelect('dicts');
            document.getElementById('followup-tab-dicts')?.focus();
          }
        }}
      >
        回访列表
      </button>
      <button
        id="followup-tab-dicts"
        role="tab"
        aria-selected={activeTab === 'dicts'}
        aria-controls="followup-panel-dicts"
        tabIndex={activeTab === 'dicts' ? 0 : -1}
        className={activeTab === 'dicts' ? 'tab active' : 'tab'}
        onClick={() => onSelect('dicts')}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            onSelect('list');
            document.getElementById('followup-tab-list')?.focus();
          }
        }}
      >
        词典管理
      </button>
    </div>
  );
}
