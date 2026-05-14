// Ranks and buckets inventory items for the LIVE INVENTORY CONTEXT prompt
// block. Pure functions — no IO. Consumed by inventoryLookup.js.
//
// Bucketing rules (confirmed with user):
//   - When customer named a brand: surface BOTH that brand's matches AND
//     iLink side-by-side (the prompt instructs Claude to lead with the
//     requested brand and only fall back to iLink if tone is price-sensitive).
//   - When customer named no brand: iLink-led, with a couple of strong
//     "other" picks for variety.
//
// Within any bucket, sort by:
//   homeStock.qty DESC -> totalStock DESC -> price ASC
// (most-local-stock first so the rep can promise "ready to rock" without
// warehouse-shipment caveats.)
//
// Caps: 3 per bucket, 5 total surfaced items.

const HOUSE_BRAND = 'iLink';
const MAX_PER_BUCKET = 3;
const MAX_TOTAL = 5;

function isHouseBrand(item) {
  const b = (item && item.brand) || '';
  return /\bilink\b/i.test(b);
}

function brandMatches(item, brand) {
  if (!brand) return false;
  const b = (item && item.brand) || '';
  const n = (item && item.name) || '';
  const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`, 'i');
  return re.test(b) || re.test(n);
}

function homeStockQty(item, homeLocationShort) {
  if (!homeLocationShort || !item || !item.stock || !Array.isArray(item.stock.byLocation)) return 0;
  const hit = item.stock.byLocation.find((s) => s.short === homeLocationShort);
  return hit ? hit.qty : 0;
}

function sortItems(a, b, homeLocationShort) {
  const aHome = homeStockQty(a, homeLocationShort);
  const bHome = homeStockQty(b, homeLocationShort);
  if (aHome !== bHome) return bHome - aHome;
  const aTotal = (a.stock && a.stock.total) || 0;
  const bTotal = (b.stock && b.stock.total) || 0;
  if (aTotal !== bTotal) return bTotal - aTotal;
  const aPrice = a.price || Infinity;
  const bPrice = b.price || Infinity;
  return aPrice - bPrice;
}

// Dedup to top-1-per-brand for the "other" bucket so the prompt doesn't get
// three Toyos when it wants variety. Keeps the first occurrence (already
// sorted by relevance/stock).
function topOnePerBrand(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.brand || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// Returns { ilink_items, brand_requested_items, other_items, totals }.
// other_items is only populated when no brand was requested (caller decides
// whether to render the OTHER section; when a brand IS requested we go
// side-by-side with iLink only).
export function rankAndBucket(items, { brandRequested = null, homeLocationShort = null } = {}) {
  const safeItems = Array.isArray(items) ? items.filter((it) => it && it.name) : [];
  const sortByHome = (a, b) => sortItems(a, b, homeLocationShort);

  const ilinkRaw = safeItems.filter(isHouseBrand).slice().sort(sortByHome);
  const ilink_items = ilinkRaw.slice(0, MAX_PER_BUCKET);

  let brand_requested_items = [];
  let other_items = [];

  // When the customer named a brand that is NOT iLink, surface that brand
  // alongside iLink. When the customer named iLink itself, the iLink bucket
  // already covers it — brand_requested_items stays empty so we don't
  // duplicate.
  const requestedIsHouse = brandRequested && /^ilink$/i.test(brandRequested);
  if (brandRequested && !requestedIsHouse) {
    brand_requested_items = safeItems
      .filter((it) => !isHouseBrand(it) && brandMatches(it, brandRequested))
      .slice()
      .sort(sortByHome)
      .slice(0, MAX_PER_BUCKET);
  }

  if (!brandRequested) {
    // No brand override -> pad with strong "other" picks for variety.
    const otherRaw = safeItems
      .filter((it) => !isHouseBrand(it))
      .slice()
      .sort(sortByHome);
    other_items = topOnePerBrand(otherRaw).slice(0, MAX_TOTAL - ilink_items.length);
  }

  // Cap total surfaced items at 5.
  let surfaced = ilink_items.length + brand_requested_items.length + other_items.length;
  if (surfaced > MAX_TOTAL) {
    const overshoot = surfaced - MAX_TOTAL;
    // Trim from the lowest-priority bucket first: other -> brand_requested -> ilink.
    const trimOther = Math.min(other_items.length, overshoot);
    other_items = other_items.slice(0, other_items.length - trimOther);
    let remaining = overshoot - trimOther;
    if (remaining > 0) {
      const trimBrand = Math.min(brand_requested_items.length, remaining);
      brand_requested_items = brand_requested_items.slice(0, brand_requested_items.length - trimBrand);
    }
  }

  return {
    ilink_items,
    brand_requested_items,
    other_items,
    totals: {
      matched: safeItems.length,
      ilink: safeItems.filter(isHouseBrand).length,
      brand_requested: brandRequested && !requestedIsHouse
        ? safeItems.filter((it) => !isHouseBrand(it) && brandMatches(it, brandRequested)).length
        : 0,
      other: safeItems.filter((it) => !isHouseBrand(it)).length
    }
  };
}

// Derives an ABSOLUTE-RULE-D2-compliant availability framing string for a
// single surfaced item. Returns 'ready_to_rock' | 'we_can_get_those' | null.
//
//   homeStock >= 4                          -> ready_to_rock
//   totalStock >= 4 && homeStock < 4        -> we_can_get_those
//   totalStock < 4 && external > 0          -> we_can_get_those
//   else                                    -> null (let model pick neutral)
export function deriveAvailabilityFraming(item, homeLocationShort) {
  if (!item) return null;
  const homeQty = homeStockQty(item, homeLocationShort);
  const totalQty = (item.stock && item.stock.total) || 0;
  const external = (item.stock && item.stock.external) || 0;
  if (homeQty >= 4) return 'ready_to_rock';
  if (totalQty >= 4 && homeQty < 4) return 'we_can_get_those';
  if (totalQty < 4 && external > 0) return 'we_can_get_those';
  return null;
}

// Detects dedicated winter / snow / ice tires by name and description. Per
// the Dayton rule: anything with snow/winter/ice in the name/description
// is winter-only, not an all-season — even if it carries the 3PMS rating.
// Word-bounded to avoid tripping on "snowflake" (a rating, not a product
// class) or "winterized". Operates on item.name + item.rawDescription only —
// never the customer's message.
const WINTER_ONLY_RE = /\b(snow|winter|ice)\b/i;
export function isWinterOnly(item) {
  if (!item) return false;
  const name = String(item.name || '');
  const desc = String(item.rawDescription || '');
  return WINTER_ONLY_RE.test(name) || WINTER_ONLY_RE.test(desc);
}

// Helper: compact a clean item from client.js into the prompt-block-friendly
// shape consumed by buildInventoryBlock(). Strips raw description, dedups
// to the data the prompt actually surfaces.
export function shapeForPrompt(item, homeLocationShort) {
  if (!item) return null;
  const homeQty = homeStockQty(item, homeLocationShort);
  const homeName = (() => {
    if (!homeLocationShort) return null;
    const hit = (item.stock && item.stock.byLocation) || [];
    const match = hit.find((s) => s.short === homeLocationShort);
    return match ? match.name : null;
  })();
  const otherStores = ((item.stock && item.stock.byLocation) || [])
    .filter((s) => s.qty > 0 && s.short !== homeLocationShort)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 4)
    .map((s) => ({ short: s.short, qty: s.qty }));
  return {
    name: item.name,
    brand: item.brand,
    sku: item.sku,
    price: item.price,
    priceFormatted: item.priceFormatted,
    url: item.url,
    image: item.image,
    homeStock: homeName ? { name: homeName, qty: homeQty } : null,
    totalStock: (item.stock && item.stock.total) || 0,
    otherStores,
    external: (item.stock && item.stock.external) || 0,
    availabilityFraming: deriveAvailabilityFraming(item, homeLocationShort),
    winterOnly: isWinterOnly(item),
    // Capped image list (up to 4) for downstream "attach images on send".
    // shapeForPrompt drops everything else from rawDescription / images that
    // the prompt and UI don't need; this stays small.
    allImages: Array.isArray(item.allImages) ? item.allImages.slice(0, 4) : []
  };
}

// Returns the current tire-season context. Used to (a) filter winter-only
// picks from primary surfacing when outside winter-tire season, and (b)
// brief Claude on the date so seasonal language ("for spring driving") and
// the "don't pitch winters in May" rule are calibrated correctly.
//
// Canadian retailer: winter-tire season ≈ Oct 15 – Apr 15 (lines up with
// BC/QC legal winter-tire-required windows + common all-season practice).
// Optional override via `now` param for tests.
export function getTireSeasonContext(now) {
  const d = now instanceof Date ? now : new Date();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  let season;
  if (month >= 3 && month <= 5) season = 'spring';
  else if (month >= 6 && month <= 8) season = 'summer';
  else if (month >= 9 && month <= 11) season = 'fall';
  else season = 'winter';
  const isWinterSeason =
    (month === 10 && day >= 15) ||
    month === 11 ||
    month === 12 ||
    month === 1 ||
    month === 2 ||
    month === 3 ||
    (month === 4 && day <= 15);
  return {
    season,
    isWinterSeason,
    iso_date: d.toISOString().slice(0, 10),
    month,
    day
  };
}

// Auto-primary pick: the item we want the prompt to LEAD with by default.
// Priority:
//   1. Season-appropriate (drop winter-only when not winter season)
//   2. In stock locally (homeStock.qty > 0)
//   3. House brand (iLink)
//   4. Otherwise top-ranked surfaced pick that meets (1) + (2).
// Returns null if no pick meets criteria — variants fall back to
// reference-by-name behavior without a "lead with this" instruction.
export function selectAutoPrimary({ ilink_items = [], brand_requested_items = [], other_items = [], seasonContext }) {
  const seasonOk = (it) => !it.winterOnly || (seasonContext && seasonContext.isWinterSeason);
  const inStockLocal = (it) => it.homeStock && it.homeStock.qty > 0;
  const inStockAnywhere = (it) => (it.totalStock || 0) > 0 || (it.external || 0) > 0;

  // 1. iLink + in-stock locally + season-ok
  const tier1 = ilink_items.find((it) => seasonOk(it) && inStockLocal(it));
  if (tier1) return tier1;

  // 2. Brand-requested + in-stock locally + season-ok (when customer named a brand)
  const tier2 = brand_requested_items.find((it) => seasonOk(it) && inStockLocal(it));
  if (tier2) return tier2;

  // 3. Other + in-stock locally + season-ok
  const tier3 = other_items.find((it) => seasonOk(it) && inStockLocal(it));
  if (tier3) return tier3;

  // 4. iLink + in-stock anywhere + season-ok (warehouse fallback)
  const tier4 = ilink_items.find((it) => seasonOk(it) && inStockAnywhere(it));
  if (tier4) return tier4;

  // 5. Last resort: top season-ok surfaced item
  const tier5 = [...ilink_items, ...brand_requested_items, ...other_items].find((it) => seasonOk(it));
  return tier5 || null;
}
