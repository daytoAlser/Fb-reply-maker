import { useCallback, useMemo, useRef } from 'react';

// Trigger F1_5_SCROLL_INBOX once the user scrolls within this many px of
// the bottom of the extension list body. App.jsx still debounces 1.5s.
const SCROLL_NEAR_BOTTOM_PX = 100;

// Phase F.1.5 step 2 — ThreadList renders from the live FB inbox scrape
// joined to Supabase by thread_id. Each row carries an isKnownLead flag:
// joined rows get status pills + chips, unjoined ones (team chats, brand-
// new buyers we haven't generated for yet) render plain.

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

function isReady(row) {
  return Array.isArray(row.open_flags) && row.open_flags.includes('ready_for_options');
}

function isReturning(row) {
  return row.conversation_mode === 'returning';
}

function isUnread(row, cached) {
  // Live scrape's unread flag wins when present (FB aria-label said so).
  if (row.unread) return true;
  // Legacy heuristic: cached variants present and we haven't replied yet.
  if (!cached) return false;
  if (row.status === 'contacted' || row.status === 'closed_won' || row.status === 'closed_lost') return false;
  return row.isKnownLead;
}

function rowDisplayTime(row) {
  // Prefer the relative string from the live scrape when present (e.g. "5m").
  if (row.last_activity_relative) return row.last_activity_relative;
  return formatRelative(row.last_updated);
}

