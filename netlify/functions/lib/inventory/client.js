// Live inventory client for canadacustomautoworks.com.
// Ported from the standalone ccaw-inventory-search extension's background
// service worker (background.js lines 4-165). The chrome.runtime.onMessage
// wrapper is dropped — this is called directly by the interpretation phase.
//
// Public API:
//   - LOCATIONS, SORT_FIELDS                   (constants)
//   - buildSortString(homeLocationKey)         (homeLocation-first sort)
//   - searchInventory(query, options)          (live API call, returns cleaned)
//   - cleanResponse / cleanItem                (response normalizers)
//   - homeLocationKeyFromName(name)            (location-name -> sort key)
//   - homeLocationShortFromName(name)          (location-name -> short code)

const API_BASE = 'https://www.canadacustomautoworks.com/api/items';

export const SORT_FIELDS = [
  'custitem_red_deer_int_ecomm_inv:desc',
  'custitem_calgary_int_ecomm_inv:desc',
  'custitem_edmonton_int_ecomm_inv:desc',
  'custitem_airdrie_int_ecomm_inv:desc',
  'custitem_ft_sask_int_ecomm_inv:desc',
  'custitem_grande_prairie_int_ecomm_inv:desc',
  'custitem_lloydminster_int_ecomm_inv:desc',
  'custitem_regina_int_ecomm_inv:desc',
  'custitem_saskatoon_int_ecomm_inv:desc',
  'custitem_spruce_grove_int_ecomm_inv:desc',
  'custitem_westbank_int_ecomm_inv:desc',
  'custitem_kamloops_int_ecomm_inv:desc',
  'custitem_lethbridge_int_ecomm_inv:desc',
  'custitem_medicine_hat_int_ecomm_inv:desc',
  'custitem_fedco_int_ecomm_inv:desc',
  'custitem_external_inventory_count:desc',
  'relevance:desc'
];

export const LOCATIONS = [
  { key: 'custitem_red_deer_int_ecomm_inv', name: 'Red Deer', short: 'RD' },
  { key: 'custitem_calgary_int_ecomm_inv', name: 'Calgary', short: 'CAL' },
  { key: 'custitem_edmonton_int_ecomm_inv', name: 'Edmonton', short: 'EDM' },
  { key: 'custitem_airdrie_int_ecomm_inv', name: 'Airdrie', short: 'AIR' },
  { key: 'custitem_ft_sask_int_ecomm_inv', name: 'Fort Sask', short: 'FTS' },
  { key: 'custitem_grande_prairie_int_ecomm_inv', name: 'Grande Prairie', short: 'GP' },
  { key: 'custitem_lloydminster_int_ecomm_inv', name: 'Lloydminster', short: 'LLD' },
  { key: 'custitem_regina_int_ecomm_inv', name: 'Regina', short: 'REG' },
  { key: 'custitem_saskatoon_int_ecomm_inv', name: 'Saskatoon', short: 'SAS' },
  { key: 'custitem_spruce_grove_int_ecomm_inv', name: 'Spruce Grove', short: 'SG' },
  // The canonical NetSuite field key is "westbank" but the customer-facing
  // name is "Kelowna". Accept both spellings in the name->key/short lookups.
  { key: 'custitem_westbank_int_ecomm_inv', name: 'Kelowna', short: 'KEL' },
  { key: 'custitem_kamloops_int_ecomm_inv', name: 'Kamloops', short: 'KAM' },
  { key: 'custitem_lethbridge_int_ecomm_inv', name: 'Lethbridge', short: 'LTH' },
  { key: 'custitem_medicine_hat_int_ecomm_inv', name: 'Medicine Hat', short: 'MH' },
  { key: 'custitem_fedco_int_ecomm_inv', name: 'Fedco', short: 'FED' }
];

const LEGACY_NAME_ALIASES = {
  westbank: 'custitem_westbank_int_ecomm_inv',
  kelowna: 'custitem_westbank_int_ecomm_inv',
  'fort saskatchewan': 'custitem_ft_sask_int_ecomm_inv',
  'fort sask': 'custitem_ft_sask_int_ecomm_inv'
};

