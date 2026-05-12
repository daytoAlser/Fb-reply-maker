const STORAGE_KEY = 'leads';
const QUALIFIED_BADGE_KEY = 'unviewedQualifiedCount';
const FLAGGED_BADGE_KEY = 'unviewedFlaggedCount';
const BADGE_COLOR = '#f59e0b';
const FLAG_HISTORY_CAP = 20;
const ALLOWED_FLAGS = new Set(['fitment', 'pricing', 'timeline']);
const MIGRATION_FLAG_KEY = 'supabase_migration_v1';

const AUTO_STATUS_RANK = { new: 1, qualifying: 2, qualified: 3 };
const MANUAL_STATUSES = new Set(['contacted', 'closed_won', 'closed_lost', 'stale']);

export function getThreadIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/t\/([^\/?#]+)/);
  return m ? m[1] : null;
}

async function getAllLeadsRaw() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

export async function getAllLeads() {
  const leads = await getAllLeadsRaw();
  return Object.values(leads).sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
}

export async function getLeadByThreadId(threadId) {
  if (!threadId) return null;
  const leads = await getAllLeadsRaw();
  return leads[threadId] || null;
}

function emptyCapturedFields() {
  return {
    vehicle: null,
    lookPreference: null,
    rideHeight: null,
    tireSize: null,
    intent: null,
    customerType: null
  };
}

// Phase E.0: default shape for new state-aware fields. Existing leads that
// pre-date Phase E read these as undefined and the UI/sync layers treat
// undefined and the defaults below as equivalent.
function defaultPhaseEFields() {
  return {
    productsOfInterest: [],
    conversationMode: 'standard',
    lastCustomerMessageAt: null,
    silenceDurationMs: 0,
    manualOptionsLog: []
  };
}

function isMeaningful(v) {
  return v !== null && v !== undefined && v !== '' && v !== 'null';
}

function mergeFields(existing, incoming) {
  const base = { ...emptyCapturedFields(), ...(existing || {}) };
  if (!incoming || typeof incoming !== 'object') return base;
  for (const k of Object.keys(emptyCapturedFields())) {
    if (isMeaningful(incoming[k])) base[k] = incoming[k];
  }
  return base;
}

function meetsQualificationThreshold(adType, fields, productsOfInterest) {
  // Phase E.1: when the lead has tracked products, qualification gates on
  // ALL products being qualified (state computed server-side based on
  // per-product required fields + lead-level vehicle).
  if (Array.isArray(productsOfInterest) && productsOfInterest.length > 0) {
    return productsOfInterest.every((p) => p && p.productState === 'qualified');
  }
  const f = fields || {};
  switch (adType) {
    case 'wheel':
      return isMeaningful(f.vehicle) && isMeaningful(f.lookPreference) && isMeaningful(f.rideHeight);
    case 'tire':
      return isMeaningful(f.tireSize) && isMeaningful(f.vehicle);
    case 'accessory':
    case 'lift':
      return isMeaningful(f.vehicle);
    case 'unknown':
    default:
      return false;
  }
}

function hasAnyCapturedField(fields) {
  if (!fields) return false;
  return Object.values(fields).some(isMeaningful);
}

function pickAutoStatus(currentStatus, qualified, hasField) {
  if (MANUAL_STATUSES.has(currentStatus)) return currentStatus;
  let target = 'new';
  if (qualified) target = 'qualified';
  else if (hasField) target = 'qualifying';
  const currentRank = AUTO_STATUS_RANK[currentStatus] || 0;
  const targetRank = AUTO_STATUS_RANK[target] || 0;
  return targetRank > currentRank ? target : currentStatus;
}

// ----- Badge -----

async function getCount(key) {
  const data = await chrome.storage.local.get(key);
  const v = data[key];
  return typeof v === 'number' && v >= 0 ? v : 0;
}

async function setCount(key, count) {
  const clamped = Math.max(0, Math.floor(count));
  await chrome.storage.local.set({ [key]: clamped });
  await recomputeBadge();
}

async function recomputeBadge() {
  const q = await getCount(QUALIFIED_BADGE_KEY);
  const f = await getCount(FLAGGED_BADGE_KEY);
  const total = Math.max(0, q + f);
  try {
    await chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch (err) {
    console.warn('[FB Reply Maker leads] badge update failed:', err?.message);
  }
}

async function bumpUnviewedQualified(delta) {
  const c = await getCount(QUALIFIED_BADGE_KEY);
  await setCount(QUALIFIED_BADGE_KEY, c + delta);
}

async function bumpUnviewedFlagged(delta) {
  const c = await getCount(FLAGGED_BADGE_KEY);
  await setCount(FLAGGED_BADGE_KEY, c + delta);
}

export async function clearUnviewedQualified() {
  await setCount(QUALIFIED_BADGE_KEY, 0);
}

export async function clearUnviewedFlagged() {
  await setCount(FLAGGED_BADGE_KEY, 0);
}

// ----- Flag lifecycle -----

function applyFlagLifecycle({ prevOpenFlags, prevHistory, newFlags, overrideFlags, customerMessage, now }) {
  const safeNewFlags = Array.isArray(newFlags) ? newFlags.filter((f) => ALLOWED_FLAGS.has(f)) : [];
  let openFlags = prevOpenFlags || [];
  let history = Array.isArray(prevHistory) ? [...prevHistory] : [];

  function markLatestUnresolved(flag, mutator) {
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i];
      if (e && e.flag_type === flag && e.resolved_at == null) {
        history[i] = mutator(e);
        return true;
      }
    }
    return false;
  }

  if (overrideFlags) {
    for (const flag of openFlags) {
      markLatestUnresolved(flag, (e) => ({ ...e, overridden: true }));
    }
  } else if (safeNewFlags.length > 0) {
    for (const flag of safeNewFlags) {
      if (!openFlags.includes(flag)) {
        history.push({
          flag_type: flag,
          fired_at: now,
          overridden: false,
          resolved_at: null,
          customer_message: typeof customerMessage === 'string' ? customerMessage.slice(0, 200) : ''
        });
      }
    }
    openFlags = safeNewFlags;
  } else if (openFlags.length > 0) {
    for (const flag of openFlags) {
      markLatestUnresolved(flag, (e) => ({ ...e, resolved_at: now }));
    }
    openFlags = [];
  }

  if (history.length > FLAG_HISTORY_CAP) {
    history = history.slice(-FLAG_HISTORY_CAP);
  }

  return { openFlags, history };
}

