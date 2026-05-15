// Fitment lookup — uses RideStyler to resolve vehicle -> bolt pattern,
// OEM tire size, offset/diameter/width ranges, lug specs, hub bore, TPMS,
// runflat, and staggered flags. Runs in parallel with the other inventory
// lookups in generate-reply.js and produces a free-text context block the
// LLM reads as SOURCE OF TRUTH for fitment questions.
//
// Flow:
//   1. Parse the captured/extracted vehicle string with parseVehicleQuery.
//   2. GetDescriptions(search) -> up to ~60 ConfigurationID variants.
//   3. Cap to one variant per unique (DriveType, Trim) tuple, max 6 total.
//   4. Per variant in parallel: GetFitmentProfile + GetTireOptionDetails.
//   5. Cluster by bolt pattern, aggregate ranges, dedupe tire sizes,
//      emit a per_variant map alongside the roll-up.

import { parseVehicleQuery } from '../fitment/queryParser.js';
import {
  getDescriptions,
  getFitmentProfile,
  getTireOptionDetails
} from '../fitment/ridestylerClient.js';

const MAX_PROFILED_VARIANTS = 6;
const SECONDARY_CLUSTER_THRESHOLD = 0.20;

// Resolves a vehicle string out of captured fields, current message, or
// conversation history. Mirrors wheelInventoryLookup.resolveVehicle but
// does NOT require resolveBoltPatternFromVehicle to hit — RideStyler is
// the lookup, not the hardcoded table.
function resolveVehicle({ capturedFields, conversationHistory, message }) {
  if (capturedFields && typeof capturedFields.vehicle === 'string' && capturedFields.vehicle.trim()) {
    return { vehicle: capturedFields.vehicle.trim(), source: 'captured_field' };
  }
  // Anything with a 4-digit year + something else is a plausible vehicle
  // string. Be loose; parseVehicleQuery will reject if it can't extract
  // year+make.
  const scan = (text) => {
    if (typeof text !== 'string' || !text.trim()) return null;
    const parsed = parseVehicleQuery(text);
    if (parsed.year && parsed.make) return text.trim();
    return null;
  };
  const fromMsg = scan(message);
  if (fromMsg) return { vehicle: fromMsg, source: 'current_message' };
  if (Array.isArray(conversationHistory)) {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const m = conversationHistory[i];
      const t = m && (m.text || m.content || m.message);
      const v = scan(t);
      if (v) return { vehicle: v, source: 'conversation_history' };
    }
  }
  return null;
}

// Canonical bolt pattern string from a Profile object. Returns null when
// either field is missing.
function canonicalBoltPattern(profile) {
  if (!profile) return null;
  const lugs = profile.BoltCount;
  const mm = profile.BoltSpacingMM;
  if (lugs == null || mm == null) return null;
  const rounded = Math.round(Number(mm) * 10) / 10;
  return `${lugs}x${rounded}`;
}

function normalizeTireSize(raw) {
  if (!raw) return null;
  const s = String(raw);
  const m = s.match(/(\d{3})\/(\d{2})R(\d{2})/);
  return m ? `${m[1]}/${m[2]}R${m[3]}` : s;
}

function normalizeLugThread(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+)\s*mm\s*x\s*([\d.]+)/i);
  return m ? `M${m[1]}x${parseFloat(m[2])}` : String(raw);
}

function normalizeLugType(raw) {
  if (!raw) return null;
  const t = String(raw).toLowerCase();
  if (t.includes('bolt')) return 'Bolts';
  if (t.includes('nut')) return 'Nuts';
  return String(raw);
}

// Extracts tire option records out of a GetTireOptionDetails response.
// The array field varies — popup probes Details / TireOptionDetails /
// TireOptions / Options / Tires / Results. Returns [] on miss.
function extractTireOptions(data) {
  if (!data || typeof data !== 'object') return [];
  const candidates = ['Details', 'TireOptionDetails', 'TireOptions', 'Options', 'Tires', 'Results'];
  for (const field of candidates) {
    const arr = data[field];
    if (Array.isArray(arr) && arr.length > 0) return arr;
  }
  // Maybe the root IS the tire record
  if (data.Front || data.Rear) return [data];
  return [];
}

// Each tire option row may carry Front/Rear at the top level OR nested
// inside TireOption — popup handles both shapes.
function tireOptionSides(row) {
  if (!row) return { front: null, rear: null };
  const front = row.Front || (row.TireOption && row.TireOption.Front) || null;
  const rear = row.Rear || (row.TireOption && row.TireOption.Rear) || null;
  return { front, rear };
}

