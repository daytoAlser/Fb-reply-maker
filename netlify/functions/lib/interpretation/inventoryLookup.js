// Live inventory lookup phase.
//
// Triggers when a tire size is in play (current message OR captured on the
// lead). Fetches matching tires from canadacustomautoworks.com/api/items via
// the ported scraping client, buckets them (iLink-led with optional brand-
// requested side-by-side), and returns a data block the prompt builder
// serializes into LIVE INVENTORY CONTEXT.
//
// Caller (generate-reply.js handler) is responsible for the wrongProduct
// suppression gate — pass a pre-fetched signal of { triggered: false,
// gate_reason: 'suppressed_by_wrong_product' } back instead of calling us
// when wrongProduct fires.

import {
  searchInventory,
  homeLocationKeyFromName,
  homeLocationShortFromName
} from '../inventory/client.js';
import {
  buildTireQuery,
  extractBrandFromMessage,
  normalizeTireSpec,
  formatTireSpec
} from '../inventory/queryBuilder.js';
import { rankAndBucket, shapeForPrompt } from '../inventory/rank.js';

function resolveTireSize({ normalized, capturedFields, productsOfInterest }) {
  // Priority: current turn -> captured field -> product_of_interest.
  if (normalized && normalized.tire_spec) {
    const spec = normalizeTireSpec(normalized.tire_spec);
    if (spec) return { spec, source: 'current_message' };
  }
  if (capturedFields && typeof capturedFields === 'object') {
    const raw = capturedFields.tireSize;
    if (raw) {
      const spec = normalizeTireSpec(raw);
      if (spec) return { spec, source: 'captured_field' };
    }
  }
  if (Array.isArray(productsOfInterest)) {
    const tire = productsOfInterest.find((p) => p && p.productType === 'tire');
    const raw = tire && tire.qualifierFields && tire.qualifierFields.tireSize;
    if (raw) {
      const spec = normalizeTireSpec(raw);
      if (spec) return { spec, source: 'product_of_interest' };
    }
  }
  return null;
}

export async function lookupInventory({
  message,
  normalized,
  capturedFields,
  productsOfInterest,
  location,
  signal
} = {}) {
  const resolved = resolveTireSize({ normalized, capturedFields, productsOfInterest });
  if (!resolved) return { triggered: false, gate_reason: 'no_tire_spec' };

  const { spec, source } = resolved;
  const brandRequested = extractBrandFromMessage(message);
  const query = buildTireQuery({ tireSpec: spec, brand: brandRequested });
  const firedFromSize = formatTireSpec(spec);
  const homeLocationKey = homeLocationKeyFromName(location && location.name);
  const homeLocationShort = homeLocationShortFromName(location && location.name);

  const result = await searchInventory(query, {
    homeLocation: homeLocationKey,
    limit: 100,
    signal
  });

  if (!result.ok) {
    return {
      triggered: false,
      gate_reason: 'lookup_failed',
      error: result.error || 'unknown',
      fired_from_size: firedFromSize,
      brand_requested: brandRequested,
      query
    };
  }

  // Only consider items in the correct tire size. The API search is
  // relevance-keyed but can return adjacent sizes; filter strictly by the
  // canonical tireSize / tireQuickSize fields when available.
  const sizeNeedle = firedFromSize.toLowerCase();
  const items = (result.data.items || []).filter((it) => {
    const a = (it.specs && it.specs.tireSize ? String(it.specs.tireSize).toLowerCase() : '');
    const b = (it.specs && it.specs.tireQuickSize ? String(it.specs.tireQuickSize).toLowerCase() : '');
    if (!a && !b) return true; // No spec metadata -> trust the API relevance score
    return a.includes(sizeNeedle) || b.includes(sizeNeedle);
  });

  const buckets = rankAndBucket(items, { brandRequested, homeLocationShort });

  const shape = (it) => shapeForPrompt(it, homeLocationShort);
  const ilink_items = buckets.ilink_items.map(shape);
  const brand_requested_items = buckets.brand_requested_items.map(shape);
  const other_items = buckets.other_items.map(shape);

  const surfacedCount = ilink_items.length + brand_requested_items.length + other_items.length;
  if (surfacedCount === 0 && !brandRequested) {
    // Nothing to show, no override path. Fall back to existing product-kb voice.
    return {
      triggered: false,
      gate_reason: 'no_matches',
      fired_from_size: firedFromSize,
      brand_requested: null,
      query,
      totals: buckets.totals
    };
  }

  return {
    triggered: true,
    source,
    fired_from_size: firedFromSize,
    brand_requested: brandRequested,
    query,
    totals: buckets.totals,
    ilink_items,
    brand_requested_items,
    other_items,
    home_location: location && location.name ? location.name : null,
    home_location_short: homeLocationShort
  };
}
