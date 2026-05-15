// Vehicle string normalizer — ported from fitment-xref-v3.2.0/popup.js
// (lines 126-178). Pulls year/make/model out of free-text input and emits
// a canonical search string for RideStyler's GetDescriptions endpoint.
//
// Examples:
//   "2019 Infiniti Q60"        -> { year: "2019", make: "infiniti", model: "q60", searchString: "2019 infiniti q60" }
//   "F-150 Ford 2020"          -> { year: "2020", make: "ford",     model: "f-150", searchString: "2020 ford f-150" }
//   "chevy silverado 1500 24"  -> year null, make "chevrolet", model "silverado 1500 24"

const MAKE_ALIASES = {
  chevy: 'chevrolet', vw: 'volkswagen', mercedes: 'mercedes-benz',
  mb: 'mercedes-benz', caddy: 'cadillac', beemer: 'bmw', bimmer: 'bmw',
  subi: 'subaru', subbie: 'subaru'
};

const KNOWN_MAKES = [
  'mercedes-benz', 'mercedes benz', 'alfa-romeo', 'alfa romeo', 'land-rover', 'land rover',
  'acura', 'audi', 'bmw', 'buick', 'cadillac', 'chevrolet', 'chevy', 'chrysler',
  'dodge', 'fiat', 'ford', 'gmc', 'honda', 'hyundai', 'infiniti', 'jaguar', 'jeep',
  'kia', 'lexus', 'lincoln', 'mazda', 'mini', 'mitsubishi', 'nissan', 'porsche',
  'ram', 'subaru', 'tesla', 'toyota', 'volkswagen', 'vw', 'volvo', 'maserati',
  'genesis', 'rivian', 'lucid', 'polestar', 'smart', 'scion', 'saturn', 'pontiac',
  'hummer', 'suzuki', 'isuzu', 'mercedes', 'mb', 'beemer', 'bimmer', 'caddy', 'subi', 'subbie'
];

export function parseVehicleQuery(input) {
  const text = String(input || '').toLowerCase().trim();
  if (!text) return { year: null, make: null, model: null, searchString: '' };

  const yearMatch = text.match(/\b(19[8-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? yearMatch[1] : null;

  const sorted = [...KNOWN_MAKES].sort((a, b) => b.length - a.length);
  let make = null;
  let makeRaw = null;
  for (const m of sorted) {
    const re = new RegExp('\\b' + m.replace(/[-\s]/g, '[-\\s]') + '\\b');
    if (re.test(text)) { makeRaw = m; make = m; break; }
  }
  if (!makeRaw) {
    const words = text.split(/\s+/).filter(w => w.length >= 3 && /^[a-z]/.test(w));
    for (const m of sorted) {
      const mNorm = m.replace(/[-\s]/g, '');
      for (const w of words) {
        if (mNorm.startsWith(w) && w.length >= 3 && w.length < mNorm.length) {
          makeRaw = w; make = m; break;
        }
      }
      if (makeRaw) break;
    }
  }
  if (make && MAKE_ALIASES[make]) make = MAKE_ALIASES[make];
  const canonicalMake = make ? make.replace(/\s+/g, '-') : null;

  let rem = text;
  if (year) rem = rem.replace(new RegExp('\\b' + year + '\\b', 'g'), ' ');
  if (makeRaw) rem = rem.replace(new RegExp('\\b' + makeRaw.replace(/[-\s]/g, '[-\\s]') + '\\b', 'g'), ' ');
  rem = rem.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  const model = rem || null;

  const searchString = [year, canonicalMake ? canonicalMake.replace(/-/g, ' ') : null, model]
    .filter(Boolean).join(' ');
  return { year, make: canonicalMake, model, searchString };
}
