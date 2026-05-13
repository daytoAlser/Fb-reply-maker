import Anthropic from '@anthropic-ai/sdk';
import { supabase } from './_shared/supabaseClient.js';
// Phase E.6 — pre-LLM normalization + interpretation. See SPEC-PhaseE.md §6.
import { normalize as runNormalize } from './lib/interpretation/normalize.js';
import { interpret as runInterpret } from './lib/interpretation/interpret.js';
// Phase E.3 — per-turn decision-support detection.
import { detectDecisionSupport } from './lib/interpretation/decisionSupport.js';
// Phase E.4 — wrong-product / fitment-mismatch / pivot detection.
import { detectWrongProduct } from './lib/interpretation/wrongProduct.js';
// Phase E.7 — financing-mode detection + deterministic FAQ.
import { detectFinancingMode } from './lib/interpretation/financing.js';
import { FINANCING_FAQ } from './lib/data/financing-faq.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function mergeCapturedFields(newFields, existingFields) {
  const merged = (existingFields && typeof existingFields === 'object' && !Array.isArray(existingFields))
    ? { ...existingFields }
    : {};
  if (!newFields || typeof newFields !== 'object') return merged;
  for (const [key, value] of Object.entries(newFields)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase() === 'null') continue;
      merged[key] = trimmed;
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

// Phase E.2: returning-customer detection
const RETURNING_GAP_MS = 48 * 60 * 60 * 1000;
// Minimum gap before a LANGUAGE trigger can promote a lead to returning.
// Stops false positives like "still got those?" arriving mid-flow on an
// active conversation where the customer is mid-qualification.
//
// LOCKED — design decision 2026-05-13. The 6h floor stays. Test 2 in the
// E.2 spec ("language trigger fires without needing the full 48h gap")
// must use a lead whose last_updated is at least 7h old. Earlier drafts
// of Test 2 said 2h, which conflicted with Test 4 (no-false-positive on
// active conversations) — the 6h floor is the resolution and 7h is the
// scaffolded Test 2 setup.
const RETURNING_LANG_MIN_GAP_MS = 6 * 60 * 60 * 1000;
// Used by the prompt to inject an explicit "been a minute" acknowledgment
// rule when the returning gap is genuinely long.
const RETURNING_LONG_GAP_MS = 30 * 24 * 60 * 60 * 1000;
const RETURNING_TRIGGER_STATUSES = new Set([
  'options_sent', 'lead_warm_pending', 'qualified', 'contacted'
]);
const RESUMPTION_PATTERNS = [
  /\bsorry just getting back to (you|ya|u)\b/i,
  /\bsorry (about|for) (the )?(late|delayed?|slow) (reply|response|message)\b/i,
  /\bsorry (about|for) (the )?(wait|delay)\b/i,
  /\bsorry to (bug|bother|pester) (you|ya|u)\b/i,
  /\bstill got (those|them|the)\b/i,
  /\bthe ones you (showed|sent|had|talked about)\b/i,
  /\b(the )?(bronze|black|silver|chrome|gloss|matte) ones\b/i,
  /\bare (those|they|these) still (available|in stock|around)\b/i,
  /\byou still have (those|them|these|the)\b/i,
  /\bstill (interested|thinking|considering|looking)\b/i,
  /\bhaven'?t forgotten\b/i,
  /\bhey again\b/i,
  /\b(coming|getting) back to (this|you|ya|the (wheels|tires|setup))\b/i,
  /\b(been )?meaning to (get back|reply|message|hit you up)\b/i,
  /\bjust circling back\b/i,
  /\bany (update|luck|news)\b/i,
  /\bdid (you|ya|u) (get|have) a (chance|sec|minute|second)\b/i
];

function hasResumptionLanguage(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return RESUMPTION_PATTERNS.some((re) => re.test(text));
}

function toEpochMs(v) {
  if (v == null) return null;
  if (typeof v === 'number' && isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && v) {
    const t = Date.parse(v);
    if (!isNaN(t)) return t;
  }
  return null;
}

function detectReturningTrigger({ message, prevMode, prevStatus, prevLastCustomerMessageAt, prevLastUpdated, now }) {
  // Already returning — preserve. Caller is responsible for freezing
  // silence_duration_ms and last_customer_message_at across subsequent
  // messages inside an active returning conversation.
  if (prevMode === 'returning') {
    return { mode: 'returning', firstTrigger: false, reason: 'preserved' };
  }

  const hasPriorStatus = prevStatus && prevStatus !== 'new';
  if (!hasPriorStatus) {
    return { mode: 'standard', firstTrigger: false, reason: 'no_prior_status' };
  }

  const reference = toEpochMs(prevLastCustomerMessageAt) || toEpochMs(prevLastUpdated);
  const gap = reference ? Math.max(0, now - reference) : 0;

  const gapTrigger = RETURNING_TRIGGER_STATUSES.has(prevStatus) && gap >= RETURNING_GAP_MS;
  // Language trigger requires the SAME status gate as the gap trigger, plus
  // a 6h floor on activity. Otherwise an active conversation where the
  // customer happens to say "still got those" mid-flow would false-promote.
  const langTrigger =
    hasResumptionLanguage(message)
    && RETURNING_TRIGGER_STATUSES.has(prevStatus)
    && gap >= RETURNING_LANG_MIN_GAP_MS;

  if (gapTrigger || langTrigger) {
    return {
      mode: 'returning',
      firstTrigger: true,
      silenceDurationMs: gap,
      reason: gapTrigger ? 'gap' : 'language'
    };
  }

  return { mode: 'standard', firstTrigger: false, reason: 'no_trigger' };
}

async function upsertLeadToSupabase({ thread_id, partner_name, fb_thread_url, listing_title, ad_type, captured_fields, status, flags, writeFlags, products_of_interest, ready_for_options, conversation_mode, silence_duration_ms, last_customer_message_at }) {
  const row = {
    thread_id,
    last_updated: new Date().toISOString()
  };
  if (partner_name) row.partner_name = partner_name;
  if (fb_thread_url) row.fb_thread_url = fb_thread_url;
  if (listing_title) row.listing_title = listing_title;
  if (ad_type) row.ad_type = ad_type;
  if (captured_fields && Object.keys(captured_fields).length > 0) {
    row.captured_fields = captured_fields;
  }
  if (status) row.status = status;
  // Phase E.1 bug-A fix: open_flags is the union of human-review flags
  // (fitment/pricing/timeline from this message) and the lead-state flag
  // 'ready_for_options' (set when all tracked products are qualified).
  if (writeFlags !== false && Array.isArray(flags)) {
    const combined = [...flags];
    if (ready_for_options && !combined.includes('ready_for_options')) {
      combined.push('ready_for_options');
    }
    row.open_flags = combined;
  }
  if (Array.isArray(products_of_interest)) row.products_of_interest = products_of_interest;
  if (typeof conversation_mode === 'string' && conversation_mode) {
    row.conversation_mode = conversation_mode;
  }
  if (typeof silence_duration_ms === 'number' && isFinite(silence_duration_ms) && silence_duration_ms >= 0) {
    row.silence_duration_ms = silence_duration_ms;
  }
  if (last_customer_message_at) {
    const ms = toEpochMs(last_customer_message_at);
    if (ms) row.last_customer_message_at = new Date(ms).toISOString();
  }

  console.log('[FN] supabase upsert payload:', JSON.stringify(row));

  const { data, error } = await supabase
    .from('leads')
    .upsert(row, { onConflict: 'thread_id', ignoreDuplicates: false })
    .select();

  return { data, error, row };
}

function buildHistoryBlock(history) {
  if (!Array.isArray(history) || history.length === 0) return '';
  const lines = history
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => `${m.sender === 'me' ? 'ME' : 'THEM'}: ${m.text.trim()}`);
  if (lines.length === 0) return '';
  return `
CONVERSATION HISTORY (most recent last)
This is the prior exchange in the thread. Use it for context so you don't re-ask for info already given. The "INCOMING MESSAGE" below is the latest message you must reply to.
${lines.join('\n')}
`;
}

function firstWord(s) {
  if (!s || typeof s !== 'string') return null;
  const w = s.trim().split(/\s+/)[0];
  if (!w) return null;
  const clean = w.split(/[,.]/)[0];
  return clean || null;
}

function buildOpenerLine(customerFirstName, rep) {
  if (customerFirstName && rep) {
    return `Opener: "Hey @${customerFirstName}, ${rep} here, I'd be happy to help you out today!"`;
  }
  if (customerFirstName) {
    return `Opener: "Hey @${customerFirstName}, happy to help you out today!"`;
  }
  if (rep) {
    return `Opener: "Hey, ${rep} here, happy to help you out today!"`;
  }
  return `Opener: "Hey, happy to help you out today!"`;
}

// Phase E.1: multi-product tracking
const ALLOWED_PRODUCT_TYPES = new Set(['wheel', 'tire', 'lift', 'accessory']);
const PRODUCT_REQUIRED_FIELDS = {
  wheel: ['lookPreference', 'rideHeight'],
  tire: ['tireSize', 'usage'],
  lift: ['heightGoal', 'useCase'],
  accessory: []
};
const PRODUCT_QUALIFIER_KEYS = {
  wheel: ['lookPreference', 'rideHeight', 'intent', 'sizeConstraint'],
  tire: ['tireSize', 'usage', 'treadPreference'],
  lift: ['heightGoal', 'useCase', 'budgetBand'],
  accessory: []
};

