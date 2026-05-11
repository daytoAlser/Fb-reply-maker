chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('sidePanel.setPanelBehavior failed', err));

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
        sendResponse({ ok: false, reason: 'no_active_tab' });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'INSERT_REPLY',
          text: msg.text
        });
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
