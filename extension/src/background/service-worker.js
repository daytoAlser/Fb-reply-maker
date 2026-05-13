// Phase F.1: action icon now opens the full-screen lead center instead of
// the side panel. Side panel is still installed (chrome://extensions side
// panel toggle / right-click → "Open side panel") for back-compat, but the
// icon is the primary entry point.
//
// IMPORTANT: This block runs at the top of the SW. Anything that throws
// synchronously here would prevent the action.onClicked listener below
// from registering. Defensive try/catch + optional chaining to survive
// older Chromes / unexpected API states.
try {
  chrome.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: false })
    ?.catch((err) => console.error('[FB Reply Maker SW] sidePanel.setPanelBehavior rejected:', err?.message || err));
} catch (err) {
  console.error('[FB Reply Maker SW] sidePanel.setPanelBehavior threw:', err?.message || err);
}

const FULLSCREEN_PATH = 'src/fullscreen/index.html';

async function openOrFocusFullscreen() {
  console.log('[FB Reply Maker SW] openOrFocusFullscreen entry');
  const url = chrome.runtime.getURL(FULLSCREEN_PATH);
  console.log('[FB Reply Maker SW] fullscreen url:', url);
  try {
    let existing = [];
    try {
      existing = await chrome.tabs.query({ url });
    } catch (qErr) {
      console.warn('[FB Reply Maker SW] tabs.query failed, proceeding to create:', qErr?.message || qErr);
    }
    if (existing && existing.length > 0) {
      const tab = existing[0];
      console.log('[FB Reply Maker SW] focusing existing fullscreen tab', tab.id);
      try {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        return;
      } catch (focusErr) {
        console.warn('[FB Reply Maker SW] focus existing failed, will create new:', focusErr?.message || focusErr);
      }
    }
    console.log('[FB Reply Maker SW] creating new fullscreen tab');
    const created = await chrome.tabs.create({ url });
    console.log('[FB Reply Maker SW] created tab id:', created?.id);
  } catch (err) {
    console.error('[FB Reply Maker SW] openOrFocusFullscreen failed:', err?.message || err);
  }
}

// Register the action listener as early as possible so it survives any
// downstream init failures. Wrapped in try/catch so the addListener call
// itself can't crash the SW startup.
try {
  chrome.action.onClicked.addListener((tab) => {
    console.log('[FB Reply Maker SW] action.onClicked fired from tab', tab?.id);
    openOrFocusFullscreen();
  });
  console.log('[FB Reply Maker SW] action.onClicked listener registered');
} catch (err) {
  console.error('[FB Reply Maker SW] action.onClicked.addListener threw:', err?.message || err);
}

const BADGE_COLOR = '#f59e0b';

async function restoreBadgeFromStorage() {
  try {
    const data = await chrome.storage.local.get('unviewedQualifiedCount');
    const count = typeof data.unviewedQualifiedCount === 'number' ? data.unviewedQualifiedCount : 0;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    console.log('[FB Reply Maker SW] badge restored to', count);
  } catch (err) {
    console.warn('[FB Reply Maker SW] badge restore failed:', err?.message || err);
  }
}

restoreBadgeFromStorage();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.unviewedQualifiedCount) {
    const count = changes.unviewedQualifiedCount.newValue || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
  }
});

const CONTENT_SCRIPT_ID = 'marketplace';
// Phase F.1.5: selectors.js MUST come first so globalThis.FBRM_SELECTORS
// exists before marketplace.js runs. Same isolated world, sequential execution.
const CONTENT_SCRIPT_FILES = [
  'content/selectors.js',
  'content/marketplace.js'
];
const CONTENT_SCRIPT_MATCHES = [
  'https://*.facebook.com/*',
  'https://*.messenger.com/*'
];

// onStartup, onInstalled, and the startup IIFE all call this; if any two
// race we get "Duplicate script ID 'marketplace'" which leaves the SW in
// a partially-initialized state. Module-level promise serializes them, and
// we update-in-place when an existing registration is found instead of
// the unregister-then-register dance.
let registerInFlight = null;
const CONTENT_SCRIPT_DEF = {
  id: CONTENT_SCRIPT_ID,
  matches: CONTENT_SCRIPT_MATCHES,
  js: CONTENT_SCRIPT_FILES,
  runAt: 'document_idle',
  world: 'ISOLATED'
};

