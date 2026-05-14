// Idempotency guard. Chrome may run this file twice on the same page when
// a registered injection coincides with our executeScript fallback in the
// SW. Without this, top-level `const FBRM = ...` throws on the second run
// ("Identifier 'FBRM' has already been declared") and kills the SW round-
// trip. We wrap the whole body in an IIFE and bail early if a flag on
// globalThis says we already initialized.
(function () {
  if (globalThis.__FBRM_CONTENT_LOADED__) {
    console.log('[FB Reply Maker] content script already initialized on ' + location.href + ', skipping re-init');
    return;
  }
  globalThis.__FBRM_CONTENT_LOADED__ = true;

// Build marker — bump per release so the FB tab DevTools console shows
// exactly which version is running. If you don't see THIS marker after
// reloading the extension, the content script didn't re-inject and the
// FB tab needs a hard refresh (Ctrl+Shift+R).
const __FB_REPLY_MAKER_BUILD__ = 'cs-swlogged-2026-05-14';
console.log("[FB Reply Maker] content script v2 (strict sender) loaded on " + location.href + " · build=" + __FB_REPLY_MAKER_BUILD__);

// Stream content-script logs into the SW console so we can see them
// without opening FB tab DevTools (which conflicts with chrome.debugger
// when we test the trusted-Ctrl+V path). Best-effort — silently noops
// if the SW isn't reachable.
function swlog(...args) {
  try {
    const message = args.map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    chrome.runtime.sendMessage({ type: 'LOG_FROM_CS', message });
  } catch (e) {}
}
swlog('content script loaded build=' + __FB_REPLY_MAKER_BUILD__ + ' href=' + location.href);

// Pull centralized selectors if selectors.js loaded first (registered ahead
// of this file in the SW).  Fall back to inline defaults so a stale install
// without selectors.js still works for the existing thread-scrape path.
const FBRM = globalThis.FBRM_SELECTORS || null;
const SELECTORS = {
  threadContainer: FBRM?.thread?.container || '[role="main"]',
  threadHeader: FBRM?.thread?.header || 'h1, h2',
  replyTextbox: FBRM?.thread?.replyTextbox || '[contenteditable="true"][role="textbox"]',
  sendButtonSelectors: FBRM?.thread?.sendButtonSelectors || [
    'div[role="button"][aria-label="Press enter to send"]',
    'div[role="button"][aria-label="Send"]',
    'div[role="button"][aria-label="Press Enter to send"]',
    'button[aria-label="Send"]',
    'button[aria-label="Press enter to send"]',
    '[role="textbox"] ~ div[role="button"]'
  ]
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

// Aligned to 20 in the side-panel migration so AI context matches the full
// scrape window. THREAD_UPDATE broadcasts now ship up to 20 turns; the
// server prompt builds the history block from all of them.
const MAX_CONTEXT_MESSAGES = 20;
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

// `opts.permissive` = true relaxes the unknown-sender rule. With strict mode
// (default), an ambiguous sender (not "you", not the configured rep, not
// the partner first-name) returns null — this protects auto-gen from being
// triggered by a misclassified outgoing message in a 2-party Marketplace
// thread. Permissive mode is used by the UI-only OPEN_THREAD path, where
// we want group-chat bubbles to render with the actual sender label even
// though auto-gen should still treat them as ambiguous (which it does,
// because auto-gen reads from THREAD_UPDATE which uses strict mode).
function parseAriaMessage(label, partnerName, userName, opts) {
  const permissive = !!(opts && opts.permissive);
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
    const rawSender = (m[1] || '').trim();
    const senderToken = rawSender.toLowerCase();
    const text = (m[2] || '').trim();
    if (!text || text.length < MIN_TEXT_LENGTH) return null;

    // roleDot only attaches to the partner (Buyer/Seller tag is never on "you")
    if (name === 'roleDot') {
      return { sender: 'them', text, senderName: rawSender };
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
      return { sender: 'them', text, senderName: rawSender };
    }

    // Pattern matched but sender isn't "you" and isn't the named partner.
    // Strict mode (default) refuses to guess so auto-gen doesn't fire on
    // a misclassified bubble. Permissive mode (UI-only) accepts it as a
    // group-chat-style "them" bubble and preserves the sender label so
    // the UI can render "John: hey everyone".
    if (permissive && rawSender) {
      return { sender: 'them', text, senderName: rawSender };
    }
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
// by detectThread (sidepanel broadcast — STRICT, drives auto-gen safety),
// the GET_THREAD_HISTORY RPC, and OPEN_THREAD
// (passes opts.permissive: true so group chats render).
function scanThreadMessages(container, partnerName, opts) {
  const permissive = !!(opts && opts.permissive);
  const byText = new Map();
  let droppedCount = 0;
  for (const el of container.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label');
    if (!(el.innerText || '').trim()) continue;
    const parsed = parseAriaMessage(label, partnerName, configuredUserName, { permissive });
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

// ============================================================
// Phase F.1.7 — humanized send injection
// ============================================================
//
// Replaces the prior bulk-insert with a character-by-character typing path,
// adds an optional auto-send that locates the send button, "drives" the
// cursor toward it with a short mousemove sequence, then clicks. Per-
// character delays follow a 3-bucket distribution (normal / pause /
// thinking) and occasional typo-retype patterns for messages over 40
// chars. Pre-send guards block placeholder leaks, dedupes, and
// thread-URL drift. Bulk-insert remains as a robust fallback if FB
// rejects character-driven input on a given surface.

const TYPING_BUCKETS = [
  { weight: 0.70, min: 30,  max: 90  },  // normal typing
  { weight: 0.20, min: 90,  max: 180 },  // brief pause
  { weight: 0.10, min: 180, max: 400 }   // thinking pause
];
// 1.5% per word — distracted-but-functional typing on long messages.
// 4% felt noisy across real sends; 1.5% averages ~1 typo per 60-70 words.
const TYPO_PROBABILITY_PER_WORD = 0.015;
const TYPO_MIN_MESSAGE_LENGTH = 40;
const FOCUS_PRE_TYPE_MIN_MS = 400;
const FOCUS_PRE_TYPE_MAX_MS = 1200;
const POST_TYPE_REVIEW_MIN_MS = 300;
const POST_TYPE_REVIEW_MAX_MS = 900;
const SEND_MOUSEMOVE_STEPS_MIN = 3;
const SEND_MOUSEMOVE_STEPS_MAX = 5;
const SEND_MOUSEMOVE_DURATION_MIN_MS = 80;
const SEND_MOUSEMOVE_DURATION_MAX_MS = 200;
const SEND_BUTTON_WAIT_MS = 2000;
const SEND_CONFIRM_WAIT_MS = 3000;
const SEND_NETWORK_GRACE_MS = 8000;
const PLACEHOLDER_LEAK_PATTERNS = [
  /@\[\s*(name|customer|partner|first[\s_-]?name)\s*\]/i,
  /\{\s*(vehicle|name|partner|listing|customer)\s*\}/i,
  /<<\s*\w+\s*>>/
];
// Adjacent-keys for typo simulation. Maps a→s,q,w; etc. Only common ASCII
// letters; fallback to a generic shift if not in map.
const TYPO_NEIGHBORS = {
  a: 'sq', b: 'vn', c: 'xv', d: 'sf', e: 'wr', f: 'dg', g: 'fh', h: 'gj',
  i: 'uo', j: 'hk', k: 'jl', l: 'k', m: 'n', n: 'bm', o: 'ip', p: 'o',
  q: 'wa', r: 'et', s: 'ad', t: 'ry', u: 'yi', v: 'cb', w: 'qe', x: 'zc',
  y: 'tu', z: 'x'
};

function pickTypingDelayMs() {
  const r = Math.random();
  let acc = 0;
  for (const b of TYPING_BUCKETS) {
    acc += b.weight;
    if (r <= acc) return b.min + Math.floor(Math.random() * (b.max - b.min));
  }
  const last = TYPING_BUCKETS[TYPING_BUCKETS.length - 1];
  return last.min + Math.floor(Math.random() * (last.max - last.min));
}

function pickFocusDelayMs(textLength) {
  // Longer messages = more "reading before typing" time. Scale linearly,
  // clamped to the configured range.
  const scaled = FOCUS_PRE_TYPE_MIN_MS + Math.floor((textLength / 200) * (FOCUS_PRE_TYPE_MAX_MS - FOCUS_PRE_TYPE_MIN_MS));
  const clamped = Math.min(FOCUS_PRE_TYPE_MAX_MS, Math.max(FOCUS_PRE_TYPE_MIN_MS, scaled));
  // Add ±20% jitter so two same-length messages don't have identical delays.
  const jitter = clamped * (Math.random() * 0.4 - 0.2);
  return Math.max(FOCUS_PRE_TYPE_MIN_MS, Math.floor(clamped + jitter));
}

function typoNeighborFor(ch) {
  const lower = ch.toLowerCase();
  const neighbors = TYPO_NEIGHBORS[lower];
  if (!neighbors) return null;
  const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
  return ch === lower ? pick : pick.toUpperCase();
}

// Build a typing "plan" — an array of operations the typer will execute.
// Most entries are { kind: 'char', char }. A small percentage of words get
// a { kind: 'typo', wrong, correct } pair which the typer expands into
// type-wrong → backspace → type-correct.
function buildTypingPlan(text) {
  const ops = [];
  if (text.length < TYPO_MIN_MESSAGE_LENGTH) {
    for (const ch of text) ops.push({ kind: 'char', char: ch });
    return ops;
  }
  // Split into words preserving the separators so we can re-stream the
  // original text exactly.
  const tokens = text.match(/\S+|\s+/g) || [text];
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      for (const ch of tok) ops.push({ kind: 'char', char: ch });
      continue;
    }
    // Eligible word for typo: at least 4 chars, only-letters body, has a
    // typo-eligible character in positions 2-end. Pick one position to
    // mis-type at the per-word probability.
    const eligible = tok.length >= 4 && /^[A-Za-z'-]+[.,!?]?$/.test(tok);
    if (eligible && Math.random() < TYPO_PROBABILITY_PER_WORD) {
      const typoIdx = 1 + Math.floor(Math.random() * (tok.length - 1));
      const right = tok[typoIdx];
      const wrong = typoNeighborFor(right);
      if (wrong && wrong !== right) {
        for (let i = 0; i < tok.length; i++) {
          if (i === typoIdx) {
            ops.push({ kind: 'typo', wrong, correct: right });
          } else {
            ops.push({ kind: 'char', char: tok[i] });
          }
        }
        continue;
      }
    }
    for (const ch of tok) ops.push({ kind: 'char', char: ch });
  }
  return ops;
}

// (sleep + randomBetween already declared near the top of this IIFE
//  for F.1.5 humanization; F.1.7 reuses them.)

// Fire a single character into the contenteditable using a beforeinput +
// input pair (most React-friendly). Falls back to textContent append if
// the synthetic event was canceled. Returns whether the textbox grew.
function typeChar(box, ch) {
  const before = box.innerText || '';
  try {
    const ie = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: ch,
      bubbles: true,
      cancelable: true
    });
    const accepted = box.dispatchEvent(ie);
    if (accepted) {
      box.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText',
        data: ch,
        bubbles: true
      }));
    }
  } catch (err) {
    /* fall through to DOM append */
  }
  if ((box.innerText || '') === before) {
    // Synthetic input was rejected — append directly so the next char
    // doesn't compound the gap.
    try {
      box.appendChild(document.createTextNode(ch));
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } catch { /* give up on this char */ }
  }
  return (box.innerText || '').length > before.length;
}

