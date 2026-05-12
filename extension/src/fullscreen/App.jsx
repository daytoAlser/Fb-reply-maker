import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ThreadList from './components/ThreadList.jsx';
import ThreadView from './components/ThreadView.jsx';
import ReplyPane from './components/ReplyPane.jsx';
import {
  loadSettings,
  listLeads,
  getThreadHistory,
  requestRegenerate,
  focusFbTab,
  readCachedVariants,
  readAllCachedVariants,
  getInboxList,
  scrollInboxDown,
  openThread
} from './lib/api.js';

const LEADS_REFRESH_INTERVAL_MS = 30 * 1000;
const INBOX_REFRESH_INTERVAL_MS = 30 * 1000;
const INBOX_SCROLL_DEBOUNCE_MS = 1500;
const MIN_VIEWPORT_WIDTH = 1280;

// Phase F.1.5 step 2 — build the list the ThreadList renders from. The live
// FB inbox scrape is the source of truth for which rows exist; Supabase
// state (status, flags, conversation_mode, last_updated, listing) is joined
// in by thread_id so known leads light up with chips and pills. Unknown
// rows (e.g. team chats from Messenger, or brand-new buyer threads we've
// never generated a reply for) render plain.
function mergeInboxWithLeads(inboxRows, leads) {
  const leadByThread = new Map();
  for (const l of leads || []) {
    if (l?.thread_id) leadByThread.set(l.thread_id, l);
  }
  return (inboxRows || []).map((row) => {
    const lead = leadByThread.get(row.thread_id) || null;
    return {
      thread_id: row.thread_id,
      source: row.source || 'marketplace',
      partner_name: row.partner_name || lead?.partner_name || 'Unknown',
      listing_title: lead?.listing_title || row.listing_title || null,
      snippet: row.snippet || null,
      last_activity_relative: row.last_activity_relative || null,
      unread: !!row.unread,
      isKnownLead: !!lead,
      status: lead?.status || null,
      open_flags: lead?.open_flags || null,
      conversation_mode: lead?.conversation_mode || null,
      last_updated: lead?.last_updated || null,
      fb_thread_url: lead?.fb_thread_url || null,
      // raw row kept on the side so future debugging can see the scrape input
      _raw: row
    };
  });
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState(null);
  const [cachedByThread, setCachedByThread] = useState({});
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [activeCached, setActiveCached] = useState(null);
  const [generatingFor, setGeneratingFor] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [viewportTooSmall, setViewportTooSmall] = useState(window.innerWidth < MIN_VIEWPORT_WIDTH);

  // Phase F.1.5 step 2 — live FB inbox state. Polled every 30s and on
  // mount; merged with Supabase leads by thread_id for the ThreadList.
  // inboxStatus is one of: 'idle' | 'loading' | 'ok' | 'tab_not_found' | 'error'.
  const [inboxRows, setInboxRows] = useState([]);
  const [inboxStatus, setInboxStatus] = useState('idle');
  const [inboxError, setInboxError] = useState(null);
  const [inboxTabUrl, setInboxTabUrl] = useState(null);
  const [inboxLayoutVersion, setInboxLayoutVersion] = useState(null);
  const [inboxLastUpdated, setInboxLastUpdated] = useState(null);
  // Step 3: scroll-to-load state. lastScrollAt drives the 1.5s debounce.
  const [inboxLoadingMore, setInboxLoadingMore] = useState(false);
  const [inboxAtBottom, setInboxAtBottom] = useState(false);
  const lastScrollAtRef = useRef(0);
  // Step 4: per-row click state. openingThreadId is the row currently
  // being driven open in the FB tab; ThreadList renders a spinner on it.
  const [openingThreadId, setOpeningThreadId] = useState(null);

  const refreshLeads = useCallback(async (s) => {
    const cfg = (s || settings)?.config;
    if (!cfg?.endpoint || !cfg?.secret) {
      setLeadsError('Configure endpoint and secret in the extension options.');
      setLeadsLoading(false);
      return;
    }
    try {
      const res = await listLeads({ endpoint: cfg.endpoint, secret: cfg.secret, limit: 500 });
      if (res?.ok) {
        setLeads(Array.isArray(res.leads) ? res.leads : []);
        setLeadsError(null);
      } else {
        setLeadsError(res?.error || 'list-leads returned not ok');
      }
    } catch (err) {
      setLeadsError(err?.message || 'list-leads fetch failed');
    } finally {
      setLeadsLoading(false);
    }
  }, [settings]);

  const refreshCacheMap = useCallback(async () => {
    const all = await readAllCachedVariants();
    setCachedByThread(all);
  }, []);

  // Phase F.1.5 step 2 — pull the live inbox from the FB tab. Translates the
  // SW response into status+rows the pane can render. `silent` skips toggling
  // the loading flag for poll-driven refreshes that shouldn't flicker the UI.
  //
  // Step 3 adds `merge`: when true, the new scrape is unioned with existing
  // rows (keyed by source+thread_id) instead of replacing — so virtualized
  // rows we already saw don't disappear when FB unloads them out of view.
  const refreshInbox = useCallback(async ({ silent, merge } = {}) => {
    if (!silent) setInboxStatus((s) => (s === 'idle' ? 'loading' : s));
    try {
      const res = await getInboxList();
      if (!res) {
        setInboxStatus('error');
        setInboxError('no_response');
        return;
      }
      if (res.ok) {
        const incoming = Array.isArray(res.rows) ? res.rows : [];
        setInboxRows((prev) => {
          if (!merge) return incoming;
          const byKey = new Map();
          for (const r of prev) byKey.set(`${r.source || 'marketplace'}:${r.thread_id}`, r);
          for (const r of incoming) byKey.set(`${r.source || 'marketplace'}:${r.thread_id}`, r);
          return [...byKey.values()];
        });
        setInboxStatus('ok');
        setInboxError(null);
        setInboxTabUrl(res.tabUrl || null);
        setInboxLayoutVersion(res.layoutVersion || null);
        setInboxLastUpdated(Date.now());
        return;
      }
      if (res.reason === 'tab_not_found') {
        if (!merge) setInboxRows([]);
        setInboxStatus('tab_not_found');
        setInboxError(null);
        setInboxTabUrl(null);
        return;
      }
      setInboxStatus('error');
      setInboxError(res.reason || 'unknown');
      setInboxTabUrl(res.tabUrl || null);
    } catch (err) {
      setInboxStatus('error');
      setInboxError(err?.message || 'rpc_failed');
    }
  }, []);

  // Phase F.1.5 step 3 — fired by ThreadList when the user scrolls the
  // extension list within 100px of its bottom. Debounce 1.5s so a quick
  // flick doesn't queue 10 scroll RPCs. Triggers FB-side scroll, then
  // re-fetches in merge mode so previously-visible rows stick.
  const handleScrollNearBottom = useCallback(async () => {
    const now = Date.now();
    if (now - lastScrollAtRef.current < INBOX_SCROLL_DEBOUNCE_MS) return;
    if (inboxLoadingMore) return;
    if (inboxAtBottom) return;
    lastScrollAtRef.current = now;
    setInboxLoadingMore(true);
    try {
      const res = await scrollInboxDown();
      if (res?.atBottom) setInboxAtBottom(true);
      // Refire the scrape regardless of scroll result — FB may have
      // injected rows even when the container can't scroll further (e.g.
      // small inbox, no virtualization needed).
      await refreshInbox({ silent: true, merge: true });
    } finally {
      setInboxLoadingMore(false);
    }
  }, [refreshInbox, inboxLoadingMore, inboxAtBottom]);

  // Initial mount: load settings, then list leads + cache map + first inbox.
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setSettings(s);
      await refreshLeads(s);
      await refreshCacheMap();
      await refreshInbox();
    })();
    function onResize() { setViewportTooSmall(window.innerWidth < MIN_VIEWPORT_WIDTH); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic refresh of the Supabase lead list (cheap GET).
  useEffect(() => {
    if (!settings) return;
    const id = setInterval(() => refreshLeads(), LEADS_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [settings, refreshLeads]);

  // Periodic refresh of the live FB inbox. Silent so UI doesn't flicker.
  useEffect(() => {
    const id = setInterval(() => refreshInbox({ silent: true }), INBOX_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshInbox]);

  // Listen for SW pushes: variants updated/started/failed.
  useEffect(() => {
    function onMsg(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'F1_VARIANTS_UPDATED') {
        setCachedByThread((prev) => ({ ...prev, [msg.thread_id]: msg.payload }));
        if (msg.thread_id === activeThreadId) {
          setActiveCached(msg.payload);
          setGeneratingFor(null);
        }
        refreshLeads();
      } else if (msg.type === 'F1_GENERATION_STARTED') {
        if (msg.thread_id === activeThreadId) {
          setGeneratingFor(msg.thread_id);
        }
      } else if (msg.type === 'F1_GENERATION_FAILED') {
        if (msg.thread_id === activeThreadId) {
          setGeneratingFor(null);
        }
      }
    }
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [activeThreadId, refreshLeads]);

  // When active thread changes: load cached variants. History is driven
  // by the click handler (handleSelectThread) via F1_5_OPEN_THREAD so the
  // FB tab is on the right thread before scraping.
  useEffect(() => {
    if (!activeThreadId) {
      setHistory([]);
      setActiveCached(null);
      return;
    }
    (async () => {
      const cached = await readCachedVariants(activeThreadId);
      setActiveCached(cached);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  // Phase F.1.5 step 4 — row click drives the FB tab silently to the thread
  // then scrapes. If OPEN_THREAD fails (row off-screen due to virtualization,
  // compose pane didn't render, etc.) we fall back to the legacy
  // GET_THREAD_HISTORY which works when the user manually navigates the FB
  // tab to that thread first.
  const handleSelectThread = useCallback(async (threadId, source) => {
    if (!threadId) return;
    setActiveThreadId(threadId);
    setHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);
    setOpeningThreadId(threadId);
    try {
      const res = await openThread(threadId, source || 'marketplace');
      if (res?.ok) {
        setHistory(Array.isArray(res.messages) ? res.messages : []);
        setHistoryError(null);
      } else {
        // Fallback: tab may be on this thread already, or content script is
        // not where we expect — try the read-only history RPC.
        const fb = await getThreadHistory(threadId);
        if (fb?.ok) {
          setHistory(Array.isArray(fb.messages) ? fb.messages : []);
          setHistoryError(null);
        } else {
          setHistory([]);
          setHistoryError(res?.reason || fb?.reason || 'open_failed');
        }
      }
    } catch (err) {
      setHistory([]);
      setHistoryError(err?.message || 'rpc_failed');
    } finally {
      setHistoryLoading(false);
      setOpeningThreadId(null);
    }
  }, []);

  async function handleRefreshHistory() {
    if (!activeThreadId) return;
    // Find current row to recover its source; default to marketplace.
    const row = mergedRows.find((r) => r.thread_id === activeThreadId);
    await handleSelectThread(activeThreadId, row?.source);
  }

  async function handleOpenInFb() {
    if (!activeThreadId) return;
    const res = await focusFbTab(activeThreadId);
    if (!res?.ok && res?.reason === 'fb_tab_not_open') {
      // Fall back to opening the FB thread URL in a new tab.
      const lead = leads.find((l) => l.thread_id === activeThreadId);
      if (lead?.fb_thread_url) {
        chrome.tabs.create({ url: lead.fb_thread_url });
      }
    }
  }

  async function handleManualRefreshInbox() {
    setInboxStatus('loading');
    setInboxAtBottom(false);
    lastScrollAtRef.current = 0;
    await refreshInbox();
  }

  function handleOpenInboxTab() {
    chrome.tabs.create({ url: 'https://www.facebook.com/marketplace/inbox' });
  }

  async function handleRegenerate(threadId) {
    if (!threadId) return;
    setGeneratingFor(threadId);
    const res = await requestRegenerate(threadId);
    if (!res?.ok) {
      console.warn('[FB Reply Maker FS] regenerate failed:', res?.reason);
      setGeneratingFor(null);
    }
  }

  // Phase F.1.5 step 2 — the left-pane data source is now the live inbox
  // joined to Supabase. Memoized so ThreadList only re-renders when one of
  // the inputs actually changes.
  const mergedRows = useMemo(
    () => mergeInboxWithLeads(inboxRows, leads),
    [inboxRows, leads]
  );

  // ThreadView still wants a Supabase lead shape. If the active thread is
  // in the live inbox but has no Supabase row yet, synthesize a minimal
  // lead-like object from the merged row so the center pane renders cleanly.
  const activeLead = useMemo(() => {
    if (!activeThreadId) return null;
    const fromSupabase = leads.find((l) => l.thread_id === activeThreadId);
    if (fromSupabase) return fromSupabase;
    const fromInbox = mergedRows.find((r) => r.thread_id === activeThreadId);
    if (!fromInbox) return null;
    return {
      thread_id: fromInbox.thread_id,
      partner_name: fromInbox.partner_name,
      listing_title: fromInbox.listing_title,
      status: null,
      fb_thread_url: null,
      open_flags: [],
      captured_fields: null
    };
  }, [activeThreadId, leads, mergedRows]);

  if (viewportTooSmall) {
    return (
      <div className="lead-center-narrow">
        <h1>Lead Center</h1>
        <p>This view needs a window at least {MIN_VIEWPORT_WIDTH}px wide. Make the window bigger or use the side panel.</p>
      </div>
    );
  }

  return (
    <div className="lead-center">
      <ThreadList
        rows={mergedRows}
        inboxStatus={inboxStatus}
        inboxError={inboxError}
        inboxTabUrl={inboxTabUrl}
        inboxLastUpdated={inboxLastUpdated}
        inboxLoadingMore={inboxLoadingMore}
        inboxAtBottom={inboxAtBottom}
        leadsLoading={leadsLoading}
        leadsError={leadsError}
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        activeThreadId={activeThreadId}
        openingThreadId={openingThreadId}
        onSelect={handleSelectThread}
        cachedByThread={cachedByThread}
        onRefresh={handleManualRefreshInbox}
        onOpenInboxTab={handleOpenInboxTab}
        onScrollNearBottom={handleScrollNearBottom}
      />
      <ThreadView
        lead={activeLead}
        history={history}
        historyLoading={historyLoading}
        historyError={historyError}
        onRefreshHistory={handleRefreshHistory}
        onOpenInFb={handleOpenInFb}
      />
      <ReplyPane
        threadId={activeThreadId}
        cached={activeCached}
        generating={generatingFor === activeThreadId}
        onRegenerate={handleRegenerate}
      />
    </div>
  );
}

