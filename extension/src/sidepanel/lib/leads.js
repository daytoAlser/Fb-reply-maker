const STORAGE_KEY = 'leads';
const QUALIFIED_BADGE_KEY = 'unviewedQualifiedCount';
const FLAGGED_BADGE_KEY = 'unviewedFlaggedCount';
const BADGE_COLOR = '#f59e0b';
const FLAG_HISTORY_CAP = 20;
// Phase D human-review flags: detected from customer message, auto-clear on
// next clean message.
const HUMAN_REVIEW_FLAGS = new Set(['fitment', 'pricing', 'timeline']);
// Phase E.1 lead-state flags: derived from lead/product state, persist until
// the underlying state changes or the user resolves manually.
const LEAD_STATE_FLAGS = new Set(['ready_for_options']);
const ALLOWED_FLAGS = new Set([...HUMAN_REVIEW_FLAGS, ...LEAD_STATE_FLAGS]);
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
  // Phase E.1 bug-A: operate only on Phase D human-review flags. Lead-state
  // flags (ready_for_options) live in the same open_flags array but follow a
  // different lifecycle: they are added/removed by createOrUpdateLead based
  // on product qualification state, not by message-driven auto-clear.
  const prevReview = (prevOpenFlags || []).filter((f) => HUMAN_REVIEW_FLAGS.has(f));
  const carriedLeadState = (prevOpenFlags || []).filter((f) => LEAD_STATE_FLAGS.has(f));

  const safeNewFlags = Array.isArray(newFlags) ? newFlags.filter((f) => HUMAN_REVIEW_FLAGS.has(f)) : [];
  let reviewOpen = prevReview;
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
    for (const flag of reviewOpen) {
      markLatestUnresolved(flag, (e) => ({ ...e, overridden: true }));
    }
  } else if (safeNewFlags.length > 0) {
    for (const flag of safeNewFlags) {
      if (!reviewOpen.includes(flag)) {
        history.push({
          flag_type: flag,
          fired_at: now,
          overridden: false,
          resolved_at: null,
          customer_message: typeof customerMessage === 'string' ? customerMessage.slice(0, 200) : ''
        });
      }
    }
    reviewOpen = safeNewFlags;
  } else if (reviewOpen.length > 0) {
    for (const flag of reviewOpen) {
      markLatestUnresolved(flag, (e) => ({ ...e, resolved_at: now }));
    }
    reviewOpen = [];
  }

  if (history.length > FLAG_HISTORY_CAP) {
    history = history.slice(-FLAG_HISTORY_CAP);
  }

  // Caller (createOrUpdateLead) layers ready_for_options on top based on
  // product state. We carry forward any previously-set lead-state flags so
  // a clean message doesn't drop them; caller is responsible for the final
  // truth based on current product qualification.
  return { openFlags: reviewOpen, history, carriedLeadState };
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
  productsOfInterest,
  readyForOptions,
  conversationMode,
  silenceDurationMs,
  lastCustomerMessageAt
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

  const { openFlags: reviewOpenFlags, history } = applyFlagLifecycle({
    prevOpenFlags,
    prevHistory,
    newFlags: flags,
    overrideFlags: !!overrideFlags,
    customerMessage,
    now
  });

  // Phase E.1 bug-A: derive ready_for_options from product state. Server
  // sends readyForOptions explicitly; for older responses we also infer
  // it locally from the products array.
  const inferredReady = effectiveProducts.length > 0
    && effectiveProducts.every((p) => p && p.productState === 'qualified');
  const showReady = typeof readyForOptions === 'boolean' ? readyForOptions : inferredReady;
  const hadReadyBefore = prevOpenFlags.includes('ready_for_options');
  let openFlags = [...reviewOpenFlags];
  if (showReady) {
    openFlags.push('ready_for_options');
    if (!hadReadyBefore) {
      history.push({
        flag_type: 'ready_for_options',
        fired_at: now,
        overridden: false,
        resolved_at: null,
        customer_message: ''
      });
    }
  } else if (hadReadyBefore) {
    // Products went back to qualifying — mark the latest ready entry resolved.
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i];
      if (e && e.flag_type === 'ready_for_options' && e.resolved_at == null) {
        history[i] = { ...e, resolved_at: now };
        break;
      }
    }
  }
  if (history.length > FLAG_HISTORY_CAP) {
    history.splice(0, history.length - FLAG_HISTORY_CAP);
  }

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
    // Phase E.2: server is authoritative for conversation_mode / silence /
    // last_customer_message_at. Trust the response; fall back to prior local
    // value when the response omits (older deploy or non-thread generate).
    conversationMode: typeof conversationMode === 'string' && conversationMode
      ? conversationMode
      : (existing?.conversationMode || phaseEDefaults.conversationMode),
    lastCustomerMessageAt: typeof lastCustomerMessageAt === 'number' && lastCustomerMessageAt > 0
      ? lastCustomerMessageAt
      : (existing?.lastCustomerMessageAt ?? phaseEDefaults.lastCustomerMessageAt),
    silenceDurationMs: typeof silenceDurationMs === 'number' && silenceDurationMs >= 0
      ? silenceDurationMs
      : (typeof existing?.silenceDurationMs === 'number'
        ? existing.silenceDurationMs
        : phaseEDefaults.silenceDurationMs),
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

// Phase E.5 — append entries to a lead's manualOptionsLog and flip
// status to options_sent. Used by the "Log Options Sent" form in the
// sidepanel. Each entry shape: { product_type, brand, model, size,
// price, notes, logged_at }. Server-side prompt block reads from the
// merged log on the next generate.
export async function logManualOptionsSent(threadId, entries) {
  if (!threadId || !Array.isArray(entries) || entries.length === 0) return null;
  const leads = await getAllLeadsRaw();
  const lead = leads[threadId];
  if (!lead) return null;

  const now = Date.now();
  const stamped = entries.map((e) => ({
    product_type: (e && e.product_type) || null,
    brand:        (e && e.brand) || null,
    model:        (e && e.model) || null,
    size:         (e && e.size) || null,
    price:        (e && e.price) || null,
    notes:        (e && e.notes) || null,
    logged_at:    now
  })).filter((e) => e.product_type || e.brand || e.model);

  if (stamped.length === 0) return null;

  const prev = Array.isArray(lead.manualOptionsLog) ? lead.manualOptionsLog : [];
  lead.manualOptionsLog = [...prev, ...stamped];

  // Status promotion: only auto-flip when current status is in the
  // auto-rank ladder (new/qualifying/qualified). Manual statuses
  // (contacted, closed_won, closed_lost, stale) are user-driven and
  // shouldn't be overwritten by an options-logged event.
  const prevStatus = lead.status || 'new';
  if (!MANUAL_STATUSES.has(prevStatus)) {
    lead.status = 'options_sent';
    if (prevStatus === 'qualified') await bumpUnviewedQualified(-1);
  }
  lead.lastUpdated = now;

  await chrome.storage.local.set({ [STORAGE_KEY]: leads });
  fireAndForgetSync('upsert', threadId, lead);
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