function backspaceOne(box) {
  const before = box.innerText || '';
  try {
    const ie = new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      bubbles: true,
      cancelable: true
    });
    const accepted = box.dispatchEvent(ie);
    if (accepted) {
      box.dispatchEvent(new InputEvent('input', {
        inputType: 'deleteContentBackward',
        bubbles: true
      }));
    }
  } catch { /* ignore */ }
  if ((box.innerText || '') === before) {
    // Manually pop the last character.
    const txt = box.innerText || '';
    if (txt.length > 0) {
      box.innerText = txt.slice(0, -1);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

async function humanizedType(box, text) {
  // Place caret at end and focus.
  try {
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* best effort */ }

  await sleep(pickFocusDelayMs(text.length));

  const plan = buildTypingPlan(text);
  for (const op of plan) {
    if (document.hidden) {
      return { ok: false, reason: 'tab_hidden_mid_type' };
    }
    if (op.kind === 'char') {
      typeChar(box, op.char);
      await sleep(pickTypingDelayMs());
    } else if (op.kind === 'typo') {
      typeChar(box, op.wrong);
      // Brief "noticed it" pause before backspacing — short, not "thinking".
      await sleep(80 + Math.floor(Math.random() * 120));
      backspaceOne(box);
      // Recovery pause before retyping.
      await sleep(60 + Math.floor(Math.random() * 100));
      typeChar(box, op.correct);
      await sleep(pickTypingDelayMs());
    }
  }
  return { ok: true };
}

function findSendButton() {
  const list = SELECTORS.sendButtonSelectors || [];
  for (const sel of list) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// Fire a short mousemove sequence "toward" the target element ending in a
// click. FB's bot-detection has been observed reacting to instant clicks
// with no prior pointer movement; a 3-5 step traversal over 80-200ms is
// cheap insurance.
async function humanizedClick(target) {
  if (!target) return { ok: false, reason: 'no_target' };
  const rect = target.getBoundingClientRect();
  const endX = rect.left + rect.width * (0.4 + Math.random() * 0.2);
  const endY = rect.top + rect.height * (0.4 + Math.random() * 0.2);

  // Pick a starting point somewhere left + above the target.
  const startX = Math.max(10, endX - (60 + Math.random() * 120));
  const startY = Math.max(10, endY - (40 + Math.random() * 80));

  const steps = SEND_MOUSEMOVE_STEPS_MIN
    + Math.floor(Math.random() * (SEND_MOUSEMOVE_STEPS_MAX - SEND_MOUSEMOVE_STEPS_MIN + 1));
  const totalDur = SEND_MOUSEMOVE_DURATION_MIN_MS
    + Math.floor(Math.random() * (SEND_MOUSEMOVE_DURATION_MAX_MS - SEND_MOUSEMOVE_DURATION_MIN_MS));
  const stepDur = Math.max(8, Math.floor(totalDur / steps));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Slight curve via sinusoidal Y offset so it isn't a straight line.
    const curveY = Math.sin(t * Math.PI) * (4 + Math.random() * 6);
    const x = startX + (endX - startX) * t;
    const y = startY + (endY - startY) * t + curveY;
    try {
      const el = document.elementFromPoint(x, y) || target;
      el.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window
      }));
    } catch { /* ignore */ }
    await sleep(stepDur);
  }

  // Overlay collision check (spec adjustment 5). If something else is in
  // the way at the final cursor coords — sticker tray, attachment menu,
  // tooltip — the mouseover/down/up events would land on the overlay,
  // not the button. Skip the pre-click event sequence in that case and
  // fire a direct click on the target.
  let finalElAtPoint = null;
  try { finalElAtPoint = document.elementFromPoint(endX, endY); } catch { /* ignore */ }
  const overlayCollision = finalElAtPoint && finalElAtPoint !== target && !target.contains(finalElAtPoint) && !finalElAtPoint.contains(target);
  if (overlayCollision) {
    console.warn('[FB Reply Maker] mousemove_overlay_collision', {
      expected: target.tagName + (target.getAttribute('aria-label') ? `[${target.getAttribute('aria-label')}]` : ''),
      got: finalElAtPoint.tagName + (finalElAtPoint.getAttribute && finalElAtPoint.getAttribute('aria-label') ? `[${finalElAtPoint.getAttribute('aria-label')}]` : '')
    });
    try {
      target.click();
      return { ok: true, method: 'direct_click_overlay_fallback' };
    } catch (err) {
      console.warn('[FB Reply Maker] direct-click fallback failed:', err?.message);
      return { ok: false, reason: 'direct_click_threw' };
    }
  }

  try {
    // mouseover + mousedown + mouseup + click — full sequence so React
    // pointer handlers fire in the order they expect.
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: endX, clientY: endY }));
    await sleep(20 + Math.floor(Math.random() * 40));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: endX, clientY: endY }));
    await sleep(20 + Math.floor(Math.random() * 50));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: endX, clientY: endY }));
    target.click();
    return { ok: true, method: 'humanized_click' };
  } catch (err) {
    console.warn('[FB Reply Maker] humanizedClick failed:', err?.message);
    return { ok: false, reason: err?.message || 'click_threw' };
  }
}

