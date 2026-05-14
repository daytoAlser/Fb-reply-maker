// Side-panel migration: action icon opens the side panel beside the FB
// tab. Chrome handles the open natively when openPanelOnActionClick is
// true — no action.onClicked listener required for the common case.
try {
  chrome.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    ?.catch((err) => console.error('[FB Reply Maker SW] sidePanel.setPanelBehavior rejected:', err?.message || err));
} catch (err) {
  console.error('[FB Reply Maker SW] sidePanel.setPanelBehavior threw:', err?.message || err);
}

const BADGE_COLOR = '#f59e0b';

async function restoreBadgeFromStorage() {
  try {
    const data = await chrome.storage.local.get('unviewedQualifiedCount');
    const count = typeof data.unviewedQualifiedCount === 'number' ? data.unviewedQualifiedCount : 0;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
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

// ============================================================
// Content script registration
// ============================================================

const CONTENT_SCRIPT_ID = 'marketplace';
// selectors.js MUST come first so globalThis.FBRM_SELECTORS exists before
// marketplace.js runs. Same isolated world, sequential execution.
const CONTENT_SCRIPT_FILES = [
  'content/selectors.js',
  'content/marketplace.js'
];
const CONTENT_SCRIPT_MATCHES = [
  'https://*.facebook.com/*',
  'https://*.messenger.com/*'
];

// onStartup, onInstalled, and the startup IIFE all call this; if any two
// race we get "Duplicate script ID 'marketplace'". Module-level promise
// serializes them.
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
      } else {
        await chrome.scripting.registerContentScripts([
          { ...CONTENT_SCRIPT_DEF, persistAcrossSessions: true }
        ]);
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
    if (!scripts.find((s) => s.id === CONTENT_SCRIPT_ID)) {
      await registerContentScripts();
    }
  } catch (err) {
    console.error('[FB Reply Maker SW] startup register failed:', err);
  }
})();

chrome.runtime.onInstalled.addListener(() => registerContentScripts());
chrome.runtime.onStartup.addListener(() => registerContentScripts());

// ============================================================
// Inbox tab discovery
// ============================================================

const tabState = new Map();

function getThreadIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/t\/([^/?#]+)/);
  return m ? m[1] : null;
}

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
    return rankInboxTabs(tabs);
  } catch (err) {
    console.warn('[FB Reply Maker SW] findInboxTabs failed:', err?.message || err);
    return [];
  }
}

// Walks the ranked candidate list, retries once with executeScript if the
// content script wasn't registered on a candidate tab. Used by F1_5_*.
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

// ============================================================
// Auto-gen on new incoming
// ============================================================

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

  const seen = lastSeenIncoming.get(threadId);
  if (seen === latestIncoming) return;

  const leadsData = await chrome.storage.local.get('leads');
  const lead = leadsData.leads?.[threadId];
  if (lead && AUTO_GEN_SKIP_STATUSES.has(lead.status)) {
    lastSeenIncoming.set(threadId, latestIncoming);
    return;
  }

  const cached = await readCachedVariants(threadId);
  if (cached?.source_message === latestIncoming) {
    lastSeenIncoming.set(threadId, latestIncoming);
    return;
  }

  inFlightThreads.add(threadId);
  // Tell the side panel "we're working on it" so the UI can show a
  // generating spinner instead of staying blank.
  chrome.runtime.sendMessage({
    type: 'VARIANTS_GENERATING',
    thread_id: threadId
  }).catch(() => {});
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
      result,
      source_message: latestIncoming,
      generated_at: Date.now()
    };
    await writeCachedVariants(threadId, entry);
    lastSeenIncoming.set(threadId, latestIncoming);
    // Broadcast so the side panel (if open on this thread) can swap in
    // the freshly-generated variants without the user clicking anything.
    chrome.runtime.sendMessage({
      type: 'VARIANTS_CACHED',
      thread_id: threadId,
      payload: entry
    }).catch(() => {});
  } catch (err) {
    console.error('[FB Reply Maker SW] auto-gen failed:', err?.message || err);
    chrome.runtime.sendMessage({
      type: 'VARIANTS_FAILED',
      thread_id: threadId,
      error: err?.message || String(err)
    }).catch(() => {});
  } finally {
    inFlightThreads.delete(threadId);
  }
}

// ============================================================
// chrome.offscreen — clipboard writer
// ============================================================
//
// navigator.clipboard.write requires the calling document to be focused.
// Side-panel and content-script contexts both lose focus to/from each
// other during the INSERT flow, so neither can reliably write images.
// Chrome's documented workaround: an offscreen document created with
// reason: 'CLIPBOARD' gets a focus-check bypass specifically for
// extension clipboard operations.