export function homeLocationKeyFromName(name) {
  if (!name || typeof name !== 'string') return null;
  const lc = name.trim().toLowerCase();
  if (!lc) return null;
  if (LEGACY_NAME_ALIASES[lc]) return LEGACY_NAME_ALIASES[lc];
  const hit = LOCATIONS.find((l) => l.name.toLowerCase() === lc);
  return hit ? hit.key : null;
}

export function homeLocationShortFromName(name) {
  if (!name || typeof name !== 'string') return null;
  const lc = name.trim().toLowerCase();
  if (!lc) return null;
  if (lc === 'westbank' || lc === 'kelowna') return 'KEL';
  if (lc === 'fort saskatchewan' || lc === 'fort sask') return 'FTS';
  const hit = LOCATIONS.find((l) => l.name.toLowerCase() === lc);
  return hit ? hit.short : null;
}

export function buildSortString(homeLocationKey) {
  if (!homeLocationKey) return SORT_FIELDS.join(',');
  const reordered = [
    `${homeLocationKey}:desc`,
    ...SORT_FIELDS.filter((s) => !s.startsWith(homeLocationKey))
  ];
  return reordered.join(',');
}

export async function searchInventory(query, options = {}) {
  const { homeLocation = null, limit = 100, offset = 0, signal = undefined } = options;

  const params = new URLSearchParams({
    c: '5473735',
    country: 'CA',
    currency: 'CAD',
    fieldset: 'search',
    include: 'facets',
    language: 'en',
    limit: String(limit),
    n: '2',
    offset: String(offset),
    pricelevel: '5',
    q: query,
    sort: buildSortString(homeLocation),
    use_pcv: 'F'
  });

  const url = `${API_BASE}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'X-SC-Touchpoint': 'shopping'
      },
      signal
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    return { ok: true, data: cleanResponse(data) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

export function cleanResponse(data) {
  const items = (data.items || []).map(cleanItem);
  return {
    total: data.total || 0,
    items,
    facets: data.facets || []
  };
}

export function cleanItem(item) {
  const stock = LOCATIONS.map((loc) => ({
    name: loc.name,
    short: loc.short,
    qty: Number(item[loc.key] || 0)
  }));

  const totalStock = stock.reduce((sum, s) => sum + s.qty, 0);
  const external = Number(item.custitem_external_inventory_count || 0);

  let imageUrl = null;
  let allImages = [];
  try {
    const findUrls = (obj, urls) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.url && typeof obj.url === 'string') urls.push(obj.url);
      for (const k of Object.keys(obj)) findUrls(obj[k], urls);
    };
    findUrls(item.itemimages_detail, allImages);
    allImages = [...new Set(allImages)];
    imageUrl = allImages[0] || null;
  } catch (e) {}

  return {
    internalId: item.internalid,
    sku: item.itemid || '',
    name: item.displayname || item.storedisplayname2 || '',
    brand: item.custitem_sdb_rs_item_brand || item.custitemcust_brand || '',
    model: item.custitem_sdb_rs_item_model || item.custitem1 || '',
    finish: item.custitem_sdb_rs_item_finish || item.custitemcust_finish || '',
    productType: item.custitemrs_p_parent_product_type || '',
    classification: item.class || '',
    price: Number(item.onlinecustomerprice || 0),
    priceFormatted: item.onlinecustomerprice_formatted || '',
    image: imageUrl,
    allImages,
    url: item.urlcomponent ? `https://www.canadacustomautoworks.com/${item.urlcomponent}` : null,
    inStock: !!item.isinstock,
    purchasable: !!item.ispurchasable,
    backorderable: !!item.isbackorderable,
    specs: {
      diameter: item.custitemrs_wheel_diameter_min || null,
      width: item.custitem_sdb_wheel_width_filter || null,
      offsetMin: item.custitemrs_wheel_offset_min || null,
      offsetMax: item.custitemrs_wheel_offset_max || null,
      hubBore: item.custitem_sdb_wheel_centerbore_filter || null,
      tireSize: item.custitemrs_tire_size || '',
      tireQuickSize: item.custitemrs_p_tire_quicksize || ''
    },
    rawDescription: item.storedescription || '',
    stock: {
      byLocation: stock,
      total: totalStock,
      external
    }
  };
}