// One variant per unique (DriveType, Trim) tuple, capped at MAX_PROFILED.
// Preserves the order GetDescriptions returned (which is roughly
// SearchConfidence descending).
function selectVariantsForProfiling(descriptions) {
  const seen = new Set();
  const picks = [];
  for (const d of descriptions) {
    if (!d || !d.ConfigurationID) continue;
    const tuple = `${d.DriveType || ''}|${d.Trim || ''}`;
    if (seen.has(tuple)) continue;
    seen.add(tuple);
    picks.push(d);
    if (picks.length >= MAX_PROFILED_VARIANTS) break;
  }
  return picks;
}

function rangeFrom(rangesObj, prefix) {
  if (!rangesObj) return null;
  const min = rangesObj[`VehicleFitment${prefix}Min`];
  const max = rangesObj[`VehicleFitment${prefix}Max`];
  if (min == null && max == null) return null;
  return {
    min: min == null ? null : Math.round(Number(min) * 10) / 10,
    max: max == null ? null : Math.round(Number(max) * 10) / 10
  };
}

function combineRange(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    min: a.min == null ? b.min : (b.min == null ? a.min : Math.min(a.min, b.min)),
    max: a.max == null ? b.max : (b.max == null ? a.max : Math.max(a.max, b.max))
  };
}

