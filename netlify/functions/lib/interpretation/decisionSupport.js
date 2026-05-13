// Phase E.3 — Decision Support Mode detection.
//
// Per-turn (not persistent lead state): when the current customer
// message is asking for advisor-style help and at least 2 product
// options have been presented earlier in the thread, flip the prompt
// into advisor-voice for this turn.
//
// Pure detection — no LLM call, no IO. Output feeds the prompt builder.

// ── Trigger phrases by sub-mode ────────────────────────────────────
//
// Order matters: compare wins over tradeoff wins over review when
// multiple sub-modes match (most specific behavior pattern first).

const COMPARE_PATTERNS = [
  /\btorn between\b/i,
  /\bbetween (the )?\w+(?: \w+){0,3} (and|vs\.?) (the )?\w+/i,
  /\bwhich (one )?is better\b/i,
  /\bwhich (would|do) you (pick|choose|go with|prefer)\b/i,
  /\bwhich (is|do you (like|prefer)) (your )?(favou?rite|best)\b/i,
  /\bwhich do you like best\b/i,
  /\bwhat would you (recommend|go with|do|pick|choose)\b/i,
  /\bwhat do you (actually )?recommend\b/i,
  /\bhonestly,? which\b/i
];

const TRADEOFF_PATTERNS = [
  /\bis (it|the \w+) worth (the )?extra\b/i,
  /\bis (the )?\w+(?: \w+){0,3} worth (it )?over (the )?\w+/i,
  /\bworth the (extra|upgrade|jump|step up)\b/i,
  /\bwould you spend (the )?extra (on|for)\b/i,
  /\bwhat'?s the difference between\b/i,
  /\b(difference|gap) between (the )?\w+(?: \w+){0,3} and (the )?\w+/i
];

const REVIEW_PATTERNS = [
  // "are these any good", "are these iLinks any good", "are the iLinks any good".
  // Allow 0-3 words between the demonstrative and "any good" so a product
  // name can sit in the middle.
  /\bare\s+(?:these|those|they|the)?\s*(?:\w+\s+){0,3}any\s+good\b/i,
  /\bwhat reviews?\b/i,
  /\bany reviews?\b/i,
  /\bhave (?:people|customers|buyers|guys) (?:liked|been happy with|had problems with)\b/i,
  /\bhave you sold (?:a lot|many) of\b/i,
  /\bwould you trust\b/i,
  /\bare\s+(?:they|these|those|the\s+\w+|\w+)\s+(?:decent|alright|ok|good|reliable|trustworthy)\b/i
];

// ── Subject-product extraction ─────────────────────────────────────
//
// Pull plausible product/brand names out of the customer message so the
// prompt can reference them by name. Heuristic only — we don't have a
// brand KB. Captures TitleCase words and known-suffix patterns commonly
// used in tire/wheel naming (e.g. "Suretrac", "iLink", "Kanati").
//
// Returns up to 2 names — that's all the compare/tradeoff structures
// need to anchor the lean + tradeoff sentences.

// Brand names sometimes start lowercase (iLink, eTrac) so we accept any
// alpha first char. Length floor of 3 keeps us off stop-words.
const PRODUCT_TOKEN = '[A-Za-z][\\w-]{2,}(?:\\s+[A-Z][\\w-]+)?';
const PRODUCT_NAME_PATTERNS = [
  // "torn between the X and the Y" / "between X and Y"
  new RegExp(`\\bbetween (?:the )?(${PRODUCT_TOKEN})\\s+(?:and|vs\\.?)\\s+(?:the )?(${PRODUCT_TOKEN})`),
  // "is the X worth it over the Y" / "is the X worth the extra over the Y"
  new RegExp(`\\bis (?:the )?(${PRODUCT_TOKEN})\\s+worth\\s+(?:\\S+\\s+){0,3}over (?:the )?(${PRODUCT_TOKEN})`, 'i'),
  // "X vs Y" / "X or Y"
  new RegExp(`\\b(${PRODUCT_TOKEN})\\s+(?:vs\\.?|or)\\s+(${PRODUCT_TOKEN})\\b`)
];

