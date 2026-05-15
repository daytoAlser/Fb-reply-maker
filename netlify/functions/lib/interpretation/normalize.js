// Phase E.6 — pure-transformation normalization of customer messages.
// No LLM call, no IO. Output feeds interpret.js and the prompt builder.

import {
  BOLT_PATTERN_ALIASES,
  AMBIGUOUS_BOLT_COUNT_PHRASES,
  TIRE_PREFIX_TYPES,
  ERA_CUTOFFS,
  SUBTYPE_PHRASES,
  TIRE_PARTITION_PHRASES,
  REASK_PHRASES,
  FRAME_PATTERNS
} from './data.js';

// ── Bolt pattern ────────────────────────────────────────────────────
//
// Customers write bolt patterns dozens of ways. We tokenize by stripping
// separators ("-" or whitespace → "x"), then lookup canonical against
// the alias table. If we see "N bolt" / "N lug" without a measurement,
// that's ambiguous.
const BOLT_DIGIT_RE = /\b([4-8])\s*[x\-]\s*([\d.]+)\b/gi;

function findRawBoltPattern(text) {
  // Reset regex state
  BOLT_DIGIT_RE.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = BOLT_DIGIT_RE.exec(text)) !== null) {
    matches.push({ raw: m[0], normalized: `${m[1]}x${m[2]}`.toLowerCase() });
  }
  return matches;
}

export function detectBoltPattern(text) {
  if (typeof text !== 'string' || !text) return null;
  const raws = findRawBoltPattern(text);
  for (const r of raws) {
    const hit = BOLT_PATTERN_ALIASES.find((a) => a.match === r.normalized);
    if (hit) {
      return {
        raw: r.raw,
        canonical: hit.canonical,
        confidence: hit.confidence,
        ambiguous: false
      };
    }
  }
  // Fallback: bare-count mention with no measurement → ambiguous.
  for (const re of AMBIGUOUS_BOLT_COUNT_PHRASES) {
    const m = text.match(re);
    if (m) {
      return {
        raw: m[0],
        canonical: null,
        confidence: 0,
        ambiguous: true,
        count: parseInt(m[1], 10)
      };
    }
  }
  return null;
}

// ── Tire spec ───────────────────────────────────────────────────────
//
// Formats: optional prefix (ST|LT|P) + width/aspectRdiam.
// Output classifies the type; mismatch detection requires a vehicle
// hint from elsewhere (handled in interpret.js).
// Width/aspect separator is "/" OR whitespace; the R between aspect and
// diameter is optional. Customers write tire sizes many ways:
// "225/55R19", "225 55 r19", "225 55r19", "225/55/19". Accept them all so
// we don't re-ask for size we already have.
const TIRE_RE = /\b(ST|LT|P)?(\d{3})\s*[\/\s]\s*(\d{2})\s*[\/RrZz]?\s*(\d{2})\b/i;

export function detectTireSpec(text) {
  if (typeof text !== 'string' || !text) return null;
  const m = text.match(TIRE_RE);
  if (!m) return null;
  const prefix = (m[1] || '').toUpperCase();
  const type = TIRE_PREFIX_TYPES[prefix] || 'passenger';
  return {
    raw: m[0],
    prefix: prefix || null,
    width: parseInt(m[2], 10),
    aspect: parseInt(m[3], 10),
    diameter: parseInt(m[4], 10),
    type
  };
}

// ── Vehicle year + era ──────────────────────────────────────────────
//
// Looks for a 4-digit year in 1900-2099 range. Picks the FIRST one
// (customers usually lead with the year). Classifies into era.
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;

export function detectVehicleEra(text) {
  if (typeof text !== 'string' || !text) return null;
  const m = text.match(YEAR_RE);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  let era = 'modern';
  for (const cutoff of ERA_CUTOFFS) {
    if (year < cutoff.until) {
      era = cutoff.era;
      break;
    }
  }
  return { year, era };
}

// ── Vehicle subtype (multi-tag) ─────────────────────────────────────
//
// Walks SUBTYPE_PHRASES, collects unique tags. Order in the input array
// matters because longer phrases come first (so "old body ram" matches
// classic_truck before any substring grabs "ram").
export function detectVehicleSubtype(text) {
  if (typeof text !== 'string' || !text) return [];
  const tags = new Set();
  for (const { phrase, tag } of SUBTYPE_PHRASES) {
    if (phrase.test(text)) tags.add(tag);
  }
  return [...tags];
}

// ── Tire partition ──────────────────────────────────────────────────
//
// Returns the FIRST matching tag (priority by order in TIRE_PARTITION_
// PHRASES). Most customers don't say more than one; if they do, the
// stronger signal wins (year_round comes after summer/winter_only by
// design so a hybrid like "I'd consider all-season but mostly summer
// only" resolves to summer_only).
export function detectTirePartition(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const { phrase, tag } of TIRE_PARTITION_PHRASES) {
    if (phrase.test(text)) return tag;
  }
  return null;
}

// ── Re-ask detection ────────────────────────────────────────────────
//
// Compare current customer message against last 5 customer messages.
// Triggers:
//   - High lexical similarity (>= 0.7) with a previous customer message
//   - "still" / "any update" / "any luck" / "did you get a chance" phrases
//   - "sorry to bug" phrases (medium)
//
// Confidence scales from base phrase signal × similarity boost.