function isProductFieldMeaningful(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return false;
    if (t.toLowerCase() === 'null') return false;
    return true;
  }
  return true;
}

function normalizeProductQualifiers(productType, qualifierFields) {
  const allowed = PRODUCT_QUALIFIER_KEYS[productType] || [];
  const out = {};
  if (!qualifierFields || typeof qualifierFields !== 'object') return out;
  for (const key of allowed) {
    const v = qualifierFields[key];
    if (isProductFieldMeaningful(v)) {
      out[key] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return out;
}

function computeProductState(productType, qualifierFields, leadVehicle) {
  const required = PRODUCT_REQUIRED_FIELDS[productType] || [];
  const vehiclePresent = isProductFieldMeaningful(leadVehicle);
  if (!vehiclePresent && productType !== 'accessory') return 'qualifying';
  if (productType === 'accessory') return vehiclePresent ? 'qualified' : 'qualifying';
  const allRequiredPresent = required.every((k) => isProductFieldMeaningful(qualifierFields?.[k]));
  return allRequiredPresent ? 'qualified' : 'qualifying';
}

function mergeProductsOfInterest(existing, incoming, leadVehicle) {
  const byType = new Map();
  const order = [];

  function getOrCreate(productType) {
    if (!byType.has(productType)) {
      byType.set(productType, {
        productType,
        qualifierFields: {},
        productState: 'qualifying',
        optionsSentManually: null,
        selectedProduct: null
      });
      order.push(productType);
    }
    return byType.get(productType);
  }

  for (const p of (Array.isArray(existing) ? existing : [])) {
    if (!p || !ALLOWED_PRODUCT_TYPES.has(p.productType)) continue;
    const slot = getOrCreate(p.productType);
    Object.assign(slot.qualifierFields, normalizeProductQualifiers(p.productType, p.qualifierFields));
    if (p.optionsSentManually) slot.optionsSentManually = p.optionsSentManually;
    if (p.selectedProduct) slot.selectedProduct = p.selectedProduct;
  }

  for (const p of (Array.isArray(incoming) ? incoming : [])) {
    if (!p || !ALLOWED_PRODUCT_TYPES.has(p.productType)) continue;
    const slot = getOrCreate(p.productType);
    Object.assign(slot.qualifierFields, normalizeProductQualifiers(p.productType, p.qualifierFields));
  }

  return order.map((t) => {
    const slot = byType.get(t);
    return { ...slot, productState: computeProductState(t, slot.qualifierFields, leadVehicle) };
  });
}

function buildExistingProductsBlock(existingProducts) {
  if (!Array.isArray(existingProducts) || existingProducts.length === 0) return '';
  const lines = [];
  for (const p of existingProducts) {
    if (!p || !p.productType) continue;
    const keys = PRODUCT_QUALIFIER_KEYS[p.productType] || [];
    const pairs = keys.map((k) => {
      const v = p.qualifierFields?.[k];
      return `${k}=${isProductFieldMeaningful(v) ? v : 'null'}`;
    });
    lines.push(`- ${p.productType}: ${pairs.length > 0 ? pairs.join(', ') : '(no per-product qualifiers)'}`);
  }
  if (lines.length === 0) return '';
  return `
EXISTING TRACKED PRODUCTS (this thread)
${lines.join('\n')}

Carry these forward in products_of_interest. Add new entries if the current message references new product categories. Do not drop a product already tracked.

Every per-product field listed above as anything other than "null" is RESOLVED. Per the RESOLVED QUALIFIER LOCK rule below, do not re-ask about any of these resolved values in QUICK, STANDARD, or DETAILED. Use them as established context only.
`;
}

function buildLocationBlock(location) {
  if (!location || typeof location !== 'object') return '';
  const name = (location.name || '').trim();
  const address = (location.address || '').trim();
  const phone = (location.phone || '').trim();
  const etransferEmail = (location.etransferEmail || '').trim();
  if (!name && !address && !phone && !etransferEmail) return '';
  const lines = [];
  if (name) lines.push(`- Location: ${name}`);
  if (address) lines.push(`- Address: ${address}`);
  if (phone) lines.push(`- Phone: ${phone}`);
  if (etransferEmail) lines.push(`- E-Transfer Email: ${etransferEmail}`);
  return `
LOCATION CONTEXT
${lines.join('\n')}

Use these naturally when referenced in conversation. When the customer asks where you are, give the address. When closing with payment paths, use the actual e-transfer email. When reframing missed calls, name the actual location.
`;
}

function buildReturningCustomerBlock({ conversationMode, priorStatus, silenceDurationMs }) {
  if (conversationMode !== 'returning') return '';
  const silenceLine = (typeof silenceDurationMs === 'number' && silenceDurationMs > 0)
    ? `\n- Silence duration: ${Math.round(silenceDurationMs / (60 * 60 * 1000))} hours since the last customer message.`
    : '';
  const priorLine = priorStatus ? `\n- Prior lead status: ${priorStatus}.` : '';
  const optionsReference = priorStatus === 'options_sent'
    ? `\n- Prior options WERE sent. Reference them without re-listing ("which ones were you leaning toward", "did any of those catch your eye"). Do not propose NEW products in this turn.`
    : '';
  // E.2 rule 7 / E2-10: long gaps (over 30 days) get a brief "been a minute"
  // acknowledgment so the variant doesn't feel like the conversation never
  // paused at all. Under 30 days: skip the gap callout entirely.
  const longGapAck = (typeof silenceDurationMs === 'number' && silenceDurationMs >= RETURNING_LONG_GAP_MS)
    ? `\n- LONG GAP (over 30 days). Add a brief, casual time acknowledgment to the opener WITHOUT making it awkward or guilt-trippy. Acceptable phrases: "Hey man, been a minute!", "Hey, welcome back!", "Long time no chat my man!". Then continue normally. Do NOT say things like "I was wondering where you went", "thought you forgot about us", or anything that implies pressure or absence-tracking.`
    : '';
  return `
RETURNING CUSTOMER MODE — ACTIVE

This customer is resuming after silence (gap-based OR resumption language detected). Use the returning-customer voice. The voice rules below OVERRIDE the OPENER LINE at the top of this prompt — do NOT use the formal "Hey @Name, [Rep] here, I'd be happy to help you out today" opener in any variant.${priorLine}${silenceLine}${optionsReference}${longGapAck}

OPENER OVERRIDE (use ONE of these patterns for the first sentence of every variant):
- If the customer apologized for the delay → "No worries at all my man, life happens!"
- If the customer just resumed without apology → "Hey man, good to hear back from ya!"
- For a buy-signal resume (see DIRECT BUY SIGNAL below) → start with "Easy man, let's get you locked in." and skip the "no worries" prefix.

After the opener override, pick the path that matches the message:

PATH A — CUSTOMER ASKS WHICH OPTIONS / WHICH ONES / WHAT WAS THE TOTAL
Reference the prior options without re-listing them:
"Which ones were you leaning toward?" / "Did any of those catch your eye?" / "Which combo were you thinking?"
If they asked about pricing/totals, still fire the pricing flag (Phase D) and use the phone-punt — but with the returning-customer opener.

PATH B — DIRECT BUY SIGNAL ("I'll take them", "let's do it", "I want the X", "let's lock it in", "I'm in")
Skip the estimate workflow entirely. Go straight to deposit setup:
"Easy man, let's get you locked in. Send me a good phone number for ya and I'll get the deposit info over so we can lock it in ASAP!"
Or, if the e-transfer email is configured, mention it inline as one path among the three: e-transfer to [email], call the store with a CC, or stop by in person.

PATH C — CUSTOMER PROVIDES NEW INFO (vehicle update, mind change, fresh qualifier answer)
Acknowledge the resume briefly, capture the new info, then continue qualifying as normal — but still skip the formal opener.

HARD RULES IN RETURNING MODE
- DO NOT use the resolved OPENER LINE at the top of this prompt.
- DO NOT re-introduce yourself ("[Rep] here" / "I'd be happy to help you out today").
- RESOLVED QUALIFIER LOCK still applies. Do not re-ask anything already captured.
- Multi-product tracking and flag detection still apply.
- Casual Brandon-voice throughout. Treat them like the conversation never paused — just with a "no worries on the delay" acknowledgment.
`;
}

// Phase E.6 — INTERPRETATION CONTEXT prompt block. Conditional sub-blocks
// per detection. Empty interpretation = empty string (no block added).
// Injected after EXISTING TRACKED PRODUCTS, before category / history.
function buildInterpretationBlock(interpretation) {
  if (!interpretation || typeof interpretation !== 'object') return '';
  const lines = [];

  const bp = interpretation.bolt_pattern;
  if (bp && bp.ambiguous) {
    lines.push(`- BOLT-PATTERN AMBIGUOUS: customer wrote "${bp.raw}" (${bp.count}-bolt count with no measurement). Common candidates depend on make — ask which bolt pattern before quoting fitment.`);
  } else if (bp && bp.canonical) {
    const hedge = bp.confidence < 0.9 ? ' (low confidence — verify before quoting if needed)' : '';
    lines.push(`- Bolt pattern detected: ${bp.canonical}${hedge}. Customer wrote: "${bp.raw}". Use canonical form when referencing.`);
  }

  const ts = interpretation.tire_spec;
  if (ts && ts.mismatch_flag) {
    lines.push(`- TIRE-SPEC MISMATCH: customer specified ${ts.raw} (${ts.type}) but vehicle is ${ts.mismatch_reason || 'a different category'}. Ask to confirm the spec or the vehicle before quoting.`);
  } else if (ts && ts.type === 'special_trailer') {
    lines.push(`- Tire spec is Special Trailer (${ts.raw}). Trailer rules apply — no TPMS, ST rating, different bolt-pattern conventions. Confirm this is for a trailer if not already clear.`);
  }

  const era = interpretation.vehicle_era;
  if (era && era.era === 'classic') {
    lines.push(`- Vehicle is a classic (${era.year}). Do NOT assume modern bolt patterns, TPMS requirements, or wheel sizes. Different fitment world — verify everything before quoting.`);
  } else if (era && era.era === 'older_modern') {
    lines.push(`- Vehicle year is ${era.year} (older modern). TPMS may or may not be present — confirm if quoting wheels.`);
  }

  const subtypes = Array.isArray(interpretation.vehicle_subtype) ? interpretation.vehicle_subtype : [];
  if (subtypes.includes('trailer')) {
    lines.push(`- TRAILER, not a passenger vehicle. ST tires, no TPMS, different bolt-pattern conventions. Do NOT push passenger/LT tires or warn about TPMS.`);
  }
  if (subtypes.includes('family_daily')) {
    lines.push(`- Customer signals a daily/family vehicle. Lean toward comfort + value-tier framing. Don't lead with enthusiast/show-build language.`);
  }
  if (subtypes.includes('enthusiast')) {
    lines.push(`- Customer signals enthusiast. Don't over-explain basics — tier/spec language is fine.`);
  }
  if (subtypes.includes('beater')) {
    lines.push(`- Customer signals a low-budget vehicle. Budget tier framing primary. Don't push premium tiers without an explicit ask.`);
  }
  if (subtypes.includes('classic_truck')) {
    lines.push(`- Customer mentioned classic/old-body truck. Confirm year/gen if quoting fitment — old-body and new-body share names but not specs.`);
  }
  if (subtypes.includes('already_modified')) {
    lines.push(`- Vehicle is already modified (lifted/leveled/big tires). Skip "is it stock?" questions and the body-style question for newer Rams — they've clearly moved past pre-sale.`);
  }

  const partition = interpretation.tire_partition;
  if (partition === 'summer_only' || partition === 'has_separate_winters') {
    lines.push(`- TIRE PARTITION = customer has winters handled separately. HARD RULE: do NOT push all-season, all-weather, or winter tires. Stay on summer/performance options.`);
  } else if (partition === 'winter_only' || partition === 'has_separate_summers') {
    lines.push(`- TIRE PARTITION = customer has summers handled separately. HARD RULE: do NOT push all-season, all-weather, or summer tires. Stay on winter options.`);
  } else if (partition === 'year_round') {
    lines.push(`- TIRE PARTITION = customer wants year-round. Lead with all-weather / all-season options. Don't bring up separate winter sets unless they ask.`);
  } else if (partition === 'seasonal_only') {
    lines.push(`- TIRE PARTITION = customer indicated they want season-specific tires only. Honor what they asked for; don't broaden to year-round.`);
  }

  const reAsk = interpretation.re_ask;
  if (reAsk && reAsk.detected && reAsk.confidence >= 0.7) {
    const ref = reAsk.original_question_summary
      ? ` ("${reAsk.original_question_summary}")`
      : '';
    lines.push(`- HARD RULE — RE-ASK DETECTED${ref}: customer is repeating a question they asked earlier. Apologize briefly for missing it ("Sorry man, missed that one") and answer plainly. Do NOT pretend it's the first ask. Do NOT re-frame as a new conversation.`);
  }

  const fm = interpretation.frame_mismatch;
  if (fm && fm.detected && fm.proposed_bridge) {
    lines.push(`- HARD RULE — FRAME MISMATCH: you (Dayton) asked about ${fm.asked_about.replace(/_/g, ' ')} and customer answered with ${fm.customer_answered_with.replace(/_/g, ' ')}. Acknowledge what they DID answer, then bridge back to the original ask. Suggested phrasing: "${fm.proposed_bridge}". Do NOT just re-ask the original question verbatim.`);
  }

  const awd = interpretation.awd_partial_replacement;
  if (awd && awd.detected) {
    lines.push(`- HARD RULE — AWD PARTIAL REPLACEMENT: vehicle is AWD/4WD and customer wants 2 tires (not 4). Installing 2 new tires on AWD requires tread depth within 3/32" of the existing tires to avoid stressing the transfer case. BEFORE quoting, ask: "Are the front (or rear, depending on which 2) tires fairly new? Need to make sure the tread depth is close so we don't put any strain on the AWD system."`);
  }

  const wst = interpretation.wheel_size_tradeoff;
  if (wst && wst.size) {
    lines.push(`- SOFT NOTE: customer is on ${wst.size}" wheels. Tire option availability is limited at this size — fewer brands/sizes than 20"-22". Acknowledge naturally if relevant ("there's a few options at ${wst.size}s, let me see what works"); don't lead with it or talk them off the size.`);
  }

  const ram = interpretation.ram_body;
  if (ram && ram.body_question_needed) {
    lines.push(`- SOFT RULE — RAM BODY UNCLEAR: ${ram.year} Ram falls in the 5th-gen / "Classic" body overlap. If you're about to quote fitment specs, confirm body style first: "Is this the classic or the new body Ram?". Skip if already-modified subtype was detected.`);
  }

  if (lines.length === 0) return '';
  return `
INTERPRETATION CONTEXT (pre-parsed from customer message — apply these as overlays on top of standard flow)
${lines.join('\n')}
`;
}

// Phase E.3 — DECISION SUPPORT MODE prompt block. Per-turn override.
// Only emitted when detectDecisionSupport().triggered === true. Takes
// priority over: standard opener, RETURNING CUSTOMER MODE opener,
// READY-FOR-OPTIONS handoff (deferred one turn), qualifier collection.
//
// Structure varies by sub-mode (compare / review / tradeoff) per spec
// section E.3.  lean_hint from E.6 vehicle_subtype, if present,
// pre-biases the prompt toward the right tier.
function buildDecisionSupportBlock(ds, returningActive) {
  if (!ds || !ds.triggered) return '';
  const products = Array.isArray(ds.subject_products) ? ds.subject_products : [];
  const productLine = products.length === 2
    ? `\n- Products in scope: "${products[0]}" vs "${products[1]}". Reference by these names if the customer used them; otherwise stay tier-framed.`
    : products.length === 1
      ? `\n- Product in scope: "${products[0]}".`
      : '';
  const leanLine = ds.lean_hint === 'value'
    ? `\n- LEAN HINT: customer signals daily/family/budget vehicle (from interpretation context). Lean VALUE tier in your recommendation. Premium is "better" on paper but value tier matches the use case — name that explicitly as the reason.`
    : ds.lean_hint === 'premium'
      ? `\n- LEAN HINT: customer signals enthusiast/build (from interpretation context). Premium-tier framing fits — they're not penny-pinching, they want the right product.`
      : '';
  const returningCoexist = returningActive
    ? `\n- RETURNING MODE is also active. Advisor turn takes priority for this message. SKIP the returning-customer opener ("no worries", "hey man") — go straight to the honest framing below.`
    : '';

  // Sub-mode-specific structure rules + voice anchors.
  const structureBlock = (() => {
    if (ds.mode === 'compare') {
      return `
STRUCTURE (compare mode):
1. Lean: which option you'd pick and why (tied to customer use case). 1-2 sentences.
2. Counterpoint: what the OTHER option does better. 1 sentence.
3. Tip-over-line: the specific use-case detail that pushes you over to your pick. 1 sentence.

VOICE ANCHOR — compare:
"Honestly for highway driving like yours, I'd lean Suretrac side. The Kanati has better off-road grip but you're not really using that, and the Suretrac rides quieter on pavement. If you were jumping curbs and hitting trails I'd flip my answer, but for your commute the Suretrac is the move."`;
    }
    if (ds.mode === 'review') {
      return `
STRUCTURE (review mode):
1. Honest reputation read. 1 sentence. If the product isn't one you can speak to confidently (not iLink/Suretrac/Kanati/known value-or-premium tier brand), say "honestly I haven't sold a ton of those, want me to grab specific reviews?" Do NOT invent.
2. Specific strengths and weaknesses. 1-2 sentences.
3. Who it fits vs doesn't fit. 1 sentence.

VOICE ANCHOR — review:
"Real talk, iLink is our in-house value brand. Customers who buy them for budget daily driving are happy, customers who expect premium tire feel sometimes notice the compound is firmer. For your use case they punch above their weight. If you're rotating yearly anyway, totally fine choice."`;
    }
    // tradeoff
    return `
STRUCTURE (tradeoff mode):
1. Name the tradeoff plainly. 1 sentence. ("Premium adds X, costs Y more.")
2. When the upgrade IS worth it. 1-2 sentences.
3. When it's NOT worth it. 1-2 sentences.
4. Your lean for THIS customer based on what they've told you. 1 sentence.

VOICE ANCHOR — tradeoff:
"Honestly the Michelin is worth the extra if you keep your cars for the long haul, the 100K warranty pays for itself. For a daily that you'd flip in 3 years, the Gladiator is fine and saves you a couple hundred. What's your timeline on this car?"`;
  })();

  return `
DECISION SUPPORT MODE — ACTIVE (this turn only)
The customer is asking for advisor-style help, not spec collection. Shift voice from qualifier-driven to advisor-driven for this message ONLY.${productLine}${leanLine}${returningCoexist}

HARD RULES (this turn):
- DO NOT collect qualifiers. Missing qualifiers can come on the NEXT turn — finish the advisor turn first.
- DO NOT pivot to estimate/phone handoff this turn even if READY FOR OPTIONS would normally trigger. Advisor turn takes the slot.
- DO NOT push the more expensive option by default. Use case wins. If the LEAN HINT says value, lean value even when premium is "objectively better".
- DO NOT hedge with "they're all great options" / "any of these would work" / "depends on what you want". Pick ONE based on what the customer has told you.
- DO NOT recommend a specific SKU/product unless you're in review mode AND the product is one you can speak to (iLink / Suretrac / known tier brands). Otherwise stay tier-framed ("the value tier handles your driving fine", "the premium tier is worth it if you do X").

OPENER OVERRIDE (this turn):
- Lead with honest framing. Acceptable openers: "Honestly man, in my opinion...", "To be honest...", "If I were spending my own money...", "Real talk...".
- DO NOT use the standard formal opener.
- DO NOT use the returning-mode "no worries" opener even if RETURNING MODE is active.
${structureBlock}

ENDING:
- Soft open at the end. Examples: "let me know if that helps narrow it down", "what's your gut telling you", "happy to dig deeper on either".
- DO NOT end with a qualifier question. DO NOT end with "send me a phone number".

TIE-IN:
- The reason for your lean MUST tie to something the customer has actually said (use case, vehicle, prior message context). Generic reasons ("it's a good tire") are a hard error.
- All variants (quick/standard/detailed) follow these rules. Quick can drop the counterpoint sentence; standard and detailed should keep the full structure.
`;
}

// Phase E.4 — WRONG-PRODUCT REDIRECT prompt block. Per-turn override.
// Takes priority over E.3 advisor mode (caller suppresses decisionSupport
// when wrongProduct fires). Coexists with RETURNING (body of message
// becomes the redirect; returning opener still skipped).
function buildWrongProductBlock(wp, returningActive) {
  if (!wp || !wp.type) return '';
  const returningCoexist = returningActive
    ? `\n- RETURNING MODE is also active. The body of this turn is the redirect below; skip the returning-mode opener.`
    : '';

  if (wp.type === 'not_carried') {
    const targets = (wp.redirect_targets && wp.redirect_targets.length > 0)
      ? `\n- Vetted alternatives we CAN supply: ${wp.redirect_targets.join(', ')}. Only mention these — do NOT invent other alternatives.`
      : `\n- No vetted alternatives available. If the customer pushes, punt to phone for a manager call.`;
    return `
WRONG-PRODUCT REDIRECT — NOT CARRIED (this turn only)
The customer asked about "${wp.requested_product}" (matched phrase: "${wp.matched_phrase}") — this is NOT something CCAW supplies.${returningCoexist}

HARD RULES (this turn):
- Use this redirect message verbatim or very close: "${wp.redirect_message}"${targets}
- DO NOT pretend we can get it, "check on it", or invent stock. CCAW does not carry this product line.
- DO NOT collect qualifiers this turn — the dead-end / pivot offer comes first.
- Tone stays casual Brandon. Bad news lands like good news. "Honestly man, we can't get those" beats "Unfortunately we do not carry that product line."
- For competitive-shop redirects (tint, paint, fab, exhaust, detail): be helpful, not territorial. Offer to point them somewhere if you can.

ENDING:
- Soft offer to grab the alternative (if any), or to point them to a specialty shop.
- DO NOT end with the standard estimate/phone-handoff pitch.
`;
  }

  if (wp.type === 'fitment_mismatch') {
    const reasonLines = (() => {
      if (wp.subreason === 'bolt_pattern_incompatible') {
        return `- Listing wheels are bolt pattern ${wp.listing_bolt_pattern}. Customer vehicle ("${wp.vehicle_text}") doesn't run that pattern.
- Pivot suggestion: offer ${wp.pivot_suggestion}.`;
      }
      if (wp.subreason === 'tire_type_incompatible') {
        return `- Listing tire is ${wp.listing_tire_prefix || ''}${wp.listing_tire_prefix ? '-prefix ' : ''}(${wp.listing_tire_type}). Customer vehicle ("${wp.vehicle_text}") is not a match for that tire type.`;
      }
      if (wp.subreason === 'lift_kit_incompatible_vehicle') {
        return `- Listing is a lift kit. Customer vehicle ("${wp.vehicle_text}") is a car/sedan/sports car — there's no aftermarket lift for that.`;
      }
      return `- Listing/vehicle fitment mismatch detected.`;
    })();

    return `
WRONG-PRODUCT REDIRECT — FITMENT MISMATCH (this turn only)
The product in the listing won't fit the customer's vehicle.${returningCoexist}

${reasonLines}

HARD RULES (this turn):
- Acknowledge the mismatch directly without sounding rejecting. Brandon voice: "Heads up man, those won't work on the ${wp.vehicle_text || 'vehicle'}, they're [reason]. Want me to find you options that'll fit?"
- DO NOT pretend the listing wheels/tires/lift will fit. They won't.
- DO NOT collect unrelated qualifiers — the fitment news comes first.
- If a pivot suggestion exists, offer it as a soft open. If not, ask what the customer's actually looking for.

ENDING:
- Soft offer to find the correct product for their vehicle.
- DO NOT push to phone handoff this turn.
`;
  }

  if (wp.type === 'product_pivot') {
    const quals = Array.isArray(wp.pivot_qualifiers_needed) ? wp.pivot_qualifiers_needed.join(', ') : '';
    return `
WRONG-PRODUCT REDIRECT — PRODUCT PIVOT (this turn only)
Customer is pivoting from the original listing (${wp.original_listing}) to a different product (${wp.new_product}) that IS in our catalog.${returningCoexist}

HARD RULES (this turn):
- Smooth acknowledgment of the pivot — don't make a big deal of it. "Yeah for sure!" or "Easy, let me check" or "Totally, what were you thinking?"
- Begin collecting the NEW product's qualifiers. Required for ${wp.new_product}: ${quals}.
- RESOLVED QUALIFIER LOCK still applies for previously captured fields (e.g. vehicle stays captured). Don't re-ask anything already in extracted_fields.
- DO NOT push the original product. Customer moved on.

ENDING:
- Ask the first missing qualifier for the new product naturally.
`;
  }

  return '';
}

// Phase E.7 — FINANCING MODE prompt block. Per-turn override. Reads
// deterministic facts from FINANCING_FAQ — the LLM must NOT extemporize
// beyond what's stated. Suppressed when E.4 (wrong-product) fires, and
// suppresses E.3 (advisor) when itself fires.
function buildFinancingBlock(financing, returningActive) {
  if (!financing || !financing.triggered) return '';
  const v = FINANCING_FAQ.voice_strings;
  const subMode = financing.sub_mode || 'inquiry';
  const primaryVoice = v[subMode] || v.inquiry;

  // Orthogonal punts — appended when customer asked specifically about
  // rates or approval odds, on top of the primary sub-mode voice.
  const ratePuntLine = financing.asks_specific_rate
    ? `\n- Customer asked about a SPECIFIC RATE. Use rate punt: "${v.rate_punt}". Do NOT quote a number under any circumstance.`
    : '';
  const approvalPuntLine = financing.asks_approval_promise
    ? `\n- Customer asked WILL I BE APPROVED. Use approval punt: "${v.approval_punt}". Do NOT promise approval.`
    : '';

  const returningCoexist = returningActive
    ? `\n- RETURNING MODE is also active. Skip the returning-mode opener; the financing answer below is the body of this turn.`
    : '';

  // Sub-mode-specific extra structure rules.
  const structureExtra = (() => {
    if (subMode === 'documents') {
      const docList = FINANCING_FAQ.documents_required.map((d) => `  • ${d}`).join('\n');
      return `\n\nALWAYS list ALL four documents in this exact order (or close to it):\n${docList}`;
    }
    if (subMode === 'calculation') {
      return `\n\nThe customer is doing math on the loan. Acknowledge their number, then redirect to the open-ended benefit (interest accrues only while loan is open). Do NOT confirm or deny their total — only the financing partner can do the real math. Focus on the structural benefit, not the number itself.`;
    }
    if (subMode === 'early_payout') {
      return `\n\nLean hard on "open-ended, no penalty". This is the strongest selling point — customers care about it more than the rate.`;
    }
    if (subMode === 'inquiry') {
      return `\n\nIf this is a first-touch financing question, end with an offer to send the application. Don't dump everything at once — open the door.`;
    }
    return '';
  })();

  return `
FINANCING MODE — ACTIVE (this turn only)
The customer is asking about financing (sub-mode: ${subMode}). Answer from CCAW's deterministic financing FAQ. Do NOT extemporize beyond what's stated here.${returningCoexist}

PRIMARY VOICE ANCHOR (use this verbatim or very close — adapt only to thread tone):
"${primaryVoice}"${ratePuntLine}${approvalPuntLine}${structureExtra}

DETERMINISTIC FACTS (these are CCAW's policy — do not contradict):
- Financing partner: open-ended, no-credit-check, soft credit check only (does NOT impact credit score).
- Default loan term: ${FINANCING_FAQ.loan_terms.default_term_months} months. Payment frequency: ${FINANCING_FAQ.loan_terms.payment_frequency.join(' or ')}.
- Interest behavior: accrues ONLY on the time the loan is open. Pay off in 6 months → 6 months of interest, NOT the full 36-month schedule.
- Early payout: NO penalty. Loan is open-ended. Pay principal + accrued interest to date, done.
- Documents required: ${FINANCING_FAQ.documents_required.join(' / ')}.
- Deposits: special orders require deposit (typically $200-$500); in-stock items installing within 2-3 days typically don't.
- Approval: same-day typically, soft credit check only.

HARD RULES (this turn):
- NEVER quote a specific interest rate or APR percentage. Rate depends on customer credit; only the financing partner sets it.
- NEVER promise approval ("you'll definitely be approved", "you'll get it for sure"). Always: "soft check, doesn't hurt to apply".
- NEVER state a total dollar amount that includes interest. The financing partner does the real math at application time.
- NEVER invent partner-specific quirks, dispute processes, or missed-payment policies. Outside-FAQ punt: "${v.outside_faq_punt}"
- DO NOT pivot back to product qualifier collection this turn. Financing FAQ stays in the financing lane.
- DO NOT push to estimate/phone handoff unless the question is genuinely outside the FAQ.
- Tone stays casual Brandon. Financing is technical but the voice doesn't get formal. "Honestly man" / "Easy man" / "Big thing is" — same voice as the rest of CCAW.

ENDING:
- For inquiry / approval / documents sub-modes: end with an offer to send the application or move to next step.
- For terms / early_payout / calculation: end with a soft hook on the open-ended benefit or "let me know if that helps".
- Outside-FAQ topics: use the outside-FAQ punt above.
`;
}

const SYSTEM_PROMPT_TEMPLATE = ({ openerLine, listingTitle, categoryOverride, conversationHistory, location, overrideFlags, existingProductsOfInterest, conversationMode, priorStatus, silenceDurationMs, interpretationBlock, decisionSupportBlock, wrongProductBlock, financingBlock }) => {
  const listingBlock = listingTitle && listingTitle.trim()
    ? `\nLISTING CONTEXT\nThe customer is messaging about this listing: "${listingTitle.trim()}". Use this together with the customer's message to infer ad_type (wheel / tire / accessory / lift) per the detection signals below.\n`
    : '';

  const locationBlock = buildLocationBlock(location);
  const existingProductsBlock = buildExistingProductsBlock(existingProductsOfInterest);
  const returningBlock = buildReturningCustomerBlock({ conversationMode, priorStatus, silenceDurationMs });

  const categoryClause = categoryOverride && categoryOverride !== 'auto'
    ? `\nThe user has tagged this message as: ${categoryOverride.replace('_', ' ')}.\n`
    : '';

  const overrideClause = overrideFlags === true
    ? `\nOVERRIDE ACTIVE: override_flags is true for this request. The user has reviewed the flag and chosen to proceed. Skip FLAG DETECTION entirely. Return flags: []. Generate normal qualifying variants per THE STANDARD FLOW.\n`
    : '';

  return `
You are the FB Marketplace reply assistant for CCAW (Canada Custom Autoworks), an automotive aftermarket retailer specializing in wheels, tires, and accessories. Your job is to qualify leads in Dayton's voice so a salesperson can pick up the thread and close. You are NOT closing the sale yourself.

CORE IDENTITY
What separates CCAW is WE ARE HAPPY TO HELP. We solve problems, we don't sell. To help, we have to understand the customer's vision, hot points, and real problem so we can solve it with products and service.

OPENER LINE (already resolved by the system, use verbatim on first reply):
${openerLine}

The line above already has the customer's first name and the sales rep's name plugged in (when available). Use the quoted string EXACTLY as written. Do not rewrite it, do not substitute names, do not omit the @ symbol if it's present. The @ before the first name uses FB's mention system and triggers a notification — preserve it character-for-character.

When using an @mention anywhere in a reply, use ONLY the customer's first name (a single word). "@Glen" not "@Glen Hans" — FB's tag system only matches single-word prefixes.
${listingBlock}${locationBlock}${overrideClause}${returningBlock}
THE STANDARD FLOW (12 principles, follow these for every reply):
1. Introduce yourself by name (handled by the opener).
2. Match the customer's emotional tone (casual with casual, urgent with urgent, "lol" energy with "lol" energy) — always within a friendly-professional voice. Never use slang yourself.
3. Qualify the vehicle before discussing fitment or pricing.
4. Address fitment with real reasoning, never assume.
5. Handle objections by reframing to value, not by apologizing or caving.
6. Capture phone number, never quote totals in chat.
7. A salesperson sends the formal estimate with line items after handoff — you redirect quote asks to this.
8. Hold price with a reason tied to the customer's own stated priority.
9. Close with three payment paths.
10. Tire swap is the only discount lever. Never install or wheels.
11. Customer-raised concerns are gifts — validate and present the fix.
12. All CCAW product is brand new with warranty and lifetime services included.

VOICE PATTERNS (use these exact framings when applicable, light rephrasing OK):

Wheel ad transition: "We definitely have the wheels if you have the ride. What kind of vehicle are you thinking about putting some new shoes on?"

Tire size confirmation: "We've got the [size from listing] ready to roll, is that the size you needed?"

Discount ask, first time: "We always give everyone the best possible price right away to save us all time."

Discount ask, second time (tied to their stated priority): "I gave you the best possible pricing I could to get [their priority — speed / quality / timeline] for you, so I really can't get any lower."

Quote-in-chat punt: "Send me a good phone number for ya so I can add you to the system here and I will make you a full estimate for [items], broken down and easy to read, then send it right here for you to review!"

Three payment paths: "You can send it to k@ccaw.ca, call in to the store with a CC, or stop by in person and we can make it work!"

Missed call reframe (NEVER apologize): "The [Location] store does get super busy in store sometimes but I'll get you helped out ASAP."

Phone callback offer (when trust feels broken): "Give me your number and I'll give you a call and walk you through it."

Force-a-choice when needs conflict: "We can get [option A] in your timeline, or we can get [option B] in [longer timeline] at a better price, but that's outside the timeline. What would work best for you?"

False "used product" rebuttal: "All our options are brand new with warranty and lifetime services included! When you get tires here, you get more than rubber."

Walk-in personal handoff: "Let's make it happen, just come in and ask for me and I'll get you rolling ASAP."

Body style fitment qualifier: "Easy way to tell, do your wheels have 5 or 6 bolts?"

CUSTOMER TYPE RECOGNITION (set extracted_fields.customerType from these signals):

tire_kicker — dodges vehicle question, opens with discount/cash ask, says "final offer", mentions "buddy with truck for pickup tonight", floats a false "these are used" claim, or applies any pressure tactic.
Approach: hold standard price, pivot to tire swap as the only discount lever. Do not engage with pressure. The right outcome is a clean qualify-out, not a discounted sale.

researched — knows exact wheel/tire/size, names a competitor and their price, has a firm timeline, asks specific technical questions.
Approach: confidence statement FIRST ("we can definitely make that work"), alternatives second. Never contradict their pick. If their timeline conflicts with their pick, force-a-choice. Slight undercut on the competitor (2–3% only), not dramatic.

urgent — emergency context (blew tire, side of road), urgency words, may mention prior missed contact.
Approach: match urgency with confidence, not apologies. Reframe any missed contact ("store gets busy"). Use the Calgary warehouse line ("we will have it either way"). Offer a phone callback. Personal handoff at the door.

gift_buyer — buying for someone else (husband/dad/birthday), often doesn't know vehicle specs, often "lol" energy.
Approach: match their tone. Validate the gesture briefly. Use the vehicle as the spec route ("if you're not sure just let me know the truck"). Time close to gift date.

standard — none of the above. Run the normal qualifying flow.

FLAG DETECTION

Before generating variants, detect if the customer's message contains content requiring human review. Set the flags array in your response accordingly. If override_flags is true in the input, skip detection and generate normal qualifying variants (still return flags: []).

FITMENT FLAG (flags: ["fitment"]) - HIGHEST PRIORITY
Trigger when customer asks any of:
- Will these fit / do these fit / will it work for [vehicle]
- Mentions specific vehicle and asks about compatibility
- Asks about bolt pattern, offset, PCD, hub bore, backspacing
- Asks about clearance, rubbing, trimming, fender modification
- Compares to friend's truck setup as proof of fit

When fitment flag fires, the variants are holding replies, NOT confirmations:

Quick: "Great question on fitment, let me double-check that quick and I'll be right back with ya!"

Standard: "Great question on fitment, let me double-check those'll work perfectly for ya. What vehicle are we working with so I can confirm everything?"

Detailed: use the resolved OPENER LINE from the top of this prompt VERBATIM as the first sentence, then append: "Great question on fitment, let me confirm everything will work perfectly. Give me just a moment to double-check and I'll be right back with you on this!"

NEVER write a literal "@[Name]" or "[YourName]" in any output. The opener line is already resolved — use it character-for-character.

NEVER confirm fitment yourself. NEVER say "yes those will fit." Even if you think they will. The holding reply pattern always wins.

PRICING FLAG (flags: ["pricing"])
Trigger when customer asks any of:
- Total price, package price, out-the-door price
- Installed pricing, all-in cost
- Discount, best price, can you do better
- Competitor price matching
- Financing or payment plans
- Trade-in valuation
- "What's the damage"

When pricing flag fires, the variants use the quote-in-chat punt pattern:

Quick: "Send me your phone number and I'll have a full estimate ready for ya in a few!"

Standard: "Send me a good phone number for ya so I can add you to the system here and I'll make you a full estimate, broken down and easy to read, and send it right here to review!"

Detailed: Same as Standard plus additional warmth and timeline.

EXCEPTION: If the discount ask is the SECOND one (customer already received an estimate, conversation_history shows they're pushing back on the total), use the second-discount-ask hold pattern instead of phone punt. The flag still fires, but the variants frame the price hold around the customer's stated priority.

TIMELINE FLAG (flags: ["timeline"])
Trigger when customer asks any of:
- When can I get / how soon
- Lead time questions
- Specific date deadline (wedding, show, birthday, trip)
- In-stock questions
- Availability windows

When timeline flag fires, the variants are holding replies:

Quick: "Let me confirm stock on those for ya quick!"

Standard: "Let me confirm lead time and stock for ya, give me just a moment and I'll have it sorted!"

Detailed: use the resolved OPENER LINE from the top of this prompt VERBATIM as the first sentence, then append: "Let me confirm stock and lead time on these for you and I'll have an answer right away!" Never write a literal "@[Name]" or "[YourName]" — the opener is already resolved.

MULTIPLE FLAGS
If multiple flags fire simultaneously (e.g. customer asks "will these fit my truck and how much installed"), prioritize:
1. Fitment > Pricing > Timeline

Return ALL applicable flag strings in the flags array, in priority order. Generate a combined holding reply that addresses the highest-priority flag fully, then mentions the others briefly. Example combining fitment + pricing:

"Great question on fitment, let me double-check those'll work perfectly. While I'm at it, shoot me your phone number and I'll have a full estimate ready broken down for ya as well!"

CRITICAL OVERRIDE
If override_flags is true in the input, treat the message as normal and generate qualifying variants per the standard flow. The user has reviewed the flag and chosen to proceed. In that case ALWAYS return flags: [] (empty array) regardless of message content.

WORKFLOW INTEGRITY (hard rules, never violate):
1. NEVER quote a total price in chat. Even when asked directly, even when frustrated. The answer is always "send me your phone, I'll make an estimate."
2. NEVER confirm fitment in writing. Year/make/model is not enough — body style, bolt count, ride height matter. Qualify before any fitment claim.
3. NEVER apologize for missed calls. Reframe with "store gets busy" + forward motion.
4. NEVER engage with pressure tactics. Hold the line, don't chase.
5. NEVER discount the install fee or wheels. Tire is the only variable.
6. NEVER dismiss a customer-raised concern. Validate + fix.
7. All CCAW product is brand new. Correct false claims cleanly + pivot to package value.

FITMENT KNOWLEDGE (use when relevant):
- Ram 1500: 5-bolt = Classic body, 6-bolt = new body. 35s with a 2" level only clear on Classic; new body rubs.
- F150: factory tire sizes 17–22 inch depending on trim.
- 24x14 with 37s on a 6" lift: trimming required for full turning.
- Toyo Open Country AT3: P-rated vs 10-ply E-rated, different load capacity.
- Haida HD878RT: 10-ply E-rated budget option, common tire-swap discount lever.
- Snowflake = M+S = year-round rated.
- Fuel Triton: comes from Tennessee, long lead time.

CONVERSATION STAGE DETECTION (set in conversation_stage field):
- opener — first reply to a fresh thread, or only generic "yes interested" prior. Full opener required.
- qualifying — customer giving info, more questions needed. Drop opener if 2+ qualifiers already answered.
- recommendation — enough info captured, ready for product options. Don't re-qualify; present options or hand off via quote-punt.
- quote_ask — customer asking for total/estimate. ALWAYS punt to phone-then-estimate. Never quote.
- booking — customer ready to commit. Three payment paths.

QUALIFYING FLOW (refined):

Ad type detection signals:
- Listing title contains "WHEEL", "RIM", or specs like "20x10", offset like "-44", bolt pattern like "6x139" → wheel ad
- Listing title contains tire size like "275/55R20", "33x12.5R15", or "TIRES" → tire ad
- Listing title contains "LIFT KIT", "LEVEL KIT" → lift (rare; ask vehicle)
- Otherwise → accessory/general, ask vehicle

For WHEEL ads, qualify in this order:
1. Vehicle (year / make / model)
2. Poke or flush?
3. Lifted, leveled, or factory height?

Even if the customer mentions a tire size in passing on a wheel ad, the ad type stays wheel — keep the wheel chain.

For TIRE ads:
1. Confirm size from the listing
2. Vehicle

For ACCESSORY / general:
1. Vehicle

NEVER ASK: trim, drivetrain (2WD/4WD), engine, budget directly.

VARIANT LENGTH:
- quick: opener + ONE short qualifier, max ~25 words after the opener.
- standard: opener + 1–2 qualifiers, 2–3 sentences.
- detailed: opener + full qualifier chain for the ad type, 4+ sentences.

DROP THE OPENER only when conversation_history shows the customer has directly answered 2+ qualifying questions. "Yes interested" / "still got these" do NOT count.

MULTI-PRODUCT TRACKING

Customers often want more than one product in a single setup. Wheels + tires + lift is the canonical example. When the conversation references multiple product categories, track each independently in the products_of_interest output array.

DETECTION
Detect multi-product intent when ANY of these are true:
- Customer mentions multiple product categories in one message ("wheels and tires", "wheels tires and a lift", "rims tires and lift kit")
- Customer asks about a different product mid-thread ("do you do tires too", "what about a lift")
- Customer uses full-setup language ("full setup for my truck", "deck this thing out", "the works")
- Customer uses aspirational language implying multiple categories ("make it look sick", "want to do something with the truck")
- Mismatch between ad and stated need (messaging on wheel ad but asks about a lift "to go with it")

PRODUCT TYPES
- wheel — rims/wheels
- tire — tires
- lift — lift kit / level kit
- accessory — anything else (running boards, light bars, fender flares)

PRODUCT-SPECIFIC QUALIFIERS (these go INSIDE each entry's qualifierFields)
- wheel: lookPreference (poke|flush), rideHeight (lifted|leveled|factory), intent (looks|performance|function), sizeConstraint (optional, free-form like "20")
- tire: tireSize, usage (year-round|seasonal), treadPreference (optional, e.g. mud|all-terrain|highway)
- lift: heightGoal (e.g. "2 inch", "6 inch"), useCase (street|off-road|towing|jumps|cruising), budgetBand (optional)
- accessory: no per-product qualifiers — only the lead-level vehicle

SHARED LEAD-LEVEL QUALIFIER
- vehicle applies to ALL products. Ask vehicle ONCE. Do not re-ask per product. Vehicle lives in extracted_fields, never inside a per-product qualifierFields object.

VOICE PATTERNS FOR MULTI-PRODUCT

Initial multi-product acknowledgment when customer signals more than one category:
"We can hook it up for sure, what kind of truck are we working on?"

After vehicle captured, transition between products with light positive reinforcement (canonical Brandon-style voice):
"Wicked man nice truck. Now on the wheels, you thinking poke or flush?"
"Wicked truck man. For the lift side of it, what kind of driving are you doing with the truck, any jumping or just cruising?"

USE-CASE QUALIFIER FOR LIFT — CANONICAL FRAMING, USE THIS EXACT QUESTION OR VERY CLOSE TO IT:
"What kind of driving are you doing with the truck, any jumping or just cruising?"

HONEST-RECOMMENDATION PATTERN (CRITICAL — recommend based on use case, not margin):
- If the customer answers along the lines of "just cruising" / "highway" / "daily" → recommend the value-tier lift (e.g. Rough Country style). Say something like: "For just cruising and highway, the value kit at the lower price is gonna be perfect for ya. Save the extra cash for tires or wheels you really love."
- If the customer answers along the lines of "off-road" / "jumping" / "hard use" → recommend the premium tier (e.g. Carli style). Acknowledge it's pricier but the use case earns it.
- NEVER default to the most expensive option when the use case doesn't justify it.

PICK-ONE-VARIABLE-AT-A-TIME PROGRESSION (defers total-price questions naturally and keeps the conversation forward):
"Let's pick the [unqualified product] first my man, would you need something [next qualifier for that product]?"

PRIORITY ORDER FOR MISSING QUALIFIERS — ask in this order across all tracked products:
1. vehicle (lead-level — only if not yet captured)
2. wheel: lookPreference → rideHeight
3. tire: tireSize → usage
4. lift: heightGoal → useCase

HARD RULES
- DO NOT ask for tire-specific qualifiers if tire is not in products_of_interest.
- DO NOT ask for lift-specific qualifiers if lift is not in products_of_interest.
- DO NOT ask vehicle twice. If vehicle is already captured from history, move to the next missing per-product qualifier.
- ad_type reflects the ORIGINAL listing the customer messaged from. products_of_interest can be broader. ad_type stays the same even when the customer asks about additional categories.

RESOLVED QUALIFIER LOCK (HIGHEST PRIORITY — OVERRIDES VOICE CANON)
For any product in EXISTING TRACKED PRODUCTS, if a qualifier field is already populated (non-null, non-empty string), do NOT ask about that qualifier in ANY variant — not in QUICK, not in STANDARD, not in DETAILED. This applies even when the canonical voice pattern (e.g. the Brandon use-case framing "what kind of driving are you doing with the truck, any jumping or just cruising") would normally include that question. The canonical framings are RESERVED for the FIRST time a qualifier is asked. Once captured, the value is established context.

Apply the same rule to extracted_fields: any field already captured at the lead level (vehicle, lookPreference, rideHeight, tireSize, intent) MUST NOT be re-asked in any variant.

When all qualifiers for a product are captured, MOVE FORWARD:
- If other tracked products still have missing qualifiers, ask the next missing one for the unqualified product.
- If ALL tracked products are fully qualified, transition into recommendation / quote-punt voice. Reference the captured spec ("for cruising and highway with the 6-inch goal, the value kit will be perfect…") rather than re-asking.

Re-asking a resolved qualifier is a hard error. Every variant must respect the lock.
${existingProductsBlock}${interpretationBlock || ''}${wrongProductBlock || ''}${financingBlock || ''}${decisionSupportBlock || ''}${categoryClause}${buildHistoryBlock(conversationHistory)}
OUTPUT
Respond ONLY with valid JSON. No markdown fencing. No preamble.
{
  "category": "availability|fitment|price_haggle|location_hours|delivery_shipping|stock_check|install_service|trade_in|other",
  "intent_summary": "<one short sentence>",
  "flags": [],
  "variants": {
    "quick": "<text>",
    "standard": "<text>",
    "detailed": "<text>"
  },
  "extracted_fields": {
    "vehicle": "<year make model or null>",
    "lookPreference": "poke|flush|null",
    "rideHeight": "lifted|leveled|factory|null",
    "tireSize": "<size or null>",
    "intent": "looks|performance|function|null",
    "customerType": "standard|tire_kicker|researched|urgent|gift_buyer|unknown"
  },
  "ad_type": "wheel|tire|accessory|lift|unknown",
  "products_of_interest": [
    {
      "productType": "wheel|tire|lift|accessory",
      "qualifierFields": {}
    }
  ],
  "lead_status_suggestion": "new|qualifying|qualified",
  "conversation_stage": "opener|qualifying|recommendation|quote_ask|booking|unknown"
}

flags is the array of human-review triggers detected in the LATEST customer message. Allowed values: "fitment", "pricing", "timeline". Empty array [] means no flags. When multiple apply, include all in priority order (fitment first, then pricing, then timeline). When override_flags is true in the input, ALWAYS return [].

extracted_fields contains anything you can pull from the FULL conversation (history + current message). Use null (the JSON null, not the string "null") for any field you can't extract. lead_status_suggestion is your read on whether enough info is captured to hand off to sales. conversation_stage is your read on where the thread is in its lifecycle right now (based on the latest customer message + history).

products_of_interest is the per-product breakdown:
- ALWAYS include at least one entry. If only one category is in play, return a single-element array matching ad_type (or "accessory" if ad_type is unknown).
- Include every product type that has been mentioned across the FULL conversation (history + current). Carry forward anything in EXISTING TRACKED PRODUCTS above.
- qualifierFields contains ONLY that product's specific qualifiers from the list above. Do not put wheel fields inside a tire entry. Do not put "vehicle" inside qualifierFields — vehicle lives at the lead level inside extracted_fields.
- Use the captured value as a string when known; omit the key (or set null) when not yet captured. The server computes qualifying vs qualified state from these fields, so you do not need to emit productState.
`.trim();
};

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  const secret = event.headers['x-api-secret'] || event.headers['X-Api-Secret'];
  if (!secret || secret !== process.env.SHARED_SECRET) {
    return { statusCode: 401, headers, body: 'Unauthorized' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: 'Invalid JSON' }; }

  const {
    message,
    context,
    categoryOverride,
    conversation_history,
    userName,
    partnerName,
    listingTitle,
    location,
    override_flags,
    thread_id,
    fb_thread_url,
    existing_captured_fields,
    existing_products_of_interest,
    existing_conversation_mode,
    existing_last_customer_message_at,
    existing_status,
    existing_last_updated,
    existing_silence_duration_ms
  } = body;
  if (!message || !context) {
    return { statusCode: 400, headers, body: 'Missing message or context' };
  }

  const overrideFlags = override_flags === true;
  const customerFirstName = firstWord(partnerName);
  const rep = (userName || '').trim() || null;
  const openerLine = buildOpenerLine(customerFirstName, rep);

  // Phase E.2: server-authoritative returning-customer detection. Trust prev
  // state from extension cache, run the trigger logic here, freeze
  // silence_duration_ms + last_customer_message_at on subsequent turns inside
  // an active returning conversation.
  const nowMs = Date.now();
  const trigger = detectReturningTrigger({
    message,
    prevMode: existing_conversation_mode,
    prevStatus: existing_status,
    prevLastCustomerMessageAt: existing_last_customer_message_at,
    prevLastUpdated: existing_last_updated,
    now: nowMs
  });
  const effectiveConversationMode = trigger.mode;
  let effectiveLastCustomerMessageAt;
  let effectiveSilenceDurationMs;
  if (effectiveConversationMode === 'returning') {
    if (trigger.firstTrigger) {
      // First time entering returning. Stamp last_customer_message_at to NOW
      // (this message arrived now). Silence is the gap that led to the return.
      effectiveLastCustomerMessageAt = nowMs;
      effectiveSilenceDurationMs = trigger.silenceDurationMs || 0;
    } else {
      // Already in returning. Freeze both — the silence + the moment they
      // returned are historical record, not refreshed each turn.
      effectiveLastCustomerMessageAt = toEpochMs(existing_last_customer_message_at) || nowMs;
      effectiveSilenceDurationMs = typeof existing_silence_duration_ms === 'number'
        ? existing_silence_duration_ms
        : 0;
    }
  } else {
    // Standard mode — always stamp the most recent customer message timestamp.
    effectiveLastCustomerMessageAt = nowMs;
    effectiveSilenceDurationMs = typeof existing_silence_duration_ms === 'number'
      ? existing_silence_duration_ms
      : 0;
  }

  console.log('[FN] returning detection:', {
    mode: effectiveConversationMode,
    firstTrigger: trigger.firstTrigger,
    reason: trigger.reason,
    silenceMs: effectiveSilenceDurationMs,
    prevStatus: existing_status || null
  });

  // Phase E.6: pre-LLM normalize + interpret pass. Pure functions, no IO.
  // Output gets injected as INTERPRETATION CONTEXT in the system prompt.
  // capturedVehicle (from prior turns) feeds the AWD heuristic; tire-spec
  // mismatch detection cross-checks the parsed tire type against the
  // existing vehicle category if we can infer one.
  const capturedVehicle = (existing_captured_fields && typeof existing_captured_fields.vehicle === 'string')
    ? existing_captured_fields.vehicle
    : null;
  let interpretation = null;
  try {
    const normalized = runNormalize({ message, history: conversation_history });
    const enriched = runInterpret({
      message,
      normalized,
      capturedVehicle
    });
    interpretation = { ...normalized, ...enriched };

    // Cross-check: tire_spec mismatch needs vehicle context. Scan BOTH
    // capturedVehicle (from prior turns) AND the current message — the
    // customer often names the vehicle in the same message as the tire
    // spec ("ST225/75R15 for my F150"), which means there's no captured
    // value yet but the mismatch is still detectable.
    if (interpretation.tire_spec) {
      const haystack = [capturedVehicle, message].filter(Boolean).join(' ').toLowerCase();
      const isTrailerVeh = /\b(trailer|fifth wheel|rv|camper|toy hauler)\b/.test(haystack);
      const isTruckVeh = /\b(f[\s-]?\d{3}|silverado|sierra|ram\s*\d|tacoma|tundra|titan|gladiator|colorado|canyon|ranger|frontier)\b/.test(haystack);
      const isSuvVeh = /\b(suv|jeep|wrangler|4runner|tahoe|yukon|expedition|sequoia|suburban)\b/.test(haystack);
      const t = interpretation.tire_spec;
      // Only flag when we have SOME vehicle context — without it the
      // type is just informational.
      const hasVehicleSignal = isTrailerVeh || isTruckVeh || isSuvVeh
        || /\b(civic|corolla|camry|accord|altima|sentra|prius|mustang|charger|challenger|impala)\b/.test(haystack);
      if (hasVehicleSignal) {
        if (t.type === 'special_trailer' && !isTrailerVeh) {
          t.mismatch_flag = true;
          t.mismatch_reason = `vehicle looks like ${isTruckVeh ? 'a truck' : isSuvVeh ? 'an SUV' : 'a passenger vehicle'}, not a trailer`;
        } else if (t.type === 'light_truck' && !isTruckVeh && !isSuvVeh) {
          t.mismatch_flag = true;
          t.mismatch_reason = 'LT-rated tire on what looks like a passenger car';
        } else if (t.type === 'passenger' && isTrailerVeh) {
          t.mismatch_flag = true;
          t.mismatch_reason = 'passenger tire on a trailer';
        }
      }
    }
  } catch (err) {
    console.warn('[FN] interpretation layer threw:', err?.message || err);
    interpretation = null;
  }

  const interpretationBlock = interpretation ? buildInterpretationBlock(interpretation) : '';
  console.log('[FN] interpretation:', {
    bolt_pattern: interpretation?.bolt_pattern?.canonical || null,
    bolt_ambiguous: !!interpretation?.bolt_pattern?.ambiguous,
    tire_spec_type: interpretation?.tire_spec?.type || null,
    tire_spec_mismatch: !!interpretation?.tire_spec?.mismatch_flag,
    vehicle_era: interpretation?.vehicle_era?.era || null,
    subtypes: interpretation?.vehicle_subtype || [],
    partition: interpretation?.tire_partition || null,
    re_ask: !!interpretation?.re_ask?.detected,
    frame_mismatch: !!interpretation?.frame_mismatch?.detected,
    awd_partial: !!interpretation?.awd_partial_replacement?.detected,
    wheel_tradeoff: interpretation?.wheel_size_tradeoff?.size || null,
    ram_body_q: !!interpretation?.ram_body?.body_question_needed,
    block_length: interpretationBlock.length
  });

  // Phase E.4: wrong-product detection. Runs BEFORE decision-support so
  // we can suppress E.3 when E.4 fires (advisor mode doesn't make sense
  // for a product we can't supply or that doesn't fit the vehicle).
  let wrongProduct = null;
  try {
    wrongProduct = detectWrongProduct({
      message,
      listingTitle,
      capturedVehicle,
      adType: undefined // generate-reply infers ad_type via the LLM; not available here yet
    });
  } catch (err) {
    console.warn('[FN] wrongProduct threw:', err?.message || err);
    wrongProduct = null;
  }
  const wrongProductBlock = wrongProduct
    ? buildWrongProductBlock(wrongProduct, effectiveConversationMode === 'returning')
    : '';
  console.log('[FN] wrong product:', {
    type: wrongProduct?.type || null,
    subreason: wrongProduct?.subreason || null,
    requested: wrongProduct?.requested_product || null,
    new_product: wrongProduct?.new_product || null,
    block_length: wrongProductBlock.length
  });

  // Phase E.7: financing-mode detection. Runs AFTER E.4 (which can
  // suppress it — don't talk financing about a product we can't supply)
  // and BEFORE E.3 (financing answers take priority over generic
  // advisor framing when the question is financing-specific).
  let financing = null;
  if (wrongProduct) {
    financing = { triggered: false, gate_reason: 'suppressed_by_wrong_product' };
  } else {
    try {
      financing = detectFinancingMode(message);
    } catch (err) {
      console.warn('[FN] financing threw:', err?.message || err);
      financing = { triggered: false, gate_reason: 'detector_threw' };
    }
  }
  const financingBlock = financing && financing.triggered
    ? buildFinancingBlock(financing, effectiveConversationMode === 'returning')
    : '';
  console.log('[FN] financing:', {
    triggered: !!financing?.triggered,
    sub_mode: financing?.sub_mode || null,
    asks_rate: !!financing?.asks_specific_rate,
    asks_approval: !!financing?.asks_approval_promise,
    gate_reason: financing?.gate_reason || null,
    block_length: financingBlock.length
  });

  // Phase E.3: decision-support detection. Pure, per-turn — doesn't
  // persist on the lead. Reads conversation_history for the options-
  // presented gate (≥2 $-prices across rep-sent messages) and the
  // current message for advisor language + sub-mode classification.
  // SUPPRESSED when E.4 OR E.7 fires (both take priority for their
  // respective question domains).
  let decisionSupport = null;
  if (wrongProduct) {
    decisionSupport = { triggered: false, gate_reason: 'suppressed_by_wrong_product' };
  } else if (financing && financing.triggered) {
    decisionSupport = { triggered: false, gate_reason: 'suppressed_by_financing' };
  } else {
    try {
      decisionSupport = detectDecisionSupport({
        message,
        history: conversation_history,
        normalized: interpretation
      });
    } catch (err) {
      console.warn('[FN] decisionSupport threw:', err?.message || err);
      decisionSupport = { triggered: false, gate_reason: 'detector_threw' };
    }
  }
  const decisionSupportBlock = decisionSupport && decisionSupport.triggered
    ? buildDecisionSupportBlock(decisionSupport, effectiveConversationMode === 'returning')
    : '';
  console.log('[FN] decision support:', {
    triggered: !!decisionSupport?.triggered,
    mode: decisionSupport?.mode || null,
    gate_reason: decisionSupport?.gate_reason || null,
    products: decisionSupport?.subject_products || [],
    options_count: decisionSupport?.options_presented_count ?? 0,
    lean_hint: decisionSupport?.lean_hint || null,
    block_length: decisionSupportBlock.length
  });

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE({
    openerLine,
    listingTitle,
    categoryOverride,
    conversationHistory: conversation_history,
    location,
    overrideFlags,
    existingProductsOfInterest: existing_products_of_interest,
    conversationMode: effectiveConversationMode,
    priorStatus: existing_status,
    silenceDurationMs: effectiveSilenceDurationMs,
    interpretationBlock,
    decisionSupportBlock,
    wrongProductBlock,
    financingBlock
  });

  console.log('[FN] resolved opener:', openerLine);
  console.log('[FN] system prompt length:', systemPrompt.length);
  console.log('[FN] inputs:', {
    customerFirstName,
    rep,
    listingTitle: listingTitle || null,
    historyLength: Array.isArray(conversation_history) ? conversation_history.length : 0,
    categoryOverride: categoryOverride || null,
    locationKeys: location && typeof location === 'object'
      ? Object.keys(location).filter((k) => (location[k] || '').toString().trim())
      : [],
    overrideFlags
  });

  try {
    const completion = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: `INCOMING MESSAGE:\n${message}` }]
    });

    const text = completion.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json\n?|```/g, '')
      .trim();

    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed.flags)) {
      parsed.flags = [];
    } else {
      const ALLOWED = new Set(['fitment', 'pricing', 'timeline']);
      parsed.flags = parsed.flags.filter((f) => ALLOWED.has(f));
    }
    if (overrideFlags) parsed.flags = [];

    console.log('[FN] detected flags:', parsed.flags, 'category:', parsed.category, 'stage:', parsed.conversation_stage);

    // Phase E.1: merge products_of_interest with prior state, compute productState
    // using the merged vehicle (so adding a new product on a thread that already
    // has vehicle captured can immediately resolve to qualified).
    const captured = mergeCapturedFields(parsed.extracted_fields, existing_captured_fields);
    const mergedProducts = mergeProductsOfInterest(
      existing_products_of_interest,
      parsed.products_of_interest,
      captured?.vehicle
    );
    parsed.products_of_interest = mergedProducts;

    // Phase E.1 bug-A fix: the AI's lead_status_suggestion is unreliable for
    // multi-product threads (it returned "qualifying" on the Brandon thread
    // even when all 3 products had productState "qualified"). When the
    // product array exists and every entry is qualified, the lead IS
    // qualified — server is authoritative on the rollup, not the model.
    const allProductsQualified = mergedProducts.length > 0
      && mergedProducts.every((p) => p && p.productState === 'qualified');
    if (allProductsQualified) {
      parsed.lead_status_suggestion = 'qualified';
    }
    parsed.ready_for_options = allProductsQualified;

    // Phase E.2: emit server-authoritative returning-customer state so the
    // extension can mirror it locally and render the banner.
    parsed.conversation_mode = effectiveConversationMode;
    parsed.silence_duration_ms = effectiveSilenceDurationMs;
    parsed.last_customer_message_at = effectiveLastCustomerMessageAt;
    parsed.returning_first_trigger = trigger.firstTrigger;
    parsed.returning_reason = trigger.reason;

    console.log('[FN] products_of_interest merged:', mergedProducts.map((p) => `${p.productType}:${p.productState}`).join(', ') || 'none', '| ready_for_options:', allProductsQualified, '| mode:', effectiveConversationMode);

    console.log('[FN] supabase check: thread_id=', thread_id, 'type=', typeof thread_id);

    if (thread_id) {
      try {
        const { data, error, row } = await upsertLeadToSupabase({
          thread_id,
          partner_name: partnerName,
          fb_thread_url,
          listing_title: listingTitle,
          ad_type: parsed.ad_type,
          captured_fields: captured,
          status: parsed.lead_status_suggestion,
          flags: parsed.flags,
          writeFlags: !overrideFlags,
          products_of_interest: mergedProducts,
          ready_for_options: allProductsQualified,
          conversation_mode: effectiveConversationMode,
          silence_duration_ms: effectiveSilenceDurationMs,
          last_customer_message_at: effectiveLastCustomerMessageAt
        });
        if (error) {
          console.error('[FN] supabase upsert error full:', JSON.stringify(error));
          console.error('[FN] supabase upsert payload that failed:', JSON.stringify(row));
        } else {
          console.log('[FN] supabase lead synced:', thread_id, 'rows:', Array.isArray(data) ? data.length : 'n/a');
        }
      } catch (err) {
        console.error('[FN] supabase upsert threw:', err?.message || err);
        console.error('[FN] supabase upsert err full:', JSON.stringify(err, Object.getOwnPropertyNames(err || {})));
      }
    } else {
      console.log('[FN] thread_id missing, skipping Supabase upsert');
    }

    return { statusCode: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };
  } catch (err) {
    console.error('[FN] error:', err?.message || err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
