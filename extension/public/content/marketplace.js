console.log("[FB Reply Maker] content script loaded on " + location.href);

const SELECTORS = {
  threadContainer: '[role="main"]',
  threadHeader: 'h1, h2',
  replyTextbox: '[contenteditable="true"][role="textbox"]'
};

const INCOMING_PATTERNS = [
  ['atDate', /^At .+?, (.+?): (.+)$/s],
  ['enterMsg', /^Enter, Message sent .+? by (.+?): (.+)$/s],
  ['roleDot', /^(.+?) · (?:Buyer|Seller) (.+)$/s]
];

const SYSTEM_PATTERNS = [/started this chat\.?$/i];

const HEADER_BLACKLIST = /^(chats?|marketplace|inbox|settings|messenger|notifications?|search|home)$/i;

const MAX_CONTEXT_MESSAGES = 5;
const MIN_TEXT_LENGTH = 4;
const MAX_TEXT_LENGTH = 500;
const DEBOUNCE_MS = 300;

const PARTNER_H3_PATTERNS = [
  { idx: 1, re: /^(.+?)\s+·\s+(.+)$/, listingGroup: 2 },
  { idx: 2, re: /^(.+?)\s*\n\s*·\s+(?:Buyer|Seller)/s, listingGroup: null },
  { idx: 3, re: /^Conversation titled (.+?)\s+·\s+(.+)$/, listingGroup: 2 }
];

const PARTNER_REJECT_SUBSTR = /Messenger|Marketplace|Conversation/i;

let lastPartnerSuccessLog = '';
let lastPartnerFailureLog = '';

function validatePartner(name) {
  if (!name) return false;
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (HEADER_BLACKLIST.test(trimmed)) return false;
  if (PARTNER_REJECT_SUBSTR.test(trimmed)) return false;
  if (trimmed === 'Messages' || trimmed === 'Compose') return false;
  if (trimmed.includes('$') || trimmed.includes('·')) return false;
  return true;
}

function extractThreadInfo(container) {
  if (!container) return { partner: null, listingTitle: null };

  const h3s = [...container.querySelectorAll('h3')];
  const h3Texts = h3s.map((el) => (el.innerText || '').trim()).filter(Boolean);

  for (const { idx, re, listingGroup } of PARTNER_H3_PATTERNS) {
    for (const text of h3Texts) {
      const m = text.match(re);
      if (!m) continue;
      const candidate = (m[1] || '').replace(/\s+/g, ' ').trim();
      if (!validatePartner(candidate)) continue;
      const listing = listingGroup
        ? (m[listingGroup] || '').replace(/\s+/g, ' ').trim() || null
        : null;
      const key = `${candidate}|p${idx}|${listing || ''}`;
      if (key !== lastPartnerSuccessLog) {
        lastPartnerSuccessLog = key;
        console.log(
          '[FB Reply Maker] partner detected:',
          candidate,
          'via h3 pattern', idx,
          listing ? `/ listing: ${listing}` : ''
        );
      }
      return { partner: candidate, listingTitle: listing };
    }
  }

  const fallback = container.querySelectorAll(SELECTORS.threadHeader);
  for (const el of fallback) {
    const text = (el.innerText || '').trim();
    if (validatePartner(text)) {
      const key = `${text}|h1h2`;
      if (key !== lastPartnerSuccessLog) {
        lastPartnerSuccessLog = key;
        console.log('[FB Reply Maker] partner detected:', text, 'via h1/h2 fallback');
      }
      return { partner: text, listingTitle: null };
    }
  }

  const failureKey = JSON.stringify(h3Texts);
  if (failureKey !== lastPartnerFailureLog) {
    lastPartnerFailureLog = failureKey;
    console.log('[FB Reply Maker] no partner found. h3 contents:', h3Texts);
  }
  return { partner: null, listingTitle: null };
}

function parseAriaMessage(label, partnerName) {
  if (!label) return null;
  const trimmed = label.trim();
  if (trimmed.length < MIN_TEXT_LENGTH || trimmed.length > MAX_TEXT_LENGTH) return null;
  if (SYSTEM_PATTERNS.some((p) => p.test(trimmed))) return null;

  const partnerFirst = partnerName ? partnerName.toLowerCase().split(/\s+/)[0] : null;

  for (const [, pattern] of INCOMING_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m) {
      const senderToken = (m[1] || '').toLowerCase();
      const text = (m[2] || '').trim();
      if (!text || text.length < MIN_TEXT_LENGTH) return null;
      if (partnerFirst && senderToken.includes(partnerFirst)) {
        return { sender: 'them', text };
      }
      return null;
    }
  }

  return { sender: 'me', text: trimmed };
}

let lastPayloadHash = '';
let debounceTimer = null;

