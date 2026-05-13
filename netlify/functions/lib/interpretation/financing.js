// Phase E.7 — financing-mode detection.
//
// Per-turn (not persistent). Trigger is permissive: false positives are
// low-cost (the FAQ block just adds context the LLM ignores); false
// negatives are high-cost (AI extemporizes wrong financing info).
//
// Sub-mode priority (most specific → most general):
//   calculation > documents > early_payout > approval > terms > inquiry
//
// Two orthogonal flags also surfaced:
//   asks_specific_rate     — customer asked "what's the interest rate"
//   asks_approval_promise  — customer asked "will I get approved"
// These trigger dedicated voice strings (rate_punt / approval_punt) on
// top of whichever sub-mode classified.

// ── Top-level trigger ──────────────────────────────────────────────
//
// Any of these phrases in the current message turns financing mode on.
// Per spec, trigger is permissive — false positives are low-cost (the
// FAQ block adds context the LLM ignores when irrelevant); false
// negatives are high-cost (AI extemporizes wrong financing info).
const FINANCING_TRIGGER_PATTERNS = [
  /\bfinanc(?:e|ing|ed)\b/i,
  /\bmonthly\b/i,
  /\bbi[\s-]?weekly\b/i,
  /\b(?:payment\s*plan|pay\s+in\s+payments|spread\s+(?:out\s+)?(?:the\s+)?payments)\b/i,
  /\bcredit\s+check\b/i,
  /\bsoft\s+(?:pull|credit)\b/i,
  /\b(?:deposit|down\s+payment|money\s+down)\b/i,
  /\b(?:interest\s+rate|interest|apr)\b/i,
  /\bloan(?:\s+term)?\b/i,
  /\b(?:approved|pre-?approved|approval)\b/i,
  /\bpay\s+(?:it\s+)?off\b/i,
  /\bearly\s+(?:pay(?:ment|out|off))\b/i,
  /\bprepayment\b/i,
  /\bpenalty\b/i,
  /\bvoid\s+(?:cheque|check)\b/i,
  /\bhow\s+much\s+per\s+month\b/i,
  /\bwhat\s+(?:do\s+you\s+need|documents|paperwork)\b/i,
  // Missed-payment family — clear financing topic; punts to phone via
  // outside-FAQ rule but must trigger to suppress LLM extemporization.
  /\b(?:miss(?:ed|ing)?|skipping)\s+a?\s*payment\b/i,
  // Pure-math attempts ("$160 x 36 = $5779"). Strongly correlates with
  // loan-total estimation. Worst case false-positive on product-price
  // math; prompt routes the LLM to acknowledge + redirect either way.
  /\$\s?\d+(?:\.\d+)?\s*(?:x|\*|times|×)\s*\d+/i,
  /\d+(?:\.\d+)?\s*(?:x|\*|times|×)\s*\d+\s*=\s*\$?\s?\d+/i
];

// ── Sub-mode patterns (priority order) ─────────────────────────────

