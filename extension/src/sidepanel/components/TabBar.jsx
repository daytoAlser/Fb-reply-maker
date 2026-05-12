export default function TabBar({ activeTab, onChange, leadsBadgeCount }) {
  return (
    <nav className="tab-bar" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'reply'}
        className={`tab ${activeTab === 'reply' ? 'tab-active' : ''}`}
        onClick={() => onChange('reply')}
      >
        Reply Maker
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'leads'}
        className={`tab ${activeTab === 'leads' ? 'tab-active' : ''}`}
        onClick={() => onChange('leads')}
      >
        <span>Leads</span>
        {leadsBadgeCount > 0 && (
          <span className="tab-badge" aria-label={`${leadsBadgeCount} unviewed qualified leads`}>
            {leadsBadgeCount}
          </span>
        )}
      </button>
    </nav>
  );
}
