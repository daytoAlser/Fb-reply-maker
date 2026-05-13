// Phase E.4 — wrong-product detection.
//
// Three sub-types, evaluated in priority order:
//   1. not_carried       — customer asks about a product CCAW doesn't supply
//   2. fitment_mismatch  — customer's vehicle is incompatible with the listing
//   3. product_pivot     — customer asks about a different product than the
//                          listing, but it IS in catalog (smooth handoff)
//
// First match wins. Per-turn detector — no LLM call, no IO.

import { NOT_CARRIED, IN_CATALOG_PRODUCTS, PRODUCT_KEYWORD_MAP } from '../data/not-carried.js';
import { FITMENT_RULES, classifyVehicle, classifyListingType } from '../data/fitment-rules.js';
import { detectBoltPattern, detectTireSpec } from './normalize.js';

// ── Not-carried ─────────────────────────────────────────────────────
//
// Scan the customer message against NOT_CARRIED.match_phrases. Returns
// the first hit with the key + entry. Substring match (case-insensitive)
// — short phrases like "bbk" must be word-bounded to avoid false-positive
// inside larger words.

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectNotCarried(message) {
  if (typeof message !== 'string' || !message.trim()) return null;
  for (const [key, entry] of Object.entries(NOT_CARRIED)) {
    for (const phrase of entry.match_phrases) {
      // Optional trailing 's' so "paint job" matches "paint jobs",
      // "body lift" matches "body lifts", etc. Most match phrases are
      // nouns that customers naturally pluralize.
      const re = new RegExp('\\b' + escapeForRegex(phrase) + 's?\\b', 'i');
      if (re.test(message)) {
        return {
          type: 'not_carried',
          requested_product: key,
          matched_phrase: phrase,
          redirect_message: entry.redirect_message,
          redirect_targets: entry.redirect_targets
        };
      }
    }
  }
  return null;
}

// ── Fitment mismatch ───────────────────────────────────────────────
//
// Conservative: needs BOTH a recognizable listing product+spec AND a
// recognizable customer vehicle. We never flag on ambiguity — let the
// normal qualifier flow handle unclear cases.
//
// Three flavors:
//   - bolt-pattern incompatibility (wheel listing vs vehicle bolt class)
//   - tire-type incompatibility (ST/LT/P listing vs vehicle category)
//   - product-vs-vehicle incompatibility (lift kit on a sedan, etc.)

export function detectFitmentMismatch({ listingTitle, capturedVehicle, message }) {
  if (typeof listingTitle !== 'string' || !listingTitle) return null;

  // Vehicle source: prefer captured (canonical), fall back to current
  // message so first-turn customers get the check too.
  const vehicleText = (capturedVehicle && capturedVehicle.trim()) || message || '';
  if (!vehicleText) return null;
  const vehicleTags = classifyVehicle(vehicleText);
  if (vehicleTags.size === 0) return null;

  const listingType = classifyListingType(listingTitle);

  // --- Bolt-pattern check (wheel listings) ----------------------------
  const listingBolt = detectBoltPattern(listingTitle);
  if (listingBolt && listingBolt.canonical) {
    const compat = FITMENT_RULES.bolt_pattern_compatibility[listingBolt.canonical];
    if (compat) {
      const overlap = compat.some((t) => vehicleTags.has(t));
      if (!overlap) {
        return {
          type: 'fitment_mismatch',
          subreason: 'bolt_pattern_incompatible',
          listing_bolt_pattern: listingBolt.canonical,
          vehicle_tags: [...vehicleTags],
          vehicle_text: vehicleText.slice(0, 80),
          pivot_suggestion: pivotForVehicle(vehicleTags)
        };
      }
    }
  }

  // --- Tire-type check (tire listings with ST/LT/P prefix) -----------
  const listingTire = detectTireSpec(listingTitle);
  if (listingTire) {
    const prefix = listingTire.prefix || 'NONE';
    const compat = FITMENT_RULES.tire_type_compatibility[prefix];
    if (compat) {
      const overlap = compat.some((t) => vehicleTags.has(t));
      if (!overlap) {
        return {
          type: 'fitment_mismatch',
          subreason: 'tire_type_incompatible',
          listing_tire_type: listingTire.type,
          listing_tire_prefix: prefix,
          vehicle_tags: [...vehicleTags],
          vehicle_text: vehicleText.slice(0, 80)
        };
      }
    }
  }

  // --- Lift kit on incompatible vehicle ------------------------------
  if (listingType === 'lift_kit') {
    const blocked = FITMENT_RULES.lift_incompatible_categories.some((t) => vehicleTags.has(t));
    if (blocked) {
      return {
        type: 'fitment_mismatch',
        subreason: 'lift_kit_incompatible_vehicle',
        listing_product: 'lift_kit',
        vehicle_tags: [...vehicleTags],
        vehicle_text: vehicleText.slice(0, 80)
      };
    }
  }

  return null;
}