export default function ThreadList({
  rows,
  inboxStatus,
  inboxError,
  inboxTabUrl,
  inboxLastUpdated,
  inboxLoadingMore,
  inboxAtBottom,
  leadsLoading,
  leadsError,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  activeThreadId,
  openingThreadId,
  onSelect,
  cachedByThread,
  onRefresh,
  onOpenInboxTab,
  onScrollNearBottom
}) {
  // Phase F.1.5 step 3 — scroll-to-load. When the pane-list-body scroll
  // position is within SCROLL_NEAR_BOTTOM_PX of the bottom, fire the
  // upstream handler (which debounces and dispatches F1_5_SCROLL_INBOX +
  // a merge-mode re-scrape).
  const bodyRef = useRef(null);
  const handleScroll = useCallback(() => {
    if (!onScrollNearBottom) return;
    const el = bodyRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distanceFromBottom <= SCROLL_NEAR_BOTTOM_PX) {
      onScrollNearBottom();
    }
  }, [onScrollNearBottom]);
  const counts = useMemo(() => {
    const c = { all: rows.length, unread: 0, qualifying: 0, qualified: 0, ready: 0, returning: 0 };
    for (const r of rows) {
      if (r.status === 'qualifying' || r.status === 'new') c.qualifying++;
      if (r.status === 'qualified') c.qualified++;
      if (isReady(r)) c.ready++;
      if (isReturning(r)) c.returning++;
      if (isUnread(r, cachedByThread[r.thread_id])) c.unread++;
    }
    return c;
  }, [rows, cachedByThread]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      switch (filter) {
        case 'unread':     if (!isUnread(r, cachedByThread[r.thread_id])) return false; break;
        case 'qualifying': if (r.status !== 'qualifying' && r.status !== 'new') return false; break;
        case 'qualified':  if (r.status !== 'qualified') return false; break;
        case 'ready':      if (!isReady(r)) return false; break;
        case 'returning':  if (!isReturning(r)) return false; break;
        default: break;
      }
      if (q) {
        const hay = `${r.partner_name || ''} ${r.listing_title || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, query, cachedByThread]);

  const showEmptyTabState = inboxStatus === 'tab_not_found';
  const showInboxError = inboxStatus === 'error';
  const showInboxLoading = inboxStatus === 'loading' && rows.length === 0;

  return (
    <aside className="pane-list">
      <header className="pane-list-head">
        <div className="pane-list-title-row">
          <h2 className="pane-list-title">FB INBOX</h2>
          <button
            type="button"
            className="pane-list-refresh"
            onClick={onRefresh}
            title="Refresh now"
            aria-label="Refresh inbox"
          >
            ↻
          </button>
        </div>
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

      <div className="pane-list-body" ref={bodyRef} onScroll={handleScroll}>
        {showInboxLoading && <p className="pane-list-empty">Loading inbox…</p>}

        {showEmptyTabState && (
          <div className="pane-list-empty-block">
            <p className="pane-list-empty">
              No FB inbox tab open.
            </p>
            <p className="pane-list-empty-sub">
              Open Facebook Marketplace inbox to see threads here.
            </p>
            <button
              type="button"
              className="pane-list-cta"
              onClick={onOpenInboxTab}
            >
              Open FB Inbox
            </button>
          </div>
        )}

        {showInboxError && (
          <div className="pane-list-empty-block">
            <p className="pane-list-error">Inbox scrape failed: {inboxError}</p>
            {inboxTabUrl && (
              <p className="pane-list-empty-sub" title={inboxTabUrl}>
                Tab: {inboxTabUrl}
              </p>
            )}
            <button type="button" className="pane-list-cta" onClick={onRefresh}>
              Try again
            </button>
          </div>
        )}

        {leadsError && !showEmptyTabState && !showInboxError && (
          <p className="pane-list-error">Supabase: {leadsError}</p>
        )}

        {!showEmptyTabState && !showInboxError && !showInboxLoading && filtered.length === 0 && (
          <p className="pane-list-empty">No threads match.</p>
        )}

        {filtered.map((r) => {
          const isActive = r.thread_id === activeThreadId;
          const isOpening = r.thread_id === openingThreadId;
          const ready = isReady(r);
          const returning = isReturning(r);
          const unread = isUnread(r, cachedByThread[r.thread_id]);
          const sourceTag = r.source === 'messages' ? 'MSG' : 'MKT';
          return (
            <button
              key={r.thread_id}
              type="button"
              onClick={() => onSelect(r.thread_id, r.source)}
              disabled={isOpening}
              className={`thread-row ${isActive ? 'is-active' : ''} ${r.isKnownLead ? '' : 'is-unknown'} ${isOpening ? 'is-opening' : ''}`}
            >
              <div className="thread-row-line1">
                <span className="thread-row-name">{r.partner_name || 'Unknown'}</span>
                <span className="thread-row-time">
                  {isOpening ? <span className="thread-row-spinner" aria-label="Opening" /> : rowDisplayTime(r)}
                </span>
              </div>
              <div className="thread-row-line2">
                <span className="thread-row-listing">
                  {r.listing_title || r.snippet || '—'}
                </span>
              </div>
              <div className="thread-row-meta">
                <span className={`thread-row-source thread-row-source-${r.source || 'marketplace'}`}>
                  {sourceTag}
                </span>
                {r.isKnownLead ? (
                  <span className={`status-pill ${STATUS_CLASSES[r.status] || 'status-gray'}`}>
                    {STATUS_LABELS[r.status] || r.status || '—'}
                  </span>
                ) : (
                  <span className="status-pill status-slate" title="Not yet a Supabase lead">
                    New
                  </span>
                )}
                {ready && <span className="thread-row-dot thread-row-dot-ready" title="Ready for options" />}
                {returning && <span className="thread-row-dot thread-row-dot-returning" title="Returning customer" />}
                {unread && <span className="thread-row-dot thread-row-dot-unread" title="Unread" />}
              </div>
            </button>
          );
        })}

        {inboxLoadingMore && (
          <p className="pane-list-foot pane-list-foot-loading">Loading more…</p>
        )}

        {!inboxLoadingMore && inboxAtBottom && filtered.length > 0 && (
          <p className="pane-list-foot pane-list-foot-end">End of inbox</p>
        )}

        {inboxStatus === 'ok' && inboxLastUpdated && !inboxLoadingMore && !inboxAtBottom && (
          <p className="pane-list-foot" title={new Date(inboxLastUpdated).toLocaleString()}>
            Live · {rows.length} threads · updated {formatRelative(inboxLastUpdated) || 'just now'}
          </p>
        )}
      </div>
    </aside>
  );
}