const OFFSCREEN_PATH = 'offscreen.html';
let offscreenReady = null; // Promise that resolves when the offscreen doc exists

async function ensureOffscreenDocument() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    if (!chrome.offscreen || !chrome.offscreen.createDocument) {
      throw new Error('chrome.offscreen API unavailable (Chrome <117?)');
    }
    // Check if it already exists (SW can restart).
    if (chrome.offscreen.hasDocument) {
      const has = await chrome.offscreen.hasDocument();
      if (has) return;
    } else {
      // Older API fallback — try createDocument and ignore "already exists".
    }
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['CLIPBOARD'],
        justification: 'Write product images to the system clipboard for FB Marketplace replies (focus-check bypass).'
      });
    } catch (err) {
      const msg = err?.message || String(err);
      if (!/single offscreen document|already (exists|has)/i.test(msg)) throw err;
    }
  })();
  try {
    await offscreenReady;
  } catch (err) {
    offscreenReady = null; // allow retry
    throw err;
  }
  return offscreenReady;
}

// Fetches an image URL and writes it to the system clipboard via the
// offscreen document. SW host_permissions bypass CORS for the fetch;
// offscreen reason:'CLIPBOARD' bypasses the focus check for the write.
async function fetchAndWriteImageToClipboard(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  await ensureOffscreenDocument();
  const resp = await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_WRITE_IMAGE',
    base64,
    mime: blob.type || 'image/jpeg'
  });
  if (!resp || !resp.ok) {
    throw new Error('offscreen write failed: ' + (resp && resp.reason ? resp.reason : 'no_response'));
  }
  return resp;
}

// ============================================================
// chrome.debugger — trusted Ctrl+V dispatcher
// ============================================================
//
// FB Messenger's composer rejects synthetic ClipboardEvent('paste') and
// document.execCommand('paste') is unreliable for image clipboard data.
// chrome.debugger lets us dispatch a TRUSTED keyboard event (isTrusted:
// true) via the Chrome DevTools Protocol, which the browser handles
// exactly like a real Ctrl+V on physical hardware — and FB accepts it.
//
// Trade-off: Chrome shows a yellow "FB Reply Maker started debugging
// this browser" bar at the top of the tab while the debugger is
// attached. We auto-detach 2.5s after the last Ctrl+V request so the
// bar disappears between INSERT clicks rather than staying permanent.

let debuggerAttachedTabId = null;
let debuggerDetachTimer = null;

async function ensureDebuggerAttached(tabId) {
  if (debuggerDetachTimer) {
    clearTimeout(debuggerDetachTimer);
    debuggerDetachTimer = null;
  }
  if (debuggerAttachedTabId === tabId) {
    console.log('[SW] debugger already attached to tab', tabId);
    return;
  }
  if (debuggerAttachedTabId !== null && debuggerAttachedTabId !== tabId) {
    console.log('[SW] detaching debugger from previous tab', debuggerAttachedTabId);
    try { await chrome.debugger.detach({ tabId: debuggerAttachedTabId }); } catch {}
  }
  console.log('[SW] attempting chrome.debugger.attach on tab', tabId);
  await chrome.debugger.attach({ tabId }, '1.3');
  console.log('[SW] debugger ATTACHED to tab', tabId, '— yellow bar should be visible');
  debuggerAttachedTabId = tabId;
}

function scheduleDebuggerDetach() {
  if (debuggerDetachTimer) clearTimeout(debuggerDetachTimer);
  debuggerDetachTimer = setTimeout(async () => {
    if (debuggerAttachedTabId !== null) {
      try { await chrome.debugger.detach({ tabId: debuggerAttachedTabId }); } catch {}
      debuggerAttachedTabId = null;
    }
    debuggerDetachTimer = null;
  }, 2500);
}

// Mac uses Cmd+V; everything else Ctrl+V. CDP modifier flags:
// Alt=1, Ctrl=2, Meta/Cmd=4, Shift=8.
const IS_MAC = (() => {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const plat = (typeof navigator !== 'undefined' && navigator.platform) || '';
    return /Mac/i.test(ua) || /Mac/i.test(plat);
  } catch { return false; }
})();
const PASTE_MODIFIERS = IS_MAC ? 4 : 2;

