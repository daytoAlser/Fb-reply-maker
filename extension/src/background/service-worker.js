// Phase F.1: action icon now opens the full-screen lead center instead of
// the side panel. Side panel is still installed (chrome://extensions side
// panel toggle / right-click → "Open side panel") for back-compat, but the
// icon is the primary entry point.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err) => console.error('sidePanel.setPanelBehavior failed', err));

const FULLSCREEN_PATH = 'src/fullscreen/index.html';

async function openOrFocusFullscreen() {
  const url = chrome.runtime.getURL(FULLSCREEN_PATH);
  try {
    const existing = await chrome.tabs.query({ url });
    if (existing && existing.length > 0) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return;
    }
    await chrome.tabs.create({ url });
  } catch (err) {
    console.error('[FB Reply Maker SW] openOrFocusFullscreen failed:', err?.message || err);
  }
}

chrome.action.onClicked.addListener(() => {
  openOrFocusFullscreen();
});

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

async function registerContentScripts() {
  try {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    } catch {
      // no prior registration; ignore
    }
    await chrome.scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_ID,
        matches: CONTENT_SCRIPT_MATCHES,
        js: CONTENT_SCRIPT_FILES,
        runAt: 'document_idle',
        world: 'ISOLATED',
        persistAcrossSessions: true
      }
    ]);
    const after = await chrome.scripting.getRegisteredContentScripts();
    console.log('[FB Reply Maker SW] registered scripts:', after);
  } catch (err) {
    console.error('[FB Reply Maker SW] registerContentScripts failed:', err);
  }
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

// Phase F.1.5 — locate the FB Marketplace inbox tab the user has open.
// Heuristic: any tab whose URL matches one of the inbox patterns, sorted by
// lastAccessed desc (Chrome 121+ exposes this; we fall back to active/index).
// Returns the chrome.tabs.Tab object or null.
const INBOX_TAB_URL_PATTERNS = [
  'https://*.facebook.com/marketplace/inbox*',
  'https://*.facebook.com/marketplace/inbox/*',
  'https://*.facebook.com/marketplace/t/*',
  'https://business.facebook.com/latest/inbox*',
  'https://business.facebook.com/latest/inbox/*',
  'https://*.messenger.com/marketplace/*',
  'https://*.messenger.com/t/*'
];

async function findInboxTab() {
  try {
    const tabs = await chrome.tabs.query({ url: INBOX_TAB_URL_PATTERNS });
    if (!tabs || tabs.length === 0) return null;
    const ranked = tabs.slice().sort((a, b) => {
      const la = typeof a.lastAccessed === 'number' ? a.lastAccessed : 0;
      const lb = typeof b.lastAccessed === 'number' ? b.lastAccessed : 0;
      if (lb !== la) return lb - la;
      if ((b.active ? 1 : 0) !== (a.active ? 1 : 0)) return (b.active ? 1 : 0) - (a.active ? 1 : 0);
      return (b.id || 0) - (a.id || 0);
    });
    const picked = ranked[0];
    console.log('[FB Reply Maker SW] inbox tab pick:', picked?.id, picked?.url, '(of', tabs.length, 'candidates)');
    return picked;
  } catch (err) {
    console.warn('[FB Reply Maker SW] findInboxTab failed:', err?.message || err);
    return null;
  }
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
  // Returns { ok, rows, tabId, tabUrl, ... } or { ok: false, reason }.
  if (msg?.type === 'F1_5_GET_INBOX') {
    (async () => {
      const tab = await findInboxTab();
      if (!tab || !tab.id) {
        sendResponse({ ok: false, reason: 'tab_not_found' });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_INBOX_LIST' });
        if (!res || typeof res !== 'object') {
          sendResponse({ ok: false, reason: 'no_response', tabId: tab.id, tabUrl: tab.url });
          return;
        }
        sendResponse({ ...res, tabId: tab.id, tabUrl: tab.url });
      } catch (err) {
        sendResponse({
          ok: false,
          reason: err?.message || 'rpc_failed',
          tabId: tab.id,
          tabUrl: tab.url
        });
      }
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
      console.log('[FB Reply Maker SW] INSERT_REPLY received, forwarding to tab', tab.id, tab.url);
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'INSERT_REPLY',
          text: msg.text
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
