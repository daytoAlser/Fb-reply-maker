export default function TabBar({ activeTab, onChange, leadsBadgeCount, inboxBadgeCount }) {
  return (
    <nav className="tab-bar" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'reply'}
        className={`tab ${activeTab === 'reply' ? 'tab-active' : ''}`}
        onClick={() => onChange('reply')}
      >
        Reply
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'inbox'}
        className={`tab ${activeTab === 'inbox' ? 'tab-active' : ''}`}
        onClick={() => onChange('inbox')}
      >
        <span>Inbox</span>
        {inboxBadgeCount > 0 && (
          <span className="tab-badge" aria-label={`${inboxBadgeCount} unread threads`}>
            {inboxBadgeCount}
          </span>
        )}
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
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'learning'}
        className={`tab ${activeTab === 'learning' ? 'tab-active' : ''}`}
        onClick={() => onChange('learning')}
        title="Recent INSERT → send captures for prompt review"
      >
        <span>{'\u{1F4DA}'} Learning</span>
      </button>
    </nav>
  );
}