async function registerContentScripts() {
  if (registerInFlight) return registerInFlight;
  registerInFlight = (async () => {
    try {
      const existing = await chrome.scripting
        .getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] })
        .catch(() => []);
      if (existing && existing.length > 0) {
        await chrome.scripting.updateContentScripts([CONTENT_SCRIPT_DEF]);
        console.log('[FB Reply Maker SW] content script updated in place');
      } else {
        await chrome.scripting.registerContentScripts([
          { ...CONTENT_SCRIPT_DEF, persistAcrossSessions: true }
        ]);
        console.log('[FB Reply Maker SW] content script registered fresh');
      }
    } catch (err) {
      console.error('[FB Reply Maker SW] registerContentScripts failed:', err?.message || err);
    } finally {
      registerInFlight = null;
    }
  })();
  return registerInFlight;
}

(async () => {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    console.log('[FB Reply Maker SW] starting, registered scripts:', scripts);
    if (!scripts.find((s) => s.id === CONTENT_SCRIPT_ID)) {
      console.log('[FB Reply Maker SW] no registration found at startup; registering now');
      await registerContentScripts();
    }
  } catch (err) {
    console.error('[FB Reply Maker SW] startup log failed:', err);
  }
})();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FB Reply Maker SW] onInstalled');
  registerContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[FB Reply Maker SW] onStartup');
  registerContentScripts();
});

const tabState = new Map();

// Phase F.1 — full-screen lead center plumbing
// =============================================

function getThreadIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/t\/([^/?#]+)/);
  return m ? m[1] : null;
}

function findTabForThread(threadId) {
  if (!threadId) return null;
  for (const [tabId, payload] of tabState.entries()) {
    const id = getThreadIdFromUrl(payload?.url || '');
    if (id === threadId) return tabId;
  }
  return null;
}

// Phase F.1.5 — locate the FB inbox tab the user has open.
//
// Two FB surfaces are supported in F.1.5: facebook.com/marketplace/inbox
// (Marketplace) and facebook.com/messages (Messenger). business.facebook.com
// Pages Manager is intentionally excluded — its DOM uses a different anchor
// scheme that step 1's selectors don't recognize.
const INBOX_TAB_URL_PATTERNS = [
  'https://*.facebook.com/marketplace/inbox*',
  'https://*.facebook.com/marketplace/inbox/*',
  'https://*.facebook.com/marketplace/t/*',
  'https://*.facebook.com/messages*',
  'https://*.facebook.com/messages/*',
  'https://*.facebook.com/messages/t/*',
  'https://*.messenger.com/marketplace/*',
  'https://*.messenger.com/t/*'
];

// Higher score = better match. Both /marketplace/inbox and /messages are
// canonical inbox surfaces; we score /messages slightly lower so that when
// the user has both open the marketplace tab wins (marketplace threads are
// the primary lead source for CCAW).
function scoreInboxTabUrl(url) {
  if (!url || typeof url !== 'string') return 0;
  if (/\/\/[^/]*facebook\.com\/marketplace\/inbox/i.test(url)) return 100;
  if (/\/\/[^/]*facebook\.com\/marketplace\/t\//i.test(url)) return 90;
  if (/\/\/[^/]*facebook\.com\/messages\/t\//i.test(url)) return 80;
  if (/\/\/[^/]*facebook\.com\/messages\b/i.test(url)) return 70;
  if (/\/\/[^/]*messenger\.com\/marketplace/i.test(url)) return 60;
  if (/\/\/[^/]*messenger\.com\/t\//i.test(url)) return 50;
  return 0;
}

function rankInboxTabs(tabs) {
  return tabs.slice().sort((a, b) => {
    const sa = scoreInboxTabUrl(a.url);
    const sb = scoreInboxTabUrl(b.url);
    if (sb !== sa) return sb - sa;
    const la = typeof a.lastAccessed === 'number' ? a.lastAccessed : 0;
    const lb = typeof b.lastAccessed === 'number' ? b.lastAccessed : 0;
    if (lb !== la) return lb - la;
    if ((b.active ? 1 : 0) !== (a.active ? 1 : 0)) return (b.active ? 1 : 0) - (a.active ? 1 : 0);
    return (b.id || 0) - (a.id || 0);
  });
}

async function findInboxTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: INBOX_TAB_URL_PATTERNS });
    if (!tabs || tabs.length === 0) return [];
    const ranked = rankInboxTabs(tabs);
    console.log(
      '[FB Reply Maker SW] inbox candidates:',
      ranked.map((t) => ({ id: t.id, score: scoreInboxTabUrl(t.url), url: t.url }))
    );
    return ranked;
  } catch (err) {
    console.warn('[FB Reply Maker SW] findInboxTabs failed:', err?.message || err);
    return [];
  }
}