function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// Jaccard similarity over token sets — cheap, good enough for short
// FB-marketplace-length messages.
function lexicalSimilarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  const union = ta.size + tb.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

// Summarize a question for the prompt: short, end-trimmed.
function summarizeQuestion(text) {
  if (!text) return '';
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? oneLine.slice(0, 77) + '…' : oneLine;
}

export function detectReAsk(currentMessage, history) {
  if (typeof currentMessage !== 'string' || !currentMessage.trim()) {
    return { detected: false };
  }
  const hist = Array.isArray(history) ? history : [];
  // History entries shape: { sender: 'me' | 'them', text }
  const customerPriors = hist.filter((m) => m && m.sender === 'them' && typeof m.text === 'string');
  // Skip the very last entry if it IS the current message (avoid self-match).
  const priors = (() => {
    if (customerPriors.length === 0) return [];
    const tail = customerPriors[customerPriors.length - 1];
    if (tail && tail.text === currentMessage) return customerPriors.slice(0, -1);
    return customerPriors;
  })().slice(-5);

  const hasHigh = REASK_PHRASES.high.some((re) => re.test(currentMessage));
  const hasMed  = REASK_PHRASES.medium.some((re) => re.test(currentMessage));

  let bestIdx = -1;
  let bestSim = 0;
  for (let i = 0; i < priors.length; i++) {
    const sim = lexicalSimilarity(currentMessage, priors[i].text);
    if (sim > bestSim) { bestSim = sim; bestIdx = i; }
  }

  // High-similarity match → definite re-ask, confidence scales with sim.
  if (bestSim >= 0.7 && bestIdx >= 0) {
    return {
      detected: true,
      original_message_index: bestIdx,
      original_question_summary: summarizeQuestion(priors[bestIdx].text),
      confidence: Math.min(0.95, 0.6 + bestSim * 0.4)
    };
  }
  // High phrase signal + a prior customer question that mentions "?" and
  // wasn't followed by a confident answer = likely re-ask.
  if (hasHigh && priors.length > 0) {
    // Find the most recent prior customer message containing a question mark.
    let priorIdx = -1;
    for (let i = priors.length - 1; i >= 0; i--) {
      if (/\?/.test(priors[i].text)) { priorIdx = i; break; }
    }
    if (priorIdx >= 0) {
      return {
        detected: true,
        original_message_index: priorIdx,
        original_question_summary: summarizeQuestion(priors[priorIdx].text),
        confidence: 0.85
      };
    }
    // Phrase signal alone, no clear prior — soft re-ask.
    return {
      detected: true,
      original_message_index: null,
      original_question_summary: null,
      confidence: 0.7
    };
  }
  if (hasMed) {
    return {
      detected: true,
      original_message_index: bestIdx >= 0 ? bestIdx : null,
      original_question_summary: bestIdx >= 0 ? summarizeQuestion(priors[bestIdx].text) : null,
      confidence: 0.6
    };
  }
  return { detected: false };
}

// ── Frame mismatch ──────────────────────────────────────────────────
//
// If Dayton's most recent message asked a question and the customer's
// reply answers a different question, flag it and propose a bridge.
//
// History shape (same as elsewhere): array of { sender, text } in
// chronological order. We look at the LAST 'me' message preceding the
// current customer message.

function findLastRepMessage(history) {
  if (!Array.isArray(history)) return null;
  // Walk from the end. Skip any trailing 'them' messages (the current
  // customer message and prior consecutive customer messages).
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i].sender === 'me' && typeof history[i].text === 'string') {
      return history[i].text;
    }
  }
  return null;
}

export function detectFrameMismatch(currentMessage, history) {
  if (typeof currentMessage !== 'string' || !currentMessage.trim()) {
    return { detected: false };
  }
  const lastRep = findLastRepMessage(history);
  if (!lastRep) return { detected: false };

  for (const frame of FRAME_PATTERNS) {
    const askedHit = frame.daytonAsked.some((re) => re.test(lastRep));
    if (!askedHit) continue;
    for (const wrong of frame.customerWrongShapes) {
      const m = currentMessage.match(wrong.pattern);
      if (m) {
        const bridge = wrong.bridge.replace('{match}', m[1] || m[0]);
        return {
          detected: true,
          asked_about: frame.intent,
          customer_answered_with: wrong.shape,
          proposed_bridge: bridge,
          confidence: 0.9
        };
      }
    }
    // Dayton asked the question; customer didn't match any "wrong" shape
    // — they may be in-frame, no mismatch detected.
    return { detected: false, asked_about: frame.intent };
  }
  return { detected: false };
}

// ── Top-level normalize() ───────────────────────────────────────────
//
// Single entry point used by generate-reply.js. Returns the
// interpretation object's normalize section (interpret.js layers
// additional rule outputs on top).
export function normalize({ message, history }) {
  const text = typeof message === 'string' ? message : '';
  return {
    bolt_pattern: detectBoltPattern(text),
    tire_spec: detectTireSpec(text),
    vehicle_era: detectVehicleEra(text),
    vehicle_subtype: detectVehicleSubtype(text),
    tire_partition: detectTirePartition(text),
    re_ask: detectReAsk(text, history),
    frame_mismatch: detectFrameMismatch(text, history)
  };
}
