// Ad-driven inventory cross-check.
//
// Customer-side inventoryLookup.js answers "what does the CUSTOMER's
// message tell us about size?" This phase answers "what does the
// LISTING tell us?" — parses the ad title for tire size + brand,
// queries inventory at the rep's home location, and reports:
//   - is the EXACT listed product (brand + size) in stock locally?
//   - if not, what's in the same size + in stock locally as a pivot?
//
// Feeds the AD INVENTORY CONTEXT prompt block, which lets the AI
// naturally say "we can get those Transmate from the warehouse, a
// few days out, but we've got the iLink in 225/45ZR17 ready to roll
// at Red Deer today — wanna do those instead?"

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
import { shapeForPrompt } from '../inventory/rank.js';

function homeQty(it, homeShort) {
  if (!homeShort || !it || !Array.isArray(it.stock?.byLocation)) return 0;
  const hit = it.stock.byLocation.find((s) => s.short === homeShort);
  return hit ? hit.qty : 0;
}

function externalQty(it) {
  return (it && it.stock && it.stock.external) || 0;
}

function brandRegex(brand) {
  return new RegExp('\\b' + brand.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\b', 'i');
}

function itemMatchesBrand(it, brand) {
  if (!brand || !it) return false;
  const re = brandRegex(brand);
  return re.test(it.brand || '') || re.test(it.name || '');
}

function isHouseBrand(it) {
  return /\bilink\b/i.test((it && it.brand) || '');
}

export async function lookupAdInventory({ listingTitle, location, signal } = {}) {
  if (typeof listingTitle !== 'string' || !listingTitle.trim()) {
    return { triggered: false, gate_reason: 'no_listing_title' };
  }
  const size = normalizeTireSpec(listingTitle);
  if (!size) {
    // Listing isn't a tire (could be wheels, lift kit, accessory).
    // Skip — phase 1 only handles tires.
    return { triggered: false, gate_reason: 'no_tire_size_in_listing' };
  }
  const sizeStr = formatTireSpec(size);
  const brand = extractBrandFromMessage(listingTitle);
  const homeKey = homeLocationKeyFromName(location && location.name);
  const homeShort = homeLocationShortFromName(location && location.name);
  if (!homeKey || !homeShort) {
    return { triggered: false, gate_reason: 'no_home_location' };
  }

  const query = buildTireQuery({ tireSpec: size });
  const result = await searchInventory(query, {
    homeLocation: homeKey,
    limit: 100,
    signal
  });
  if (!result.ok) {
    return {
      triggered: false,
      gate_reason: 'lookup_failed',
      listed_size: sizeStr,
      listed_brand: brand,
      error: result.error
    };
  }

  const sizeNeedle = sizeStr.toLowerCase();
  const items = (result.data.items || []).filter((it) => {
    const a = (it.specs && it.specs.tireSize ? String(it.specs.tireSize).toLowerCase() : '');
    const b = (it.specs && it.specs.tireQuickSize ? String(it.specs.tireQuickSize).toLowerCase() : '');
    if (!a && !b) return true;
    return a.includes(sizeNeedle) || b.includes(sizeNeedle);
  });

  // Bucket #1: exact listed brand matches.
  const listedMatches = brand ? items.filter((it) => itemMatchesBrand(it, brand)) : [];
  const listedLocal = listedMatches.filter((it) => homeQty(it, homeShort) > 0);
  const listedWarehouse = listedMatches.filter((it) => homeQty(it, homeShort) === 0 && externalQty(it) > 0);

  // Bucket #2: in-stock-local alternatives (any non-listed brand).
  // Prioritize iLink (house brand) + local stock count. Dedup by
  // brand so the prompt gets variety, not three SKUs of one tire.
  const altPool = items.filter((it) => {
    if (brand && itemMatchesBrand(it, brand)) return false;
    return homeQty(it, homeShort) > 0;
  });
  altPool.sort((a, b) => {
    const aHouse = isHouseBrand(a) ? 1 : 0;
    const bHouse = isHouseBrand(b) ? 1 : 0;
    if (aHouse !== bHouse) return bHouse - aHouse;
    return homeQty(b, homeShort) - homeQty(a, homeShort);
  });
  const seenBrands = new Set();
  const alts = [];
  for (const it of altPool) {
    const k = (it.brand || '').toLowerCase().trim();
    if (!k || seenBrands.has(k)) continue;
    seenBrands.add(k);
    alts.push(it);
    if (alts.length >= 3) break;
  }

  let listed_status;
  if (listedLocal.length > 0) listed_status = 'in_stock_local';
  else if (listedWarehouse.length > 0) listed_status = 'warehouse_only';
  else if (brand) listed_status = 'not_in_catalog';
  else listed_status = 'no_brand_in_listing';

  return {
    triggered: true,
    listed_size: sizeStr,
    listed_brand: brand,
    home_location: (location && location.name) || null,
    home_location_short: homeShort,
    listed_status,
    listed_in_stock_local: listedLocal.slice(0, 2).map((it) => shapeForPrompt(it, homeShort)),
    listed_warehouse_picks: listedWarehouse.slice(0, 1).map((it) => shapeForPrompt(it, homeShort)),
    alternatives_in_stock_local: alts.map((it) => shapeForPrompt(it, homeShort)),
    totals: {
      total_in_size: items.length,
      listed_matches: listedMatches.length,
      alternatives_local: altPool.length
    }
  };
}