function pivotForVehicle(vehicleTags) {
  // Best-effort suggestion text. The prompt builder formats this into
  // the variant.
  if (vehicleTags.has('trailer')) return 'trailer-rated tires (ST spec) that fit';
  if (vehicleTags.has('truck_hd') || vehicleTags.has('truck_8lug')) return 'HD truck wheels (8-lug) that fit';
  if (vehicleTags.has('truck_1500')) return '6-lug truck wheels that fit';
  if (vehicleTags.has('car') || vehicleTags.has('sedan') || vehicleTags.has('sports_car')) return '5x114.3 or matching bolt-pattern car wheels that fit';
  return 'wheels that fit your vehicle';
}

// ── Product pivot ──────────────────────────────────────────────────
//
// Customer's current message asks about a different product than the
// listing, AND the new product IS in CCAW catalog. Smooth handoff to
// the new product's qualifier flow.
//
// Requires a pivot signal (phrasing) to avoid false-positive on every
// stray product mention. Examples of pivot signals:
//   "actually" / "actually quote me" / "what about"
//   "instead" / "instead of" / "rather than"
//   "switch to" / "swap to"
//   "can I get a quote on <X>" / "do you also do <X>"
//   "while we're at it"

const PIVOT_SIGNAL_PATTERNS = [
  /\bactually\b/i,
  /\binstead\s+of\b/i,
  /\bjust\s+(?:thought|wanted|figured)\b/i,
  /\bwhile\s+we'?re\s+at\s+it\b/i,
  /\bswitch(?:ing)?\s+(?:to|over\s+to)\b/i,
  /\bswap(?:ping)?\s+(?:to|over\s+to)\b/i,
  /\brather\s+than\b/i,
  /\bwhat\s+about\b/i,
  /\bdo\s+you\s+(?:also\s+)?(?:do|carry|stock|sell)\b/i,
  /\bcan\s+(?:i|we)\s+(?:get|grab|see)\s+(?:a\s+)?(?:quote|price)\s+on\b/i,
  /\b(?:quote|price)\s+me\s+(?:on|for)\b/i
];

function detectProductInMessage(message) {
  for (const { phrase, tag } of PRODUCT_KEYWORD_MAP) {
    if (phrase.test(message)) return tag;
  }
  return null;
}

export function detectProductPivot({ listingTitle, adType, message }) {
  if (typeof message !== 'string' || !message.trim()) return null;
  const newProduct = detectProductInMessage(message);
  if (!newProduct) return null;
  if (!IN_CATALOG_PRODUCTS.has(newProduct)) return null;

  // Compare against listing context. If listing ad_type matches the
  // detected product, it's not a pivot — the customer is asking about
  // the same thing they came in on.
  const listingProduct = adType
    ? mapAdTypeToProduct(adType)
    : detectProductInMessage(listingTitle || '');
  if (listingProduct && listingProduct === newProduct) return null;

  // Require a pivot signal — otherwise random product mentions
  // ("the wheels look great, do these tires fit?") shouldn't trigger.
  const hasSignal = PIVOT_SIGNAL_PATTERNS.some((re) => re.test(message));
  if (!hasSignal) return null;

  return {
    type: 'product_pivot',
    original_listing: listingProduct || 'unknown',
    new_product: newProduct,
    in_catalog: true,
    pivot_qualifiers_needed: qualifiersForProduct(newProduct)
  };
}

function mapAdTypeToProduct(adType) {
  // generate-reply uses ad_type values: wheel / tire / accessory / lift / unknown
  if (!adType) return null;
  switch (adType) {
    case 'wheel': return 'wheels';
    case 'tire': return 'tires';
    case 'lift': return 'lift_kit';
    case 'accessory': return 'accessories';
    default: return null;
  }
}

function qualifiersForProduct(tag) {
  switch (tag) {
    case 'wheels':         return ['vehicle', 'lookPreference', 'rideHeight'];
    case 'tires':          return ['vehicle', 'tireSize'];
    case 'lift_kit':       return ['vehicle', 'rideHeight', 'intent'];
    case 'leveling_kit':   return ['vehicle'];
    case 'coilovers':      return ['vehicle', 'intent'];
    case 'air_ride':       return ['vehicle', 'intent'];
    case 'accessories':    return ['vehicle'];
    case 'shocks_struts':  return ['vehicle'];
    case 'pads_rotors':    return ['vehicle'];
    default:               return ['vehicle'];
  }
}

// ── Top-level detection ────────────────────────────────────────────
//
// Priority order: not_carried > fitment_mismatch > product_pivot.
// First hit wins. Returns null when nothing fires.

export function detectWrongProduct({ message, listingTitle, capturedVehicle, adType }) {
  const nc = detectNotCarried(message);
  if (nc) return nc;
  const fm = detectFitmentMismatch({ listingTitle, capturedVehicle, message });
  if (fm) return fm;
  const pp = detectProductPivot({ listingTitle, adType, message });
  if (pp) return pp;
  return null;
}
