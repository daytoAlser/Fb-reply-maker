// Phase E.6 — static lookup tables for the interpretation layer.
// Pure data; no behavior. normalize.js and interpret.js consume these.

// ── Bolt-pattern aliases ────────────────────────────────────────────
//
// Customers write bolt patterns in many forms — millimeter (5x114.3),
// inch (5x4.5), inch-with-trailing-zero (5x4.50), inch-decimal-shorthand
// (5-1.44, which is 4.5"/3.14 inches), or with dashes instead of "x".
// We resolve everything to canonical millimeter form for downstream use.
//
// Each entry: { match, canonical, confidence, ambiguous? }
//   match     — exact lowercased string after the digit-form normalizer
//               in normalize.js (e.g. "5x4.5", "5x114"). DO NOT include
//               separators other than "x"; the normalizer rewrites "-"
//               and " " to "x" before lookup.
//   canonical — string written into interpretation.bolt_pattern.canonical
//   confidence — 0..1, hint to prompt for hedging vs. asserting
//   ambiguous — if true, normalizer flags for clarification
export const BOLT_PATTERN_ALIASES = [
  // 5-bolt — exact mm forms
  { match: '5x114.3',  canonical: '5x114.3', confidence: 1.0 },
  { match: '5x114',    canonical: '5x114.3', confidence: 0.9 }, // typo for .3
  { match: '5x100',    canonical: '5x100',   confidence: 1.0 },
  { match: '5x105',    canonical: '5x105',   confidence: 1.0 },
  { match: '5x108',    canonical: '5x108',   confidence: 1.0 },
  { match: '5x110',    canonical: '5x110',   confidence: 1.0 },
  { match: '5x112',    canonical: '5x112',   confidence: 1.0 },
  { match: '5x120',    canonical: '5x120',   confidence: 1.0 },
  { match: '5x120.65', canonical: '5x120.65', confidence: 1.0 },
  { match: '5x127',    canonical: '5x127',   confidence: 1.0 },
  { match: '5x130',    canonical: '5x130',   confidence: 1.0 },
  { match: '5x139.7',  canonical: '5x139.7', confidence: 1.0 },
  // 5-bolt — inch forms (4.25"=107.95, 4.5"=114.3, 4.75"=120.65, 5"=127, 5.5"=139.7)
  { match: '5x4.25',   canonical: '5x107.95', confidence: 0.95 },
  { match: '5x4.5',    canonical: '5x114.3', confidence: 1.0 },
  { match: '5x4.50',   canonical: '5x114.3', confidence: 1.0 },
  { match: '5x4.75',   canonical: '5x120.65', confidence: 1.0 },
  { match: '5x5',      canonical: '5x127',   confidence: 0.95 },
  { match: '5x5.0',    canonical: '5x127',   confidence: 1.0 },
  { match: '5x5.5',    canonical: '5x139.7', confidence: 1.0 },
  // 5-bolt inch-decimal shorthand (1.44 ≈ 4.5"/π — community shorthand)
  { match: '5x1.44',   canonical: '5x114.3', confidence: 0.85 },
  // 6-bolt — mm
  { match: '6x114.3',  canonical: '6x114.3', confidence: 1.0 },
  { match: '6x120',    canonical: '6x120',   confidence: 1.0 },
  { match: '6x132',    canonical: '6x132',   confidence: 1.0 },
  { match: '6x135',    canonical: '6x135',   confidence: 1.0 },
  { match: '6x139.7',  canonical: '6x139.7', confidence: 1.0 },
  // 6-bolt — inch
  { match: '6x4.5',    canonical: '6x114.3', confidence: 1.0 },
  { match: '6x5.5',    canonical: '6x139.7', confidence: 1.0 },
  // 8-bolt — mm
  { match: '8x165.1',  canonical: '8x165.1', confidence: 1.0 },
  { match: '8x170',    canonical: '8x170',   confidence: 1.0 },
  { match: '8x180',    canonical: '8x180',   confidence: 1.0 },
  { match: '8x200',    canonical: '8x200',   confidence: 1.0 },
  // 8-bolt — inch
  { match: '8x6.5',    canonical: '8x165.1', confidence: 1.0 },
  // 4-bolt — mm
  { match: '4x100',    canonical: '4x100',   confidence: 1.0 },
  { match: '4x108',    canonical: '4x108',   confidence: 1.0 },
  { match: '4x114.3',  canonical: '4x114.3', confidence: 1.0 }
];

// Bare bolt-count mentions ("6 bolt", "5 lug", "8 lug") are ambiguous —
// the count alone can map to multiple canonical patterns depending on
// vehicle make. normalize.js flags these for clarification.
export const AMBIGUOUS_BOLT_COUNT_PHRASES = [
  /\b([4-8])\s*(?:bolt|lug)\b/i
];

// ── Tire-spec parsing ───────────────────────────────────────────────
//
// Format: optional prefix (ST|LT|P) + width/aspectRdiam.
// We parse into structured fields and classify the type. Mismatch
// detection happens in interpret.js against vehicle hints.
export const TIRE_PREFIX_TYPES = {
  ST: 'special_trailer',
  LT: 'light_truck',
  P:  'passenger'
};

