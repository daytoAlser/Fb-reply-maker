const STORAGE_KEY = 'leads';
const BADGE_KEY = 'unviewedQualifiedCount';
const BADGE_COLOR = '#f59e0b';

const AUTO_STATUS_RANK = { new: 1, qualifying: 2, qualified: 3 };
const MANUAL_STATUSES = new Set(['contacted', 'closed_won', 'closed_lost', 'stale']);

export function getThreadIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/t\/([^\/?#]+)/);
  return m ? m[1] : null;
}

export async function getAllLeads() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const leads = data[STORAGE_KEY] || {};
  return Object.values(leads).sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
}

export async function getLeadByThreadId(threadId) {
  if (!threadId) return null;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const leads = data[STORAGE_KEY] || {};
  return leads[threadId] || null;
}

function emptyCapturedFields() {
  return {
    vehicle: null,
    lookPreference: null,
    rideHeight: null,
    tireSize: null,
    intent: null
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

function meetsQualificationThreshold(adType, fields) {
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

async function getUnviewedCount() {
  const data = await chrome.storage.local.get(BADGE_KEY);
  const v = data[BADGE_KEY];
  return typeof v === 'number' && v >= 0 ? v : 0;
}

async function setUnviewedCount(count) {
  const clamped = Math.max(0, Math.floor(count));
  await chrome.storage.local.set({ [BADGE_KEY]: clamped });
  try {
    await chrome.action.setBadgeText({ text: clamped > 0 ? String(clamped) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch (err) {
    console.warn('[FB Reply Maker leads] badge update failed:', err?.message);
  }
}

async function bumpUnviewedQualified(delta) {
  const c = await getUnviewedCount();
  await setUnviewedCount(c + delta);
}

export async function clearUnviewedQualified() {
  await setUnviewedCount(0);
}

export async function createOrUpdateLead({
  threadId,
  partnerName,
  fbThreadUrl,
  listingTitle,
  adType,
  extractedFields,
  leadStatusSuggestion
}) {
  if (!threadId) {
    console.warn('[FB Reply Maker leads] createOrUpdateLead: missing threadId, skipping');
    return null;
  }

  const data = await chrome.storage.local.get(STORAGE_KEY);
  const leads = data[STORAGE_KEY] || {};
  const existing = leads[threadId] || null;
  const now = Date.now();

  const prevStatus = existing?.status || 'new';
  const prevFields = existing?.capturedFields || emptyCapturedFields();
  const mergedFields = mergeFields(prevFields, extractedFields);
  const effectiveAdType = (adType && adType !== 'unknown')
    ? adType
    : (existing?.adType && existing.adType !== 'unknown' ? existing.adType : (adType || 'unknown'));

  const localQualified = meetsQualificationThreshold(effectiveAdType, mergedFields);
  const apiSuggestsQualified = leadStatusSuggestion === 'qualified';
  const qualified = localQualified || apiSuggestsQualified;
  const hasField = hasAnyCapturedField(mergedFields);

  const newStatus = pickAutoStatus(prevStatus, qualified, hasField);

  const lead = {
    threadId,
    partnerName: partnerName || existing?.partnerName || null,
    fbThreadUrl: fbThreadUrl || existing?.fbThreadUrl || null,
    listingTitle: listingTitle || existing?.listingTitle || null,
    adType: effectiveAdType,
    capturedFields: mergedFields,
    status: newStatus,
    createdAt: existing?.createdAt || now,
    lastUpdated: now,
    notes: existing?.notes || ''
  };

  leads[threadId] = lead;
  await chrome.storage.local.set({ [STORAGE_KEY]: leads });

  const wasQualified = prevStatus === 'qualified';
  const becameQualified = !wasQualified && newStatus === 'qualified';
  if (becameQualified) {
    await bumpUnviewedQualified(+1);
  }

  return lead;
}

export async function updateLeadStatus(threadId, newStatus) {
  if (!threadId || !newStatus) return null;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const leads = data[STORAGE_KEY] || {};
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

  return lead;
}

export async function deleteLead(threadId) {
  if (!threadId) return;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const leads = data[STORAGE_KEY] || {};
  const lead = leads[threadId];
  if (!lead) return;
  if (lead.status === 'qualified') {
    await bumpUnviewedQualified(-1);
  }
  delete leads[threadId];
  await chrome.storage.local.set({ [STORAGE_KEY]: leads });
}