function isConversationPage() {
  if (!document.querySelector('[role="main"] [aria-label]')) return false;
  const labeled = document.querySelectorAll('[role="main"] [aria-label]');
  for (const el of labeled) {
    if (/Message/i.test(el.getAttribute('aria-label') || '')) return true;
  }
  return !!document.querySelector(SELECTORS.replyTextbox);
}

function detectThread() {
  const container = document.querySelector(SELECTORS.threadContainer);
  if (!container) {
    return { status: 'no_thread_detected', reason: 'no_container' };
  }
  if (!isConversationPage()) {
    return { status: 'no_thread_detected', reason: 'not_conversation_page' };
  }

  const { partner: partnerName, listingTitle } = extractThreadInfo(container);

  const byText = new Map();
  for (const el of container.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label');
    if (!(el.innerText || '').trim()) continue;
    const parsed = parseAriaMessage(label, partnerName);
    if (!parsed) continue;
    const existing = byText.get(parsed.text);
    if (!existing) {
      byText.set(parsed.text, parsed);
    } else if (parsed.sender === 'them' && existing.sender === 'me') {
      byText.set(parsed.text, parsed);
    }
  }

  const all = [...byText.values()];
  if (all.length === 0) {
    return {
      status: 'no_thread_detected',
      reason: 'no_matching_messages',
      partnerName,
      listingTitle
    };
  }

  const recent = all.slice(-MAX_CONTEXT_MESSAGES);

  let latestIncoming = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].sender === 'them') {
      latestIncoming = recent[i].text;
      break;
    }
  }
  if (!latestIncoming) {
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].sender === 'them') {
        latestIncoming = all[i].text;
        break;
      }
    }
  }

  return {
    status: 'ok',
    latestIncoming,
    conversationHistory: recent,
    partnerName,
    listingTitle,
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
    p: payload.partnerName || '',
    t: payload.listingTitle || '',
    u: payload.url || ''
  });
  if (!force && hash === lastPayloadHash) return;
  lastPayloadHash = hash;
  try {
    chrome.runtime.sendMessage({ type: 'THREAD_UPDATE', payload }).catch(() => {});
  } catch {
    // service worker not ready
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

async function tryInsertReply(text) {
  const box = document.querySelector(SELECTORS.replyTextbox);
  if (!box) return { ok: false, reason: 'no_textbox' };

  const sample = text.slice(0, 20);

  // Method 1: InputEvent (most React-compatible)
  try {
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const ie = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: text,
      bubbles: true,
      cancelable: true
    });
    const accepted = box.dispatchEvent(ie);
    if (accepted) {
      box.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText',
        data: text,
        bubbles: true
      }));
      if (box.innerText.includes(sample)) {
        return { ok: true, method: 'inputEvent' };
      }
    }
  } catch (err) {
    console.warn('[FB Reply Maker] insert method 1 threw:', err?.message);
  }

  // Method 2: DOM insertNode + synthetic input/change
  try {
    box.focus();
    const textNode = document.createTextNode(text);
    const r2 = document.createRange();
    r2.selectNodeContents(box);
    r2.collapse(false);
    r2.insertNode(textNode);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    if (box.innerText.includes(sample)) {
      return { ok: true, method: 'domInsert' };
    }
  } catch (err) {
    console.warn('[FB Reply Maker] insert method 2 threw:', err?.message);
  }

  // Method 3: Clipboard paste simulation (last resort)
  try {
    await navigator.clipboard.writeText(text);
    box.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    });
    box.dispatchEvent(pasteEvent);
    return { ok: true, method: 'clipboardPaste' };
  } catch (err) {
    console.warn('[FB Reply Maker] insert method 3 threw:', err?.message);
  }

  return {
    ok: false,
    reason: 'all_methods_failed',
    tried: ['inputEvent', 'domInsert', 'clipboardPaste']
  };
}

function fireActivationBurst() {
  const box = document.querySelector(SELECTORS.replyTextbox);
  if (!box) return;
  ['input', 'keyup', 'keydown'].forEach((t) =>
    box.dispatchEvent(new Event(t, { bubbles: true }))
  );
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'INSERT_REPLY') {
    const text = msg.text || '';
    console.log('[FB Reply Maker] INSERT_REPLY received, preview:', text.slice(0, 40));
    (async () => {
      const result = await tryInsertReply(text);
      if (result.ok) {
        console.log('[FB Reply Maker] insert method succeeded:', result.method);
        fireActivationBurst();
      } else {
        console.warn('[FB Reply Maker] INSERT_REPLY failed:', result);
      }
      sendResponse(result);
    })();
    return true;
  }
  if (msg?.type === 'RESCAN') {
    lastPayloadHash = '';
    broadcast(true);
    sendResponse({ ok: true });
    return;
  }
});
