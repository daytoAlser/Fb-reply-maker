// Phase F.1 — full-screen lead center: API helpers, RPC wrappers, cache.

const CACHE_KEY_PREFIX = 'cached_variants:';

function listLeadsEndpointFrom(generateEndpoint) {
  if (!generateEndpoint || typeof generateEndpoint !== 'string') return null;
  return generateEndpoint.replace(/\/generate-reply\b/, '/list-leads');
}

export async function loadSettings() {
  const data = await chrome.storage.sync.get(['userName', 'config', 'context', 'location']);
  return {
    userName: typeof data.userName === 'string' ? data.userName : '',
    config: data.config || {},
    context: data.context || null,
    location: data.location || null
  };
}

export async function listLeads({ endpoint, secret, limit = 500 } = {}) {
  const url = listLeadsEndpointFrom(endpoint);
  if (!url) throw new Error('list-leads endpoint unavailable');
  const res = await fetch(`${url}?limit=${encodeURIComponent(limit)}`, {
    method: 'GET',
    headers: { 'x-api-secret': secret }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text || res.statusText}`);
  }
  return res.json();
}

export async function getThreadHistory(threadId) {
  if (!threadId) return { ok: false, reason: 'no_thread_id' };
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'F1_GET_THREAD_HISTORY', thread_id: threadId }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, reason: 'no_response' });
    });
  });
}

export async function requestRegenerate(threadId) {
  if (!threadId) return { ok: false, reason: 'no_thread_id' };
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'F1_REGENERATE', thread_id: threadId }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, reason: 'no_response' });
    });
  });
}

// Phase F.1.5 — live inbox RPCs. step 1: GET. step 3: SCROLL.
export async function getInboxList() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'F1_5_GET_INBOX' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, reason: 'no_response' });
    });
  });
}

export async function scrollInboxDown() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'F1_5_SCROLL_INBOX' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, reason: 'no_response' });
    });
  });
}

export async function focusFbTab(threadId) {
  if (!threadId) return { ok: false, reason: 'no_thread_id' };
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'F1_FOCUS_FB_TAB', thread_id: threadId }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, reason: 'no_response' });
    });
  });
}

export async function readCachedVariants(threadId) {
  if (!threadId) return null;
  const key = CACHE_KEY_PREFIX + threadId;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

export async function readAllCachedVariants() {
  const all = await chrome.storage.local.get(null);
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(CACHE_KEY_PREFIX) && v) {
      out[k.slice(CACHE_KEY_PREFIX.length)] = v;
    }
  }
  return out;
}
