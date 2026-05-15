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

function resolveDiameter({ capturedFields, productsOfInterest, listingTitle }) {
  const tryParse = (raw) => {
    if (!raw) return null;
    const spec = normalizeTireSpec(raw);
    if (spec && spec.diameter) return spec.diameter;
    const m = String(raw).match(/\b(\d{2})["”]?\b/);
    if (m) return parseInt(m[1], 10);
    return null;
  };
  if (capturedFields) {
    const fromTire = tryParse(capturedFields.tireSize);
    if (fromTire) return { diameter: fromTire, source: 'captured_tire_size' };
  }
  if (Array.isArray(productsOfInterest)) {
    const tire = productsOfInterest.find((p) => p && p.productType === 'tire');
    if (tire && tire.qualifierFields && tire.qualifierFields.tireSize) {
      const d = tryParse(tire.qualifierFields.tireSize);
      if (d) return { diameter: d, source: 'product_of_interest' };
    }
  }
  if (listingTitle) {
    const d = tryParse(listingTitle);
    if (d) return { diameter: d, source: 'listing_title' };
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

  const vehicle = capturedFields && capturedFields.vehicle;
  if (!vehicle) return { triggered: false, gate_reason: 'no_vehicle_captured' };
  const boltPattern = resolveBoltPatternFromVehicle(vehicle);
  if (!boltPattern) {
    return { triggered: false, gate_reason: 'bolt_pattern_unresolved', vehicle };
  }

  const diameterResolved = resolveDiameter({ capturedFields, productsOfInterest, listingTitle });
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

  // Strict: brand or name must contain "Armed". Diameter must match.
  const items = (result.data.items || []).filter((it) => {
    if (!isArmed(it)) return false;
    if (it.specs?.diameter && Number(it.specs.diameter) !== Number(diameter)) return false;
    return true;
  });

  // Group by Armed model. For each model, pick the best in-stock-local
  // option (highest local qty, tie-break by price asc). Falls back to
  // any in-stock (warehouse) if no local hit.
  const byModel = new Map();
  for (const it of items) {
    const model = classifyArmedModel(it);
    if (!model) continue;
    const cur = byModel.get(model);
    const q = homeQty(it, homeShort);
    if (!cur) { byModel.set(model, it); continue; }
    const curQ = homeQty(cur, homeShort);
    if (q > curQ) byModel.set(model, it);
    else if (q === curQ && (it.price || 0) < (cur.price || 0)) byModel.set(model, it);
  }

  const picks = ARMED_MODELS
    .map((model) => {
      const it = byModel.get(model);
      if (!it) return null;
      const shaped = shapeWheelForPrompt(it, homeShort);
      shaped.armedModel = model;
      shaped.inStockLocal = shaped.homeQty > 0;
      return shaped;
    })
    .filter(Boolean);

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
