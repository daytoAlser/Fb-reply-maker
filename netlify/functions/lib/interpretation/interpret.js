// Phase E.6 — rule-based enrichment on top of normalize() output.
// No LLM call. Reads from the normalized object + thread context to
// surface higher-level rules (AWD safety, wheel-size tradeoff, Ram
// body classification).

import {
  AWD_VEHICLE_HINTS,
  RAM_GENERATIONS,
  WHEEL_SIZE_TRADEOFF_INCHES
} from './data.js';

// ── AWD partial replacement detection ───────────────────────────────
//
// Triggered when:
//   - There's any AWD hint in the customer message OR captured vehicle
//   - The customer is asking about 2 tires (not 4) — common pattern:
//     "need 2 tires for...", "replacing the rears", "front tires are bad"
//
// We don't try to be clever about which axle; the prompt rule asks
// Dayton to check tread depth on the "other set" regardless.
const TWO_TIRE_ASK_PATTERNS = [
  /\b(just|only)\s+(?:need|want|getting|grabbing|replacing)\s+2\s+tires?\b/i,
  /\bneed\s+2\s+tires?\b/i,
  /\breplacing\s+(?:the\s+)?(?:front|rear|2)\s+tires?\b/i,
  /\b(front|rear)\s+tires?\s+(?:are|need)\b/i,
  /\b2\s+new\s+tires?\b/i,
  /\b(?:a\s+)?pair\s+of\s+tires?\b/i
];

export function detectAwdPartialReplacement({ message, capturedVehicle }) {
  if (typeof message !== 'string' || !message) {
    return { detected: false };
  }
  const haystack = (message + ' ' + (capturedVehicle || '')).toLowerCase();
  const awdHit = AWD_VEHICLE_HINTS.some((re) => re.test(haystack));
  if (!awdHit) return { detected: false };
  const twoTireHit = TWO_TIRE_ASK_PATTERNS.some((re) => re.test(message));
  if (!twoTireHit) return { detected: false };
  return {
    detected: true,
    action: 'ask_tread_depth_check'
  };
}

// ── Wheel-size availability tradeoff ────────────────────────────────
//
// Extracts inch size from common phrases and flags 24+ as soft-tradeoff.
// Does NOT discourage the customer; just primes Dayton to acknowledge.
const WHEEL_SIZE_PATTERNS = [
  /\b(2[2-9]|3[0-6])\s*(?:inch|"|in)\s*(?:wheels?|rims?)?\b/i,
  /\bon\s+(2[2-9]|3[0-6])s\b/i,
  /\b(2[2-9]|3[0-6])s\b/i
];

export function detectWheelSizeTradeoff(message) {
  if (typeof message !== 'string' || !message) return null;
  for (const re of WHEEL_SIZE_PATTERNS) {
    const m = message.match(re);
    if (m) {
      const size = parseInt(m[1], 10);
      if (size >= WHEEL_SIZE_TRADEOFF_INCHES) {
        return {
          size,
          advisory: 'limited_tire_options'
        };
      }
    }
  }
  return null;
}

// ── Ram body generation ─────────────────────────────────────────────
//
// Customer must mention Ram. If year is known, classify generation.
// 2019+ ambiguity (DT 5th gen vs "Classic" 4th gen still sold alongside)
// gets a body_question_needed flag — unless the subtype set already
// includes already_modified (customer's clearly past pre-sale, no need
// to clarify body for fitment).
const RAM_MENTION = /\bram\s*\d?\d?\s*(?:1500|2500|3500|truck)?\b/i;
// HD Rams (2500/3500) are always 8-lug regardless of body style — no
// classic-vs-new ambiguity. The body-style question is RESERVED for 1500s.
const RAM_HD_MENTION = /\bram\s*\d?\d?\s*(?:2500|3500|4500|5500|hd|heavy[\s-]?duty|cummins|hemi\s*hd)\b/i;
// Conservative 1500-explicit signal so we only fire the body question when
// we're confident it's a 1500. "ram 1500", "1500", or absence of HD signals
// alongside a Ram mention.
const RAM_1500_MENTION = /\bram\s*\d?\d?\s*1500\b|\b1500\b/i;

export function detectRamBody({ message, vehicleEra, vehicleSubtype }) {
  if (typeof message !== 'string' || !message) return null;
  if (!RAM_MENTION.test(message)) return null;
  // HD Ram → not the body-question case.
  if (RAM_HD_MENTION.test(message)) {
    return { generation: null, year: vehicleEra?.year || null, body_question_needed: false, sub_model: 'hd' };
  }
  const year = vehicleEra?.year || null;
  if (!year) {
    // Customer said "Ram" but didn't anchor a year — soft signal only,
    // we don't propose a body question without a year to ground it.
    return { generation: null, year: null, body_question_needed: false };
  }
  const gen = RAM_GENERATIONS.find((g) => year >= g.yearMin && year <= g.yearMax);
  if (!gen) return null;
  const alreadyModified = Array.isArray(vehicleSubtype)
    && vehicleSubtype.includes('already_modified');
  // Body question is ONLY a real ambiguity for 1500s. If we can't confirm
  // 1500 from the message, suppress the flag — better to skip a useful
  // question than to ask it on a 2500/3500 where it doesn't apply.
  const isOneFiveHundred = RAM_1500_MENTION.test(message);
  return {
    year,
    generation: gen.gen,
    sub_model: isOneFiveHundred ? '1500' : 'unknown',
    body_question_needed: !!(gen.bodyQuestionNeeded && !alreadyModified && isOneFiveHundred)
  };
}

// ── Top-level interpret() ───────────────────────────────────────────
//
// Takes the normalize output + extra context (vehicle hint from
// capturedFields, etc.) and returns the rule-layer additions to merge
// into the final interpretation object.
export function interpret({ message, normalized, capturedVehicle }) {
  return {
    awd_partial_replacement: detectAwdPartialReplacement({
      message,
      capturedVehicle: capturedVehicle || null
    }),
    wheel_size_tradeoff: detectWheelSizeTradeoff(message),
    ram_body: detectRamBody({
      message,
      vehicleEra: normalized?.vehicle_era,
      vehicleSubtype: normalized?.vehicle_subtype
    })
  };
}