// ----- Cloud sync -----

async function getConfig() {
  const data = await chrome.storage.sync.get('config');
  return data.config || {};
}

function syncEndpointFrom(generateEndpoint) {
  if (!generateEndpoint || typeof generateEndpoint !== 'string') return null;
  return generateEndpoint.replace(/\/generate-reply\b/, '/sync-lead');
}

export async function syncToCloud(action, threadId, data = null) {
  const config = await getConfig();
  if (!config.endpoint || !config.secret) {
    return { ok: false, error: 'missing_config' };
  }
  const syncEndpoint = syncEndpointFrom(config.endpoint);
  if (!syncEndpoint) return { ok: false, error: 'invalid_endpoint' };

  try {
    const response = await fetch(syncEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': config.secret },
      body: JSON.stringify({ action, thread_id: threadId, data })
    });
    const result = await response.json().catch(() => ({ ok: false, error: 'invalid_json' }));
    if (!result.ok) {
      console.error('[FB Reply Maker leads] sync failed:', action, threadId, result.error);
    } else {
      console.log('[FB Reply Maker leads] synced:', action, threadId);
    }
    return result;
  } catch (err) {
    console.error('[FB Reply Maker leads] sync threw:', err?.message);
    return { ok: false, error: err?.message || 'fetch_failed' };
  }
}

async function markLeadSyncPending(threadId, pending) {
  if (!threadId) return;
  const leads = await getAllLeadsRaw();
  if (!leads[threadId]) return;
  leads[threadId].sync_pending = !!pending;
  await chrome.storage.local.set({ [STORAGE_KEY]: leads });
}

function fireAndForgetSync(action, threadId, data) {
  (async () => {
    const result = await syncToCloud(action, threadId, data);
    if (!result.ok) {
      await markLeadSyncPending(threadId, true);
    } else {
      await markLeadSyncPending(threadId, false);
    }
  })().catch((err) => console.error('[FB Reply Maker leads] background sync error:', err));
}

// ----- Main lead update -----