// ── Vehicle era ─────────────────────────────────────────────────────
//
// Era affects fitment knowledge — classic cars have weird bolt patterns,
// no TPMS, smaller stock wheels, etc.
export const ERA_CUTOFFS = [
  { until: 1990, era: 'classic' },
  { until: 2011, era: 'older_modern' },
  { until: Infinity, era: 'modern' }
];

// ── Vehicle subtype phrases ─────────────────────────────────────────
//
// Each subtype is a soft signal; multi-tag is fine. interpret.js + the
// prompt block use these to frame tier/voice.
export const SUBTYPE_PHRASES = [
  // Multi-word phrases first so the longer-match preempts a substring hit
  { phrase: /\bold body\s+ram\b/i, tag: 'classic_truck' },
  { phrase: /\bfirst gen\b/i, tag: 'classic_truck' },
  { phrase: /\bclassic\s+(ram|truck|chevy|gmc|ford)\b/i, tag: 'classic_truck' },
  { phrase: /\bnew body\b/i, tag: 'modern_truck' },
  { phrase: /\bcurrent gen\b/i, tag: 'modern_truck' },

  { phrase: /\b(my )?wife'?s (car|truck|suv)\b/i, tag: 'family_daily' },
  { phrase: /\bher car\b/i, tag: 'family_daily' },
  { phrase: /\bcommuter\b/i, tag: 'family_daily' },
  { phrase: /\bkids in (the )?back\b/i, tag: 'family_daily' },
  { phrase: /\bschool run\b/i, tag: 'family_daily' },
  { phrase: /\bdaily driver\b/i, tag: 'family_daily' },

  { phrase: /\b(my )?build\b/i, tag: 'enthusiast' },
  { phrase: /\bproject (car|truck)\b/i, tag: 'enthusiast' },
  { phrase: /\bshow car\b/i, tag: 'enthusiast' },
  { phrase: /\bstage\s*\d+\s*tune\b/i, tag: 'enthusiast' },

  { phrase: /\brat\s+\w+/i, tag: 'beater' },
  { phrase: /\bbeater\b/i, tag: 'beater' },

  { phrase: /\blifted\b/i, tag: 'already_modified' },
  { phrase: /\bleveled\b/i, tag: 'already_modified' },
  { phrase: /\bon (3[5-9]|4[0-2])s\b/i, tag: 'already_modified' },

  { phrase: /\bstock\b/i, tag: 'unmodified' },
  { phrase: /\bfactory\b/i, tag: 'unmodified' },

  { phrase: /\btravel trailer\b/i, tag: 'trailer' },
  { phrase: /\bfifth wheel\b/i, tag: 'trailer' },
  { phrase: /\b(my )?RV\b/, tag: 'trailer' },
  { phrase: /\bcamper\b/i, tag: 'trailer' }
];

// ── Tire partition (which season the customer is solving for) ───────
export const TIRE_PARTITION_PHRASES = [
  { phrase: /\bsummer\s*only\b/i, tag: 'summer_only' },
  { phrase: /\bjust\s+summers?\b/i, tag: 'summer_only' },
  { phrase: /\bsummers?\s+(?:on|on a)\s+(?:separate|different)\s+(?:set|rims?|wheels?)\b/i, tag: 'has_separate_summers' },
  { phrase: /\bwinter\s*only\b/i, tag: 'winter_only' },
  { phrase: /\bjust\s+winters?\b/i, tag: 'winter_only' },
  { phrase: /\b(i\s+)?have\s+(?:winters?|snow tires?)\s+(?:on|on a)\s+(?:separate|different|another)\s+(?:set|rims?|wheels?)\b/i, tag: 'has_separate_winters' },
  { phrase: /\b(i\s+)?have\s+(?:a\s+)?(?:set\s+of\s+)?(?:winters?|snow tires?)\s+already\b/i, tag: 'has_separate_winters' },
  { phrase: /\byear\s*round\b/i, tag: 'year_round' },
  { phrase: /\ball\s*season\b/i, tag: 'year_round' },
  { phrase: /\ball\s*weather\b/i, tag: 'year_round' },
  { phrase: /\bjust\s+need\s+(?:summer|winter|all[\s-]?season|all[\s-]?weather)\s+tires?\b/i, tag: 'seasonal_only' }
];

// ── Re-ask phrase signals ───────────────────────────────────────────
//
// These phrases boost re-ask confidence when accompanied by lexical
// similarity vs an earlier customer message, OR when the matching prior
// customer question never got a Dayton-side answer.
export const REASK_PHRASES = {
  high: [
    /\b(still|again)\b/i,
    /\bany update\b/i,
    /\bany luck\b/i,
    /\bdid (you|ya|u) (get|have) a (chance|sec|minute|second)\b/i
  ],
  medium: [
    /\bsorry to (bug|bother|pester) (you|ya|u)\b/i
  ]
};

// ── Frame-mismatch detection ────────────────────────────────────────
//
// Maps a recent Dayton message intent → expected answer shape, plus the
// "wrong-but-still-useful" shapes a customer commonly answers with, and
// a bridge phrase template the variant can use to acknowledge + redirect.
//
// `daytonAsked` patterns scan the most recent rep-sent message.
// `customerLooksLike` patterns scan the current customer reply.
export const FRAME_PATTERNS = [
  {
    intent: 'vehicle_year_make_model',
    daytonAsked: [
      /\byear\s*\/?\s*make\s*\/?\s*model\b/i,
      /\bwhat (year|kind|type) (?:is the |of )?(truck|car|suv|vehicle|ride)\b/i,
      /\b(year)?\s*of (the )?(truck|car|suv|vehicle|ride)\b/i,
      /\bwhat\s+(?:you('?re| are)|ya)\s+(?:driving|drive|rolling in)\b/i
    ],
    customerWrongShapes: [
      { shape: 'rim_size', pattern: /\b(1[5-9]|2[0-6])\s*(?:inch|"|in)\b/i,
        bridge: 'Got the {match} inch — and what year/make/model is the ride?' },
      { shape: 'tire_size', pattern: /\b\d{3}\/\d{2}r\d{2}\b/i,
        bridge: 'Appreciate the size — and what year/make/model are we putting them on? (We pull the right size from the vehicle, just want to confirm the ride.)' },
      { shape: 'bolt_pattern', pattern: /\b\d{1}x[\d.]+\b/i,
        bridge: 'Got the bolt pattern — and what year/make/model is the ride?' },
      { shape: 'color', pattern: /\b(black|chrome|bronze|silver|gloss|matte|gold)\b/i,
        bridge: 'Got the color preference — and what year/make/model are we fitting?' }
    ]
  },
  {
    // Tire qualifier intent: ALWAYS about tire TYPE (mud / A/T / snowflake-
    // rated / highway / three-season), NEVER about size. The rep figures
    // size from the vehicle. These bridges are for when Dayton asked the
    // tire-type question and the customer answered with something off-topic.
    intent: 'tire_type',
    daytonAsked: [
      /\bwhat (kind|type|style) of tire\b/i,
      /\bmud.{0,30}all.terrain.{0,30}snowflake/i,
      /\bsnowflake.rated\b/i,
      /\bA\/?T or M\/?T\b/i
    ],
    customerWrongShapes: [
      { shape: 'color', pattern: /\b(black|chrome|bronze|silver|gloss|matte|gold)\b/i,
        bridge: 'Got the color — and what kind of tire are you after? Mud, A/T, snowflake-rated for winter, or highway/touring?' },
      { shape: 'rim_size', pattern: /\b(1[5-9]|2[0-6])\s*(?:inch|"|in)\b/i,
        bridge: 'Got the {match} inch — and what kind of tire are you after on those? Mud, A/T, snowflake-rated for winter, or more highway/touring?' }
    ]
  }
];

// ── AWD heuristic — common AWD/4WD make/model fragments ─────────────
//
// We don't have a full make/model AWD database. Use these substrings as
// a hint when the customer mentions a vehicle: if any match, mark the
// vehicle as likely AWD/4WD. interpret.js then gates the partial-tire
// replacement rule on this hint.
export const AWD_VEHICLE_HINTS = [
  /\bsubaru\b/i,
  /\bf[\s-]?150\s+(?:4x4|4wd|awd)\b/i,
  /\b(silverado|sierra|f250|f350|ram\s*\d+|tundra|tacoma|titan)\b/i,
  /\b(suburban|tahoe|yukon|escalade|expedition|sequoia|4runner)\b/i,
  /\b(jeep|wrangler|grand cherokee|cherokee|gladiator)\b/i,
  /\b(audi|quattro|x[3-7]|q[3-8])\b/i,
  /\baudi\s+(a4|a6|a8|s4|s6|s8|rs[34567])\b/i,
  /\b(highlander|pilot|cr-?v|rav-?4|crosstrek|outback|forester|ascent|legacy)\b/i,
  /\b(4x4|4wd|awd|all wheel drive|four wheel drive)\b/i
];

// ── Ram body generation cutoffs ─────────────────────────────────────
//
// 2009-2018 spans 4th-gen body. 2019+ is technically 5th gen "DT" body,
// but Ram kept selling the 4th-gen alongside the new one through ~2024
// rebadged as "Classic." So 2019+ year alone doesn't fully resolve body
// style — that's why ram_body.body_question_needed exists.
export const RAM_GENERATIONS = [
  { yearMin: 1981, yearMax: 1993, gen: '1st_gen' },
  { yearMin: 1994, yearMax: 2001, gen: '2nd_gen' },
  { yearMin: 2002, yearMax: 2008, gen: '3rd_gen' },
  { yearMin: 2009, yearMax: 2018, gen: '4th_gen' },
  // 2019+ — needs body confirmation unless already_modified subtype is set
  { yearMin: 2019, yearMax: Infinity, gen: '5th_gen', bodyQuestionNeeded: true }
];

// ── Wheel-size tradeoff threshold ───────────────────────────────────
export const WHEEL_SIZE_TRADEOFF_INCHES = 24;
