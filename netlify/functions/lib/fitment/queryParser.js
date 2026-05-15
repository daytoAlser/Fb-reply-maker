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

// Model -> make fallback. Used when the AI extractor returns a vehicle
// string WITHOUT the make ("2017 Q60", "2020 F-150", "Civic"). RideStyler's
// search needs at least make+model to resolve a year-specific variant
// — "q60" alone returns 0 Descriptions even though the popup README
// says partial model names work. This map handles the gap.
//
// Strategy: model name -> canonical make. Lookup is case-insensitive
// and tries both raw and separator-stripped forms ("f-150" and "f150").
// Only include models that are UNIQUE to one make. Generic trim names
// like "Sport", "Touring", "GT" are excluded.
const MODEL_TO_MAKE = {
  // Infiniti
  'q50': 'infiniti', 'q60': 'infiniti', 'q70': 'infiniti',
  'qx50': 'infiniti', 'qx55': 'infiniti', 'qx60': 'infiniti', 'qx80': 'infiniti',
  'g35': 'infiniti', 'g37': 'infiniti', 'fx35': 'infiniti', 'fx45': 'infiniti',
  // Lexus
  'rx': 'lexus', 'rx350': 'lexus', 'rx450': 'lexus', 'is': 'lexus', 'is250': 'lexus', 'is350': 'lexus',
  'es': 'lexus', 'es350': 'lexus', 'ls': 'lexus', 'gx': 'lexus', 'gx460': 'lexus',
  'nx': 'lexus', 'nx300': 'lexus', 'lx': 'lexus', 'lx570': 'lexus', 'lc': 'lexus', 'rc': 'lexus',
  // Acura
  'tlx': 'acura', 'mdx': 'acura', 'rdx': 'acura', 'ilx': 'acura', 'tsx': 'acura',
  'tl': 'acura', 'rl': 'acura', 'integra': 'acura', 'nsx': 'acura',
  // Ford
  'f150': 'ford', 'f-150': 'ford', 'f250': 'ford', 'f-250': 'ford',
  'f350': 'ford', 'f-350': 'ford', 'f450': 'ford', 'f-450': 'ford',
  'mustang': 'ford', 'bronco': 'ford', 'ranger': 'ford', 'edge': 'ford',
  'escape': 'ford', 'explorer': 'ford', 'expedition': 'ford', 'fusion': 'ford',
  'focus': 'ford', 'fiesta': 'ford', 'taurus': 'ford', 'flex': 'ford',
  'ecosport': 'ford', 'maverick': 'ford', 'lightning': 'ford', 'transit': 'ford',
  // Chevrolet
  'silverado': 'chevrolet', 'colorado': 'chevrolet', 'tahoe': 'chevrolet',
  'suburban': 'chevrolet', 'equinox': 'chevrolet', 'traverse': 'chevrolet',
  'malibu': 'chevrolet', 'camaro': 'chevrolet', 'corvette': 'chevrolet',
  'cruze': 'chevrolet', 'impala': 'chevrolet', 'sonic': 'chevrolet',
  'spark': 'chevrolet', 'trax': 'chevrolet', 'trailblazer': 'chevrolet',
  'blazer': 'chevrolet', 'avalanche': 'chevrolet', 'hhr': 'chevrolet',
  // GMC
  'sierra': 'gmc', 'canyon': 'gmc', 'yukon': 'gmc', 'terrain': 'gmc',
  'acadia': 'gmc', 'envoy': 'gmc',
  // Toyota
  'tacoma': 'toyota', 'tundra': 'toyota', '4runner': 'toyota', 'sequoia': 'toyota',
  'camry': 'toyota', 'corolla': 'toyota', 'rav4': 'toyota', 'highlander': 'toyota',
  'avalon': 'toyota', 'prius': 'toyota', 'sienna': 'toyota', 'venza': 'toyota',
  'matrix': 'toyota', 'yaris': 'toyota', 'c-hr': 'toyota', 'chr': 'toyota',
  'supra': 'toyota', 'gr86': 'toyota',
  // Honda
  'civic': 'honda', 'accord': 'honda', 'crv': 'honda', 'cr-v': 'honda',
  'pilot': 'honda', 'ridgeline': 'honda', 'odyssey': 'honda', 'hrv': 'honda',
  'hr-v': 'honda', 'passport': 'honda', 'element': 'honda', 'fit': 'honda',
  'insight': 'honda', 'crosstour': 'honda', 's2000': 'honda',
  // Nissan
  'altima': 'nissan', 'sentra': 'nissan', 'rogue': 'nissan', 'pathfinder': 'nissan',
  'murano': 'nissan', 'frontier': 'nissan', 'titan': 'nissan', 'maxima': 'nissan',
  'armada': 'nissan', 'versa': 'nissan', 'cube': 'nissan', 'juke': 'nissan',
  'kicks': 'nissan', 'leaf': 'nissan', 'xterra': 'nissan', '350z': 'nissan', '370z': 'nissan',
  // Jeep
  'wrangler': 'jeep', 'gladiator': 'jeep', 'cherokee': 'jeep', 'grand cherokee': 'jeep',
  'compass': 'jeep', 'renegade': 'jeep', 'patriot': 'jeep', 'liberty': 'jeep',
  'commander': 'jeep', 'wagoneer': 'jeep',
  // Dodge
  'charger': 'dodge', 'challenger': 'dodge', 'durango': 'dodge', 'journey': 'dodge',
  'caliber': 'dodge', 'nitro': 'dodge', 'avenger': 'dodge', 'dart': 'dodge',
  // Chrysler
  '300': 'chrysler', 'pacifica': 'chrysler', 'sebring': 'chrysler', 'aspen': 'chrysler',
  // Mazda
  'mazda3': 'mazda', 'mazda6': 'mazda', 'cx-3': 'mazda', 'cx3': 'mazda',
  'cx-5': 'mazda', 'cx5': 'mazda', 'cx-9': 'mazda', 'cx9': 'mazda',
  'cx-30': 'mazda', 'cx30': 'mazda', 'cx-50': 'mazda', 'cx50': 'mazda',
  'mx-5': 'mazda', 'mx5': 'mazda', 'mx-30': 'mazda', 'miata': 'mazda',
  // Subaru
  'forester': 'subaru', 'outback': 'subaru', 'crosstrek': 'subaru', 'impreza': 'subaru',
  'wrx': 'subaru', 'sti': 'subaru', 'legacy': 'subaru', 'ascent': 'subaru',
  'tribeca': 'subaru', 'brz': 'subaru', 'baja': 'subaru',
  // Hyundai
  'tucson': 'hyundai', 'santa fe': 'hyundai', 'santafe': 'hyundai', 'elantra': 'hyundai',
  'sonata': 'hyundai', 'kona': 'hyundai', 'palisade': 'hyundai', 'venue': 'hyundai',
  'accent': 'hyundai', 'veloster': 'hyundai', 'genesis coupe': 'hyundai',
  'ioniq': 'hyundai', 'azera': 'hyundai',
  // Kia
  'sorento': 'kia', 'sportage': 'kia', 'forte': 'kia', 'optima': 'kia',
  'soul': 'kia', 'telluride': 'kia', 'seltos': 'kia', 'rio': 'kia',
  'stinger': 'kia', 'cadenza': 'kia', 'k5': 'kia', 'k900': 'kia',
  'sedona': 'kia', 'carnival': 'kia', 'niro': 'kia', 'ev6': 'kia',
  // Volkswagen
  'jetta': 'volkswagen', 'tiguan': 'volkswagen', 'atlas': 'volkswagen',
  'golf': 'volkswagen', 'passat': 'volkswagen', 'beetle': 'volkswagen',
  'taos': 'volkswagen', 'arteon': 'volkswagen', 'cc': 'volkswagen',
  'eos': 'volkswagen', 'routan': 'volkswagen', 'touareg': 'volkswagen',
  'id4': 'volkswagen', 'id.4': 'volkswagen',
  // BMW (use the model designator only — most BMWs have unique names)
  'x1': 'bmw', 'x2': 'bmw', 'x3': 'bmw', 'x4': 'bmw', 'x5': 'bmw', 'x6': 'bmw', 'x7': 'bmw',
  'z4': 'bmw', 'i3': 'bmw', 'i4': 'bmw', 'i8': 'bmw', 'ix': 'bmw',
  // Audi
  'a3': 'audi', 'a4': 'audi', 'a5': 'audi', 'a6': 'audi', 'a7': 'audi', 'a8': 'audi',
  'q3': 'audi', 'q5': 'audi', 'q7': 'audi', 'q8': 'audi',
  's3': 'audi', 's4': 'audi', 's5': 'audi', 's6': 'audi', 's7': 'audi', 's8': 'audi',
  'rs3': 'audi', 'rs5': 'audi', 'rs6': 'audi', 'rs7': 'audi',
  'tt': 'audi', 'r8': 'audi', 'e-tron': 'audi', 'etron': 'audi',
  // Mercedes-Benz
  'c-class': 'mercedes-benz', 'cclass': 'mercedes-benz',
  'e-class': 'mercedes-benz', 'eclass': 'mercedes-benz',
  's-class': 'mercedes-benz', 'sclass': 'mercedes-benz',
  'glc': 'mercedes-benz', 'gle': 'mercedes-benz', 'gls': 'mercedes-benz',
  'gla': 'mercedes-benz', 'glb': 'mercedes-benz', 'glk': 'mercedes-benz',
  'sl': 'mercedes-benz', 'slc': 'mercedes-benz', 'slk': 'mercedes-benz',
  'cla': 'mercedes-benz', 'cls': 'mercedes-benz',
  // MINI
  'cooper': 'mini', 'clubman': 'mini', 'countryman': 'mini',
  // Cadillac
  'escalade': 'cadillac', 'cts': 'cadillac', 'ats': 'cadillac', 'xts': 'cadillac',
  'srx': 'cadillac', 'xt4': 'cadillac', 'xt5': 'cadillac', 'xt6': 'cadillac',
  'ct4': 'cadillac', 'ct5': 'cadillac', 'ct6': 'cadillac', 'deville': 'cadillac',
  'sts': 'cadillac', 'dts': 'cadillac',
  // Lincoln
  'navigator': 'lincoln', 'aviator': 'lincoln', 'nautilus': 'lincoln',
  'corsair': 'lincoln', 'mkz': 'lincoln', 'mks': 'lincoln', 'mkx': 'lincoln',
  'mkc': 'lincoln', 'mkt': 'lincoln', 'continental': 'lincoln', 'town car': 'lincoln',
  // Buick
  'enclave': 'buick', 'lacrosse': 'buick', 'verano': 'buick', 'regal': 'buick',
  'envision': 'buick', 'encore': 'buick',
  // Mitsubishi
  'outlander': 'mitsubishi', 'lancer': 'mitsubishi', 'eclipse': 'mitsubishi',
  'mirage': 'mitsubishi', 'rvr': 'mitsubishi', 'galant': 'mitsubishi',
  'endeavor': 'mitsubishi', 'montero': 'mitsubishi',
  // Genesis
  'g70': 'genesis', 'g80': 'genesis', 'g90': 'genesis',
  'gv70': 'genesis', 'gv80': 'genesis',
  // Porsche
  'cayenne': 'porsche', 'macan': 'porsche', 'panamera': 'porsche', 'taycan': 'porsche',
  '911': 'porsche', 'boxster': 'porsche', 'cayman': 'porsche',
  // Tesla
  'model s': 'tesla', 'models': 'tesla', 'model 3': 'tesla', 'model3': 'tesla',
  'model x': 'tesla', 'modelx': 'tesla', 'model y': 'tesla', 'modely': 'tesla',
  // Volvo
  'xc40': 'volvo', 'xc60': 'volvo', 'xc70': 'volvo', 'xc90': 'volvo',
  's60': 'volvo', 's80': 'volvo', 's90': 'volvo', 'v60': 'volvo', 'v70': 'volvo', 'v90': 'volvo',
  // Land Rover
  'range rover': 'land-rover', 'rangerover': 'land-rover',
  'discovery': 'land-rover', 'defender': 'land-rover', 'lr3': 'land-rover', 'lr4': 'land-rover',
  // Jaguar
  'xf': 'jaguar', 'xj': 'jaguar', 'xe': 'jaguar', 'f-pace': 'jaguar', 'fpace': 'jaguar',
  'e-pace': 'jaguar', 'epace': 'jaguar', 'i-pace': 'jaguar', 'ipace': 'jaguar',
  'f-type': 'jaguar', 'ftype': 'jaguar',
  // Maserati
  'ghibli': 'maserati', 'levante': 'maserati', 'quattroporte': 'maserati',
  'granturismo': 'maserati',
  // Fiat
  '500': 'fiat', '500x': 'fiat', '500l': 'fiat', '124 spider': 'fiat',
  // Alfa Romeo
  'giulia': 'alfa-romeo', 'stelvio': 'alfa-romeo', '4c': 'alfa-romeo',
  // Rivian
  'r1t': 'rivian', 'r1s': 'rivian',
  // Lucid
  'air': 'lucid'
};

