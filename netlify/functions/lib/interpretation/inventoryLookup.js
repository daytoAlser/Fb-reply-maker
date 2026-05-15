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
import {
  rankAndBucket,
  shapeForPrompt,
  getTireSeasonContext,
  selectAutoPrimary
} from '../inventory/rank.js';

function resolveTireSize({ normalized, capturedFields, productsOfInterest, message, conversationHistory, listingTitle }) {
  // Priority: current turn (normalize) -> captured field -> product_of_interest
  // -> raw scan of current message -> raw scan of conversation history
  // -> raw scan of listing title. The history scan handles the common
  // case where the customer mentioned a size 1-2 turns back and the
  // current turn is on a different topic (e.g., they just gave us their
  // vehicle); capturedFields hasn't synced yet because the prior turn's
  // extract didn't catch the size or the extension hasn't propagated it.
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
  // Fallback raw scans — normalizeTireSpec returns null cleanly if the
  // text doesn't contain a tire-size pattern.
  if (typeof message === 'string' && message) {
    const spec = normalizeTireSpec(message);
    if (spec) return { spec, source: 'current_message_raw' };
  }
  if (Array.isArray(conversationHistory)) {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const m = conversationHistory[i];
      const t = m && (m.text || m.content || m.message);
      if (typeof t !== 'string' || !t) continue;
      const spec = normalizeTireSpec(t);
      if (spec) return { spec, source: 'conversation_history' };
    }
  }
  if (typeof listingTitle === 'string' && listingTitle) {
    const spec = normalizeTireSpec(listingTitle);
    if (spec) return { spec, source: 'listing_title' };
  }
  return null;
}

export async function lookupInventory({
  message,
  normalized,
  capturedFields,
  productsOfInterest,
  conversationHistory,
  listingTitle,
  location,
  signal
} = {}) {
  const resolved = resolveTireSize({
    normalized,
    capturedFields,
    productsOfInterest,
    message,
    conversationHistory,
    listingTitle
  });
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
  const seasonContext = getTireSeasonContext();

  const shape = (it) => shapeForPrompt(it, homeLocationShort);
  let ilink_items = buckets.ilink_items.map(shape);
  let brand_requested_items = buckets.brand_requested_items.map(shape);
  let other_items = buckets.other_items.map(shape);

  // Outside winter-tire season, drop winter-only picks from primary
  // surfacing entirely — they're wrong-season recommendations. We still
  // keep them in totals so the prompt can mention them if asked.
  const winterFilteredOut = { ilink: 0, brand_requested: 0, other: 0 };
  if (!seasonContext.isWinterSeason) {
    const dropWinter = (list, key) => {
      const before = list.length;
      const kept = list.filter((it) => !it.winterOnly);
      winterFilteredOut[key] = before - kept.length;
      return kept;
    };
    ilink_items = dropWinter(ilink_items, 'ilink');
    brand_requested_items = dropWinter(brand_requested_items, 'brand_requested');
    other_items = dropWinter(other_items, 'other');
  }

  const surfacedCount = ilink_items.length + brand_requested_items.length + other_items.length;
  if (surfacedCount === 0 && !brandRequested) {
    return {
      triggered: false,
      gate_reason: 'no_matches',
      fired_from_size: firedFromSize,
      brand_requested: null,
      query,
      totals: buckets.totals,
      season_context: seasonContext
    };
  }

  const autoPrimary = selectAutoPrimary({
    ilink_items,
    brand_requested_items,
    other_items,
    seasonContext
  });

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
    home_location_short: homeLocationShort,
    season_context: seasonContext,
    winter_filtered_out: winterFilteredOut,
    auto_primary: autoPrimary
  };
}
