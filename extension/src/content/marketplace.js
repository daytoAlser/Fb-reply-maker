import { SELECTORS, ROLE_PATTERNS, MAX_CONTEXT_MESSAGES } from './selectors.js';

const DEBOUNCE_MS = 300;

let lastPayloadHash = '';
let debounceTimer = null;

function classifyLabel(label) {
  if (ROLE_PATTERNS.incoming.test(label)) return 'them';
  if (ROLE_PATTERNS.outgoing.test(label)) return 'me';
  return null;
}

function cleanText(t) {
  if (!t) return '';
  return t.replace(/\s+/g, ' ').trim();
}

function detectThread() {
  const container = document.querySelector(SELECTORS.threadContainer);
  if (!container) {
    return { status: 'no_thread_detected', reason: 'no_container' };
  }

  const labeled = [...container.querySelectorAll('[aria-label]')]
    .map((el) => {
      const label = el.getAttribute('aria-label') || '';
      const sender = classifyLabel(label);
      if (!sender) return null;
      const text = cleanText(el.innerText);
      if (!text) return null;
      return { sender, text };
    })
    .filter(Boolean);

  if (labeled.length === 0) {
    return { status: 'no_thread_detected', reason: 'no_matching_messages' };
  }

  const recent = labeled.slice(-MAX_CONTEXT_MESSAGES);

  let latestIncoming = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].sender === 'them') {
      latestIncoming = recent[i].text;
      break;
    }
  }
  if (!latestIncoming) {
    for (let i = labeled.length - 1; i >= 0; i--) {
      if (labeled[i].sender === 'them') {
        latestIncoming = labeled[i].text;
        break;
      }
    }
  }

  return {
    status: 'ok',
    latestIncoming,
    conversationHistory: recent,
    url: location.href,
    capturedAt: Date.now()
  };
}

function broadcast(force = false) {
  const payload = detectThread();
  const hash = JSON.stringify({
    s: payload.status,
    l: payload.latestIncoming || '',
    h: payload.conversationHistory || [],
    u: payload.url || ''
  });
  if (!force && hash === lastPayloadHash) return;
  lastPayloadHash = hash;
  try {
    chrome.runtime.sendMessage({ type: 'THREAD_UPDATE', payload }).catch(() => {});
  } catch {
    // service worker not ready; will retry on next mutation
  }
}

function scheduleBroadcast() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => broadcast(false), DEBOUNCE_MS);
}

const observer = new MutationObserver(scheduleBroadcast);
observer.observe(document.body, { childList: true, subtree: true });

broadcast(true);

let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastPayloadHash = '';
    broadcast(true);
  }
}, 500);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'INSERT_REPLY') {
    const box = document.querySelector(SELECTORS.replyTextbox);
    if (!box) {
      sendResponse({ ok: false, reason: 'no_textbox' });
      return;
    }
    box.focus();
    box.click();
    const ok = document.execCommand('insertText', false, msg.text);
    sendResponse({ ok, reason: ok ? null : 'execCommand_failed' });
    return;
  }
  if (msg?.type === 'RESCAN') {
    lastPayloadHash = '';
    broadcast(true);
    sendResponse({ ok: true });
    return;
  }
});