// Shared inbox-tab dispatcher. Walks the ranked candidate list, retries
// once with executeScript if the content script wasn't registered on a
// candidate tab. Used by both F1_5_GET_INBOX and F1_5_SCROLL_INBOX.
async function callInboxTab(messageBody) {
  const candidates = await findInboxTabs();
  if (candidates.length === 0) return { ok: false, reason: 'tab_not_found' };
  const attempts = [];
  for (const tab of candidates) {
    if (!tab.id) continue;
    const attempt = { tabId: tab.id, tabUrl: tab.url };
    try {
      const res = await chrome.tabs.sendMessage(tab.id, messageBody);
      if (res && typeof res === 'object') {
        return { ...res, tabId: tab.id, tabUrl: tab.url, attempts };
      }
      attempt.reason = 'no_response';
    } catch (err) {
      attempt.reason = err?.message || 'rpc_failed';
      if (/Receiving end does not exist|Could not establish connection/i.test(attempt.reason)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: CONTENT_SCRIPT_FILES
          });
          const res2 = await chrome.tabs.sendMessage(tab.id, messageBody);
          if (res2 && typeof res2 === 'object') {
            return { ...res2, tabId: tab.id, tabUrl: tab.url, injected: true, attempts };
          }
          attempt.injectRetry = 'no_response';
        } catch (e2) {
          attempt.injectRetry = e2?.message || 'inject_failed';
        }
      }
    }
    attempts.push(attempt);
  }
  return { ok: false, reason: 'all_candidates_failed', attempts };
}

const CACHE_KEY_PREFIX = 'cached_variants:';
const AUTO_GEN_MIN_WORDS = 3;
const AUTO_GEN_SKIP_STATUSES = new Set(['closed_won', 'closed_lost', 'stale']);
const inFlightThreads = new Set();
const lastSeenIncoming = new Map(); // threadId → text

async function loadGenerationSettings() {
  const sync = await chrome.storage.sync.get(['userName', 'config', 'context', 'location']);
  return {
    userName: typeof sync.userName === 'string' ? sync.userName : '',
    config: sync.config || {},
    context: sync.context || null,
    location: sync.location || null
  };
}

async function readCachedVariants(threadId) {
  if (!threadId) return null;
  const key = CACHE_KEY_PREFIX + threadId;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

async function writeCachedVariants(threadId, payload) {
  if (!threadId) return;
  const key = CACHE_KEY_PREFIX + threadId;
  await chrome.storage.local.set({ [key]: payload });
}

async function clearCachedVariants(threadId) {
  if (!threadId) return;
  const key = CACHE_KEY_PREFIX + threadId;
  await chrome.storage.local.remove(key);
}

function pushToFullscreen(message) {
  // Fire-and-forget broadcast. The fullscreen page (if open) listens via
  // chrome.runtime.onMessage; nothing else cares about these types.
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // ignore
  }
}

