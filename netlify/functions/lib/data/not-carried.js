// Phase E.4 — products CCAW does NOT supply.
//
// Each entry maps a customer-mention to:
//   match_phrases   — case-insensitive substrings/phrases to detect
//                     the request in the current customer message
//   redirect_message — voice-anchored response (used near-verbatim by
//                     the prompt builder; LLM can lightly adapt to
//                     match thread tone, but must not invent stock)
//   redirect_targets — alternatives we CAN supply (for the LLM to
//                     name only when those alternatives genuinely exist)
//
// Add entries when transcripts surface a recurring not-carried request.
// Hardcoded for now — see Phase E.4 handoff for Supabase-table notes.

export const NOT_CARRIED = {
  rev9_coilovers: {
    match_phrases: ['rev9', 'rev 9', 'rev-9'],
    redirect_message: "Honestly man, we can't get Rev9 here. Similar style we CAN get is BC Racing or KSport, want me to grab options on either?",
    redirect_targets: ['BC Racing', 'KSport']
  },
  body_lift: {
    match_phrases: ['body lift', 'body spacer', 'frame lift spacer', 'body spacer lift'],
    redirect_message: "We don't really do body lifts here, only suspension lifts. Suspension gives you the height plus better travel. Open to that?",
    redirect_targets: ['suspension_lift']
  },
  roll_cage: {
    match_phrases: ['roll cage', 'roll bar', 'rollover bar', 'rollcage'],
    redirect_message: "We don't fab roll cages here, that's a specialty shop job. Want me to point you toward someone local?",
    redirect_targets: []
  },
  engine_tune: {
    match_phrases: ['ecu flash', 'ecu tune', 'engine tune', 'performance tune', 'stage 1 tune', 'stage 2 tune', 'stage 3 tune'],
    redirect_message: "We're a wheels/tires/suspension shop, tunes are outside our lane. Want me to recommend a tuner shop?",
    redirect_targets: []
  },
  window_tint: {
    match_phrases: ['window tint', 'tint job', 'ceramic tint', 'tinted windows', 'getting tinted'],
    redirect_message: "We don't do tint in-house. Want a rec for a good tint shop?",
    redirect_targets: []
  },
  paint_body: {
    match_phrases: ['paint job', 'body work', 'paint and body', 'respray', 'paint match', 'bodywork'],
    redirect_message: "We don't do paint or body work, that's outside our shop. Wheels/tires/suspension is our lane.",
    redirect_targets: []
  },
  custom_fab: {
    match_phrases: ['custom fab', 'fabrication', 'one off', 'one-off', 'custom welded', 'welding work'],
    redirect_message: "We're a parts + install shop, custom fab needs a specialty fabricator.",
    redirect_targets: []
  },
  big_brake_kit: {
    match_phrases: ['big brake kit', 'bbk', 'stoptech kit', 'brembo kit', 'wilwood kit', '6-piston', '4-piston caliper'],
    redirect_message: "We can do pad/rotor replacements but big-brake kits aren't our specialty. What were you looking at?",
    redirect_targets: ['pads_rotors']
  },
  exhaust: {
    match_phrases: ['exhaust system', 'cat back', 'cat-back', 'catback', 'axle back', 'axle-back', 'muffler delete', 'long tube headers', 'shorty headers'],
    redirect_message: "We don't do exhaust work here.",
    redirect_targets: []
  },
  detail_coating: {
    match_phrases: ['ceramic coating', 'paint correction', 'paint protection film', 'ppf', 'full detail', 'auto detail', 'interior detail'],
    redirect_message: "We don't do detail or coatings, that's a separate shop.",
    redirect_targets: []
  }
};

// Helper: in-catalog product types (what CCAW DOES supply). Used by the
// product-pivot detector to confirm the customer's new ask is something
// we can actually quote. Anything NOT in this set and NOT in NOT_CARRIED
// is ambiguous — the prompt will hedge ("not sure if that's our lane,
// let me check") rather than committing.
export const IN_CATALOG_PRODUCTS = new Set([
  'wheels',
  'tires',
  'lift_kit',          // suspension lift
  'leveling_kit',
  'coilovers',         // we CAN supply some brands (e.g. BC Racing) — see redirect_targets
  'air_ride',
  'accessories',       // running boards, fender flares, mud flaps
  'shocks_struts',
  'tpms_sensors',
  'lug_nuts',
  'wheel_spacers',
  'pads_rotors'
]);

// Helper: product keywords → in-catalog tag mapping. Used by detectProductPivot
// to figure out what the customer is asking about in the current message.
// Order matters — longer / more specific phrases first.
export const PRODUCT_KEYWORD_MAP = [
  { phrase: /\b(suspension\s+lift|lift\s+kit|3\s*inch\s+lift|6\s*inch\s+lift|2-3\s*inch\s+lift)\b/i, tag: 'lift_kit' },
  { phrase: /\b(leveling\s+kit|level\s+kit)\b/i, tag: 'leveling_kit' },
  { phrase: /\b(coilovers?|coil\s*overs?)\b/i, tag: 'coilovers' },
  { phrase: /\b(air\s*ride|air\s*bag\s+suspension|airride)\b/i, tag: 'air_ride' },
  { phrase: /\b(running\s+boards?|side\s+steps?|nerf\s+bars?)\b/i, tag: 'accessories' },
  { phrase: /\b(fender\s+flares?|mud\s+flaps?)\b/i, tag: 'accessories' },
  { phrase: /\b(shocks?|struts?)\b/i, tag: 'shocks_struts' },
  { phrase: /\btpms\b/i, tag: 'tpms_sensors' },
  { phrase: /\b(lug\s+nuts?|wheel\s+locks?)\b/i, tag: 'lug_nuts' },
  { phrase: /\bwheel\s+spacers?\b/i, tag: 'wheel_spacers' },
  { phrase: /\b(brake\s+pads?|rotors?)\b/i, tag: 'pads_rotors' },
  { phrase: /\b(rims?|wheels?)\b/i, tag: 'wheels' },
  { phrase: /\btires?\b/i, tag: 'tires' }
];