async function waitForMessageInThread(text, maxMs) {
  const sample = text.slice(0, Math.min(40, text.length));
  const container = document.querySelector(SELECTORS.threadContainer);
  if (!container) return false;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const innerText = container.innerText || '';
    if (innerText.includes(sample)) return true;
    await sleep(150);
  }
  return false;
}

function checkPreSendGuards({ text, threadHint }) {
  if (typeof text !== 'string') return { ok: false, reason: 'not_string' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  for (const re of PLACEHOLDER_LEAK_PATTERNS) {
    if (re.test(text)) return { ok: false, reason: 'placeholder_leak' };
  }
  // Optional caller-supplied thread URL hint: refuse to send if the tab
  // has navigated to a different thread since the request was queued.
  if (threadHint) {
    const safe = String(threadHint).replace(/[^A-Za-z0-9_-]/g, '');
    if (safe && !new RegExp('/(?:marketplace|messages)/t/' + safe + '(?:[/?#]|$)').test(location.href)) {
      return { ok: false, reason: 'thread_url_drift', url: location.href };
    }
  }
  // Dedupe: scan visible bubbles for an outgoing message identical to text.
  const container = document.querySelector(SELECTORS.threadContainer);
  if (container) {
    const partner = extractThreadInfo(container).partner || null;
    const { messages } = scanThreadMessages(container, partner);
    for (const m of messages) {
      if (m.sender === 'me' && m.text && m.text.trim() === trimmed) {
        return { ok: false, reason: 'duplicate_send' };
      }
    }
  }
  return { ok: true };
}

// Bulk-insert fallback (the original F.1 method). Still used when the
// humanized character-by-character path is rejected by FB or when caller
// opts out via { skipHumanized: true }. Single-method insert via
// execCommand — works reliably when the FB tab is the active foreground
// tab (which it always is in side-panel mode).
async function bulkInsertReply(text) {
  const box = document.querySelector(SELECTORS.replyTextbox);
  if (!box) return { ok: false, reason: 'no_textbox' };
  const sample = text.slice(0, Math.min(20, text.length));

  // Forcefully activate the box. FB's compose is a contenteditable that
  // sometimes ignores .focus() alone if the user hasn't interacted with
  // the page since load — execCommand('insertText') silently fails when
  // the active element isn't the box. Synthetic mousedown+mouseup+click
  // mirrors a real user click and gets FB's React state into "focused".
  try {
    const rect = box.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ['mousedown', 'mouseup', 'click']) {
      box.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0
      }));
    }
    box.focus();
  } catch {}

  // Place caret at end of any existing content + select-all so insertText
  // replaces (not appends).
  try {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}

  // Verify the box is actually the active element. If not, one more
  // focus attempt — sometimes the click takes a tick to land.
  if (document.activeElement !== box) {
    try { box.focus(); } catch {}
    await sleep(20);
  }

  try {
    document.execCommand('insertText', false, text);
  } catch (err) {
    return { ok: false, reason: err?.message || 'insert_threw' };
  }
  await sleep(40);
  if (!(box.innerText || '').includes(sample)) {
    return { ok: false, reason: 'insert_failed' };
  }
  return { ok: true, method: 'execCommand' };
}

// Fetches an image URL and returns a PNG Blob. Routes the actual HTTP
// fetch through the service worker via FETCH_IMAGE_FOR_CLIPBOARD because
// host_permissions reliably bypass CORS for SW fetches, whereas content-
// script fetches can occasionally hit CORS edge cases (the request runs
// in the page's origin context). PNG conversion happens here in the CS.
async function fetchAsPngBlobInCS(url) {
  if (typeof url !== 'string' || !url) throw new Error('no_url');
  const resp = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_FOR_CLIPBOARD', url });
  if (!resp || !resp.ok) {
    throw new Error('sw_fetch_failed: ' + (resp && resp.reason ? resp.reason : 'unknown'));
  }
  // Decode base64 back to a Blob.
  const binary = atob(resp.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const srcBlob = new Blob([bytes], { type: resp.mime || 'image/jpeg' });
  if (srcBlob.type === 'image/png') return srcBlob;
  const bmp = await createImageBitmap(srcBlob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_canvas_2d_context');
  ctx.drawImage(bmp, 0, 0);
  return await canvas.convertToBlob({ type: 'image/png' });
}

// Activates the FB chat composer (focus + caret to end). Same synthetic
// mouse activation pattern bulkInsertReply uses to wake React state.
function activateReplyBox() {
  const box = document.querySelector(SELECTORS.replyTextbox);
  if (!box) return null;
  try {
    const rect = box.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ['mousedown', 'mouseup', 'click']) {
      box.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0
      }));
    }
    box.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(box);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}
  return box;
}