async function runGenerateReply({
  threadId,
  url,
  message,
  partnerName,
  listingTitle,
  conversationHistory
}) {
  const settings = await loadGenerationSettings();
  if (!settings.config?.endpoint || !settings.config?.secret) {
    console.warn('[FB Reply Maker SW] auto-gen skipped: missing endpoint/secret');
    return { ok: false, reason: 'missing_config' };
  }

  // Hydrate prior state from the lead cache so the server has full context
  // for mergeCapturedFields / merge products_of_interest / returning-mode
  // detection. Mirrors what App.jsx does in the sidepanel.
  const leadsData = await chrome.storage.local.get('leads');
  const existingLead = leadsData.leads?.[threadId] || null;

  const body = {
    message,
    context: settings.context,
    categoryOverride: 'auto',
    userName: settings.userName || undefined,
    partnerName: partnerName || undefined,
    listingTitle: listingTitle || undefined,
    location: settings.location || undefined,
    thread_id: threadId,
    fb_thread_url: url
  };
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    body.conversation_history = conversationHistory;
  }
  if (existingLead?.capturedFields && typeof existingLead.capturedFields === 'object') {
    body.existing_captured_fields = existingLead.capturedFields;
  }
  if (Array.isArray(existingLead?.productsOfInterest) && existingLead.productsOfInterest.length > 0) {
    body.existing_products_of_interest = existingLead.productsOfInterest;
  }
  if (typeof existingLead?.conversationMode === 'string' && existingLead.conversationMode) {
    body.existing_conversation_mode = existingLead.conversationMode;
  }
  if (typeof existingLead?.lastCustomerMessageAt === 'number' && existingLead.lastCustomerMessageAt > 0) {
    body.existing_last_customer_message_at = existingLead.lastCustomerMessageAt;
  }
  if (typeof existingLead?.status === 'string' && existingLead.status) {
    body.existing_status = existingLead.status;
  }
  if (typeof existingLead?.lastUpdated === 'number' && existingLead.lastUpdated > 0) {
    body.existing_last_updated = existingLead.lastUpdated;
  }
  if (typeof existingLead?.silenceDurationMs === 'number' && existingLead.silenceDurationMs >= 0) {
    body.existing_silence_duration_ms = existingLead.silenceDurationMs;
  }

  console.log('[FB Reply Maker SW] auto-gen → generate-reply', { threadId, msgLen: message.length });

  const res = await fetch(settings.config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-secret': settings.config.secret },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text || res.statusText}`);
  }
  return res.json();
}

async function maybeAutoGenerate({ threadId, payload }) {
  if (!threadId) return;
  if (inFlightThreads.has(threadId)) return;

  const latestIncoming = (payload?.latestIncoming || '').trim();
  if (!latestIncoming) return;
  const wordCount = latestIncoming.split(/\s+/).filter(Boolean).length;
  if (wordCount < AUTO_GEN_MIN_WORDS) return;

  // De-dupe against the most recent fire for the same exact incoming text.
  const seen = lastSeenIncoming.get(threadId);
  if (seen === latestIncoming) return;

  // Closed/stale leads: skip. (Read from chrome.storage.local — same cache
  // that leads.js writes after every generate.)
  const leadsData = await chrome.storage.local.get('leads');
  const lead = leadsData.leads?.[threadId];
  if (lead && AUTO_GEN_SKIP_STATUSES.has(lead.status)) {
    console.log('[FB Reply Maker SW] auto-gen skipped: lead status =', lead.status);
    lastSeenIncoming.set(threadId, latestIncoming);
    return;
  }

  // Same-message cache check: if the cache already holds variants generated
  // from this exact message, don't burn another API call.
  const cached = await readCachedVariants(threadId);
  if (cached?.source_message === latestIncoming) {
    lastSeenIncoming.set(threadId, latestIncoming);
    return;
  }

  inFlightThreads.add(threadId);
  pushToFullscreen({ type: 'F1_GENERATION_STARTED', thread_id: threadId });
  try {
    const result = await runGenerateReply({
      threadId,
      url: payload.url,
      message: latestIncoming,
      partnerName: payload.partnerName,
      listingTitle: payload.listingTitle,
      conversationHistory: payload.conversationHistory
    });

    const entry = {
      thread_id: threadId,
      partner_name: payload.partnerName || null,
      listing_title: payload.listingTitle || null,
      result, // full /generate-reply response
      source_message: latestIncoming,
      generated_at: Date.now()
    };
    await writeCachedVariants(threadId, entry);
    lastSeenIncoming.set(threadId, latestIncoming);
    console.log('[FB Reply Maker SW] auto-gen cached for', threadId);
    pushToFullscreen({ type: 'F1_VARIANTS_UPDATED', thread_id: threadId, payload: entry });
  } catch (err) {
    console.error('[FB Reply Maker SW] auto-gen failed:', err?.message || err);
    pushToFullscreen({ type: 'F1_GENERATION_FAILED', thread_id: threadId, error: err?.message || String(err) });
  } finally {
    inFlightThreads.delete(threadId);
  }
}

