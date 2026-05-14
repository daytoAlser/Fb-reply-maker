import { useEffect, useRef, useState } from 'react';
import IncomingPanel from './components/IncomingPanel.jsx';
import CategoryPicker from './components/CategoryPicker.jsx';
import VariantCard from './components/VariantCard.jsx';
import InventoryPicks from './components/InventoryPicks.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';
import AutoDetectCard from './components/AutoDetectCard.jsx';
import TabBar from './components/TabBar.jsx';
import LeadsTab from './components/LeadsTab.jsx';
import FlagBanner from './components/FlagBanner.jsx';
import MultiProductChips from './components/MultiProductChips.jsx';
import ReturningCustomerBanner from './components/ReturningCustomerBanner.jsx';
import LogOptionsModal from './components/LogOptionsModal.jsx';
import InboxTab from './components/InboxTab.jsx';
import { generateReply } from './lib/api.js';
import { loadAll } from './lib/storage.js';
import {
  getThreadIdFromUrl,
  createOrUpdateLead,
  getLeadByThreadId,
  getAllLeads,
  logManualOptionsSent,
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
  const [priorStatusSnapshot, setPriorStatusSnapshot] = useState(null);
  // Phase E.5 — track current lead's thread + status so the Log Options
  // Sent button can show/hide based on status === qualified, and so the
  // log helper can target the right lead. Modal open + submit-in-flight.
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [currentLeadStatus, setCurrentLeadStatus] = useState(null);
  const [logOptionsOpen, setLogOptionsOpen] = useState(false);
  const [loggingOptions, setLoggingOptions] = useState(false);

  const isManualRef = useRef(false);
  const lastAutoFilledRef = useRef('');
  // Live refs of the current detected thread + incoming. Used by
  // handleGenerate's stale-response guard to compare against the
  // CURRENT values when a response arrives, not the snapshot
  // captured when the call was fired (closures over state are stale
  // by the time async responses come back).
  const liveDetectedThreadIdRef = useRef(null);
  const liveIncomingRef = useRef('');

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
    chrome.storage.local.get('theme').then((d) => {
      const t = d?.theme === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
    });
    function onThemeChange(changes, area) {
      if (area !== 'local' || !changes.theme) return;
      const t = changes.theme.newValue === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
    }
    chrome.storage.onChanged.addListener(onThemeChange);
    return () => chrome.storage.onChanged.removeListener(onThemeChange);
  }, []);

  useEffect(() => {
    let q = 0;
    let f = 0;
    chrome.storage.local.get(['activeTab', 'unviewedQualifiedCount', 'unviewedFlaggedCount']).then((d) => {
      if (d.activeTab === 'reply' || d.activeTab === 'leads' || d.activeTab === 'inbox') setActiveTab(d.activeTab);
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

  // Local lead cache (chrome.storage.local) — passed to InboxTab so it can
  // mark known-lead rows with status pills. Refreshed when a lead is
  // created/updated by the auto-gen flow.
  const [localLeads, setLocalLeads] = useState([]);
  useEffect(() => {
    let mounted = true;
    async function pull() {
      try {
        const all = await getAllLeads();
        if (mounted) setLocalLeads(Array.isArray(all) ? all : []);
      } catch {}
    }
    pull();
    function onStorageChange(changes, area) {
      if (area === 'local' && changes.leads) pull();
    }
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);

  // Inbox row click → side panel doesn't manage activeThreadId directly;
  // the FB tab navigation will fire THREAD_UPDATE which the Reply tab
  // auto-detects. We just swap tabs back to Reply so the user sees the
  // variants for the freshly-opened thread.
  function handleInboxSelect(_threadId, _source) {
    handleTabChange('reply');
  }

  // Detected thread = the thread our content script reports on the
  // active FB tab. Distinct from `currentThreadId` (state above) which
  // tracks the thread we LAST RAN GENERATE FOR via the modal flow.
  const detectedThreadId = autoDetect?.status === 'ok'
    ? getThreadIdFromUrl(autoDetect.url || '')
    : null;
  // Mirror the latest values into refs so async callbacks (handleGenerate
  // response, broadcast listeners) can read the LIVE current state
  // instead of stale closure snapshots.
  useEffect(() => { liveDetectedThreadIdRef.current = detectedThreadId; }, [detectedThreadId]);
  useEffect(() => { liveIncomingRef.current = incoming; }, [incoming]);

  // Track which thread the currently-displayed result is for, so we wipe
  // cleanly when the user switches threads.
  const lastLoadedThreadRef = useRef(null);
  // Distinguish "first thread we saw" (cache hit is fine — page reload)
  // from "user switched threads" (always force fresh — cached context
  // may be stale even if source_message matches, e.g. lead capturedFields
  // changed since last write).
  const initialMountDoneRef = useRef(false);
  // Guard re-firing for the same thread while one is already in flight.
  // Cleared on thread switch so a new thread always gets a fresh fire.
  const inFlightTriggerRef = useRef(null);

  useEffect(() => {
    if (!detectedThreadId) return;
    const isThreadSwitch =
      lastLoadedThreadRef.current && lastLoadedThreadRef.current !== detectedThreadId;
    if (isThreadSwitch) {
      setResult(null);
      setError(null);
      inFlightTriggerRef.current = null;
    }
    lastLoadedThreadRef.current = detectedThreadId;

    let cancelled = false;
    async function loadAndMaybeRegen() {
      const liveSrc = (autoDetect?.latestIncoming || '').trim();
      const hasConfig = !!(settings?.config?.endpoint && settings?.config?.secret);

      // On INITIAL mount only: try the cache first (avoids burning a
      // generate call on every panel open / page reload). On thread
      // switch: always regen so context changes (lead state, captured
      // fields) get picked up — cached source_message match is not
      // sufficient signal that variants are still correct.
      if (!isThreadSwitch && !initialMountDoneRef.current) {
        try {
          const key = 'cached_variants:' + detectedThreadId;
          const data = await chrome.storage.local.get(key);
          const cached = data[key];
          if (cancelled) return;
          const cachedSrc = (cached?.source_message || '').trim();
          const sourceMatches = !liveSrc || cachedSrc === liveSrc;
          if (cached?.result && sourceMatches) {
            setResult(cached.result);
            setError(null);
            initialMountDoneRef.current = true;
            return;
          }
        } catch (err) {
          console.warn('[FB Reply Maker SP] cache read failed:', err?.message);
        }
      }
      initialMountDoneRef.current = true;

      // Auto-fire Generate. On thread switch we DO NOT block on
      // `loading` from a prior thread's in-flight call — the stale-
      // response guard inside handleGenerate will discard whichever
      // response arrives after the switch, so it's safe to start a new
      // one. Without this, switching mid-flight produces a stuck
      // display showing the prior thread's variants.
      if (!liveSrc || !hasConfig || isManualRef.current) return;
      const triggerKey = detectedThreadId + '|' + liveSrc;
      if (inFlightTriggerRef.current === triggerKey) return;
      inFlightTriggerRef.current = triggerKey;
      console.log('[FB Reply Maker SP] auto-firing Generate for thread', detectedThreadId, isThreadSwitch ? '(switch)' : '(initial/stale)');
      handleGenerate();
    }
    loadAndMaybeRegen();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedThreadId, autoDetect?.latestIncoming, settings?.config?.endpoint]);

  // Live SW broadcasts: VARIANTS_GENERATING shows the loading state,
  // VARIANTS_CACHED swaps in the freshly-generated variants when SW's
  // auto-gen finishes for the thread the user is viewing. Mounted once
  // — reads detectedThreadId from the live ref so a thread switch
  // between mount and message arrival doesn't paint stale variants.
  useEffect(() => {
    function onGenMsg(msg) {
      if (!msg) return;
      const liveThreadId = liveDetectedThreadIdRef.current;
      if (!liveThreadId) return;
      if (msg.thread_id !== liveThreadId) return;
      if (msg.type === 'VARIANTS_GENERATING') {
        setLoading(true);
        setError(null);
      } else if (msg.type === 'VARIANTS_CACHED' && msg.payload?.result) {
        setResult(msg.payload.result);
        setLoading(false);
        setError(null);
      } else if (msg.type === 'VARIANTS_FAILED') {
        setLoading(false);
        setError(msg.error || 'Auto-generate failed');
      }
    }
    chrome.runtime.onMessage.addListener(onGenMsg);
    return () => chrome.runtime.onMessage.removeListener(onGenMsg);
  }, []);

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

  async function handleGenerate({ overrideFlags = false, focusedProduct = null } = {}) {
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
    // Tag this generate call with the thread + incoming it was fired
    // for. When the response arrives, we discard it if the user has
    // since switched threads — otherwise a slow response from a prior
    // thread leaks onto the freshly-switched thread's display.
    const firedThreadId = autoDetect?.status === 'ok'
      ? getThreadIdFromUrl(autoDetect.url || '')
      : null;
    const firedIncoming = incoming;
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
      // Phase E.2: send conversation mode / silence / last_customer_message_at
      // / status / lastUpdated so the server's returning-customer detector has
      // the full prior state to work from.
      let existingCapturedFields = null;
      let existingProductsOfInterest = null;
      let existingConversationMode = null;
      let existingLastCustomerMessageAt = null;
      let existingStatus = null;
      let existingLastUpdated = null;
      let existingSilenceDurationMs = null;
      let existingManualOptionsLog = null;
      if (threadId) {
        try {
          const existingLead = await getLeadByThreadId(threadId);
          existingCapturedFields = existingLead?.capturedFields || null;
          existingProductsOfInterest = Array.isArray(existingLead?.productsOfInterest)
            ? existingLead.productsOfInterest
            : null;
          existingConversationMode = existingLead?.conversationMode || null;
          existingLastCustomerMessageAt = typeof existingLead?.lastCustomerMessageAt === 'number'
            ? existingLead.lastCustomerMessageAt
            : null;
          existingStatus = existingLead?.status || null;
          existingLastUpdated = typeof existingLead?.lastUpdated === 'number'
            ? existingLead.lastUpdated
            : null;
          existingSilenceDurationMs = typeof existingLead?.silenceDurationMs === 'number'
            ? existingLead.silenceDurationMs
            : null;
          existingManualOptionsLog = Array.isArray(existingLead?.manualOptionsLog)
            ? existingLead.manualOptionsLog
            : null;
        } catch (err) {
          console.warn('[FB Reply Maker SP] read existing lead failed:', err?.message);
        }
      }
      // Capture prior status for the returning banner's subtitle (we want to
      // show what the lead WAS before this turn potentially changed it).
      setPriorStatusSnapshot(existingStatus);

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
        existingConversationMode,
        existingStatus,
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
        existing_products_of_interest: existingProductsOfInterest || undefined,
        existing_conversation_mode: existingConversationMode || undefined,
        existing_last_customer_message_at: existingLastCustomerMessageAt || undefined,
        existing_status: existingStatus || undefined,
        existing_last_updated: existingLastUpdated || undefined,
        existing_silence_duration_ms: typeof existingSilenceDurationMs === 'number'
          ? existingSilenceDurationMs
          : undefined,
        existing_manual_options_log: existingManualOptionsLog && existingManualOptionsLog.length > 0
          ? existingManualOptionsLog
          : undefined,
        focusedProduct: focusedProduct || undefined
      });

      if (overrideFlags) setOverrideActive(true);

      console.log('[FB Reply Maker SP] response meta:', {
        ad_type: res?.ad_type,
        lead_status_suggestion: res?.lead_status_suggestion,
        conversation_stage: res?.conversation_stage,
        customerType: res?.extracted_fields?.customerType,
        flags: res?.flags,
        extracted_fields: res?.extracted_fields,
        ready_for_options: res?.ready_for_options,
        conversation_mode: res?.conversation_mode,
        silence_duration_ms: res?.silence_duration_ms,
        returning_first_trigger: res?.returning_first_trigger,
        returning_reason: res?.returning_reason,
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
            productsOfInterest: Array.isArray(res?.products_of_interest) ? res.products_of_interest : null,
            readyForOptions: typeof res?.ready_for_options === 'boolean' ? res.ready_for_options : undefined,
            conversationMode: typeof res?.conversation_mode === 'string' ? res.conversation_mode : undefined,
            silenceDurationMs: typeof res?.silence_duration_ms === 'number' ? res.silence_duration_ms : undefined,
            lastCustomerMessageAt: typeof res?.last_customer_message_at === 'number' ? res.last_customer_message_at : undefined
          });
          console.log('[FB Reply Maker SP] lead updated:', lead?.threadId);
          // Phase E.5: track current lead so Log Options Sent button can
          // gate its visibility on status.
          setCurrentThreadId(lead?.threadId || threadId || null);
          setCurrentLeadStatus(lead?.status || null);
        } catch (err) {
          console.error('[FB Reply Maker SP] lead update failed:', err);
        }
      } else {
        console.log('[FB Reply Maker SP] no threadId on active tab URL, skipping lead update — url:', fbThreadUrl);
      }

      // Stale-response guard: discard if the user switched threads or
      // edited the incoming since this call was fired. Reads from the
      // LIVE refs (not closure snapshots, which would still hold the
      // values at fire time and never trip).
      const liveThreadId = liveDetectedThreadIdRef.current;
      const liveIncoming = liveIncomingRef.current;
      if (firedThreadId && firedThreadId !== liveThreadId) {
        console.log('[FB Reply Maker SP] discarding stale generate response — fired for', firedThreadId, 'now on', liveThreadId);
        return;
      }
      if (firedIncoming !== liveIncoming) {
        console.log('[FB Reply Maker SP] discarding stale generate response — incoming changed mid-flight');
        return;
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
        inboxBadgeCount={0}
      />

      {activeTab === 'inbox' ? (
        <InboxTab
          onSelectThread={handleInboxSelect}
          currentThreadId={autoDetect?.status === 'ok' ? getThreadIdFromUrl(autoDetect.url || '') : null}
          leads={localLeads}
        />
      ) : activeTab === 'reply' ? (
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
              {result.conversation_mode === 'returning' && (
                <ReturningCustomerBanner
                  silenceDurationMs={result.silence_duration_ms}
                  priorStatus={priorStatusSnapshot}
                  reason={result.returning_reason}
                />
              )}
              <MultiProductChips products={result.products_of_interest} />
              {result.ready_for_options && (
                <div className="ready-banner" role="status" aria-label="Ready for options">
                  <span className="ready-banner-icon" aria-hidden="true">{'\u{1F3AF}'}</span>
                  <span className="ready-banner-title">READY FOR OPTIONS</span>
                  <span className="ready-banner-body">All tracked products are qualified. Time to pull options for this customer.</span>
                </div>
              )}
              <FlagBanner
                flags={result.flags || []}
                overrideActive={overrideActive}
                onOverride={() => handleGenerate({ overrideFlags: true })}
                loading={loading}
              />
              <InventoryPicks
                meta={result.inventory_meta}
                onPickClick={(pick) => handleGenerate({ focusedProduct: pick })}
                disabled={loading}
              />
              <p className="insert-tip">
                Tip: click on the @name in FB's reply box to convert it to a real tag before sending.
              </p>
              <VariantCard kind="quick" text={result.variants.quick} />
              <VariantCard kind="standard" text={result.variants.standard} />
              <VariantCard kind="detailed" text={result.variants.detailed} />
              <div className="post-variant-actions">
                <button
                  className="btn-secondary"
                  onClick={() => handleGenerate()}
                  disabled={loading}
                >
                  Regenerate
                </button>
                {currentThreadId && (currentLeadStatus === 'qualified' || currentLeadStatus === 'options_sent') && (
                  <button
                    className="btn-secondary log-options-btn"
                    onClick={() => setLogOptionsOpen(true)}
                    disabled={loading || loggingOptions}
                    title="Record what you just sent the customer so the next reply has context"
                  >
                    {currentLeadStatus === 'options_sent' ? '+ Log More Options' : 'Log Options Sent'}
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      ) : (
        <LeadsTab />
      )}

      <LogOptionsModal
        open={logOptionsOpen}
        submitting={loggingOptions}
        onClose={() => setLogOptionsOpen(false)}
        onSubmit={async (entries) => {
          if (!currentThreadId) {
            setLogOptionsOpen(false);
            return;
          }
          setLoggingOptions(true);
          try {
            const updated = await logManualOptionsSent(currentThreadId, entries);
            if (updated) {
              setCurrentLeadStatus(updated.status || 'options_sent');
              console.log('[FB Reply Maker SP] manual options logged:', entries.length, 'entries');
            }
          } catch (err) {
            console.error('[FB Reply Maker SP] log options failed:', err);
          } finally {
            setLoggingOptions(false);
            setLogOptionsOpen(false);
          }
        }}
      />
    </div>
  );
}
