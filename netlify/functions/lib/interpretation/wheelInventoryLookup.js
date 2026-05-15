// Wheel inventory lookup — Armed-brand only.
//
// Fires when:
//   - Customer mentions rims/wheels (or wheel is a product_of_interest)
//   - Vehicle is captured (so we can resolve bolt pattern)
//   - Tire size is captured OR ad listing diameter is known (so we know
//     the wheel diameter)
//
// Queries canadacustomautoworks.com for Armed-brand wheels in that
// diameter, post-filters to brand strictly starting with "Armed", and
// returns the top in-stock-local pick PER MODEL (Armed Street, Armed
// Syndicate, Armed Off-Road).
//
// Why Armed-only: CCAW's wheel margin is highest on the house brand
// and the rep wants the AI to commit to options instead of asking
// poke/flush forever. Anything outside Armed gets handed to a human.

import {
  searchInventory,
  homeLocationKeyFromName,
  homeLocationShortFromName
} from '../inventory/client.js';
import { normalizeTireSpec } from '../inventory/queryBuilder.js';
import { resolveBoltPatternFromVehicle } from '../data/vehicleBoltPattern.js';

const ARMED_MODELS = ['Armed Street', 'Armed Syndicate', 'Armed Off-Road'];

function isArmed(it) {
  if (!it) return false;
  const brand = (it.brand || '').toLowerCase();
  const name = (it.name || '').toLowerCase();
  return /\barmed\b/.test(brand) || /\barmed\b/.test(name);
}

function classifyArmedModel(it) {
  if (!it) return null;
  const hay = ((it.brand || '') + ' ' + (it.name || '') + ' ' + (it.model || '')).toLowerCase();
  if (/armed\s*off[\s-]?road|armed[-\s]*o\.?r\.?/.test(hay)) return 'Armed Off-Road';
  if (/armed\s*syndicate/.test(hay)) return 'Armed Syndicate';
  if (/armed\s*street/.test(hay)) return 'Armed Street';
  // Unlabelled "Armed X" — fall through to street as the safest default
  if (/armed\b/.test(hay)) return 'Armed Street';
  return null;
}

function homeQty(it, homeShort) {
  if (!homeShort || !it || !Array.isArray(it.stock?.byLocation)) return 0;
  const hit = it.stock.byLocation.find((s) => s.short === homeShort);
  return hit ? hit.qty : 0;
}

function shapeWheelForPrompt(it, homeShort) {
  return {
    sku: it.sku,
    name: it.name,
    brand: it.brand,
    model: it.model || '',
    finish: it.finish || '',
    priceFormatted: it.priceFormatted,
    price: it.price,
    image: it.image,
    allImages: Array.isArray(it.allImages) ? it.allImages.slice(0, 4) : [],
    diameter: it.specs?.diameter || null,
    width: it.specs?.width || null,
    offsetMin: it.specs?.offsetMin || null,
    offsetMax: it.specs?.offsetMax || null,
    homeQty: homeQty(it, homeShort),
    url: it.url || null
  };
}