// ============================================================
// Phase F.1.6 — Background prefetch
// ============================================================
//
// Pre-warm OPEN_THREAD + generate-reply on the top-N visible threads in
// the fullscreen inbox so the user's first click renders variants
// instantly. Sequential (single in-flight at a time, FB rate-limit safe),
// humanized 2-4s throttle between operations, cancelable on tab close.
//
// Flow:
//   1. Fullscreen sends F1_6_SET_VISIBLE with a priority-ranked list of
//      thread ids it wants prefetched. SW dedupes vs already-completed,
//      adds to pending queue, kicks the runner if idle.
//   2. Runner pulls highest-priority pending, re-checks gates (lead may
//      have closed since fullscreen built the list), runs OPEN_THREAD →
//      generate-reply → cache write, then sleeps the throttle delay.
//   3. F1_6_STOP_PREFETCH (sent on fullscreen unload or user request)
//      flushes the queue and sets the stopped flag so the next loop
//      iteration exits.

const PREFETCH_DELAY_MIN_MS = 2000;
const PREFETCH_DELAY_MAX_MS = 4000;
const PREFETCH_STALE_THRESHOLD_MS = 10 * 60 * 1000;
const PREFETCH_TOP_N = 5;

const prefetchState = {
  // thread_id → { source, priority }
  pending: new Map(),
  // thread_ids we've successfully completed in this session — don't redo
  // unless explicitly invalidated (e.g. new incoming message detected).
  completed: new Set(),
  inFlight: null,
  running: false,
  stopped: false,
  swept: 0,
  total: 0
};

function prefetchBroadcast(extra) {
  pushToFullscreen({
    type: 'F1_6_PREFETCH_PROGRESS',
    completed: prefetchState.swept,
    total: prefetchState.total,
    in_flight: prefetchState.inFlight,
    queued: prefetchState.pending.size,
    ...extra
  });
}

async function isPrefetchEligible(threadId) {
  if (!threadId) return { eligible: false, reason: 'no_id' };
  if (prefetchState.completed.has(threadId)) {
    return { eligible: false, reason: 'already_done' };
  }
  if (inFlightThreads.has(threadId)) {
    return { eligible: false, reason: 'auto_gen_in_flight' };
  }
  // Lead-status gate. Closed/stale leads aren't worth pre-warming.
  const leadsData = await chrome.storage.local.get('leads');
  const lead = leadsData.leads?.[threadId] || null;
  if (lead && AUTO_GEN_SKIP_STATUSES.has(lead.status)) {
    return { eligible: false, reason: 'closed_status' };
  }
  return { eligible: true, lead };
}

async function runOnePrefetch({ thread_id, source }) {
  const settings = await loadGenerationSettings();
  if (!settings.config?.endpoint || !settings.config?.secret) {
    return { ok: false, reason: 'missing_config' };
  }

  // Step 1: drive the FB tab to this thread + scrape. Reuse the same
  // OPEN_THREAD RPC the user-click path uses; the content script handles
  // navigation + bubble swap detection.
  pushToFullscreen({ type: 'F1_6_PREFETCH_STARTED', thread_id });
  const open = await callInboxTab({ type: 'OPEN_THREAD', thread_id, source });
  if (!open || !open.ok) {
    return { ok: false, reason: open?.reason || 'open_failed' };
  }
  const messages = Array.isArray(open.messages) ? open.messages : [];

  // Step 2: find the most recent customer message. No incoming → nothing
  // to reply to → skip silently.
  let latestIncoming = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender === 'them' && messages[i].text) {
      latestIncoming = messages[i].text.trim();
      break;
    }
  }
  if (!latestIncoming) return { ok: false, reason: 'no_customer_message' };
  const wordCount = latestIncoming.split(/\s+/).filter(Boolean).length;
  if (wordCount < AUTO_GEN_MIN_WORDS) return { ok: false, reason: 'too_short' };

  // Step 3: cache freshness. If we already generated for this exact message
  // (e.g. F.1 auto-gen ran earlier), don't burn another call.
  const cached = await readCachedVariants(thread_id);
  if (cached?.source_message === latestIncoming) {
    return { ok: true, skipped: 'fresh_cache' };
  }

  // Step 4: run generate-reply through the same path as auto-gen so the
  // server sees identical context (existing_* hydration, etc).
  if (inFlightThreads.has(thread_id)) {
    return { ok: false, reason: 'auto_gen_raced' };
  }
  inFlightThreads.add(thread_id);
  try {
    const result = await runGenerateReply({
      threadId: thread_id,
      url: open.url,
      message: latestIncoming,
      partnerName: open.partnerName,
      listingTitle: open.listingTitle,
      conversationHistory: messages
    });
    if (result?.ok === false) {
      return { ok: false, reason: result.reason || 'generate_failed' };
    }
    const entry = {
      thread_id,
      partner_name: open.partnerName || null,
      listing_title: open.listingTitle || null,
      result,
      source_message: latestIncoming,
      generated_at: Date.now(),
      prefetched: true
    };
    await writeCachedVariants(thread_id, entry);
    lastSeenIncoming.set(thread_id, latestIncoming);
    pushToFullscreen({ type: 'F1_VARIANTS_UPDATED', thread_id, payload: entry });
    return { ok: true };
  } finally {
    inFlightThreads.delete(thread_id);
  }
}