// Copies ONE image URL to the system clipboard from the content script,
// activates the chat composer, then asks the service worker to dispatch
// a TRUSTED Ctrl+V via chrome.debugger. The trusted keypress triggers
// the browser's native paste, which FB Messenger accepts (synthetic
// paste events and execCommand are unreliable for image data).
//
// Returns { ok, pasted, reason }. pasted=true means the trusted Ctrl+V
// was dispatched successfully. The yellow "X is debugging this browser"
// bar appears on the FB tab while the debugger is attached, then
// disappears ~2.5s after the last Ctrl+V (auto-detach in SW).
async function copyAndPasteOneImage(url) {
  swlog('copyAndPasteOneImage START url=' + url);
  try {
    const pngBlob = await fetchAsPngBlobInCS(url);
    swlog('fetch+png OK bytes=' + pngBlob.size + ' type=' + pngBlob.type);
    if (typeof ClipboardItem === 'undefined') {
      swlog('ABORT: ClipboardItem unavailable');
      return { ok: false, reason: 'clipboard_item_unavailable' };
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    swlog('clipboard.write OK');
  } catch (err) {
    swlog('FAILED at fetch/png/clipboard.write: ' + (err?.message || err));
    return { ok: false, reason: err?.message || String(err) };
  }
  const box = activateReplyBox();
  if (!box) {
    swlog('FAILED: activateReplyBox returned null (no textbox)');
    return { ok: true, pasted: false, reason: 'no_textbox_for_paste' };
  }
  swlog('composer activated; sending DISPATCH_CTRL_V to SW');
  await sleep(60);
  let pasted = false;
  let pasteErr = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'DISPATCH_CTRL_V' });
    swlog('DISPATCH_CTRL_V response: ' + JSON.stringify(resp));
    if (resp && resp.ok) {
      pasted = true;
    } else {
      pasteErr = (resp && resp.reason) || 'no_response';
    }
  } catch (err) {
    swlog('DISPATCH_CTRL_V threw: ' + (err?.message || err));
    pasteErr = err?.message || String(err);
  }
  return { ok: true, pasted, paste_err: pasteErr };
}

// Chains copy-and-paste across an array of URLs. If an auto-paste lands,
// we continue to the next image after a delay. If an auto-paste fails
// (execCommand('paste') is unreliable for image data on FB Messenger),
// we STOP the chain so the failed image stays on the clipboard for the
// rep to finish with Ctrl+V. Continuing past a failure would overwrite
// the clipboard with the next image, stranding the first.
async function attachImagesViaClipboardChain(urls) {
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const r = await copyAndPasteOneImage(urls[i]);
    results.push(r);
    if (!r.ok) break;
    if (!r.pasted) {
      // Clipboard is loaded with this image; chat is focused. Hand off
      // to the rep — pressing Ctrl+V now will paste THIS image. The
      // remaining images stay queued (rep clicks their 📋 buttons next).
      break;
    }
    if (i < urls.length - 1) await sleep(800);
  }
  return results;
}

// LEGACY synthetic-paste path. Kept around as documentation of why we
// switched approaches but no longer called from INSERT_REPLY. FB rejects
// synthetic ClipboardEvent('paste') with image clipboardData (event is
// not trusted), so we moved to navigator.clipboard.write + execCommand.
async function pasteImagesIntoReplyBox(urls) {
  const result = { attached: 0, errors: [] };
  if (!Array.isArray(urls) || urls.length === 0) return result;

  const box = document.querySelector(SELECTORS.replyTextbox);
  if (!box) {
    result.errors.push('no_textbox');
    return result;
  }

  // Fetch each image as a Blob. Done in parallel; per-image failures are
  // captured and don't sink the whole batch.
  const fetches = await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { credentials: 'omit', mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      // Derive a sensible filename + MIME type. FB inspects the File name
      // for the upload UI label; falling back to image/jpeg is safe.
      const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
      const ext = mime.split('/')[1] || 'jpg';
      const safeName = (url.split('/').pop() || `tire-${Date.now()}.${ext}`).replace(/[^A-Za-z0-9._-]/g, '_');
      const file = new File([blob], safeName, { type: mime });
      return { ok: true, file, url };
    } catch (err) {
      return { ok: false, url, err: err?.message || String(err) };
    }
  }));

  const files = fetches.filter((f) => f.ok).map((f) => f.file);
  for (const f of fetches) {
    if (!f.ok) result.errors.push(`${f.url}: ${f.err}`);
  }
  if (files.length === 0) return result;

  // Make sure the box is focused — paste events require the target to be
  // the active element or focus is ambiguous.
  try {
    box.focus();
    // Move caret to end so the paste lands after the existing text reply.
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(box);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}
  if (document.activeElement !== box) {
    await sleep(40);
    try { box.focus(); } catch {}
  }

  // Build the DataTransfer. Chrome supports the `new DataTransfer()` ctor
  // and `DataTransfer.items.add(file)` since ~MV3 era.
  let dt;
  try {
    dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
  } catch (err) {
    result.errors.push(`datatransfer: ${err?.message || err}`);
    return result;
  }

  // Dispatch the paste event. ClipboardEvent constructor accepts
  // clipboardData but Chrome historically ignores it — we set it via
  // Object.defineProperty as a fallback so React's synthetic event
  // handlers see the files.
  let ev;
  try {
    ev = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt
    });
    if (!ev.clipboardData || !ev.clipboardData.files || ev.clipboardData.files.length === 0) {
      Object.defineProperty(ev, 'clipboardData', { value: dt, writable: false });
    }
  } catch (err) {
    result.errors.push(`event_ctor: ${err?.message || err}`);
    return result;
  }

  const accepted = box.dispatchEvent(ev);
  // Some implementations of paste handlers also listen on document /
  // window; fire there as a secondary signal if the box-level handler
  // didn't claim it.
  if (!ev.defaultPrevented) {
    try { document.dispatchEvent(ev); } catch {}
  }
  result.attached = files.length;
  result.dispatch_accepted = accepted;
  result.default_prevented = !!ev.defaultPrevented;
  return result;
}