// "$160 x 36" / "160 * 36 = 5779" / "so 160 x 36" / "that's $5779 total"
const CALCULATION_PATTERNS = [
  /\$\s?\d+(?:\.\d+)?\s*(?:x|\*|times|×)\s*\d+/i,
  /\d+(?:\.\d+)?\s*(?:x|\*|times|×)\s*\d+\s*=\s*\$?\s?\d+/i,
  /\bso\s+(?:that'?s\s+)?\$?\d+\s*(?:x|\*|times|×)\s*\d+\b/i,
  /\bthat'?s\s+\$?\d{2,5}\s+(?:total|all\s+in|in\s+total)\b/i,
  /\btotal\s+(?:of|would\s+be|comes?\s+(?:to|out\s+to))\s+\$?\d{2,5}\b/i
];

const DOCUMENTS_PATTERNS = [
  /\bwhat\s+(?:do\s+you\s+need|documents?|paperwork)\b/i,
  /\bwhat\s+(?:do\s+)?(?:i|we)\s+need\s+to\s+(?:bring|send|provide|give\s+you)\b/i,
  /\bvoid\s+(?:cheque|check)\b/i,
  /\bdirect\s+deposit\b/i,
  /\bwhat\s+(?:do\s+)?(?:i|we)\s+gotta\s+(?:bring|send|give)\b/i
];

const EARLY_PAYOUT_PATTERNS = [
  /\bpay\s+(?:it\s+)?off\s+(?:early|in\s+\d+|in\s+a\s+(?:few|couple))\b/i,
  /\bearly\s+(?:pay(?:ment|out|off))\b/i,
  /\bprepayment\b/i,
  /\bpenalty\b/i,
  /\bwhat\s+(?:happens\s+)?if\s+(?:i|we)\s+pay\s+(?:it\s+)?off\b/i,
  /\bcan\s+(?:i|we)\s+pay\s+(?:it\s+)?off\b/i
];

const APPROVAL_PATTERNS = [
  /\b(?:approved|approval|pre-?approved)\b/i,
  /\bcredit\s+check\b/i,
  /\bsoft\s+(?:pull|credit)\b/i,
  /\bwill\s+(?:i|we)\s+(?:get\s+)?approve/i,
  /\bany\s+chance\s+of\s+approval\b/i,
  /\b(?:bad|poor|no)\s+credit\b/i
];

const TERMS_PATTERNS = [
  /\bmonthly(?:\s+payment)?\b/i,
  /\bbi[\s-]?weekly\b/i,
  /\binterest(?:\s+rate)?\b/i,
  /\bapr\b/i,
  /\bloan\s+term\b/i,
  /\bhow\s+long\b/i,
  /\bhow\s+much\s+per\s+month\b/i,
  /\bwhat\s+would\s+(?:the|my)\s+monthly\b/i
];

const INQUIRY_PATTERNS = [
  /\bdo\s+you\s+(?:guys\s+)?(?:do\s+|offer\s+)?financ(?:e|ing)\b/i,
  /\bis\s+financing\s+available\b/i,
  /\bcan\s+(?:i|we)\s+(?:do|get)\s+payments\b/i,
  /\bpayment\s+plan\b/i,
  /\bspread\s+(?:out\s+)?(?:the\s+)?payments\b/i
];

// ── Orthogonal flags ───────────────────────────────────────────────

const ASKS_SPECIFIC_RATE_PATTERNS = [
  /\bwhat'?s?\s+(?:the\s+)?(?:interest\s+)?rate\b/i,
  /\bwhat'?s?\s+(?:the\s+)?apr\b/i,
  /\bhow\s+much\s+(?:is\s+)?(?:the\s+)?interest\b/i,
  /\b(?:rate|apr)\s+on\s+(?:the\s+)?loan\b/i
];

const ASKS_APPROVAL_PROMISE_PATTERNS = [
  /\bwill\s+(?:i|we)\s+(?:get\s+)?approve/i,
  /\b(?:am|are)\s+(?:i|we)\s+(?:gonna|going\s+to)\s+(?:get\s+)?approve/i,
  /\bdo\s+(?:you|i)\s+think\s+(?:i'?ll|i\s+will)\s+(?:get\s+)?approve/i,
  /\bany\s+chance\s+(?:i|we)\s+(?:get\s+)?approve/i,
  /\bwhat\s+are\s+my\s+chances\b/i
];

// ── Helpers ────────────────────────────────────────────────────────

function classifySubMode(message) {
  if (CALCULATION_PATTERNS.some((re) => re.test(message))) return 'calculation';
  if (DOCUMENTS_PATTERNS.some((re) => re.test(message)))   return 'documents';
  if (EARLY_PAYOUT_PATTERNS.some((re) => re.test(message))) return 'early_payout';
  if (APPROVAL_PATTERNS.some((re) => re.test(message)))    return 'approval';
  if (TERMS_PATTERNS.some((re) => re.test(message)))       return 'terms';
  if (INQUIRY_PATTERNS.some((re) => re.test(message)))     return 'inquiry';
  return null;
}

function summarizeQuestion(message) {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? oneLine.slice(0, 117) + '…' : oneLine;
}

// ── Top-level detection ────────────────────────────────────────────

export function detectFinancingMode(message) {
  if (typeof message !== 'string' || !message.trim()) {
    return { triggered: false };
  }
  const triggered = FINANCING_TRIGGER_PATTERNS.some((re) => re.test(message));
  if (!triggered) return { triggered: false };

  let subMode = classifySubMode(message);
  // If the general trigger fired but no specific sub-mode matched
  // (e.g. "interested in financing options"), default to inquiry.
  if (!subMode) subMode = 'inquiry';

  return {
    triggered: true,
    sub_mode: subMode,
    asks_specific_rate: ASKS_SPECIFIC_RATE_PATTERNS.some((re) => re.test(message)),
    asks_approval_promise: ASKS_APPROVAL_PROMISE_PATTERNS.some((re) => re.test(message)),
    customer_question_summary: summarizeQuestion(message)
  };
}
