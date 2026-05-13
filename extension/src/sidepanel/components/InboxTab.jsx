import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Side-panel inbox view. Drives the FB tab via the existing F1_5_GET_INBOX
// + F1_5_OPEN_THREAD content-script RPCs. Click a row → FB navigates →
// THREAD_UPDATE fires → the Reply tab auto-detects and switches.
const REFRESH_INTERVAL_MS = 30 * 1000;
const SCROLL_DEBOUNCE_MS = 1500;

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

function rpc(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { ok: false, reason: 'no_response' });
      });
    } catch (err) {
      resolve({ ok: false, reason: err?.message || 'rpc_threw' });
    }
  });
}

function relTime(t) {
  if (!t) return '';
  const ts = typeof t === 'string' ? Date.parse(t) : t;
  if (!isFinite(ts)) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export default function InboxTab({ onSelectThread, currentThreadId, leads }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [tabUrl, setTabUrl] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [openingThreadId, setOpeningThreadId] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [atBottom, setAtBottom] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const inFlightRef = useRef(false);
  const lastScrollAtRef = useRef(0);
  const bodyRef = useRef(null);

  const refresh = useCallback(async ({ silent, merge } = {}) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) setStatus((s) => (s === 'idle' ? 'loading' : s));
    try {
      const res = await rpc({ type: 'F1_5_GET_INBOX' });
      if (res.ok) {
        const incoming = Array.isArray(res.rows) ? res.rows : [];
        setRows((prev) => {
          if (!merge) return incoming;
          const byKey = new Map();
          for (const r of prev) byKey.set(`${r.source || 'marketplace'}:${r.thread_id}`, r);
          for (const r of incoming) byKey.set(`${r.source || 'marketplace'}:${r.thread_id}`, r);
          return [...byKey.values()];
        });
        setStatus('ok');
        setError(null);
        setTabUrl(res.tabUrl || null);
        setLastUpdated(Date.now());
      } else if (res.reason === 'tab_not_found') {
        if (!merge) setRows([]);
        setStatus('tab_not_found');
        setError(null);
      } else if (res.reason === 'not_inbox') {
        setStatus('navigated_away');
        setError(res.reason);
        setTabUrl(res.tabUrl || res.url || null);
      } else {
        setStatus('error');
        setError(res.reason || 'unknown');
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (openingThreadId) return;
      refresh({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingThreadId]);

  const handleScroll = useCallback(async () => {
    const el = bodyRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distanceFromBottom > 100) return;
    const now = Date.now();
    if (now - lastScrollAtRef.current < SCROLL_DEBOUNCE_MS) return;
    if (loadingMore || atBottom) return;
    lastScrollAtRef.current = now;
    setLoadingMore(true);
    try {
      const res = await rpc({ type: 'F1_5_SCROLL_INBOX' });
      if (res?.atBottom) setAtBottom(true);
      await refresh({ silent: true, merge: true });
    } finally {
      setLoadingMore(false);
    }
  }, [refresh, loadingMore, atBottom]);

  async function handleSelect(row) {
    if (!row?.thread_id) return;
    setOpeningThreadId(row.thread_id);
    try {
      const res = await rpc({
        type: 'F1_5_OPEN_THREAD',
        thread_id: row.thread_id,
        source: row.source || 'marketplace'
      });
      if (res?.ok) {
        // Tell the Reply tab to switch — the parent App handles tab change
        // + auto-detect re-fire after the thread loads.
        if (onSelectThread) onSelectThread(row.thread_id, row.source);
      } else {
        console.warn('[FB Reply Maker SP] open thread failed:', res?.reason);
      }
    } finally {
      setOpeningThreadId(null);
    }
  }

  function handleOpenInboxTab() {
    chrome.tabs.create({ url: 'https://www.facebook.com/marketplace/inbox' });
  }

  async function handleReopenInbox() {
    const res = await rpc({ type: 'F1_5_OPEN_INBOX' });
    if (res?.ok) {
      setTimeout(() => refresh(), 1200);
    }
  }

  const leadByThread = useMemo(() => {
    const m = new Map();
    for (const l of leads || []) if (l?.thread_id) m.set(l.thread_id, l);
    return m;
  }, [leads]);

  const merged = useMemo(() => {
    return (rows || []).map((r) => {
      const lead = leadByThread.get(r.thread_id) || null;
      return {
        ...r,
        isKnownLead: !!lead,
        status: lead?.status || null,
        listing_title: lead?.listing_title || r.listing_title || null,
        partner_name: r.partner_name || lead?.partner_name || 'Unknown'
      };
    });
  }, [rows, leadByThread]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((r) => {
      if (filter === 'unread' && !r.unread) return false;
      if (filter === 'qualifying' && r.status !== 'qualifying' && r.status !== 'new') return false;
      if (filter === 'qualified' && r.status !== 'qualified') return false;
      if (q) {
        const hay = `${r.partner_name || ''} ${r.listing_title || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [merged, filter, query]);

  return (
    <div className="inbox-tab">
      <div className="inbox-head">
        <input
          type="search"
          className="inbox-search"
          placeholder="Search name or listing…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className="inbox-refresh"
          onClick={() => refresh()}
          title="Refresh"
          aria-label="Refresh inbox"
        >
          ↻
        </button>
      </div>
      <div className="inbox-filters">
        {[
          { id: 'all',         label: 'All' },
          { id: 'unread',      label: 'Unread' },
          { id: 'qualifying',  label: 'Qualifying' },
          { id: 'qualified',   label: 'Qualified' }
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            className={`inbox-filter ${filter === f.id ? 'is-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="inbox-body" ref={bodyRef} onScroll={handleScroll}>
        {status === 'loading' && rows.length === 0 && (
          <p className="inbox-empty">Loading inbox…</p>
        )}

        {status === 'tab_not_found' && (
          <div className="inbox-empty-block">
            <p className="inbox-empty">No FB inbox tab open.</p>
            <button type="button" className="inbox-cta" onClick={handleOpenInboxTab}>
              Open FB Inbox
            </button>
          </div>
        )}

        {status === 'navigated_away' && (
          <div className="inbox-empty-block">
            <p className="inbox-empty">FB tab moved off the inbox.</p>
            <button type="button" className="inbox-cta" onClick={handleReopenInbox}>
              Re-open Inbox
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="inbox-empty-block">
            <p className="inbox-error">Inbox scrape failed: {error}</p>
            <button type="button" className="inbox-cta" onClick={() => refresh()}>
              Try again
            </button>
          </div>
        )}

        {status === 'ok' && filtered.length === 0 && (
          <p className="inbox-empty">No threads match.</p>
        )}

        {filtered.map((r) => {
          const isActive = r.thread_id === currentThreadId;
          const isOpening = r.thread_id === openingThreadId;
          const sourceTag = r.source === 'messages' ? 'MSG' : 'MKT';
          return (
            <button
              key={`${r.source || 'marketplace'}:${r.thread_id}`}
              type="button"
              className={`inbox-row ${isActive ? 'is-active' : ''} ${isOpening ? 'is-opening' : ''} ${r.isKnownLead ? '' : 'is-unknown'}`}
              onClick={() => handleSelect(r)}
              disabled={isOpening}
            >
              <div className="inbox-row-line1">
                <span className="inbox-row-name">{r.partner_name || 'Unknown'}</span>
                <span className="inbox-row-time">
                  {isOpening ? '…' : (r.last_activity_relative || relTime(r.last_updated) || '')}
                </span>
              </div>
              <div className="inbox-row-line2">
                <span className="inbox-row-listing">
                  {r.listing_title || r.snippet || '—'}
                </span>
              </div>
              <div className="inbox-row-meta">
                <span className={`inbox-row-source inbox-row-source-${r.source || 'marketplace'}`}>
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
                {r.unread && <span className="inbox-row-dot inbox-row-dot-unread" title="Unread" />}
              </div>
            </button>
          );
        })}

        {loadingMore && (
          <p className="inbox-foot inbox-foot-loading">Loading more…</p>
        )}
        {!loadingMore && atBottom && filtered.length > 0 && (
          <p className="inbox-foot">End of inbox</p>
        )}
        {status === 'ok' && lastUpdated && filtered.length > 0 && !loadingMore && !atBottom && (
          <p className="inbox-foot" title={new Date(lastUpdated).toLocaleString()}>
            Live · {rows.length} threads · updated {relTime(lastUpdated) || 'just now'}
          </p>
        )}
      </div>
    </div>
  );
}