export async function createOrUpdateLead({
  threadId,
  partnerName,
  fbThreadUrl,
  listingTitle,
  adType,
  extractedFields,
  leadStatusSuggestion,
  conversationStage,
  flags,
  overrideFlags,
  customerMessage,
  productsOfInterest
}) {
  if (!threadId) {
    console.warn('[FB Reply Maker leads] createOrUpdateLead: missing threadId, skipping');
    return null;
  }

  const leads = await getAllLeadsRaw();
  const existing = leads[threadId] || null;
  const now = Date.now();

  const prevStatus = existing?.status || 'new';
  const prevFields = existing?.capturedFields || emptyCapturedFields();
  const mergedFields = mergeFields(prevFields, extractedFields);
  const effectiveAdType = (adType && adType !== 'unknown')
    ? adType
    : (existing?.adType && existing.adType !== 'unknown' ? existing.adType : (adType || 'unknown'));

  // Phase E.1: server returns the merged products_of_interest with productState
  // computed. Trust it as authoritative; fall back to prior local copy if the
  // server omitted it (older deploy or AI returned empty).
  const effectiveProducts = Array.isArray(productsOfInterest) && productsOfInterest.length > 0
    ? productsOfInterest
    : (Array.isArray(existing?.productsOfInterest) ? existing.productsOfInterest : []);

  const localQualified = meetsQualificationThreshold(effectiveAdType, mergedFields, effectiveProducts);
  const apiSuggestsQualified = leadStatusSuggestion === 'qualified';
  // Phase E.1: when products_of_interest is in play, the array's per-product
  // state is the source of truth. Ignore the model's bulk lead_status_suggestion
  // if it claims qualified but the products aren't all qualified yet.
  const qualified = effectiveProducts.length > 0
    ? localQualified
    : (localQualified || apiSuggestsQualified);
  const hasField = hasAnyCapturedField(mergedFields) || effectiveProducts.length > 0;

  const newStatus = pickAutoStatus(prevStatus, qualified, hasField);

  const prevOpenFlags = Array.isArray(existing?.open_flags) ? existing.open_flags : [];
  const prevHistory = Array.isArray(existing?.flag_history) ? existing.flag_history : [];

  const { openFlags, history } = applyFlagLifecycle({
    prevOpenFlags,
    prevHistory,
    newFlags: flags,
    overrideFlags: !!overrideFlags,
    customerMessage,
    now
  });

  const phaseEDefaults = defaultPhaseEFields();

  const lead = {
    threadId,
    partnerName: partnerName || existing?.partnerName || null,
    fbThreadUrl: fbThreadUrl || existing?.fbThreadUrl || null,
    listingTitle: listingTitle || existing?.listingTitle || null,
    adType: effectiveAdType,
    capturedFields: mergedFields,
    conversationStage: (isMeaningful(conversationStage) && conversationStage !== 'unknown')
      ? conversationStage
      : (existing?.conversationStage || null),
    status: newStatus,
    open_flags: openFlags,
    flag_history: history,
    // Phase E.0/E.1: state-aware fields. productsOfInterest is overwritten by
    // the server-merged array when present (server is authoritative); carry
    // forward existing otherwise.
    productsOfInterest: effectiveProducts,
    conversationMode: existing?.conversationMode || phaseEDefaults.conversationMode,
    lastCustomerMessageAt: existing?.lastCustomerMessageAt ?? phaseEDefaults.lastCustomerMessageAt,
    silenceDurationMs: typeof existing?.silenceDurationMs === 'number'
      ? existing.silenceDurationMs
      : phaseEDefaults.silenceDurationMs,
    manualOptionsLog: Array.isArray(existing?.manualOptionsLog)
      ? existing.manualOptionsLog
      : phaseEDefaults.manualOptionsLog,
    createdAt: existing?.createdAt || now,
    lastUpdated: now,
    notes: existing?.notes || '',
    sync_pending: existing?.sync_pending || false
  };

  leads[threadId] = lead;
  await chrome.storage.local.set({ [STORAGE_KEY]: leads });

  if (prevStatus !== 'qualified' && newStatus === 'qualified') {
    await bumpUnviewedQualified(+1);
  }
  const hadFlagsBefore = prevOpenFlags.length > 0;
  const hasFlagsNow = openFlags.length > 0;
  if (!hadFlagsBefore && hasFlagsNow) {
    await bumpUnviewedFlagged(+1);
  } else if (hadFlagsBefore && !hasFlagsNow) {
    await bumpUnviewedFlagged(-1);
  }

  // generate-reply.js writes the row itself (D.2.5). Local-only here.
  return lead;
}

