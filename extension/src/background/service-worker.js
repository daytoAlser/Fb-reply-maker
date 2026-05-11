chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('sidePanel.setPanelBehavior failed', err));

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
const CONTENT_SCRIPT_FILE = 'content/marketplace.js';
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
        js: [CONTENT_SCRIPT_FILE],
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'THREAD_UPDATE' && sender.tab?.id) {
    tabState.set(sender.tab.id, msg.payload);
    chrome.runtime.sendMessage({
      type: 'THREAD_BROADCAST',
      tabId: sender.tab.id,
      payload: msg.payload
    }).catch(() => {});
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
