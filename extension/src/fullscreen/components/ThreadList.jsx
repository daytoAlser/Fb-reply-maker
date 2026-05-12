import { useMemo } from 'react';

const FILTERS = [
  { id: 'all',         label: 'All'              },
  { id: 'unread',      label: 'Unread'           },
  { id: 'qualifying',  label: 'Qualifying'       },
  { id: 'qualified',   label: 'Qualified'        },
  { id: 'ready',       label: 'Ready for Options' },
  { id: 'returning',   label: 'Returning'        }
];

const STATUS_LABELS = {
  new: 'New',
  qualifying: 'Qualifying',
  qualified: 'Qualified',
  contacted: 'Contacted',
  closed_won: 'Won',
  closed_lost: 'Lost',
  stale: 'Stale'
};

const STATUS_CLASSES = {
  new: 'status-gray',
  qualifying: 'status-gray',
  qualified: 'status-amber',
  contacted: 'status-green',
  closed_won: 'status-blue',
  closed_lost: 'status-red',
  stale: 'status-slate'
};

function formatRelative(ts) {
  if (!ts) return '';
  const t = typeof ts === 'string' ? Date.parse(ts) : ts;
  if (!isFinite(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  return new Date(t).toLocaleDateString();
}

function isReady(lead) {
  return Array.isArray(lead.open_flags) && lead.open_flags.includes('ready_for_options');
}

function isReturning(lead) {
  return lead.conversation_mode === 'returning';
}

function isUnread(lead, cached) {
  // Heuristic for F.1: a thread is "unread" when there are cached variants
  // ready (auto-gen fired since last interaction) but the lead wasn't yet
  // marked contacted. Future F.x can promote this to a real read/unread bit.
  if (!cached) return false;
  if (lead.status === 'contacted' || lead.status === 'closed_won' || lead.status === 'closed_lost') return false;
  return true;
}

export default function ThreadList({
  leads,
  loading,
  error,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  activeThreadId,
  onSelect,
  cachedByThread
}) {
  const counts = useMemo(() => {
    const c = { all: leads.length, unread: 0, qualifying: 0, qualified: 0, ready: 0, returning: 0 };
    for (const l of leads) {
      if (l.status === 'qualifying' || l.status === 'new') c.qualifying++;
      if (l.status === 'qualified') c.qualified++;
      if (isReady(l)) c.ready++;
      if (isReturning(l)) c.returning++;
      if (isUnread(l, cachedByThread[l.thread_id])) c.unread++;
    }
    return c;
  }, [leads, cachedByThread]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      switch (filter) {
        case 'unread':     if (!isUnread(l, cachedByThread[l.thread_id])) return false; break;
        case 'qualifying': if (l.status !== 'qualifying' && l.status !== 'new') return false; break;
        case 'qualified':  if (l.status !== 'qualified') return false; break;
        case 'ready':      if (!isReady(l)) return false; break;
        case 'returning':  if (!isReturning(l)) return false; break;
        default: break;
      }
      if (q) {
        const hay = `${l.partner_name || ''} ${l.listing_title || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, filter, query, cachedByThread]);

  return (
    <aside className="pane-list">
      <header className="pane-list-head">
        <h2 className="pane-list-title">LEADS</h2>
        <input
          type="search"
          className="pane-list-search"
          placeholder="Search name or listing…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          spellCheck={false}
        />
        <div className="pane-list-filters" role="tablist" aria-label="Lead filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`pane-list-filter ${filter === f.id ? 'is-active' : ''}`}
              onClick={() => onFilterChange(f.id)}
            >
              {f.label}
              <span className="pane-list-filter-count">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="pane-list-body">
        {loading && <p className="pane-list-empty">Loading…</p>}
        {error && <p className="pane-list-error">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="pane-list-empty">No leads match.</p>
        )}
        {filtered.map((l) => {
          const isActive = l.thread_id === activeThreadId;
          const ready = isReady(l);
          const returning = isReturning(l);
          const unread = isUnread(l, cachedByThread[l.thread_id]);
          return (
            <button
              key={l.thread_id}
              type="button"
              onClick={() => onSelect(l.thread_id)}
              className={`thread-row ${isActive ? 'is-active' : ''}`}
            >
              <div className="thread-row-line1">
                <span className="thread-row-name">{l.partner_name || 'Unknown'}</span>
                <span className="thread-row-time">{formatRelative(l.last_updated)}</span>
              </div>
              <div className="thread-row-line2">
                <span className="thread-row-listing">{l.listing_title || '—'}</span>
              </div>
              <div className="thread-row-meta">
                <span className={`status-pill ${STATUS_CLASSES[l.status] || 'status-gray'}`}>
                  {STATUS_LABELS[l.status] || l.status || '—'}
                </span>
                {ready && <span className="thread-row-dot thread-row-dot-ready" title="Ready for options" />}
                {returning && <span className="thread-row-dot thread-row-dot-returning" title="Returning customer" />}
                {unread && <span className="thread-row-dot thread-row-dot-unread" title="Fresh variants cached" />}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