// Entry point for INSERT_REPLY. Runs pre-send guards, types the message
// character-by-character (with humanized distribution + occasional typo-
// retype), and optionally clicks send via a mousemove path. Falls back to
// bulk insert if humanized typing didn't produce the expected text in the
// box (FB rejected our synthetic events).
async function tryInsertReply(text, opts) {
  const options = opts || {};
  const autoSend = !!options.auto_send;
  const threadHint = options.thread_id || null;
  const bypassGuards = !!options.bypass_guards;

  if (!bypassGuards) {
    const guard = checkPreSendGuards({ text, threadHint });
    if (!guard.ok) {
      console.warn('[FB Reply Maker] pre-send guard:', guard.reason, guard);
      return { ok: false, reason: guard.reason, guard: true };
    }
  } else {
    console.log('[FB Reply Maker] pre-send guards bypassed by caller');
  }

  const box = document.querySelector(SELECTORS.replyTextbox);
  if (!box) return { ok: false, reason: 'no_textbox' };
  const sample = text.slice(0, Math.min(20, text.length));

  let usedMethod = null;
  if (!options.skip_humanized) {
    const t = await humanizedType(box, text);
    if (t.ok && (box.innerText || '').includes(sample)) {
      usedMethod = 'humanizedType';
    } else if (!t.ok && t.reason === 'tab_hidden_mid_type') {
      return { ok: false, reason: 'tab_hidden_mid_type' };
    }
  }
  if (!usedMethod) {
    try { box.innerText = ''; } catch { /* ignore */ }
    const bulk = await bulkInsertReply(text);
    if (!bulk.ok) return { ok: false, reason: bulk.reason || 'insert_failed' };
    usedMethod = bulk.method;
  }

  const humanizationSucceeded = usedMethod === 'humanizedType';

  if (!autoSend) {
    fireActivationBurst();
    return { ok: true, method: usedMethod, sent: false, humanization_succeeded: humanizationSucceeded };
  }

  // Auto-send: locate button, review pause, humanized click, confirm send.
  // Re-locate compose box right before clicking — FB sometimes shifts DOM
  // during typing (sticker tray expands, attachment row appears, etc.).
  const reviewPause = POST_TYPE_REVIEW_MIN_MS
    + Math.floor(Math.random() * (POST_TYPE_REVIEW_MAX_MS - POST_TYPE_REVIEW_MIN_MS));
  await sleep(reviewPause);

  // Spec F1.7: "Send button not found within 2s of compose box focus →
  // Re-locate compose box. If still not found, fail to clipboard fallback."
  let sendBtn = findSendButton();
  if (!sendBtn) {
    const waitStart = Date.now();
    while (!sendBtn && Date.now() - waitStart < SEND_BUTTON_WAIT_MS) {
      await sleep(120);
      sendBtn = findSendButton();
    }
  }
  if (!sendBtn) {
    // Last-ditch: clipboard the text so the user has it on hand, surface
    // the failure so the UI can prompt for manual send.
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    return {
      ok: false,
      reason: 'send_button_not_found',
      method: usedMethod,
      humanization_succeeded: humanizationSucceeded,
      clipboard_set: true
    };
  }

  if (document.hidden) {
    return {
      ok: false,
      reason: 'tab_hidden_before_send',
      method: usedMethod,
      humanization_succeeded: humanizationSucceeded
    };
  }

  const clickResult = await humanizedClick(sendBtn);
  if (!clickResult || !clickResult.ok) {
    return {
      ok: false,
      reason: 'click_failed',
      method: usedMethod,
      humanization_succeeded: humanizationSucceeded
    };
  }

  // Confirm: wait for the message text to appear in the thread DOM. If
  // the network is slow we extend the wait but never auto-retry the send.
  const appeared = await waitForMessageInThread(text, SEND_CONFIRM_WAIT_MS);
  if (appeared) {
    return {
      ok: true,
      method: usedMethod,
      sent: true,
      humanization_succeeded: humanizationSucceeded,
      click_method: clickResult.method
    };
  }
  const lateAppeared = await waitForMessageInThread(text, SEND_NETWORK_GRACE_MS - SEND_CONFIRM_WAIT_MS);
  if (lateAppeared) {
    return {
      ok: true,
      method: usedMethod,
      sent: true,
      slow: true,
      humanization_succeeded: humanizationSucceeded,
      click_method: clickResult.method
    };
  }
  return {
    ok: false,
    reason: 'send_not_confirmed',
    method: usedMethod,
    humanization_succeeded: humanizationSucceeded,
    advice: 'Send may have failed. Check FB before retrying.'
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
// Phase F.1.5 step 3 — humanization. FB watches for bursty automated
// activity; randomized delays + a hard floor between any two DOM actions
// keep our scroll/click cadence in "looks human" territory. Module-scoped
// so it spans GET_INBOX_LIST + SCROLL_INBOX_DOWN + future OPEN_THREAD.
const HUMAN_MIN_GAP_MS = 100;
const SCROLL_PRE_DELAY_MIN = 300;
const SCROLL_PRE_DELAY_MAX = 700;
const SCROLL_SETTLE_MS = 500;
let lastFbActionAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

async function ensureHumanGap() {
  const elapsed = Date.now() - lastFbActionAt;
  if (elapsed < HUMAN_MIN_GAP_MS) {
    await sleep(HUMAN_MIN_GAP_MS - elapsed);
  }
}

function markFbAction() {
  lastFbActionAt = Date.now();
}

// Walk up from a thread anchor to the nearest ancestor that's actually
// scrollable (scrollHeight > clientHeight + a small fudge, AND overflow
// allows scrolling). FB virtualizes the inbox list inside its own scroll
// container — usually 4-8 levels up from the anchor.
function findInboxScrollContainer() {
  const anchorSelector = (INBOX_SELECTORS.threadAnchorSelectors || []).join(', ')
    || INBOX_SELECTORS.threadAnchor
    || 'a[href*="/marketplace/t/"], a[href*="/messages/t/"]';
  const firstAnchor = document.querySelector(anchorSelector);
  if (!firstAnchor) return null;

  let node = firstAnchor.parentElement;
  for (let depth = 0; depth < 20 && node && node !== document.body; depth++) {
    const cs = window.getComputedStyle(node);
    const overflowY = cs.overflowY;
    const canScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    if (canScroll && node.scrollHeight > node.clientHeight + 4) {
      return node;
    }
    node = node.parentElement;
  }
  // Fallback: scrollingElement (whole document). Less ideal but at least
  // forces FB to render more thumbs if the entire inbox is a long page.
  return document.scrollingElement || null;
}

async function scrollInboxDown() {
  const container = findInboxScrollContainer();
  if (!container) {
    return { ok: false, reason: 'no_scroll_container' };
  }
  const before = {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight
  };
  const atBottom = before.scrollTop + before.clientHeight >= before.scrollHeight - 4;
  if (atBottom) {
    return { ok: true, atBottom: true, scrolledBy: 0, ...before };
  }

  // Humanize: random pre-delay + minimum gap since last DOM action.
  await ensureHumanGap();
  await sleep(randomBetween(SCROLL_PRE_DELAY_MIN, SCROLL_PRE_DELAY_MAX));

  // Scroll ~80% of the visible viewport. FB's virtualizer kicks in on the
  // scroll event itself; we don't need a wheel/touch event, scrollTop is
  // enough for the chat list pane.
  const scrollBy = Math.max(120, Math.floor(before.clientHeight * 0.8));
  container.scrollTop = before.scrollTop + scrollBy;
  markFbAction();

  // Settle: wait for FB to inject new rows from the virtualizer.
  await sleep(SCROLL_SETTLE_MS);

  const after = {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight
  };
  return {
    ok: true,
    atBottom: after.scrollTop + after.clientHeight >= after.scrollHeight - 4,
    scrolledBy: after.scrollTop - before.scrollTop,
    before,
    after
  };
}

// Phase F.1.5 step 4 — drive the FB tab to a given thread without the user
// having to switch to it. Locate the row anchor by thread_id, click it,
// wait for the thread compose pane to render, then scrape last 20.
//
// "Hidden" tabs in Chrome do not block JS execution — element.click()
// fires the SPA navigation, FB renders the thread DOM, and the existing
// scanThreadMessages picks it up. We add humanization on top so the
// click cadence matches a normal user.
async function waitForSelector(selector, maxMs = 3000, pollMs = 120) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(pollMs);
  }
  return null;
}