function pickHighestPriorityPending() {
  let best = null;
  for (const [tid, info] of prefetchState.pending.entries()) {
    if (!best || (info.priority || 0) > (best.priority || 0)) {
      best = { thread_id: tid, ...info };
    }
  }
  return best;
}

async function runPrefetchSweep() {
  if (prefetchState.running) return;
  prefetchState.running = true;
  prefetchState.stopped = false;
  try {
    while (!prefetchState.stopped && prefetchState.pending.size > 0) {
      const next = pickHighestPriorityPending();
      if (!next) break;
      prefetchState.pending.delete(next.thread_id);

      // Re-check eligibility right before launching — lead state could
      // have changed since fullscreen reported visibility.
      const elig = await isPrefetchEligible(next.thread_id);
      if (!elig.eligible) {
        console.log('[FB Reply Maker SW] prefetch skip', next.thread_id, elig.reason);
        continue;
      }

      prefetchState.inFlight = next.thread_id;
      prefetchState.total = Math.max(prefetchState.total, prefetchState.swept + prefetchState.pending.size + 1);
      prefetchBroadcast();

      let result;
      try {
        result = await runOnePrefetch(next);
      } catch (err) {
        result = { ok: false, reason: err?.message || 'prefetch_threw' };
      }

      if (result?.ok) {
        prefetchState.completed.add(next.thread_id);
      }
      prefetchState.swept++;
      prefetchState.inFlight = null;
      pushToFullscreen({
        type: 'F1_6_PREFETCH_DONE',
        thread_id: next.thread_id,
        ok: !!result?.ok,
        reason: result?.reason || null,
        skipped: result?.skipped || null
      });
      prefetchBroadcast();

      if (prefetchState.stopped || prefetchState.pending.size === 0) break;
      // Humanized throttle between operations.
      const delay = PREFETCH_DELAY_MIN_MS
        + Math.floor(Math.random() * (PREFETCH_DELAY_MAX_MS - PREFETCH_DELAY_MIN_MS));
      await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    prefetchState.running = false;
    prefetchState.inFlight = null;
    // Reset counters when fully drained so the next sweep starts at 0/N.
    if (prefetchState.pending.size === 0) {
      prefetchState.swept = 0;
      prefetchState.total = 0;
    }
    prefetchBroadcast({ idle: true });
  }
}

function enqueuePrefetch(threadId, info) {
  if (!threadId) return false;
  if (prefetchState.completed.has(threadId)) return false;
  if (prefetchState.inFlight === threadId) return false;
  if (prefetchState.pending.has(threadId)) return false;
  prefetchState.pending.set(threadId, {
    source: info?.source || 'marketplace',
    priority: typeof info?.priority === 'number' ? info.priority : 1
  });
  return true;
}

function setVisibleThreadsForPrefetch(visible) {
  if (!Array.isArray(visible)) return;
  let added = 0;
  // Cap to top N — fullscreen also caps, but defense-in-depth.
  for (const v of visible.slice(0, PREFETCH_TOP_N)) {
    if (enqueuePrefetch(v.thread_id, v)) added++;
  }
  if (added > 0 && !prefetchState.running) {
    runPrefetchSweep().catch((err) =>
      console.warn('[FB Reply Maker SW] prefetch sweep error:', err?.message || err)
    );
  }
}

function stopPrefetch() {
  prefetchState.stopped = true;
  prefetchState.pending.clear();
  // inFlight is allowed to drain — interrupting an in-progress RPC is
  // expensive and the next loop iteration will exit before starting more.
}

// Invalidate completed-set entries when their thread receives a new
// incoming message via the standard THREAD_UPDATE path. This way the
// auto-gen flow (which fires on THREAD_UPDATE) can refresh variants
// without prefetch's "already done" guard blocking the next sweep.
function invalidatePrefetchForThread(threadId) {
  prefetchState.completed.delete(threadId);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'THREAD_UPDATE' && sender.tab?.id) {
    tabState.set(sender.tab.id, msg.payload);
    chrome.runtime.sendMessage({
      type: 'THREAD_BROADCAST',
      tabId: sender.tab.id,
      payload: msg.payload
    }).catch(() => {});
    if (msg.payload?.status === 'ok') {
      const threadId = getThreadIdFromUrl(msg.payload.url || '');
      if (threadId) {
        // A live THREAD_UPDATE means we have fresh DOM for this thread —
        // any prior prefetch result for this thread is stale candidate-
        // wise. Clear the completed mark so a future visibility report
        // can re-queue it if the message has changed.
        invalidatePrefetchForThread(threadId);
        maybeAutoGenerate({ threadId, payload: msg.payload }).catch((err) =>
          console.error('[FB Reply Maker SW] maybeAutoGenerate threw:', err?.message || err)
        );
      }
    }
    return;
  }

  if (msg?.type === 'GET_CURRENT_THREAD') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ status: 'no_active_tab' });
        return;
      }
      const cached = tabState.get(tab.id);
      sendResponse(cached || { status: 'no_thread_detected', reason: 'no_cache' });
    })();
    return true;
  }

  if (msg?.type === 'REQUEST_RESCAN') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ ok: false, reason: 'no_active_tab' });
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'no_content_script' });
      }
    })();
    return true;
  }

  // Phase F.1.5 — fullscreen → SW → FB content script: scrape inbox list.
  //
  // Walks the ranked candidate list so the real /marketplace/inbox tab wins
  // over Pages Manager. If a candidate returns "Receiving end does not
  // exist" (content script was registered after the tab loaded), we attempt
  // a one-shot executeScript injection and retry once before moving on.
  if (msg?.type === 'F1_5_GET_INBOX') {
    (async () => {
      const res = await callInboxTab({ type: 'GET_INBOX_LIST' });
      sendResponse(res);
    })();
    return true;
  }

  // Phase F.1.5 step 3 — programmatic scroll of the FB inbox list to trigger
  // virtualized loading of older threads. Fullscreen re-fires
  // F1_5_GET_INBOX after this returns to pick up new rows.
  if (msg?.type === 'F1_5_SCROLL_INBOX') {
    (async () => {
      const res = await callInboxTab({ type: 'SCROLL_INBOX_DOWN' });
      sendResponse(res);
    })();
    return true;
  }

  // Phase F.1.5 step 5 — re-open / open the FB Marketplace inbox.
  //
  // - If a FB tab is already open, navigate it to /marketplace/inbox and
  //   bring it active in its own window (no focus steal on the user's
  //   window).
  // - If none is open, create a new tab at /marketplace/inbox.
  // Used by the "Re-open Inbox" CTA when the user has navigated their FB
  // tab away from the inbox/thread surfaces.
  if (msg?.type === 'F1_5_OPEN_INBOX') {
    (async () => {
      const targetUrl = 'https://www.facebook.com/marketplace/inbox';
      try {
        const candidates = await findInboxTabs();
        const existing = candidates && candidates[0];
        if (existing && existing.id) {
          await chrome.tabs.update(existing.id, { url: targetUrl, active: true });
          sendResponse({ ok: true, tabId: existing.id, navigated: true });
          return;
        }
        // No inbox-pattern tab found — fall back to any facebook.com tab.
        const fbTabs = await chrome.tabs.query({ url: 'https://*.facebook.com/*' });
        if (fbTabs && fbTabs.length > 0) {
          const t = fbTabs[0];
          await chrome.tabs.update(t.id, { url: targetUrl, active: true });
          sendResponse({ ok: true, tabId: t.id, navigated: true });
          return;
        }
        const created = await chrome.tabs.create({ url: targetUrl });
        sendResponse({ ok: true, tabId: created?.id, created: true });
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'open_inbox_failed' });
      }
    })();
    return true;
  }

  // Phase F.1.6 — background prefetch. Fullscreen reports priority-ranked
  // visible threads; SW queues + sequentially pre-warms variants.
  if (msg?.type === 'F1_6_SET_VISIBLE' && Array.isArray(msg.visible_threads)) {
    setVisibleThreadsForPrefetch(msg.visible_threads);
    // Echo current sweep state so the new fullscreen render has accurate
    // counts immediately, without waiting for the next progress tick.
    prefetchBroadcast({ ack: true });
    return;
  }

  if (msg?.type === 'F1_6_STOP_PREFETCH') {
    stopPrefetch();
    return;
  }

  // Phase F.1.5 step 4 — drive the FB tab to a specific thread (silent
  // background click) and return the scraped messages. No focus changes:
  // the FB tab stays where it is and the user's view stays on the
  // extension. The content script handles the click + waits for compose
  // to render before scraping.
  if (msg?.type === 'F1_5_OPEN_THREAD' && typeof msg.thread_id === 'string') {
    (async () => {
      const res = await callInboxTab({
        type: 'OPEN_THREAD',
        thread_id: msg.thread_id,
        source: msg.source
      });
      sendResponse(res);
    })();
    return true;
  }

  // Phase F.1 — fullscreen → SW → FB content script: full thread history
  if (msg?.type === 'F1_GET_THREAD_HISTORY' && typeof msg.thread_id === 'string') {
    (async () => {
      const tabId = findTabForThread(msg.thread_id);
      if (!tabId) {
        sendResponse({ ok: false, reason: 'fb_tab_not_open' });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_THREAD_HISTORY' });
        sendResponse(res || { ok: false, reason: 'no_response' });
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'rpc_failed' });
      }
    })();
    return true;
  }

  // Phase F.1 — fullscreen manual regenerate. SW pulls fresh history from the
  // FB tab (so the message is current) and runs the generator.
  if (msg?.type === 'F1_REGENERATE' && typeof msg.thread_id === 'string') {
    (async () => {
      const tabId = findTabForThread(msg.thread_id);
      const payload = tabId ? tabState.get(tabId) : null;
      if (!payload || payload.status !== 'ok' || !payload.latestIncoming) {
        sendResponse({ ok: false, reason: 'no_current_message' });
        return;
      }
      // Bypass de-dupe: clear lastSeenIncoming + cache, then fire.
      lastSeenIncoming.delete(msg.thread_id);
      await clearCachedVariants(msg.thread_id);
      maybeAutoGenerate({ threadId: msg.thread_id, payload })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, reason: err?.message || 'gen_failed' }));
    })();
    return true;
  }

  // Phase F.1 — fullscreen requests focus on the FB tab for a given thread.
  if (msg?.type === 'F1_FOCUS_FB_TAB' && typeof msg.thread_id === 'string') {
    (async () => {
      const tabId = findTabForThread(msg.thread_id);
      if (!tabId) {
        sendResponse({ ok: false, reason: 'fb_tab_not_open' });
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        if (tab?.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'focus_failed' });
      }
    })();
    return true;
  }

  if (msg?.type === 'INSERT_REPLY') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        console.warn('[FB Reply Maker SW] INSERT_REPLY received but no active tab');
        sendResponse({ ok: false, reason: 'no_active_tab' });
        return;
      }
      console.log('[FB Reply Maker SW] INSERT_REPLY received, forwarding to tab', tab.id, tab.url, {
        auto_send: !!msg.auto_send,
        thread_id: msg.thread_id || null
      });
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'INSERT_REPLY',
          text: msg.text,
          auto_send: !!msg.auto_send,
          thread_id: typeof msg.thread_id === 'string' ? msg.thread_id : undefined,
          skip_humanized: !!msg.skip_humanized
        });
        console.log('[FB Reply Maker SW] INSERT_REPLY content-script reply:', res);
        sendResponse(res || { ok: false, reason: 'no_response' });
      } catch (err) {
        console.error('[FB Reply Maker SW] INSERT_REPLY forward failed:', err?.message || err);
        sendResponse({ ok: false, reason: err?.message || 'no_content_script' });
      }
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});
