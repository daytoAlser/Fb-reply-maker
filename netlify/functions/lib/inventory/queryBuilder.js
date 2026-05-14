// Pure functions for building canadacustomautoworks.com search queries.
// Ported from the standalone ccaw-inventory-search extension's tokenizer
// (sidepanel.js lines 62-196) but narrowed to the tire-spec + brand path.

// CRITICAL: 'iLink' was missing from the original KNOWN_BRANDS array. Adding
// it here is required for brand-named customer messages like "got any iLink
// in 265/65R18?" to detect properly.
export const KNOWN_BRANDS = [
  'iLink',
  'Armed Street', 'Armed Off-Road', 'Armed Syndicate', 'American Racing',
  'Black Rhino', 'Foose', 'Fuel', 'Helo', 'KMC', 'Motegi Racing', 'Moto Metal',
  'Niche', 'Petrol', 'Rotiform', 'TSW', 'US Mags', 'XD', 'Method', 'Vision',
  'Mickey Thompson', 'Toyo', 'BFGoodrich', 'Nitto', 'Falken', 'General',
  'Cooper', 'Goodyear', 'Michelin', 'Pirelli', 'Continental', 'Hankook',
  'Yokohama', 'Bridgestone', 'Dunlop', 'Sailun', 'Atturo', 'Maxxis',
  'Suretrac'
];

const SINGLE_WORD_BRANDS = [
  'iLink', 'Fuel', 'Foose', 'Helo', 'KMC', 'Niche', 'Petrol', 'Rotiform',
  'TSW', 'XD', 'Toyo', 'Nitto', 'Falken', 'Cooper', 'Goodyear', 'Michelin',
  'Pirelli', 'Continental', 'Hankook', 'Yokohama', 'Bridgestone', 'Dunlop',
  'Sailun', 'Atturo', 'Maxxis', 'Method', 'Vision', 'Suretrac'
];

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

// Scans a customer message for a known brand. Multi-word brands are checked
// first (longest-first ordering) so "Armed Off-Road" doesn't lose to "Armed".
// Returns the canonical-cased brand string from KNOWN_BRANDS or null.
export function extractBrandFromMessage(message) {
  if (typeof message !== 'string' || !message.trim()) return null;
  const sortedBrands = [...KNOWN_BRANDS].sort((a, b) => b.length - a.length);
  for (const brand of sortedBrands) {
    const brandLower = brand.toLowerCase();
    const brandRe = new RegExp(`\\b${escapeForRegex(brandLower)}\\b`, 'i');
    if (brandRe.test(message)) return brand;
  }
  // Single-word fallback for tokens that might have been split by separators.
  for (const brand of SINGLE_WORD_BRANDS) {
    const re = new RegExp(`\\b${escapeForRegex(brand.toLowerCase())}\\b`, 'i');
    if (re.test(message)) return brand;
  }
  return null;
}

// Builds a query string for the CCAW search API given a tire spec and an
// optional brand string. tireSpec accepts either the normalize.js shape
// ({ width, aspect, diameter }) or a raw string ("265/65R18"); strings are
// parsed with the same regex normalize.js uses.
//
// Examples:
//   { tireSpec: { width:265, aspect:65, diameter:18 } }      -> "265/65R18"
//   { tireSpec: { width:265, aspect:65, diameter:18 },
//     brand: 'Toyo' }                                         -> "265/65R18 Toyo"
//   { tireSpec: "265/65R18", brand: 'iLink' }                -> "265/65R18 iLink"
export function buildTireQuery({ tireSpec, brand } = {}) {
  const parts = [];
  const spec = normalizeTireSpec(tireSpec);
  if (spec) parts.push(`${spec.width}/${spec.aspect}R${spec.diameter}`);
  if (brand && typeof brand === 'string' && brand.trim()) parts.push(brand.trim());
  return parts.join(' ').trim();
}

// Accepts the various shapes a tire-size value can show up in:
//   - object from normalize.js: { width, aspect, diameter, ... }
//   - raw string: "265/65R18" / "LT265/65R18" / "265 / 65 R 18"
// Returns { width, aspect, diameter } or null.
export function normalizeTireSpec(spec) {
  if (!spec) return null;
  if (typeof spec === 'object') {
    if (typeof spec.width === 'number' && typeof spec.aspect === 'number' && typeof spec.diameter === 'number') {
      return { width: spec.width, aspect: spec.aspect, diameter: spec.diameter };
    }
    return null;
  }
  if (typeof spec !== 'string') return null;
  const m = spec.match(/\b(?:ST|LT|P)?(\d{3})\s*\/\s*(\d{2})\s*R?\s*(\d{2})\b/i);
  if (!m) return null;
  return {
    width: parseInt(m[1], 10),
    aspect: parseInt(m[2], 10),
    diameter: parseInt(m[3], 10)
  };
}

// Canonical "265/65R18" string for logging / fired_from_size.
export function formatTireSpec(spec) {
  const n = normalizeTireSpec(spec);
  if (!n) return null;
  return `${n.width}/${n.aspect}R${n.diameter}`;
}