// Snapshot the set of aria-labels under the thread container so we can
// detect when FB has swapped in a new thread's bubbles. FB reuses the
// compose textbox across thread switches, so waiting for it to "appear"
// isn't enough — we'd scrape the previous thread's still-mounted bubbles.
function snapshotThreadLabels(container) {
  const set = new Set();
  if (!container) return set;
  for (const el of container.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label');
    if (!label) continue;
    if (label.length < 8 || label.length > 800) continue;
    set.add(label);
  }
  return set;
}

// Wait for the SPA URL to reflect the requested thread. FB navigates
// instantly on click, so this resolves fast in the common case — but if
// the click misses or FB defers nav, we bail after maxMs.
async function waitForUrlToMatchThread(threadId, maxMs = 2500) {
  const safeId = String(threadId).replace(/[^A-Za-z0-9_-]/g, '');
  const re = new RegExp('/(?:marketplace|messages)/t/' + safeId + '(?:[/?#]|$)');
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (re.test(location.href)) return true;
    await sleep(80);
  }
  return re.test(location.href);
}

// Wait for the thread container's aria-label set to substantially change
// vs the pre-click baseline. Returns true once the new thread's bubbles
// have replaced the old ones (or close to it).
async function waitForThreadContentSwap(container, baseline, maxMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const current = snapshotThreadLabels(container);
    if (current.size > 0) {
      let overlap = 0;
      for (const lbl of baseline) if (current.has(lbl)) overlap++;
      const baselineSize = Math.max(1, baseline.size);
      const overlapRatio = overlap / baselineSize;
      // Two satisfaction conditions:
      // 1. Baseline was empty / very small (first thread ever opened) and
      //    we now have a few labels → content arrived.
      // 2. Most of the baseline labels are gone AND we have new ones →
      //    FB swapped threads.
      if (baseline.size <= 2 && current.size >= 3) return true;
      if (overlapRatio < 0.5 && current.size >= 3) return true;
    }
    await sleep(120);
  }
  return false;
}