// Single-product references for review/tradeoff mode.
const SINGLE_PRODUCT_PATTERNS = [
  new RegExp(`\\bare (?:these|those|the) (${PRODUCT_TOKEN})s? any good\\b`),
  new RegExp(`\\bare (?:the )?(${PRODUCT_TOKEN})s? (?:decent|alright|ok|good|reliable|trustworthy)\\b`, 'i'),
  new RegExp(`\\bworth (?:the )?(?:extra|upgrade|jump|step up)\\s+(?:on|for|to)\\s+(?:the )?(${PRODUCT_TOKEN})`, 'i'),
  new RegExp(`\\bhave you sold (?:a lot|many) of (?:these|those|the )?(${PRODUCT_TOKEN})`, 'i')
];

function extractSubjectProducts(message, mode) {
  const out = [];
  if (mode === 'compare' || mode === 'tradeoff') {
    for (const re of PRODUCT_NAME_PATTERNS) {
      const m = message.match(re);
      if (m && m[1] && m[2]) {
        out.push(m[1].trim(), m[2].trim());
        break;
      }
    }
  }
  if (mode === 'review' || (out.length === 0 && mode === 'tradeoff')) {
    for (const re of SINGLE_PRODUCT_PATTERNS) {
      const m = message.match(re);
      if (m && m[1]) {
        out.push(m[1].trim());
        break;
      }
    }
  }
  // Dedupe while preserving order.
  const seen = new Set();
  return out.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Options-presented gate ─────────────────────────────────────────
//
// Spec: "only fires when at least 2 product options have been presented
// to the customer earlier in the thread". Heuristic: count $-prices
// across rep-sent messages in conversation_history. A single rep message
// can present multiple options ("the value at $800, premium at $1100"),
// so we count price OCCURRENCES, not messages.
//
// History entry shape: { sender: 'me' | 'them', text: string }.

const PRICE_RE = /\$\s?\d{2,5}(?:\.\d{2})?/g;

export function countPresentedOptions(history) {
  if (!Array.isArray(history)) return 0;
  let count = 0;
  for (const entry of history) {
    if (!entry || entry.sender !== 'me' || typeof entry.text !== 'string') continue;
    const matches = entry.text.match(PRICE_RE);
    if (matches) count += matches.length;
  }
  return count;
}

// ── Top-level detection ────────────────────────────────────────────
//
// Returns:
//   { triggered: false, gate_reason: 'no_advisor_language' | 'no_options_presented' }
// or
//   { triggered: true, mode, subject_products, options_presented_count }
//
// `normalized` is the E.6 normalize() output (used for downstream
// advisor-lean hints; we don't gate on it here).

const MIN_OPTIONS_GATE = 2;

function classifySubMode(message) {
  if (COMPARE_PATTERNS.some((re) => re.test(message))) return 'compare';
  if (TRADEOFF_PATTERNS.some((re) => re.test(message))) return 'tradeoff';
  if (REVIEW_PATTERNS.some((re) => re.test(message))) return 'review';
  return null;
}

export function detectDecisionSupport({ message, history, normalized } = {}) {
  if (typeof message !== 'string' || !message.trim()) {
    return { triggered: false, gate_reason: 'no_message' };
  }
  const mode = classifySubMode(message);
  if (!mode) {
    return { triggered: false, gate_reason: 'no_advisor_language' };
  }
  const optionsCount = countPresentedOptions(history);
  if (optionsCount < MIN_OPTIONS_GATE) {
    return {
      triggered: false,
      gate_reason: 'no_options_presented',
      options_presented_count: optionsCount,
      mode_would_have_been: mode
    };
  }
  return {
    triggered: true,
    mode,
    subject_products: extractSubjectProducts(message, mode),
    options_presented_count: optionsCount,
    // Echo a coarse lean hint from E.6 vehicle_subtype so the prompt
    // builder can include it without re-reading normalized.
    lean_hint: deriveLeanHint(normalized)
  };
}

function deriveLeanHint(normalized) {
  const subtypes = Array.isArray(normalized?.vehicle_subtype) ? normalized.vehicle_subtype : [];
  if (subtypes.includes('beater')) return 'value';
  if (subtypes.includes('family_daily')) return 'value';
  if (subtypes.includes('enthusiast')) return 'premium';
  return null;
}