export async function updateLeadStatus(threadId, newStatus) {
  if (!threadId || !newStatus) return null;
  const leads = await getAllLeadsRaw();
  const lead = leads[threadId];
  if (!lead) return null;

  const prevStatus = lead.status;
  lead.status = newStatus;
  lead.lastUpdated = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: leads });

  if (prevStatus === 'qualified' && newStatus !== 'qualified') {
    await bumpUnviewedQualified(-1);
  } else if (prevStatus !== 'qualified' && newStatus === 'qualified') {
    await bumpUnviewedQualified(+1);
  }

  fireAndForgetSync('update_status', threadId, { status: newStatus });
  return lead;
}

export async function resolveAllFlags(threadId) {
  if (!threadId) return null;
  const leads = await getAllLeadsRaw();
  const lead = leads[threadId];
  if (!lead) return null;

  const hadOpen = Array.isArray(lead.open_flags) && lead.open_flags.length > 0;
  const now = Date.now();
  lead.flag_history = Array.isArray(lead.flag_history)
    ? lead.flag_history.map((e) => (e && e.resolved_at == null ? { ...e, resolved_at: now } : e))
    : [];
  lead.open_flags = [];
  lead.lastUpdated = now;

  await chrome.storage.local.set({ [STORAGE_KEY]: leads });

  if (hadOpen) await bumpUnviewedFlagged(-1);
  fireAndForgetSync('resolve_flags', threadId);
  return lead;
}

export async function deleteLead(threadId) {
  if (!threadId) return;
  const leads = await getAllLeadsRaw();
  const lead = leads[threadId];
  if (!lead) return;
  if (lead.status === 'qualified') await bumpUnviewedQualified(-1);
  if (Array.isArray(lead.open_flags) && lead.open_flags.length > 0) {
    await bumpUnviewedFlagged(-1);
  }
  delete leads[threadId];
  await chrome.storage.local.set({ [STORAGE_KEY]: leads });
  fireAndForgetSync('delete', threadId);
}

// ----- Migration (D.6) -----

export async function migrateLeadsToSupabase() {
  const flag = await chrome.storage.sync.get(MIGRATION_FLAG_KEY);
  if (flag[MIGRATION_FLAG_KEY]) return { skipped: true };

  const leads = await getAllLeadsRaw();
  const entries = Object.entries(leads);
  if (entries.length === 0) {
    await chrome.storage.sync.set({ [MIGRATION_FLAG_KEY]: true });
    return { migrated: 0 };
  }

  console.log('[FB Reply Maker leads] migrating', entries.length, 'leads to Supabase');
  let allOk = true;
  let migrated = 0;
  for (const [threadId, lead] of entries) {
    const result = await syncToCloud('upsert', threadId, lead);
    if (result.ok) {
      migrated++;
    } else {
      allOk = false;
      console.warn('[FB Reply Maker leads] migration failed for', threadId, result.error);
    }
  }

  if (allOk) {
    await chrome.storage.sync.set({ [MIGRATION_FLAG_KEY]: true });
    console.log('[FB Reply Maker leads] migration complete:', migrated, 'leads');
  } else {
    console.log('[FB Reply Maker leads] migration partial:', migrated, '/', entries.length, '— will retry on next mount');
  }
  return { migrated, total: entries.length, complete: allOk };
}

// ----- Sync-pending retry sweep -----

export async function retrySyncPending() {
  const leads = await getAllLeadsRaw();
  const pending = Object.entries(leads).filter(([, l]) => l && l.sync_pending);
  if (pending.length === 0) return { retried: 0 };

  console.log('[FB Reply Maker leads] retrying', pending.length, 'pending syncs');
  let cleared = 0;
  for (const [threadId, lead] of pending) {
    const result = await syncToCloud('upsert', threadId, lead);
    if (result.ok) {
      lead.sync_pending = false;
      cleared++;
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: leads });
  return { retried: pending.length, cleared };
}