async function dispatchTrustedPaste(tabId) {
  await ensureDebuggerAttached(tabId);
  const keyArgs = {
    modifiers: PASTE_MODIFIERS,
    key: 'v',
    code: 'KeyV',
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    isKeypad: false,
    autoRepeat: false
  };
  console.log('[SW] dispatching trusted Ctrl+V (modifiers=' + PASTE_MODIFIERS + ') on tab', tabId);
  // 'rawKeyDown' fires keydown ONLY — no auto-generated keypress/char
  // event. With plain 'keyDown', Chrome also dispatches a char event,
  // which some apps interpret as a second paste trigger.
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyArgs });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...keyArgs });
  console.log('[SW] trusted Ctrl+V dispatched OK on tab', tabId);
  scheduleDebuggerDetach();
}

// If the user closes the FB tab while the debugger is attached, clean
// up our state — otherwise the next attach attempt may target a dead
// tab id.
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === debuggerAttachedTabId) {
    console.log('[SW] debugger detached:', { tabId: source.tabId, reason });
    debuggerAttachedTabId = null;
    if (debuggerDetachTimer) {
      clearTimeout(debuggerDetachTimer);
      debuggerDetachTimer = null;
    }
  }
});

// ============================================================
// Message handlers
// ============================================================

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

  // Inbox tab RPCs — used by the side panel's Inbox tab.
  if (msg?.type === 'F1_5_GET_INBOX') {
    (async () => {
      const res = await callInboxTab({ type: 'GET_INBOX_LIST' });
      sendResponse(res);
    })();
    return true;
  }

  if (msg?.type === 'F1_5_SCROLL_INBOX') {
    (async () => {
      const res = await callInboxTab({ type: 'SCROLL_INBOX_DOWN' });
      sendResponse(res);
    })();
    return true;
  }

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

  // DISPATCH_CTRL_V — content script (or side panel) asks us to fire a
  // trusted Ctrl+V keypress on the FB tab via chrome.debugger. Used by
  // the image-attach chain when clipboard.write has loaded an image and
  // the chat composer is focused — the trusted keypress triggers the
  // browser's native paste, which FB accepts even though execCommand
  // and synthetic events fail.
  // WRITE_IMAGE_TO_CLIPBOARD — content script asks the SW to fetch the
  // image URL and write the bytes to the system clipboard via the
  // offscreen document. This is the focus-immune path: the offscreen
  // doc with reason: 'CLIPBOARD' bypasses the "Document is not focused"
  // check that breaks side-panel and FB-tab CS clipboard.write attempts.
  if (msg?.type === 'WRITE_IMAGE_TO_CLIPBOARD' && typeof msg.url === 'string') {
    (async () => {
      console.log('[SW] WRITE_IMAGE_TO_CLIPBOARD url=', msg.url);
      try {
        const resp = await fetchAndWriteImageToClipboard(msg.url);
        console.log('[SW] WRITE_IMAGE_TO_CLIPBOARD OK bytes=', resp?.byteSize);
        sendResponse({ ok: true, byteSize: resp?.byteSize });
      } catch (err) {
        console.warn('[SW] WRITE_IMAGE_TO_CLIPBOARD failed:', err?.message || err);
        sendResponse({ ok: false, reason: err?.message || String(err) });
      }
    })();
    return true;
  }

  // LOG_FROM_CS — content scripts can't easily surface logs to the user
  // (FB tab DevTools conflicts with chrome.debugger). Streaming key
  // diagnostic lines through the SW means we see the full trace in
  // one place: the SW console at chrome://extensions.
  if (msg?.type === 'LOG_FROM_CS') {
    console.log('[CS]', msg.message);
    sendResponse({ ok: true });
    return false;
  }

  // FETCH_IMAGE_FOR_CLIPBOARD — content script asks the SW to fetch a
  // product image URL. SW has full host_permissions bypass for CORS,
  // so this works reliably even when the content-script-side fetch
  // hits CORS edge cases (page-origin can affect MV3 CS fetches).
  // Returns the bytes as base64 so they survive the JSON round-trip.
  if (msg?.type === 'FETCH_IMAGE_FOR_CLIPBOARD' && typeof msg.url === 'string') {
    (async () => {
      try {
        const res = await fetch(msg.url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const blob = await res.blob();
        const buf = await blob.arrayBuffer();
        // Base64-encode for JSON transport.
        let binary = '';
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const base64 = btoa(binary);
        sendResponse({ ok: true, base64, mime: blob.type || 'image/jpeg', byteSize: bytes.length });
      } catch (err) {
        console.warn('[SW] FETCH_IMAGE_FOR_CLIPBOARD failed:', err?.message || err);
        sendResponse({ ok: false, reason: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (msg?.type === 'DISPATCH_CTRL_V') {
    (async () => {
      console.log('[SW] DISPATCH_CTRL_V received, sender.tab.id=', sender?.tab?.id);
      if (!chrome.debugger || typeof chrome.debugger.attach !== 'function') {
        const reason = 'chrome.debugger API unavailable in this browser/profile. ' +
          'Likely causes: the `debugger` permission was not granted on reload, ' +
          'or an enterprise/managed-device policy is blocking the API.';
        console.error('[SW]', reason);
        sendResponse({ ok: false, reason });
        return;
      }
      let tabId = sender?.tab?.id;
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      if (!tabId) { sendResponse({ ok: false, reason: 'no_tab' }); return; }
      try {
        await dispatchTrustedPaste(tabId);
        sendResponse({ ok: true });
      } catch (err) {
        const raw = err?.message || String(err);
        console.warn('[SW] dispatchTrustedPaste failed:', raw);
        // The most common failure cause: DevTools is open on the FB tab,
        // which is already holding the only debugger-attach slot. Map
        // Chrome's terse error into something actionable in the UI.
        let friendly = raw;
        if (/another debugger is already attached|cannot access a chrome|devtools/i.test(raw)) {
          friendly = 'DevTools is open on the FB tab — close it (F12) and try again. Chrome only allows one debugger per tab.';
        } else if (/no tab with given id/i.test(raw)) {
          friendly = 'FB tab not found (was it closed?). Re-open the chat and try again.';
        }
        sendResponse({ ok: false, reason: friendly, raw });
      }
    })();
    return true;
  }

  // ATTACH_SINGLE_IMAGE — side panel asks the active FB tab to copy
  // one image URL to clipboard from the FB tab's content-script context
  // (where the tab is reliably focused) and attempt execCommand('paste').
  // Used by the per-thumbnail 📋 button after the auto-chain runs.
  if (msg?.type === 'ATTACH_SINGLE_IMAGE') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) { sendResponse({ ok: false, reason: 'no_active_tab' }); return; }
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'ATTACH_SINGLE_IMAGE',
          url: msg.url
        });
        sendResponse(res || { ok: false, reason: 'no_response' });
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'no_content_script' });
      }
    })();
    return true;
  }

  // FOCUS_REPLY_BOX — side panel asks the active FB tab to focus its
  // chat composer + attempt an auto-paste from clipboard. Used after
  // the side panel writes a product image to the clipboard so the rep
  // can Ctrl+V into a focused box (or, if execCommand cooperates, the
  // image attaches automatically).
  if (msg?.type === 'FOCUS_REPLY_BOX') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) { sendResponse({ ok: false, reason: 'no_active_tab' }); return; }
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'FOCUS_REPLY_BOX' });
        sendResponse(res || { ok: false, reason: 'no_response' });
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'no_content_script' });
      }
    })();
    return true;
  }

  // INSERT_REPLY — side-panel mode: FB tab is always the active tab when
  // the user clicks Send, so we just dispatch to the active tab. No focus
  // dance, no thread_id routing, no background-tab handling needed.
  if (msg?.type === 'INSERT_REPLY') {
    (async () => {
      console.log('[SW] INSERT_REPLY received from side panel, images=', Array.isArray(msg.images) ? msg.images.length : 0);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        console.warn('[SW] INSERT_REPLY: no active tab in current window');
        sendResponse({ ok: false, reason: 'no_active_tab' });
        return;
      }
      console.log('[SW] INSERT_REPLY: forwarding to FB tab', tab.id);
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'INSERT_REPLY',
          text: msg.text,
          auto_send: !!msg.auto_send,
          thread_id: typeof msg.thread_id === 'string' ? msg.thread_id : undefined,
          skip_humanized: !!msg.skip_humanized,
          // Skip pre-send guards (duplicate_send detection, etc.). Used
          // when the rep clicks "Insert anyway" after the side panel
          // surfaces a guard failure they want to override.
          bypass_guards: !!msg.bypass_guards,
          // Optional list of image URLs to paste alongside the text reply.
          // Content script fetches each, builds a DataTransfer of File
          // objects, and dispatches a synthetic paste event on FB's
          // contenteditable to attach the photos.
          images: Array.isArray(msg.images) ? msg.images : undefined
        });
        // On confirmed send, clear cached_variants so a stale variant
        // doesn't tempt a double-send on the next view.
        if (res && res.ok && res.sent && typeof msg.thread_id === 'string') {
          try {
            await clearCachedVariants(msg.thread_id);
          } catch {}
        }
        sendResponse(res || { ok: false, reason: 'no_response' });
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'no_content_script' });
      }
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});
