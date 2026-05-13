// Phase E.4 — fitment rules linking listing product type → compatible
// vehicle categories. Used by detectFitmentMismatch in wrongProduct.js.
//
// Conservative by design: we only flag mismatch when BOTH listing info
// AND vehicle info are confident. Ambiguity = no flag (let the LLM
// handle it as normal qualification).

// Vehicle keyword → coarse category. Multiple matches = multiple tags
// (e.g. "Ford F-150" tags as both "ford" and "truck").
export const VEHICLE_CATEGORY_KEYWORDS = [
  // Trailers — checked FIRST so "travel trailer" doesn't snag "trailer" alone
  { phrase: /\btravel\s+trailer\b/i, tags: ['trailer'] },
  { phrase: /\bfifth\s+wheel\b/i, tags: ['trailer'] },
  { phrase: /\b(toy\s+hauler|rv|camper)\b/i, tags: ['trailer'] },
  { phrase: /\btrailer\b/i, tags: ['trailer'] },

  // Full-size trucks (8-lug heavy duty)
  { phrase: /\b(f[\s-]?250|f[\s-]?350|f[\s-]?450|silverado\s*2500|silverado\s*3500|sierra\s*2500|sierra\s*3500|ram\s*2500|ram\s*3500)\b/i, tags: ['truck', 'truck_hd', 'truck_8lug'] },
  // Full-size trucks (6-lug 1500-class)
  { phrase: /\b(f[\s-]?150|silverado\s*1500|sierra\s*1500|tundra|titan|ram\s*1500)\b/i, tags: ['truck', 'truck_1500'] },
  // Mid-size trucks
  { phrase: /\b(tacoma|colorado|canyon|ranger|frontier|gladiator)\b/i, tags: ['truck', 'truck_midsize'] },

  // SUVs — truck-based vs unibody
  { phrase: /\b(suburban|tahoe|yukon|escalade|expedition|sequoia|4runner)\b/i, tags: ['suv', 'suv_truck_based'] },
  { phrase: /\b(jeep|wrangler|cherokee|grand\s+cherokee)\b/i, tags: ['suv', 'suv_truck_based', 'jeep'] },
  { phrase: /\b(highlander|pilot|cr[\s-]?v|rav[\s-]?4|crosstrek|outback|forester|ascent|legacy|cx-\d|rdx|mdx|x[3-7]|q[3-8])\b/i, tags: ['suv', 'suv_unibody', 'crossover'] },

  // Sports cars / coupes
  { phrase: /\b(mustang|camaro|challenger|charger|corvette|miata|brz|wrx|sti|gti|civic\s+si|civic\s+type\s+r|m[2-8](?:\s|$)|c63|amg|porsche|supra|nsx)\b/i, tags: ['car', 'sports_car', 'coupe'] },

  // Passenger cars (sedans, hatches, etc.)
  { phrase: /\b(civic|corolla|camry|accord|altima|sentra|maxima|prius|fusion|focus|sonata|elantra|optima|jetta|passat|legacy|impreza|3\s+series|5\s+series|a4|a6|tlx|ilx|tsx|tl|cla|c-?class|e-?class)\b/i, tags: ['car', 'sedan'] }
];

export const FITMENT_RULES = {
  // Bolt-pattern groups: canonical → compatible vehicle tags.
  // If the listing has bolt pattern X and the customer's vehicle tags
  // don't overlap with X's compatible set, fitment mismatch.
  bolt_pattern_compatibility: {
    '5x114.3':  ['car', 'sedan', 'sports_car', 'coupe', 'suv_unibody', 'crossover', 'truck_midsize'],
    '5x120':    ['car', 'sedan', 'sports_car', 'coupe', 'suv_unibody'],
    '5x108':    ['car', 'sedan'],
    '5x100':    ['car', 'sedan', 'sports_car'],
    '5x112':    ['car', 'sedan', 'sports_car', 'coupe'],
    '6x135':    ['truck', 'truck_1500'],  // Ford F-150 specifically
    '6x139.7':  ['truck', 'truck_1500', 'truck_midsize', 'suv_truck_based'],
    '8x165.1':  ['truck', 'truck_hd', 'truck_8lug'],
    '8x170':    ['truck', 'truck_hd', 'truck_8lug']  // Ford Super Duty
  },

  // Tire type → vehicle category match. Mismatch = wrong type for vehicle.
  tire_type_compatibility: {
    ST: ['trailer'],
    LT: ['truck', 'suv_truck_based'],
    P:  ['car', 'sedan', 'sports_car', 'coupe', 'suv_unibody', 'crossover'],
    // no-prefix passenger spec — same as P
    NONE: ['car', 'sedan', 'sports_car', 'coupe', 'suv_unibody', 'crossover', 'truck_midsize']
  },

  // Vehicle categories that should NOT be lifted via aftermarket
  // suspension lift kits. (Body lifts are handled by NOT_CARRIED.)
  lift_incompatible_categories: ['car', 'sedan', 'sports_car', 'coupe', 'trailer'],

  // Vehicle categories that should NOT have truck-specific wheels
  // (e.g. 20x12 negative-offset truck wheels). Sized for trucks, won't
  // fit passenger cars.
  truck_wheel_incompatible_categories: ['car', 'sedan', 'sports_car', 'coupe', 'trailer'],

  // Listing-text keywords that signal the listing is for a specific
  // product type. Used to determine what compatibility check to run.
  listing_type_keywords: [
    { phrase: /\blift\s+kit\b/i, type: 'lift_kit' },
    { phrase: /\bsuspension\s+lift\b/i, type: 'lift_kit' },
    { phrase: /\bleveling\s+kit\b/i, type: 'leveling_kit' },
    { phrase: /\b(?:tire|tires)\b/i, type: 'tires' },
    { phrase: /\b(?:wheel|wheels|rim|rims)\b/i, type: 'wheels' },
    { phrase: /\b(?:coilovers?|coil\s*overs?)\b/i, type: 'coilovers' }
  ]
};

// Classify a vehicle string (from captured_fields or current message)
// into a set of category tags. Returns an empty Set when no match.
export function classifyVehicle(text) {
  const tags = new Set();
  if (typeof text !== 'string' || !text) return tags;
  for (const { phrase, tags: addTags } of VEHICLE_CATEGORY_KEYWORDS) {
    if (phrase.test(text)) {
      for (const t of addTags) tags.add(t);
    }
  }
  return tags;
}

// Classify a listing string into a product type tag.
export function classifyListingType(listingTitle) {
  if (typeof listingTitle !== 'string' || !listingTitle) return null;
  for (const { phrase, type } of FITMENT_RULES.listing_type_keywords) {
    if (phrase.test(listingTitle)) return type;
  }
  return null;
}
