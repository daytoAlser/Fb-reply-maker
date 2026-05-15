// Vehicle make/model → canonical bolt pattern.
//
// Used by wheelInventoryLookup to resolve the bolt pattern needed for a
// wheel search query. Returns null for vehicles we don't have high
// confidence on — the prompt will fall back to asking the customer.
//
// Scope is intentionally narrow: only vehicles we sell wheels to often.
// Each entry's regex should ONLY match unambiguous strings (e.g., "ram
// 1500" alone doesn't disambiguate body style for bolt pattern, but
// "tacoma" is unambiguous so it's included).

const VEHICLE_TO_BOLT = [
  // ── Toyota trucks / SUVs ─────────────────────────────────────────
  { match: /\btacoma\b/i,                          pattern: '6x139.7' },
  { match: /\btundra\b/i,                          pattern: '5x150' },
  { match: /\b4[-\s]?runner\b/i,                   pattern: '6x139.7' },
  { match: /\bsequoia\b/i,                         pattern: '5x150' },

  // ── Ford trucks / SUVs ──────────────────────────────────────────
  // F-150 went from 6x135 (modern 2004+) — older F-150s ran 5x135.
  { match: /\bf[\s-]?150\b/i,                      pattern: '6x135' },
  { match: /\bf[\s-]?250\b/i,                      pattern: '8x170' },
  { match: /\bf[\s-]?350\b/i,                      pattern: '8x170' },
  { match: /\branger\b/i,                          pattern: '6x139.7' },
  { match: /\bexpedition\b/i,                      pattern: '6x135' },
  { match: /\bbronco\s+sport\b/i,                  pattern: '5x108' },
  { match: /\bbronco\b/i,                          pattern: '6x139.7' },

  // ── GM trucks / SUVs ────────────────────────────────────────────
  { match: /\b(silverado|sierra)\s*1500\b/i,       pattern: '6x139.7' },
  { match: /\b(silverado|sierra)\s*(2500|3500)\b/i, pattern: '8x180' },
  { match: /\b(colorado|canyon)\b/i,               pattern: '6x120' },
  { match: /\b(tahoe|yukon|suburban|escalade)\b/i, pattern: '6x139.7' },

  // ── Ram trucks ──────────────────────────────────────────────────
  // Ram 1500 ambiguity: Classic body = 5x139.7, new body = 6x139.7.
  // Without body-style signal, we DON'T resolve — leave it null.
  { match: /\bram\s*(2500|3500)\b/i,               pattern: '8x165.1' },

  // ── Nissan trucks ───────────────────────────────────────────────
  { match: /\btitan\b/i,                           pattern: '6x139.7' },
  { match: /\bfrontier\b/i,                        pattern: '6x114.3' },

  // ── Jeep ────────────────────────────────────────────────────────
  { match: /\bgladiator\b/i,                       pattern: '5x127' },
  { match: /\bwrangler\b/i,                        pattern: '5x127' },
  { match: /\bgrand\s+cherokee\b/i,                pattern: '5x127' }
];

// Resolves a vehicle string ("2026 Tacoma", "F-150 Lariat", "tundra")
// to a canonical bolt pattern. Returns the canonical pattern string
// (e.g., "6x139.7") or null if we don't have a confident match.
export function resolveBoltPatternFromVehicle(vehicleStr) {
  if (typeof vehicleStr !== 'string' || !vehicleStr.trim()) return null;
  for (const entry of VEHICLE_TO_BOLT) {
    if (entry.match.test(vehicleStr)) return entry.pattern;
  }
  return null;
}