function resolveDiameter({ capturedFields, productsOfInterest, listingTitle, message, conversationHistory }) {
  const tryParseTire = (raw) => {
    if (!raw) return null;
    const spec = normalizeTireSpec(raw);
    if (spec && spec.diameter) return spec.diameter;
    return null;
  };
  // Scan free text for a tire-spec pattern (265/60/17, 265/60R17, etc.).
  // Stand-alone "17" is too ambiguous — only accept it when paired with
  // an explicit inch marker.
  const scanText = (text) => {
    if (typeof text !== 'string' || !text.trim()) return null;
    const tireMatch = text.match(/\b(?:LT|ST|P)?\d{3}\s*\/\s*\d{2}\s*[\/R]\s*(\d{2})\b/i);
    if (tireMatch) return parseInt(tireMatch[1], 10);
    const inchMatch = text.match(/\b(\d{2})\s*(?:["”]|\s?in(?:ch(?:es)?)?\b|\s?inch\b)/i);
    if (inchMatch) return parseInt(inchMatch[1], 10);
    return null;
  };
  if (capturedFields) {
    const fromTire = tryParseTire(capturedFields.tireSize);
    if (fromTire) return { diameter: fromTire, source: 'captured_tire_size' };
  }
  if (Array.isArray(productsOfInterest)) {
    const tire = productsOfInterest.find((p) => p && p.productType === 'tire');
    if (tire && tire.qualifierFields && tire.qualifierFields.tireSize) {
      const d = tryParseTire(tire.qualifierFields.tireSize);
      if (d) return { diameter: d, source: 'product_of_interest' };
    }
  }
  // Current turn — scan the customer's message AND the conversation
  // history for a tire size. This catches the case where the customer
  // JUST revealed the vehicle and size; captured_fields hasn't caught
  // up yet because this AI call is the one that would have populated it.
  const fromMessage = scanText(message);
  if (fromMessage) return { diameter: fromMessage, source: 'current_message' };
  if (Array.isArray(conversationHistory)) {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const m = conversationHistory[i];
      const t = m && (m.text || m.content || m.message);
      const d = scanText(t);
      if (d) return { diameter: d, source: 'conversation_history' };
    }
  }
  if (listingTitle) {
    const d = scanText(listingTitle);
    if (d) return { diameter: d, source: 'listing_title' };
  }
  return null;
}

function resolveVehicle({ capturedFields, conversationHistory, message }) {
  if (capturedFields && typeof capturedFields.vehicle === 'string' && capturedFields.vehicle.trim()) {
    return { vehicle: capturedFields.vehicle.trim(), source: 'captured_field' };
  }
  // Same fallback: customer may have JUST revealed the vehicle this turn.
  const scan = (text) => {
    if (typeof text !== 'string') return null;
    if (resolveBoltPatternFromVehicle(text)) return text;
    return null;
  };
  const fromMsg = scan(message);
  if (fromMsg) return { vehicle: fromMsg, source: 'current_message' };
  if (Array.isArray(conversationHistory)) {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const m = conversationHistory[i];
      const t = m && (m.text || m.content || m.message);
      const v = scan(t);
      if (v) return { vehicle: v, source: 'conversation_history' };
    }
  }
  return null;
}

function wheelInScope({ message, capturedFields, productsOfInterest, conversationHistory }) {
  if (Array.isArray(productsOfInterest)
      && productsOfInterest.some((p) => p && p.productType === 'wheel')) {
    return true;
  }
  const hay = [
    typeof message === 'string' ? message : '',
    Array.isArray(conversationHistory) ? conversationHistory.map((m) => m?.text || '').join(' ') : ''
  ].join(' ').toLowerCase();
  return /\b(rim|rims|wheel|wheels)\b/.test(hay);
}

export async function lookupWheelInventory({
  message,
  capturedFields,
  productsOfInterest,
  conversationHistory,
  listingTitle,
  location,
  signal
} = {}) {
  if (!wheelInScope({ message, capturedFields, productsOfInterest, conversationHistory })) {
    return { triggered: false, gate_reason: 'wheel_not_in_scope' };
  }

  const vehicleResolved = resolveVehicle({ capturedFields, conversationHistory, message });
  if (!vehicleResolved) return { triggered: false, gate_reason: 'no_vehicle_resolvable' };
  const vehicle = vehicleResolved.vehicle;
  const boltPattern = resolveBoltPatternFromVehicle(vehicle);
  if (!boltPattern) {
    return { triggered: false, gate_reason: 'bolt_pattern_unresolved', vehicle };
  }

  const diameterResolved = resolveDiameter({ capturedFields, productsOfInterest, listingTitle, message, conversationHistory });
  if (!diameterResolved) {
    return { triggered: false, gate_reason: 'no_wheel_diameter', vehicle, bolt_pattern: boltPattern };
  }
  const diameter = diameterResolved.diameter;

  const homeKey = homeLocationKeyFromName(location && location.name);
  const homeShort = homeLocationShortFromName(location && location.name);
  if (!homeKey || !homeShort) {
    return { triggered: false, gate_reason: 'no_home_location' };
  }

  const query = `Armed ${diameter} ${boltPattern}`;
  const result = await searchInventory(query, { homeLocation: homeKey, limit: 100, signal });
  if (!result.ok) {
    return {
      triggered: false,
      gate_reason: 'lookup_failed',
      error: result.error,
      vehicle, bolt_pattern: boltPattern, diameter
    };
  }

  // Strict: brand or name must contain "Armed". Diameter must match
  // (skip the filter when specs.diameter is missing — trust the query).
  const items = (result.data.items || []).filter((it) => {
    if (!isArmed(it)) return false;
    if (it.specs?.diameter && Number(it.specs.diameter) !== Number(diameter)) return false;
    return true;
  });

  // Surface EVERY Armed wheel in stock at the home location, deduped by
  // SKU. Cap at 8 to keep the prompt sane — when the rep sees more in
  // the inventory tool they can override. Sort: in-stock-local first
  // (highest local qty first), then warehouse-only, ties broken by
  // price asc so the cheapest comparable option leads.
  const seen = new Set();
  const candidates = [];
  for (const it of items) {
    if (!it || !it.sku || seen.has(it.sku)) continue;
    seen.add(it.sku);
    candidates.push(it);
  }
  candidates.sort((a, b) => {
    const qA = homeQty(a, homeShort);
    const qB = homeQty(b, homeShort);
    if (qA !== qB) return qB - qA;
    return (a.price || 0) - (b.price || 0);
  });
  // Keep only in-stock-local for the FIRST cut. If fewer than 3, top up
  // with warehouse-only options so the rep still has variety to send.
  const local = candidates.filter((it) => homeQty(it, homeShort) > 0);
  const warehouse = candidates.filter((it) => homeQty(it, homeShort) === 0);
  const top = local.length >= 3 ? local.slice(0, 8) : local.concat(warehouse).slice(0, 8);

  const picks = top.map((it) => {
    const shaped = shapeWheelForPrompt(it, homeShort);
    shaped.armedModel = classifyArmedModel(it) || 'Armed';
    shaped.inStockLocal = shaped.homeQty > 0;
    return shaped;
  });

  if (picks.length === 0) {
    return {
      triggered: false,
      gate_reason: 'no_armed_matches',
      vehicle, bolt_pattern: boltPattern, diameter, query
    };
  }

  return {
    triggered: true,
    vehicle,
    bolt_pattern: boltPattern,
    diameter,
    diameter_source: diameterResolved.source,
    home_location: location?.name || null,
    home_location_short: homeShort,
    query,
    picks,
    totals: {
      armed_items_in_diameter: items.length,
      models_surfaced: picks.length
    }
  };
}
