import { useEffect, useRef, useState } from 'react';
import IncomingPanel from './components/IncomingPanel.jsx';
import CategoryPicker from './components/CategoryPicker.jsx';
import VariantCard from './components/VariantCard.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';
import AutoDetectCard from './components/AutoDetectCard.jsx';
import TabBar from './components/TabBar.jsx';
import LeadsTab from './components/LeadsTab.jsx';
import FlagBanner from './components/FlagBanner.jsx';
import MultiProductChips from './components/MultiProductChips.jsx';
import { generateReply } from './lib/api.js';
import { loadAll } from './lib/storage.js';
import {
  getThreadIdFromUrl,
  createOrUpdateLead,
  getLeadByThreadId,
  migrateLeadsToSupabase,
  retrySyncPending
} from './lib/leads.js';

const CATEGORIES = [
  'auto',
  'availability',
  'fitment',
  'price_haggle',
  'location_hours',
  'delivery_shipping',
  'stock_check',
  'install_service',
  'trade_in',
  'other'
];

export default function App() {
  const [incoming, setIncoming] = useState('');
  const [categoryOverride, setCategoryOverride] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [settings, setSettings] = useState(null);
  const [autoDetect, setAutoDetect] = useState(null);
  const [isManual, setIsManual] = useState(false);
  const [activeTab, setActiveTab] = useState('reply');
  const [leadsBadgeCount, setLeadsBadgeCount] = useState(0);
  const [overrideActive, setOverrideActive] = useState(false);

  const isManualRef = useRef(false);
  const lastAutoFilledRef = useRef('');

  function markManual(val) {
    isManualRef.current = val;
    setIsManual(val);
  }

  function applyAutoDetect(payload) {
    setAutoDetect((prev) => {
      // Never let a placeholder (no_cache / no_thread_detected / no_active_tab)
      // overwrite a previously successful scrape. The SW loses its tabState
      // when it sleeps, so GET_CURRENT_THREAD can briefly return empty while
      // the content script catches up.
      if (payload?.status !== 'ok' && prev?.status === 'ok') return prev;
      return payload;
    });
    if (
      payload?.status === 'ok' &&
      payload.latestIncoming &&
      !isManualRef.current &&
      payload.latestIncoming !== lastAutoFilledRef.current
    ) {
      lastAutoFilledRef.current = payload.latestIncoming;
      setIncoming(payload.latestIncoming);
    }
  }

  function requestCurrentThread() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_THREAD' }, (res) => {
      if (chrome.runtime.lastError) return;
      applyAutoDetect(res);
    });
  }

  function rescanAndRefresh() {
    // Forces the content script to rebroadcast its current scrape, then
    // re-queries the SW. Used on mount and on tab change so an idled SW
    // does not leave us looking at stale or empty autoDetect state.
    chrome.runtime.sendMessage({ type: 'REQUEST_RESCAN' }, () => {
      if (chrome.runtime.lastError) return;
      setTimeout(requestCurrentThread, 250);
    });
    requestCurrentThread();
  }

  useEffect(() => {
    loadAll().then((data) => {
      setSettings(data);
      setCategoryOverride(data.preferences?.defaultCategory || 'auto');
    });
    migrateLeadsToSupabase().catch((err) =>
      console.warn('[FB Reply Maker SP] migration error:', err?.message)
    );
    retrySyncPending().catch((err) =>
      console.warn('[FB Reply Maker SP] retry sweep error:', err?.message)
    );
  }, []);

  useEffect(() => {
    let q = 0;
    let f = 0;
    chrome.storage.local.get(['activeTab', 'unviewedQualifiedCount', 'unviewedFlaggedCount']).then((d) => {
      if (d.activeTab === 'reply' || d.activeTab === 'leads') setActiveTab(d.activeTab);
      if (typeof d.unviewedQualifiedCount === 'number') q = d.unviewedQualifiedCount;
      if (typeof d.unviewedFlaggedCount === 'number') f = d.unviewedFlaggedCount;
      setLeadsBadgeCount(q + f);
    });
    function onChanged(changes, area) {
      if (area !== 'local') return;
      if (changes.unviewedQualifiedCount) {
        q = changes.unviewedQualifiedCount.newValue || 0;
        setLeadsBadgeCount(q + f);
      }
      if (changes.unviewedFlaggedCount) {
        f = changes.unviewedFlaggedCount.newValue || 0;
        setLeadsBadgeCount(q + f);
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  function handleTabChange(tab) {
    setActiveTab(tab);
    chrome.storage.local.set({ activeTab: tab }).catch(() => {});
  }

  useEffect(() => {
    rescanAndRefresh();

    function onMessage(msg) {
      if (msg?.type !== 'THREAD_BROADCAST') return;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeId = tabs?.[0]?.id;
        if (activeId && activeId === msg.tabId) {
          applyAutoDetect(msg.payload);
        }
      });
    }
    chrome.runtime.onMessage.addListener(onMessage);

    function onActivated() {
      rescanAndRefresh();
    }
    chrome.tabs.onActivated.addListener(onActivated);

    function onUpdated(_tabId, changeInfo) {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        rescanAndRefresh();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);

    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  function handleIncomingChange(value) {
    setIncoming(value);
    if (value !== lastAutoFilledRef.current) {
      markManual(true);
    }
  }

  function handleUseThis() {
    const latest = autoDetect?.latestIncoming;
    if (!latest) return;
    lastAutoFilledRef.current = latest;
    setIncoming(latest);
    markManual(false);
  }

  function handleRefresh() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'REQUEST_RESCAN' }, () => {
        setTimeout(() => {
          requestCurrentThread();
          resolve();
        }, 200);
      });
    });
  }

  async function handleGenerate({ overrideFlags = false } = {}) {
    setError(null);
    if (!incoming.trim()) {
      setError('Paste an incoming message first.');
      return;
    }
    if (!settings?.config?.endpoint || !settings?.config?.secret) {
      setError('Configure endpoint and secret in the options page.');
      return;
    }
    if (!overrideFlags) setOverrideActive(false);
    setLoading(true);
    setResult(null);
    try {
      const conversationHistory =
        autoDetect?.status === 'ok' &&
        Array.isArray(autoDetect.conversationHistory) &&
        autoDetect.conversationHistory.length > 0
          ? autoDetect.conversationHistory
          : null;

      const partnerName = (autoDetect?.partnerName || '').trim();
      const listingTitle = (autoDetect?.listingTitle || '').trim();
      const userName = (settings.userName || '').trim();

      if (!userName) {
        console.warn('[FB Reply Maker SP] WARNING: userName missing — set it in Options to personalize opener');
      }

      // Pull the FB thread URL from the active tab first; this is the most
      // reliable source for thread_id. Fall back to autoDetect.url if the
      // tab query fails for any reason.
      let activeTabUrl = null;
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTabUrl = activeTab?.url || null;
      } catch {
        // ignore; falls through to autoDetect.url
      }
      const fbThreadUrl = activeTabUrl || autoDetect?.url || null;
      const threadId = getThreadIdFromUrl(fbThreadUrl);

      // Server-side mergeCapturedFields needs the lead's existing capture so
      // we never overwrite a known vehicle / look / height with a null from
      // a later turn that did not re-extract them.
      // Phase E.1: also send existing productsOfInterest so the server merge
      // preserves products tracked earlier in the thread (the AI sometimes
      // forgets a product mentioned many turns back).
      let existingCapturedFields = null;
      let existingProductsOfInterest = null;
      if (threadId) {
        try {
          const existingLead = await getLeadByThreadId(threadId);
          existingCapturedFields = existingLead?.capturedFields || null;
          existingProductsOfInterest = Array.isArray(existingLead?.productsOfInterest)
            ? existingLead.productsOfInterest
            : null;
        } catch (err) {
          console.warn('[FB Reply Maker SP] read existing lead failed:', err?.message);
        }
      }

      console.log('[FB Reply Maker SP] request payload:', {
        hasMessage: !!incoming,
        messageLength: incoming?.length,
        userName: settings?.userName,
        partnerName: partnerName || null,
        listingTitle: listingTitle || null,
        threadId: threadId || null,
        fbThreadUrl: fbThreadUrl || null,
        hasExistingCaptured: !!existingCapturedFields,
        existingProductCount: existingProductsOfInterest?.length || 0,
        historyLength: conversationHistory?.length,
        category: categoryOverride
      });

      const res = await generateReply({
        endpoint: settings.config.endpoint,
        secret: settings.config.secret,
        message: incoming,
        context: settings.context,
        categoryOverride,
        conversationHistory,
        userName: userName || undefined,
        partnerName: partnerName || undefined,
        listingTitle: listingTitle || undefined,
        location: settings.location || undefined,
        overrideFlags,
        thread_id: threadId || undefined,
        fb_thread_url: fbThreadUrl || undefined,
        existing_captured_fields: existingCapturedFields || undefined,
        existing_products_of_interest: existingProductsOfInterest || undefined
      });

      if (overrideFlags) setOverrideActive(true);

      console.log('[FB Reply Maker SP] response meta:', {
        ad_type: res?.ad_type,
        lead_status_suggestion: res?.lead_status_suggestion,
        conversation_stage: res?.conversation_stage,
        customerType: res?.extracted_fields?.customerType,
        flags: res?.flags,
        extracted_fields: res?.extracted_fields,
        products_of_interest: Array.isArray(res?.products_of_interest)
          ? res.products_of_interest.map((p) => `${p.productType}:${p.productState}`)
          : null
      });

      if (threadId) {
        try {
          const lead = await createOrUpdateLead({
            threadId,
            partnerName: autoDetect?.partnerName || null,
            fbThreadUrl,
            listingTitle: autoDetect?.listingTitle || null,
            adType: res?.ad_type || 'unknown',
            extractedFields: res?.extracted_fields || {},
            leadStatusSuggestion: res?.lead_status_suggestion || null,
            conversationStage: res?.conversation_stage || null,
            flags: Array.isArray(res?.flags) ? res.flags : [],
            overrideFlags,
            customerMessage: incoming,
            productsOfInterest: Array.isArray(res?.products_of_interest) ? res.products_of_interest : null
          });
          console.log('[FB Reply Maker SP] lead updated:', lead?.threadId);
        } catch (err) {
          console.error('[FB Reply Maker SP] lead update failed:', err);
        }
      } else {
        console.log('[FB Reply Maker SP] no threadId on active tab URL, skipping lead update — url:', fbThreadUrl);
      }

      setResult(res);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>FB Reply Maker</h1>
        <button
          className="icon-btn"
          onClick={() => chrome.runtime.openOptionsPage()}
          title="Settings"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </header>

      <TabBar
        activeTab={activeTab}
        onChange={handleTabChange}
        leadsBadgeCount={leadsBadgeCount}
      />

      {activeTab === 'reply' ? (
        <>
          <AutoDetectCard
            autoDetect={autoDetect}
            isManual={isManual}
            onUseThis={handleUseThis}
            onRefresh={handleRefresh}
          />

          <IncomingPanel value={incoming} onChange={handleIncomingChange} />

          <CategoryPicker
            categories={CATEGORIES}
            value={categoryOverride}
            onChange={setCategoryOverride}
          />

          <button
            className="btn-primary"
            onClick={() => handleGenerate()}
            disabled={loading}
          >
            {loading ? 'Generating…' : 'Generate Replies'}
          </button>

          {error && <ErrorBanner message={error} />}

          {result && (
            <section className="results">
              <div className="result-header">
                <span className="badge">{result.category}</span>
                <p className="intent">{result.intent_summary}</p>
              </div>
              <MultiProductChips products={result.products_of_interest} />
              <FlagBanner
                flags={result.flags || []}
                overrideActive={overrideActive}
                onOverride={() => handleGenerate({ overrideFlags: true })}
                loading={loading}
              />
              <p className="insert-tip">
                Tip: click on the @name in FB's reply box to convert it to a real tag before sending.
              </p>
              <VariantCard kind="quick" text={result.variants.quick} />
              <VariantCard kind="standard" text={result.variants.standard} />
              <VariantCard kind="detailed" text={result.variants.detailed} />
              <button
                className="btn-secondary"
                onClick={() => handleGenerate()}
                disabled={loading}
              >
                Regenerate
              </button>
            </section>
          )}
        </>
      ) : (
        <LeadsTab />
      )}
    </div>
  );
}
