import { useCallback, useEffect, useState } from 'react';
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
  readAllCachedVariants
} from './lib/api.js';

const LEADS_REFRESH_INTERVAL_MS = 30 * 1000;
const MIN_VIEWPORT_WIDTH = 1280;

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

  // Initial mount: load settings, then list leads + cache map.
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setSettings(s);
      await refreshLeads(s);
      await refreshCacheMap();
    })();
    function onResize() { setViewportTooSmall(window.innerWidth < MIN_VIEWPORT_WIDTH); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic refresh of the lead list (cheap GET).
  useEffect(() => {
    if (!settings) return;
    const id = setInterval(() => refreshLeads(), LEADS_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [settings, refreshLeads]);

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

  // When active thread changes: load cached variants + fetch fresh history.
  useEffect(() => {
    if (!activeThreadId) {
      setHistory([]);
      setActiveCached(null);
      return;
    }
    (async () => {
      const cached = await readCachedVariants(activeThreadId);
      setActiveCached(cached);
      await fetchHistory(activeThreadId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  async function fetchHistory(threadId) {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await getThreadHistory(threadId);
      if (res?.ok) {
        setHistory(Array.isArray(res.messages) ? res.messages : []);
      } else {
        setHistory([]);
        setHistoryError(res?.reason || 'unknown');
      }
    } catch (err) {
      setHistory([]);
      setHistoryError(err?.message || 'rpc_failed');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleRefreshHistory() {
    if (activeThreadId) await fetchHistory(activeThreadId);
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

  async function handleRegenerate(threadId) {
    if (!threadId) return;
    setGeneratingFor(threadId);
    const res = await requestRegenerate(threadId);
    if (!res?.ok) {
      console.warn('[FB Reply Maker FS] regenerate failed:', res?.reason);
      setGeneratingFor(null);
    }
  }

  const activeLead = leads.find((l) => l.thread_id === activeThreadId) || null;

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
        leads={leads}
        loading={leadsLoading}
        error={leadsError}
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        activeThreadId={activeThreadId}
        onSelect={setActiveThreadId}
        cachedByThread={cachedByThread}
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