export async function lookupFitment({
  message,
  capturedFields,
  conversationHistory,
  signal
} = {}) {
  if (!process.env.RIDESTYLER_API_KEY) {
    return { triggered: false, gate_reason: 'no_ridestyler_key' };
  }

  const resolved = resolveVehicle({ capturedFields, conversationHistory, message });
  if (!resolved) return { triggered: false, gate_reason: 'no_vehicle_resolvable' };

  const parsed = parseVehicleQuery(resolved.vehicle);
  if (!parsed.year || !parsed.make) {
    return { triggered: false, gate_reason: 'incomplete_vehicle_query', vehicle: resolved.vehicle };
  }

  const descResp = await getDescriptions(parsed.searchString, { signal });
  if (!descResp.ok) {
    return {
      triggered: false,
      gate_reason: 'lookup_failed',
      vehicle: resolved.vehicle,
      error: descResp.error
    };
  }

  const descriptions = (descResp.data && Array.isArray(descResp.data.Descriptions))
    ? descResp.data.Descriptions
    : [];
  if (descriptions.length === 0) {
    return {
      triggered: false,
      gate_reason: 'no_matches',
      vehicle: resolved.vehicle,
      search: parsed.searchString
    };
  }

  const picked = selectVariantsForProfiling(descriptions);
  if (picked.length === 0) {
    return {
      triggered: false,
      gate_reason: 'no_matches',
      vehicle: resolved.vehicle,
      search: parsed.searchString
    };
  }

  // Fan out: each variant gets a Profile + TireOptionDetails call in
  // parallel. Failures per variant are tolerated — we just skip that
  // variant in the merge step.
  const variantResults = await Promise.all(picked.map(async (desc) => {
    const [profileResp, tireResp] = await Promise.all([
      getFitmentProfile({ configurationID: desc.ConfigurationID, signal }),
      getTireOptionDetails(desc.ConfigurationID, { signal })
    ]);
    return { desc, profileResp, tireResp };
  }));

  // Merge per variant
  const variants = [];
  let aggOffset = null;
  let aggDiameter = null;
  let aggWidth = null;
  let hubBoreMm = null;
  let lugType = null;
  let threadPitch = null;
  let lugTorqueFtLb = null;
  let lugTorqueNm = null;
  const tireSizeSet = new Set();
  const staggeredPairsKey = new Set();
  const staggeredPairs = [];
  const driveTypes = new Set();
  let anyTpms = false;
  let anyRunflat = false;
  let anyStaggered = false;

  for (const { desc, profileResp, tireResp } of variantResults) {
    if (!profileResp || !profileResp.ok) continue;
    const profile = profileResp.data && profileResp.data.Profile;
    if (!profile) continue;

    const boltPattern = canonicalBoltPattern(profile);
    const rangesFront = profile.RangesFront && profile.RangesFront[0];
    const rangesRear = profile.RangesRear && profile.RangesRear[0];

    const offsetF = rangeFrom(rangesFront, 'Offset');
    const offsetR = rangeFrom(rangesRear, 'Offset');
    const diameterF = rangeFrom(rangesFront, 'Diameter');
    const diameterR = rangeFrom(rangesRear, 'Diameter');
    const widthF = rangeFrom(rangesFront, 'Width');
    const widthR = rangeFrom(rangesRear, 'Width');

    aggOffset = combineRange(combineRange(aggOffset, offsetF), offsetR);
    aggDiameter = combineRange(combineRange(aggDiameter, diameterF), diameterR);
    aggWidth = combineRange(combineRange(aggWidth, widthF), widthR);

    if (hubBoreMm == null) {
      const hubF = rangesFront && rangesFront.VehicleFitmentHub;
      const hubR = rangesRear && rangesRear.VehicleFitmentHub;
      const hub = hubF != null ? hubF : hubR;
      if (hub != null) hubBoreMm = Math.round(Number(hub) * 10) / 10;
    }
    if (!lugType && profile.LugType && profile.LugType.LugTypeName) {
      lugType = normalizeLugType(profile.LugType.LugTypeName);
    }
    if (!threadPitch && profile.LugThread && profile.LugThread.LugThreadName) {
      threadPitch = normalizeLugThread(profile.LugThread.LugThreadName);
    }
    if (lugTorqueFtLb == null && profile.LugTorque) {
      if (profile.LugTorque.FtLbs != null) lugTorqueFtLb = Number(profile.LugTorque.FtLbs);
      if (profile.LugTorque.Nm != null) lugTorqueNm = Number(profile.LugTorque.Nm);
    }

    if (desc.DriveType) driveTypes.add(String(desc.DriveType));
    if (desc.HasTPMS) anyTpms = true;
    if (desc.HasRunFlat) anyRunflat = true;

    // Tire options for this variant. May yield multiple OEM packages.
    const tireRows = tireResp && tireResp.ok ? extractTireOptions(tireResp.data) : [];
    const variantTireSizes = [];
    for (const row of tireRows) {
      const sides = tireOptionSides(row);
      const fSize = normalizeTireSize(sides.front && (sides.front.Size || sides.front.Description));
      const rSize = normalizeTireSize(sides.rear && (sides.rear.Size || sides.rear.Description));
      if (!fSize && !rSize) continue;
      const isStaggered = !!(fSize && rSize && fSize !== rSize);
      if (isStaggered) {
        anyStaggered = true;
        const key = `${fSize}|${rSize}`;
        if (!staggeredPairsKey.has(key)) {
          staggeredPairsKey.add(key);
          staggeredPairs.push({ front: fSize, rear: rSize });
        }
      }
      if (fSize) tireSizeSet.add(fSize);
      if (rSize) tireSizeSet.add(rSize);
      variantTireSizes.push({
        front: fSize,
        rear: rSize || fSize,
        staggered: isStaggered
      });
    }

    variants.push({
      trim: desc.Trim || null,
      drivetrain: desc.DriveType || null,
      cab: desc.CabType || desc.Cab || null,
      bed: desc.BedLength || desc.Bed || null,
      bolt_pattern: boltPattern,
      tire_sizes: variantTireSizes,
      full_description: desc.FullDescription || null
    });
  }

  if (variants.length === 0) {
    return {
      triggered: false,
      gate_reason: 'no_profile_data',
      vehicle: resolved.vehicle,
      variants_found: descriptions.length
    };
  }

  // Cluster by bolt pattern. Dominant cluster wins; secondary surfaces
  // only when it holds >= 20% of the profiled variants.
  const clusterCounts = new Map();
  for (const v of variants) {
    if (!v.bolt_pattern) continue;
    clusterCounts.set(v.bolt_pattern, (clusterCounts.get(v.bolt_pattern) || 0) + 1);
  }
  const sortedClusters = [...clusterCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = sortedClusters[0] ? sortedClusters[0][0] : null;
  const secondaryEntry = sortedClusters[1] || null;
  const secondary = secondaryEntry && (secondaryEntry[1] / variants.length) >= SECONDARY_CLUSTER_THRESHOLD
    ? secondaryEntry[0]
    : null;

  let boltPatternNote = null;
  if (secondary) {
    boltPatternNote = `Two bolt patterns observed across variants — ${dominant} and ${secondary}. Ask the customer for body style / trim before quoting wheel options.`;
  }

  return {
    triggered: true,
    vehicle: resolved.vehicle,
    vehicle_normalized: parsed.searchString,
    vehicle_source: resolved.source,
    variants_found: descriptions.length,
    variants_profiled: variants.length,
    bolt_pattern: dominant,
    bolt_pattern_secondary: secondary,
    bolt_pattern_note: boltPatternNote,
    oem_tire_sizes: [...tireSizeSet].sort(),
    oem_tire_staggered: anyStaggered,
    oem_tire_staggered_pairs: staggeredPairs,
    hub_bore_mm: hubBoreMm,
    lug_type: lugType,
    thread_pitch: threadPitch,
    lug_torque_ftlb: lugTorqueFtLb,
    lug_torque_nm: lugTorqueNm,
    wheel_diameter_range: aggDiameter,
    wheel_width_range: aggWidth,
    offset_range: aggOffset,
    has_tpms: anyTpms,
    has_runflat: anyRunflat,
    drive_types: [...driveTypes],
    per_variant: variants,
    source: 'ridestyler'
  };
}
