console.log("[FB Reply Maker] content script v2 (strict sender) loaded on " + location.href);

// Pull centralized selectors if selectors.js loaded first (registered ahead
// of this file in the SW).  Fall back to inline defaults so a stale install
// without selectors.js still works for the existing thread-scrape path.
const FBRM = globalThis.FBRM_SELECTORS || null;
const SELECTORS = {
  threadContainer: FBRM?.thread?.container || '[role="main"]',
  threadHeader: FBRM?.thread?.header || 'h1, h2',
  replyTextbox: FBRM?.thread?.replyTextbox || '[contenteditable="true"][role="textbox"]'
};
const INBOX_SELECTORS = FBRM?.inbox || {
  threadAnchorSelectors: ['a[href*="/marketplace/t/"]', 'a[href*="/messages/t/"]'],
  threadAnchor: 'a[href*="/marketplace/t/"], a[href*="/messages/t/"]',
  rowAncestorRoles: ['row', 'listitem', 'link'],
  threadIdExtractors: [
    { source: 'marketplace', re: /\/marketplace\/t\/([^/?#]+)/ },
    { source: 'messages',    re: /\/messages\/t\/([^/?#]+)/ }
  ],
  threadIdFromHref: /\/(?:marketplace|messages)\/t\/([^/?#]+)/,
  isInboxPathname: (p) =>
    /\/marketplace\/(inbox|t\/)/i.test(p || '') || /\/messages(\/|$)/i.test(p || '')
};

// Patterns that pull (sender, text) from a message aria-label.
// "atDate" / "enterMsg" appear on both incoming and outgoing bubbles —
// direction is determined by senderToken (matched against partner first
// name OR configured rep first name OR the literal "you").
// "roleDot" only fires for the partner because only they get the Buyer/
// Seller role tag in the label.
const MESSAGE_PATTERNS = [
  ['atDate',   /^At .+?, (.+?): (.+)$/s],
  ['enterMsg', /^Enter, Message sent .+? by (.+?): (.+)$/s],
  ['roleDot',  /^(.+?) · (?:Buyer|Seller) (.+)$/s]
];

const SYSTEM_PATTERNS = [/started this chat\.?$/i];

const HEADER_BLACKLIST = /^(chats?|marketplace|inbox|settings|messenger|notifications?|search|home)$/i;

// Aria-labels that are FB UI controls, not message bubbles. These leaked
// into conversation history as fake "me" messages under the old fallthrough
// logic on customer-initiated threads. We drop them explicitly as a second
// line of defense in case a future FB update adds a new sender pattern.
const UI_BLOCKLIST = /^(Thread composer|Message|New message|Customize chat|Chat members|Media,? files,? (?:and|&) links|Privacy (?:and|&) support|Search in conversation|Mute notifications?|Block|Restrict|Unrestrict|Report (?:conversation|user)?|Mark as unread|Archive chat|Unarchive chat|Delete chat|Notifications?|Active now|Active status|Open photo viewer|See all|See more|Reactions?|Reply|Forward|More options?|Settings|Close|Back|Sign out|Help|Profile picture|Edit name|Change theme|Change emoji|Change nicknames?|Add people|Mark as spam|Conversation information|Thread settings)$/i;

const MAX_CONTEXT_MESSAGES = 5;
// Phase F.1: separate history limit for the full-screen UI which renders a
// chat-bubble thread view. The sidepanel context limit stays at 5 to keep
// the AI prompt tight; the fullscreen history is for human readability.
const MAX_HISTORY_MESSAGES = 20;
const MIN_TEXT_LENGTH = 4;
const MAX_TEXT_LENGTH = 500;
const DEBOUNCE_MS = 300;

let configuredUserName = null;
chrome.storage.sync.get('userName').then((data) => {
  if (typeof data.userName === 'string' && data.userName.trim()) {
    configuredUserName = data.userName.trim();
    console.log('[FB Reply Maker] rep userName loaded:', configuredUserName);
  }
}).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.userName) return;
  const next = changes.userName.newValue;
  configuredUserName = typeof next === 'string' && next.trim() ? next.trim() : null;
  console.log('[FB Reply Maker] rep userName updated:', configuredUserName);
});

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

function parseAriaMessage(label, partnerName, userName) {
  if (!label) return null;
  const trimmed = label.trim();
  if (trimmed.length < MIN_TEXT_LENGTH || trimmed.length > MAX_TEXT_LENGTH) return null;
  if (SYSTEM_PATTERNS.some((p) => p.test(trimmed))) return null;
  if (UI_BLOCKLIST.test(trimmed)) return null;

  const partnerFirst = partnerName ? partnerName.toLowerCase().split(/\s+/)[0] : null;
  const userFirst = userName ? userName.toLowerCase().split(/\s+/)[0] : null;

  for (const [name, pattern] of MESSAGE_PATTERNS) {
    const m = trimmed.match(pattern);
    if (!m) continue;
    const senderToken = (m[1] || '').toLowerCase().trim();
    const text = (m[2] || '').trim();
    if (!text || text.length < MIN_TEXT_LENGTH) return null;

    // roleDot only attaches to the partner (Buyer/Seller tag is never on "you")
    if (name === 'roleDot') {
      return { sender: 'them', text };
    }

    // "you" / "your" → me; configured rep first name → me
    if (
      senderToken === 'you' ||
      senderToken.startsWith('you ') ||
      senderToken.startsWith('your ') ||
      (userFirst && senderToken.includes(userFirst))
    ) {
      return { sender: 'me', text };
    }
    // partner first-name match → them
    if (partnerFirst && senderToken.includes(partnerFirst)) {
      return { sender: 'them', text };
    }

    // Pattern matched but neither side is identified — refuse to guess.
    // Prevents the old fallthrough from labeling random aria-labels as "me".
    return null;
  }

  // No message pattern matched — not a message bubble. Drop.
  return null;
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

// Phase F.1: scan all aria-labelled message rows in the active thread and
// return the deduped, classified list in DOM order (oldest → newest). Shared
// by detectThread (sidepanel broadcast) and the GET_THREAD_HISTORY RPC
// (fullscreen thread view).
function scanThreadMessages(container, partnerName) {
  const byText = new Map();
  let droppedCount = 0;
  for (const el of container.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label');
    if (!(el.innerText || '').trim()) continue;
    const parsed = parseAriaMessage(label, partnerName, configuredUserName);
    if (!parsed) {
      droppedCount++;
      continue;
    }
    const existing = byText.get(parsed.text);
    if (!existing) {
      byText.set(parsed.text, parsed);
    } else if (parsed.sender === 'them' && existing.sender === 'me') {
      byText.set(parsed.text, parsed);
    }
  }
  return { messages: [...byText.values()], droppedCount };
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
  const { messages: all, droppedCount } = scanThreadMessages(container, partnerName);
  if (all.length > 0) {
    console.log('[FB Reply Maker] captured', all.length, 'messages, dropped', droppedCount, 'non-message aria-labels');
  }
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

// Phase F.1.5 — inbox list scrape.
//
// Walks every <a href="/marketplace/t/<id>/..."> in the DOM, finds its
// nearest row container, and pulls out partner / listing / snippet / time /
// unread from the row's text + aria-labels.  Returns only what is currently
// rendered — does NOT force a scroll.  Step 3 (SCROLL_INBOX_DOWN) handles
// virtualized loading.
//
// FB does not put stable class names on the rows, so the strategy is:
//   1. Anchor on the thread-id href (stable: it is the routing primitive).
//   2. Walk up to the nearest `role="row"` / `role="listitem"` / `role="link"`
//      ancestor — that is the clickable row container.
//   3. innerText of the row, split on newlines, gives 2-4 useful lines.
//      Heuristic mapping: line0 = partner, line1 = listing, line2 = snippet,
//      line3 = time.  Real FB layouts vary; we capture raw_text too so we
//      can refine the parse without redeploying selectors.
//   4. Unread is detected from aria-labels on the anchor or row that contain
//      the word "unread" (FB does this for screen readers) and as a fallback
//      from a bold-font marker on the partner name.
function findInboxRowContainer(anchor) {
  const roles = new Set(INBOX_SELECTORS.rowAncestorRoles || []);
  let node = anchor;
  for (let depth = 0; depth < 10 && node && node.parentElement; depth++) {
    const role = (node.getAttribute && node.getAttribute('role')) || '';
    if (roles.has(role)) return node;
    node = node.parentElement;
  }
  return anchor.closest('[role="row"], [role="listitem"], [role="link"]') || anchor.parentElement || anchor;
}

function classifyThreadHref(href) {
  if (!href) return null;
  const extractors = INBOX_SELECTORS.threadIdExtractors || [
    { source: 'marketplace', re: /\/marketplace\/t\/([^/?#]+)/ },
    { source: 'messages',    re: /\/messages\/t\/([^/?#]+)/ }
  ];
  for (const { source, re } of extractors) {
    const m = href.match(re);
    if (m) return { source, thread_id: m[1] };
  }
  return null;
}

function scrapeInboxList() {
  const selectorList = INBOX_SELECTORS.threadAnchorSelectors
    || [INBOX_SELECTORS.threadAnchor || 'a[href*="/marketplace/t/"], a[href*="/messages/t/"]'];
  const combined = selectorList.join(', ');
  const anchors = document.querySelectorAll(combined);

  // Dedupe by (source, thread_id) — different surfaces (marketplace vs
  // messages) can in theory collide on raw id alone.
  const seen = new Map();

  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const classified = classifyThreadHref(href);
    if (!classified) continue;
    const key = classified.source + ':' + classified.thread_id;
    if (seen.has(key)) continue;

    const row = findInboxRowContainer(a);
    const raw = ((row && row.innerText) || (a.innerText || '')).trim();
    if (!raw) continue;

    const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);

    // Aria-label-based unread detection: FB sometimes annotates the row or
    // anchor with "Unread" for screen readers.
    const aria = [
      a.getAttribute('aria-label') || '',
      row?.getAttribute?.('aria-label') || ''
    ].join(' ');
    const unread = /\bunread\b/i.test(aria);

    seen.set(key, {
      thread_id: classified.thread_id,
      source: classified.source,
      partner_name: lines[0] || null,
      listing_title: classified.source === 'marketplace' ? (lines[1] || null) : null,
      snippet: lines[classified.source === 'marketplace' ? 2 : 1] || null,
      last_activity_relative: lines[classified.source === 'marketplace' ? 3 : 2] || null,
      unread,
      raw_text: raw,
      href
    });
  }

  return [...seen.values()];
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
  // Phase F.1.5: scrape the currently rendered FB inbox list. Read-only —
  // never clicks or scrolls. Returns whatever rows are in the DOM at scrape
  // time; SCROLL_INBOX_DOWN (step 3) handles virtualized loading.
  if (msg?.type === 'GET_INBOX_LIST') {
    try {
      const pathname = location.pathname || '';
      const isInbox = (INBOX_SELECTORS.isInboxPathname || (() => true))(pathname);
      const rows = scrapeInboxList();
      if (rows.length === 0 && !isInbox) {
        sendResponse({
          ok: false,
          reason: 'not_inbox',
          url: location.href,
          pathname
        });
        return;
      }
      console.log('[FB Reply Maker] GET_INBOX_LIST scraped', rows.length, 'rows from', pathname);
      sendResponse({
        ok: true,
        rows,
        url: location.href,
        pathname,
        layoutVersion: FBRM?.layoutVersion || 'inline-default',
        capturedAt: Date.now()
      });
    } catch (err) {
      console.warn('[FB Reply Maker] GET_INBOX_LIST threw:', err?.message);
      sendResponse({ ok: false, reason: err?.message || 'scrape_failed' });
    }
    return;
  }

  // Phase F.1: full-history RPC for the fullscreen thread view. Returns the
  // most recent MAX_HISTORY_MESSAGES with sender + text, plus thread metadata.
  if (msg?.type === 'GET_THREAD_HISTORY') {
    try {
      const container = document.querySelector(SELECTORS.threadContainer);
      if (!container || !isConversationPage()) {
        sendResponse({ ok: false, reason: 'no_thread' });
        return;
      }
      const { partner: partnerName, listingTitle } = extractThreadInfo(container);
      const { messages } = scanThreadMessages(container, partnerName);
      const tail = messages.slice(-MAX_HISTORY_MESSAGES);
      sendResponse({
        ok: true,
        partnerName,
        listingTitle,
        url: location.href,
        capturedAt: Date.now(),
        messages: tail
      });
    } catch (err) {
      console.warn('[FB Reply Maker] GET_THREAD_HISTORY threw:', err?.message);
      sendResponse({ ok: false, reason: err?.message || 'scan_failed' });
    }
    return;
  }
});