function findThreadRowAnchor(threadId, source) {
  if (!threadId) return null;
  const safeId = String(threadId).replace(/[^A-Za-z0-9_-]/g, '');
  const selectors = [];
  if (!source || source === 'marketplace') {
    selectors.push(`a[href*="/marketplace/t/${safeId}/"]`);
    selectors.push(`a[href*="/marketplace/t/${safeId}?"]`);
    selectors.push(`a[href$="/marketplace/t/${safeId}"]`);
  }
  if (!source || source === 'messages') {
    selectors.push(`a[href*="/messages/t/${safeId}/"]`);
    selectors.push(`a[href*="/messages/t/${safeId}?"]`);
    selectors.push(`a[href$="/messages/t/${safeId}"]`);
  }
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

async function openThreadByRowClick({ thread_id, source } = {}) {
  if (!thread_id) return { ok: false, reason: 'no_thread_id' };

  const anchor = findThreadRowAnchor(thread_id, source);
  if (!anchor) {
    return { ok: false, reason: 'row_not_in_dom', thread_id };
  }

  // Snapshot the current thread's aria-labels BEFORE clicking — FB reuses
  // the compose textbox and thread container across SPA navs, so without
  // a content-diff we'd scrape the previously-loaded thread's bubbles.
  const preContainer = document.querySelector(SELECTORS.threadContainer);
  const baselineLabels = snapshotThreadLabels(preContainer);

  // Humanize gap is still respected, but the pre-click jitter is kept
  // short (50-120ms) — reading a thread isn't the high-risk surface,
  // sending is. Saves ~200ms per row-click on average.
  await ensureHumanGap();
  await sleep(randomBetween(50, 120));

  try {
    anchor.click();
    markFbAction();
  } catch (err) {
    return { ok: false, reason: err?.message || 'click_failed', thread_id };
  }

  // SPA nav usually completes within a few hundred ms. Soft-wait — we
  // don't bail on mismatch because FB occasionally keeps the old URL
  // briefly while content swaps; the content-change check is the real
  // gate.
  await waitForUrlToMatchThread(thread_id);

  // Compose pane (often already present from prior thread, returns fast).
  const composeEl = await waitForSelector(SELECTORS.replyTextbox, 3000);
  if (!composeEl) {
    return { ok: false, reason: 'compose_did_not_load', thread_id, url: location.href };
  }

  // The real gate: wait for the thread container's bubble set to swap.
  const container = document.querySelector(SELECTORS.threadContainer);
  if (!container) {
    return { ok: false, reason: 'no_thread_container', thread_id, url: location.href };
  }
  const swapped = await waitForThreadContentSwap(container, baselineLabels, 1500);
  if (!swapped && baselineLabels.size > 2) {
    console.warn('[FB Reply Maker] OPEN_THREAD: content swap not detected for', thread_id);
  }

  // Final settle for any trailing bubble inject after the swap signal.
  await sleep(80);

  // Hard verify: location.href must match the requested thread before we
  // trust the scrape. Without this check, a slow FB SPA swap means we
  // scrape the PREVIOUS thread's DOM and cache it under the requested
  // thread_id — the bug behind cross-attributed variant text.
  const urlThreadId = (() => {
    const m = location.href.match(/\/(?:marketplace|messages)\/t\/([^/?#]+)/);
    return m ? m[1] : null;
  })();
  if (urlThreadId && urlThreadId !== thread_id) {
    return {
      ok: false,
      reason: 'fb_did_not_navigate',
      thread_id,
      current_thread_id: urlThreadId,
      url: location.href
    };
  }

  const { partner: partnerName, listingTitle } = extractThreadInfo(container);
  // UI-side scan: permissive so group chats render with sender labels.
  // Auto-gen is unaffected — it reads from THREAD_UPDATE (strict path).
  const { messages } = scanThreadMessages(container, partnerName, { permissive: true });
  const tail = messages.slice(-MAX_HISTORY_MESSAGES);

  return {
    ok: true,
    thread_id,
    partnerName,
    listingTitle,
    url: location.href,
    capturedAt: Date.now(),
    messages: tail,
    contentSwapDetected: swapped || baselineLabels.size <= 2
  };
}

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

// FB renders a lot of UI chrome inside each inbox row — presence dots,
// avatar fallback initials, "Unread message:" badges, "X sent a photo"
// system lines. Strip anything that isn't actual user-authored content so
// the partner-name / snippet slots don't pick up junk.
const INBOX_ROW_NOISE = [
  /^Active( now| \d+\s?[mhd] ago)?$/i,
  /^Online$/i,
  /^Offline$/i,
  /^Unread$/i,
  /^Unread message:?$/i,
  /^Notifications?\s*muted$/i,
  /^Muted$/i,
  /^Mark as (un)?read$/i,
  /^Open (chat|conversation)$/i,
  /^Sent$/i,
  /^Delivered$/i,
  /^Seen$/i,
  /^Read\s+\d/i,
  /^Typing\.?\.?\.?$/i,
  /^Pinned$/i,
  /^Archived$/i,
  /^You$/i,
  /^You:$/i,
  // Single character (avatar initial fallback when FB has no group photo).
  /^[A-Za-z0-9]$/,
  /^\s*$/
];

function stripRowNoise(lines) {
  return lines.filter((s) => !INBOX_ROW_NOISE.some((re) => re.test(s)));
}

// A line is "snippet-like" if it begins with "Sender: ..." or matches a
// known system-event phrase. We use this to skip past it when looking for
// a real partner name in the remaining lines.
function isSnippetLine(s) {
  if (!s) return false;
  // "Name: message text" — sender-prefixed message preview
  if (/^[^:\n]{1,40}:\s+.+/.test(s)) return true;
  // "Andy sent a photo." / "Andy sent an attachment."
  if (/\bsent (a|an) (photo|attachment|video|file|gif|sticker)\b/i.test(s)) return true;
  // "Andy reacted to your message"
  if (/\breacted to\b/i.test(s)) return true;
  // "You replied to ..." / "You sent ..."
  if (/^You\s+(replied|sent|reacted|liked|loved)\b/i.test(s)) return true;
  return false;
}

// A line is a relative-time fragment ("2h", "1d", "12:34", "Jan 5"). Used
// to recognize the last-activity slot when slot ordering is off.
function isTimeLine(s) {
  if (!s) return false;
  if (/^\d{1,2}[smhdw]$/i.test(s)) return true;
  if (/^\d{1,2}:\d{2}(\s*[AP]M)?$/i.test(s)) return true;
  if (/^(Yesterday|Today)$/i.test(s)) return true;
  if (/^[A-Z][a-z]{2}\s+\d{1,2}$/i.test(s)) return true;
  return false;
}

// Pull the partner name out of an anchor's aria-label when FB provides one.
// FB uses many forms: "Open chat with John Doe", "Conversation with John
// Doe", "John Doe · Buyer", "Group chat with Airdrie Shipping". On group
// chats the aria sometimes only contains the group name verbatim — we
// accept that as a last resort.
const ARIA_NAME_PATTERNS = [
  /^(?:Open\s+chat\s+with|Conversation\s+with|Chat\s+with|Group\s+chat\s+with|Message\s+from)\s+(.+?)(?:\s*[·•,]\s*.+)?$/i,
  /^(.+?)\s*[·•]\s*(?:Buyer|Seller|Open conversation|Unread|Active)/i
];

function extractAriaName(...labels) {
  for (const raw of labels) {
    const label = (raw || '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    for (const re of ARIA_NAME_PATTERNS) {
      const m = label.match(re);
      if (m && m[1]) {
        const name = m[1].replace(/\s+/g, ' ').trim();
        if (name.length >= 2 && name.length <= 120) return name;
      }
    }
    // Bare aria-label that looks like a name (no leading verb, plausible
    // length, doesn't start with snippet-style "Sender:" prefix).
    if (
      label.length >= 2 &&
      label.length <= 120 &&
      !/^\d/.test(label) &&
      !isSnippetLine(label) &&
      !INBOX_ROW_NOISE.some((re) => re.test(label))
    ) {
      return label;
    }
  }
  return null;
}

// FB group-chat rows often have the title inside a child <span> with its
// own dir="auto" + a class — but they almost always have a [role="link"]
// or descendant that carries the title text. As a last resort, search the
// row for a child whose text looks more name-like than snippet-like.
function findNameInRowSubtree(row) {
  if (!row) return null;
  const candidates = row.querySelectorAll('span[dir="auto"], h2, h3, h4');
  for (const el of candidates) {
    const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    if (txt.length < 2 || txt.length > 120) continue;
    if (isSnippetLine(txt)) continue;
    if (isTimeLine(txt)) continue;
    if (INBOX_ROW_NOISE.some((re) => re.test(txt))) continue;
    return txt;
  }
  return null;
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

    const allLines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    const lines = stripRowNoise(allLines);

    const anchorAria = a.getAttribute('aria-label') || '';
    const rowAria = row?.getAttribute?.('aria-label') || '';
    const ariaName = extractAriaName(anchorAria, rowAria);
    // "Unread" can appear in the row's accessible chrome as well as inside
    // the visible innerText; check both.
    const unread =
      /\bunread\b/i.test(anchorAria + ' ' + rowAria) ||
      allLines.some((s) => /^Unread( message:?)?$/i.test(s));

    // Partner name: try aria-label first (most reliable), then a DOM
    // subtree probe for spans/headings that look name-like, then the first
    // post-noise line that isn't a snippet/time.
    let partnerName = ariaName || findNameInRowSubtree(row);
    if (!partnerName) {
      for (const candidate of lines) {
        if (!isSnippetLine(candidate) && !isTimeLine(candidate) && candidate.length >= 2) {
          partnerName = candidate;
          break;
        }
      }
    }
    if (!partnerName) partnerName = lines[0] || null;

    // Build snippet + time slots from whatever lines remain after the
    // name. The slot indices the previous version used (lines[1]/[2]/[3])
    // assumed strict ordering — they break when FB shuffles. Instead we
    // scan lines in order, picking the first snippet-like and time-like
    // matches.
    let listingTitle = null;
    let snippet = null;
    let lastActivity = null;
    const remaining = lines.filter((s) => s !== partnerName);
    for (const ln of remaining) {
      if (!snippet && isSnippetLine(ln)) {
        snippet = ln;
        continue;
      }
      if (!lastActivity && isTimeLine(ln)) {
        lastActivity = ln;
        continue;
      }
      if (classified.source === 'marketplace' && !listingTitle && !isSnippetLine(ln) && !isTimeLine(ln)) {
        listingTitle = ln;
        continue;
      }
      if (!snippet) snippet = ln;
    }

    seen.set(key, {
      thread_id: classified.thread_id,
      source: classified.source,
      partner_name: partnerName,
      listing_title: listingTitle,
      snippet,
      last_activity_relative: lastActivity,
      unread,
      raw_text: raw,
      aria_label: anchorAria || rowAria || null,
      href
    });
  }

  return [...seen.values()];
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'INSERT_REPLY') {
    const text = msg.text || '';
    const opts = {
      auto_send: !!msg.auto_send,
      thread_id: typeof msg.thread_id === 'string' ? msg.thread_id : null,
      skip_humanized: !!msg.skip_humanized,
      bypass_guards: !!msg.bypass_guards
    };
    const imageUrls = Array.isArray(msg.images) ? msg.images.filter(Boolean) : [];
    console.log('[FB Reply Maker] INSERT_REPLY received', {
      preview: text.slice(0, 40), auto_send: opts.auto_send, thread_id: opts.thread_id,
      image_count: imageUrls.length
    });
    swlog('INSERT_REPLY received in CS images=' + imageUrls.length + ' preview="' + text.slice(0, 40) + '"');
    (async () => {
      const result = await tryInsertReply(text, opts);
      swlog('tryInsertReply returned ok=' + !!result.ok + ' sent=' + !!result.sent + ' reason=' + (result.reason || 'none'));
      if (result.ok) {
        console.log('[FB Reply Maker] insert succeeded:', result.method, 'sent:', !!result.sent);
        if (!result.sent) fireActivationBurst();
        // If images requested, paste them onto the chat input AFTER text
        // succeeded. Pasted via a synthetic paste event with a DataTransfer
        // containing image File objects — FB Messenger handles this the
        // same way it handles a real Ctrl+V on a clipboard image.
        if (imageUrls.length > 0 && !result.sent) {
          try {
            swlog('starting image chain count=' + imageUrls.length);
            // Brief delay so the text insertion lands first — pasting an
            // image into a box that's still committing text occasionally
            // drops the paste on FB's React composer.
            await sleep(150);
            const attachResults = await attachImagesViaClipboardChain(imageUrls);
            swlog('chain finished results=' + JSON.stringify(attachResults));
            const pastedCount = attachResults.filter((r) => r && r.pasted).length;
            result.imagesAttached = pastedCount;
            result.imageAttachResults = attachResults;
            console.log('[FB Reply Maker] images attached via clipboard chain:', {
              total: imageUrls.length, pasted: pastedCount, details: attachResults
            });
          } catch (err) {
            console.warn('[FB Reply Maker] image attach chain failed:', err?.message || err);
            swlog('CHAIN THREW err=' + (err?.message || String(err)));
            result.imageErrors = [err?.message || String(err)];
          }
        }
      } else {
        // Stringify the result so we can actually read it in the Errors
        // panel / chrome://extensions error page (which collapses
        // objects to "[object Object]" otherwise).
        let resultStr;
        try { resultStr = JSON.stringify(result); }
        catch { resultStr = String(result); }
        console.warn('[FB Reply Maker] INSERT_REPLY failed — reason:', resultStr);
      }
      sendResponse(result);
    })();
    return true;
  }
  // Single-image attach driven by the side panel's 📋 button. Runs
  // entirely in the content script (FB tab) so the clipboard write
  // doesn't need the side panel to be focused. Used for manual
  // re-copies after the auto-chain has finished.
  if (msg?.type === 'ATTACH_SINGLE_IMAGE' && typeof msg.url === 'string') {
    (async () => {
      try {
        const r = await copyAndPasteOneImage(msg.url);
        sendResponse(r);
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || String(err) });
      }
    })();
    return true;
  }

  // Side panel writes an image to the system clipboard, then asks us
  // to put the FB chat composer in focus so the rep can Ctrl+V. As a
  // best-effort bonus, we also try document.execCommand('paste') — if
  // FB+Chrome accept it, the image attaches with zero key presses.
  // execCommand is deprecated and frequently blocked, but tooling-style
  // extensions can sometimes hit it; failure here is fine because the
  // box is already focused for a manual paste.
  if (msg?.type === 'FOCUS_REPLY_BOX') {
    (async () => {
      const box = document.querySelector(SELECTORS.replyTextbox);
      if (!box) {
        sendResponse({ ok: false, reason: 'no_textbox' });
        return;
      }
      // Synthetic mouse activation — same pattern bulkInsertReply uses
      // to wake FB's React state into "focused".
      try {
        const rect = box.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        for (const type of ['mousedown', 'mouseup', 'click']) {
          box.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window,
            clientX: x, clientY: y, button: 0
          }));
        }
        box.focus();
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(box);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch {}
      // Best-effort paste attempt. May silently fail; the focus above
      // is the real guarantee.
      let pasteAttempted = false;
      let pasteAccepted = false;
      let pasteErr = null;
      try {
        pasteAttempted = true;
        pasteAccepted = document.execCommand('paste');
      } catch (err) {
        pasteErr = err?.message || String(err);
      }
      sendResponse({
        ok: true,
        focused: document.activeElement === box,
        paste_attempted: pasteAttempted,
        paste_accepted: pasteAccepted,
        paste_err: pasteErr
      });
    })();
    return true;
  }

  if (msg?.type === 'RESCAN') {
    lastPayloadHash = '';
    broadcast(true);
    sendResponse({ ok: true });
    return;
  }
  // Phase F.1.5 step 4 — drive the FB tab to a specific thread (silent
  // click on the inbox row anchor), wait for the compose pane to render,
  // then scrape last 20 messages. Lets the user click a row in the
  // extension without their browser view leaving the extension tab.
  if (msg?.type === 'OPEN_THREAD' && typeof msg.thread_id === 'string') {
    (async () => {
      try {
        const res = await openThreadByRowClick({
          thread_id: msg.thread_id,
          source: msg.source
        });
        sendResponse(res);
      } catch (err) {
        console.warn('[FB Reply Maker] OPEN_THREAD threw:', err?.message);
        sendResponse({ ok: false, reason: err?.message || 'open_failed' });
      }
    })();
    return true;
  }

  // Phase F.1.5 step 3 — programmatic scroll of the FB inbox list container
  // to trigger virtualized loading of older threads. Read-side; caller is
  // expected to re-issue GET_INBOX_LIST after this returns to pick up the
  // newly rendered rows.
  if (msg?.type === 'SCROLL_INBOX_DOWN') {
    (async () => {
      try {
        const res = await scrollInboxDown();
        sendResponse(res);
      } catch (err) {
        console.warn('[FB Reply Maker] SCROLL_INBOX_DOWN threw:', err?.message);
        sendResponse({ ok: false, reason: err?.message || 'scroll_failed' });
      }
    })();
    return true;
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

  // Full-history RPC. Returns the
  // most recent MAX_HISTORY_MESSAGES with sender + text, plus thread metadata.
  if (msg?.type === 'GET_THREAD_HISTORY') {
    try {
      const container = document.querySelector(SELECTORS.threadContainer);
      if (!container || !isConversationPage()) {
        sendResponse({ ok: false, reason: 'no_thread' });
        return;
      }
      const { partner: partnerName, listingTitle } = extractThreadInfo(container);
      // UI-side scan: permissive so group chats render with sender labels.
      const { messages } = scanThreadMessages(container, partnerName, { permissive: true });
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

})(); // end idempotency-guarded IIFE