function inferMakeFromModel(modelText) {
  if (!modelText) return null;
  const norm = String(modelText).toLowerCase().trim();
  if (!norm) return null;
  // 1. Direct match against full model text
  if (MODEL_TO_MAKE[norm]) return MODEL_TO_MAKE[norm];
  // 2. Match against separator-stripped form (handles "f-150" vs "f150")
  const stripped = norm.replace(/[-\s]/g, '');
  if (MODEL_TO_MAKE[stripped]) return MODEL_TO_MAKE[stripped];
  // 3. Match first word only (handles "q60 sport", "f-150 4wd")
  const firstWord = norm.split(/\s+/)[0];
  if (firstWord && MODEL_TO_MAKE[firstWord]) return MODEL_TO_MAKE[firstWord];
  // 4. First word, separator-stripped
  const firstStripped = firstWord ? firstWord.replace(/[-\s]/g, '') : '';
  if (firstStripped && MODEL_TO_MAKE[firstStripped]) return MODEL_TO_MAKE[firstStripped];
  // 5. Two-word match (handles "santa fe", "grand cherokee", "model 3")
  const firstTwo = norm.split(/\s+/).slice(0, 2).join(' ');
  if (firstTwo && MODEL_TO_MAKE[firstTwo]) return MODEL_TO_MAKE[firstTwo];
  return null;
}

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

  let rem = text;
  if (year) rem = rem.replace(new RegExp('\\b' + year + '\\b', 'g'), ' ');
  if (makeRaw) rem = rem.replace(new RegExp('\\b' + makeRaw.replace(/[-\s]/g, '[-\\s]') + '\\b', 'g'), ' ');
  rem = rem.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  const model = rem || null;

  // Make wasn't in the input — try to infer it from the model. Handles
  // the common "2017 Q60" / "F-150" / "Civic" case where the AI extractor
  // returns the model without the manufacturer. Critical: RideStyler's
  // GetDescriptions needs make+model for year-specific resolution; a
  // bare "q60" returns 0 Descriptions.
  let inferredFromModel = false;
  if (!make && model) {
    const inferred = inferMakeFromModel(model);
    if (inferred) {
      make = inferred;
      inferredFromModel = true;
    }
  }

  const canonicalMake = make ? make.replace(/\s+/g, '-') : null;

  const searchString = [year, canonicalMake ? canonicalMake.replace(/-/g, ' ') : null, model]
    .filter(Boolean).join(' ');
  return { year, make: canonicalMake, model, searchString, makeInferredFromModel: inferredFromModel };
}
