// RideStyler API client — server-side port of fitment-xref-v3.2.0/popup.js.
//
// The popup runs an 11-method auth discovery dance on first call and caches
// the winner. On prod the winner is Authorization: ApiKey <key> — we skip
// discovery and use that one method directly.
//
// Three endpoints:
//   POST /Vehicle/GetDescriptions       — vehicle variants for a search string
//   POST /Vehicle/GetFitmentProfile     — fitment profile per ConfigurationID
//                                         (TireOption is null without TireOptionID)
//   POST /Vehicle/GetTireOptionDetails  — OEM tire sizes per ConfigurationID
//                                         (each row has Front/Rear sizes directly)
//
// A module-level LRU cache keyed by endpoint+body deduplicates same-call
// lookups within a warm lambda. Cold on each lambda spin-up.

const RIDESTYLER_BASE = 'https://api.ridestyler.net';
const CACHE_MAX = 50;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU bump
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

async function fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 9000);
  // If the caller passed an outer signal, abort when it fires too.
  if (opts && opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function ridestylerCall(endpoint, body, { signal } = {}) {
  const key = process.env.RIDESTYLER_API_KEY;
  if (!key) return { ok: false, error: 'no_key' };

  const cacheKey = endpoint + ':' + JSON.stringify(body);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = RIDESTYLER_BASE + endpoint;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': 'ApiKey ' + key
  };

  let response;
  try {
    response = await fetchTimeout(
      url,
      { method: 'POST', headers, body: JSON.stringify(body || {}), signal },
      8000
    );
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'network';
    return { ok: false, error: reason };
  }

  if (!response.ok) {
    return { ok: false, error: 'http_' + response.status, status: response.status };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (data && data.Success === false) {
    return { ok: false, error: data.Message || 'rejected', code: data.Code };
  }

  const result = { ok: true, data };
  cacheSet(cacheKey, result);
  return result;
}

export async function getDescriptions(searchString, { signal } = {}) {
  return ridestylerCall('/Vehicle/GetDescriptions', { Search: String(searchString || '') }, { signal });
}

export async function getFitmentProfile({ configurationID, tireOptionID, signal } = {}) {
  const body = { ConfigurationID: configurationID };
  if (tireOptionID) body.TireOptionID = tireOptionID;
  return ridestylerCall('/Vehicle/GetFitmentProfile', body, { signal });
}

export async function getTireOptionDetails(configurationID, { signal } = {}) {
  return ridestylerCall(
    '/Vehicle/GetTireOptionDetails',
    { vehicleConfiguration: configurationID },
    { signal }
  );
}
