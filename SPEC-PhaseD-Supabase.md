# Phase D Supabase Addendum

Adds cloud sync to the existing Phase D build. Supabase is the source of truth for leads. chrome.storage.local is a local cache. The system works offline (cache reads) but writes always attempt to sync.

Read this AFTER SPEC-PhaseD.md. This document augments, does not replace.

---

## 1. Architecture Decision

**Chrome.storage.local is the cache. Supabase is the source of truth.**

Three reasons:

1. **Offline resilience.** The extension reads from local storage. Network failures don't break the UI.
2. **Write-through pattern.** Every lead update writes to local AND syncs to Supabase. If Supabase write fails, lead is flagged `sync_pending` and retried on next generate.
3. **Single source for multi-device later.** When you go multi-device in Phase E or F, Supabase is already the authoritative store. The migration is "extension reads from Supabase on startup" instead of "everything is broken."

**Write paths:**

| Trigger | Who writes |
|---|---|
| Generate Replies (new or updated lead) | Netlify function writes directly to Supabase using `service_role` key (server-side, atomic with API call) |
| Mark Contacted / Closed Won / Closed Lost / Stale / Delete | Side panel calls a new Netlify endpoint that updates Supabase |
| Mark Flags Resolved | Side panel calls the same sync endpoint |
| Any chrome.storage write | Always happens immediately, regardless of Supabase status |

The extension never talks to Supabase directly. All writes go through Netlify. This keeps the `service_role` key server-side and gives us one place to enforce auth.

---

## 2. New Netlify Function: sync-lead

Create `netlify/functions/sync-lead.js`. This handles all lead updates that originate from the extension (not from generate-reply, which writes directly).

### 2.1 Endpoint Contract

`POST /.netlify/functions/sync-lead`

Headers:
```
x-api-secret: <SHARED_SECRET>
Content-Type: application/json
```

Body:
```json
{
  "action": "upsert" | "delete" | "update_status" | "resolve_flags",
  "thread_id": "1325410602747031",
  "data": {
    // full lead object for upsert, or partial for update_status
  }
}
```

Response:
```json
{
  "ok": true,
  "thread_id": "1325410602747031",
  "action": "update_status",
  "supabase_response": { ... }
}
```

On failure:
```json
{
  "ok": false,
  "error": "<message>",
  "should_retry": true | false
}
```

### 2.2 Action Types

| Action | Body | What it does |
|---|---|---|
| `upsert` | Full lead object | Insert or update lead in Supabase. Used for migration of existing local leads. |
| `update_status` | `{ status: "contacted" }` | Update only the status field + last_updated timestamp |
| `resolve_flags` | none beyond thread_id | Clear open_flags array, set resolved_at on flag_history entries |
| `delete` | none beyond thread_id | Hard delete from Supabase |

### 2.3 Implementation Skeleton

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  const secret = event.headers['x-api-secret'] || event.headers['X-Api-Secret'];
  if (secret !== process.env.SHARED_SECRET) {
    return { statusCode: 401, headers, body: 'Unauthorized' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: 'Invalid JSON' }; }

  const { action, thread_id, data } = body;
  if (!action || !thread_id) {
    return { statusCode: 400, headers, body: 'Missing action or thread_id' };
  }

  try {
    let result;
    switch (action) {
      case 'upsert':
        result = await supabase.from('leads').upsert(mapToDb(data, thread_id)).select();
        break;
      case 'update_status':
        result = await supabase.from('leads').update({
          status: data.status,
          last_updated: new Date().toISOString()
        }).eq('thread_id', thread_id).select();
        break;
      case 'resolve_flags':
        // Get current flag_history, mark all open as resolved
        const { data: current } = await supabase.from('leads').select('flag_history').eq('thread_id', thread_id).single();
        const updated = (current.flag_history || []).map(f => 
          f.resolved_at ? f : { ...f, resolved_at: Date.now() }
        );
        result = await supabase.from('leads').update({
          open_flags: [],
          flag_history: updated,
          last_updated: new Date().toISOString()
        }).eq('thread_id', thread_id).select();
        break;
      case 'delete':
        result = await supabase.from('leads').delete().eq('thread_id', thread_id);
        break;
      default:
        return { statusCode: 400, headers, body: `Unknown action: ${action}` };
    }

    if (result.error) throw new Error(result.error.message);

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, thread_id, action, supabase_response: result })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message, should_retry: true })
    };
  }
}

// Map camelCase extension lead → snake_case Supabase row
function mapToDb(lead, threadId) {
  return {
    thread_id: threadId,
    partner_name: lead.partnerName,
    fb_thread_url: lead.fbThreadUrl,
    listing_title: lead.listingTitle,
    ad_type: lead.adType,
    captured_fields: lead.capturedFields || {},
    status: lead.status,
    open_flags: lead.open_flags || [],
    flag_history: lead.flag_history || [],
    notes: lead.notes || '',
    created_at: lead.createdAt ? new Date(lead.createdAt).toISOString() : new Date().toISOString(),
    last_updated: lead.lastUpdated ? new Date(lead.lastUpdated).toISOString() : new Date().toISOString()
  };
}
```

---

## 3. generate-reply.js Update

Add lead upsert to Supabase directly inside the function. The extension was previously the only writer; now the function writes server-side too.

### 3.1 New code path

After the Anthropic API returns and the response is parsed, BEFORE returning to the extension:

```javascript
// (existing code that calls Anthropic and parses response)

// NEW: Write lead to Supabase if we have a thread_id
if (body.thread_id && parsed.extracted_fields) {
  try {
    const leadRow = {
      thread_id: body.thread_id,
      partner_name: body.partnerName,
      fb_thread_url: body.fb_thread_url,
      listing_title: body.listingTitle,
      ad_type: parsed.ad_type,
      // Note: captured_fields merge is the extension's job. Server just stores latest.
      // For now, server upserts what extension would compute. Phase E can refine.
      captured_fields: mergeCapturedFields(parsed.extracted_fields, body.existing_captured_fields),
      status: parsed.lead_status_suggestion,
      open_flags: parsed.flags || [],
      // flag_history is managed by extension, server merges on upsert
      last_updated: new Date().toISOString()
    };

    const { error } = await supabase.from('leads').upsert(leadRow, {
      onConflict: 'thread_id',
      ignoreDuplicates: false
    });

    if (error) {
      console.error('[FN] supabase upsert failed:', error.message);
      // Don't fail the API call. Extension will retry on next generate via sync-pending logic.
    } else {
      console.log('[FN] supabase lead synced:', body.thread_id);
    }
  } catch (err) {
    console.error('[FN] supabase write threw:', err.message);
  }
}

// (existing code that returns response to extension)
```

### 3.2 New Request Fields

The side panel sends two new fields in the generate-reply request:

| Field | Why |
|---|---|
| `thread_id` | The FB thread ID extracted from URL, used as Supabase primary key |
| `existing_captured_fields` | What the extension already has in local storage for this lead, so server can compute the merge correctly |
| `fb_thread_url` | Already passed, kept for Supabase row |

---

## 4. Extension Updates

### 4.1 leads.js Sync Layer

Add a `syncToCloud()` function that wraps the Netlify call:

```javascript
async function syncToCloud(action, thread_id, data = null) {
  const config = await getConfig(); // existing function that loads endpoint + secret
  if (!config.endpoint || !config.secret) {
    console.warn('[FB Reply Maker SP] sync skipped: missing endpoint or secret');
    return { ok: false, error: 'missing_config' };
  }

  const syncEndpoint = config.endpoint.replace('/generate-reply', '/sync-lead');

  try {
    const response = await fetch(syncEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': config.secret
      },
      body: JSON.stringify({ action, thread_id, data })
    });

    const result = await response.json();
    if (!result.ok) {
      console.error('[FB Reply Maker SP] sync failed:', result.error);
      await markLeadSyncPending(thread_id);
    } else {
      console.log('[FB Reply Maker SP] synced:', action, thread_id);
      await clearLeadSyncPending(thread_id);
    }
    return result;
  } catch (err) {
    console.error('[FB Reply Maker SP] sync error:', err.message);
    await markLeadSyncPending(thread_id);
    return { ok: false, error: err.message };
  }
}
```

### 4.2 Sync-Pending Retry

Add a `sync_pending: true` flag to lead objects when Supabase write fails. On next Generate Replies, before generating, check all leads for `sync_pending: true` and retry sync.

This makes the system resilient to temporary Supabase downtime or network issues.

### 4.3 Manual Action Wiring

Update existing lead action handlers to also call sync:

| Action | Existing local write | New sync call |
|---|---|---|
| Mark Contacted | Already writes to chrome.storage.local | Call syncToCloud('update_status', threadId, { status: 'contacted' }) |
| Mark Closed Won/Lost/Stale | Already writes to chrome.storage.local | Same pattern with new status |
| Mark Flags Resolved | New from Phase D | Call syncToCloud('resolve_flags', threadId) |
| Delete | Already writes to chrome.storage.local | Call syncToCloud('delete', threadId) |
| Generate Replies | Updates lead from response | Handled server-side by generate-reply.js, no extra call |

---

## 5. Migration of Existing Local Leads

When the user first updates to this version of the extension, they may already have leads in chrome.storage.local that aren't in Supabase. Run a one-time migration on extension startup:

```javascript
async function migrateLeadsToSupabase() {
  const migrationDone = await chrome.storage.sync.get('supabase_migration_v1');
  if (migrationDone.supabase_migration_v1) return;

  const { leads } = await chrome.storage.local.get('leads');
  if (!leads || Object.keys(leads).length === 0) {
    await chrome.storage.sync.set({ supabase_migration_v1: true });
    return;
  }

  console.log('[FB Reply Maker SP] migrating', Object.keys(leads).length, 'leads to Supabase');

  for (const [threadId, lead] of Object.entries(leads)) {
    const result = await syncToCloud('upsert', threadId, lead);
    if (!result.ok) {
      console.warn('[FB Reply Maker SP] migration failed for', threadId);
      // Don't mark migration done so we retry next time
      return;
    }
  }

  await chrome.storage.sync.set({ supabase_migration_v1: true });
  console.log('[FB Reply Maker SP] migration complete');
}
```

Call this on side panel mount, fire-and-forget.

---

## 6. Updated Build Order

Insert these phases into the existing SPEC-PhaseD.md build order:

| Phase | Build | Where it fits |
|---|---|---|
| D.1 | Settings additions | Unchanged |
| **D.1.5** | **Supabase client setup in netlify/, install @supabase/supabase-js, test connection** | **NEW** |
| D.2 | Flag detection in generate-reply.js | Unchanged |
| **D.2.5** | **Add Supabase upsert in generate-reply.js after Anthropic response. Test that Generate creates a row in Supabase.** | **NEW** |
| D.3 | Side panel banner system | Unchanged |
| D.4 | Lead schema (open_flags, flag_history) | Unchanged in storage. Schema same in chrome.storage and Supabase. |
| **D.4.5** | **Create netlify/functions/sync-lead.js endpoint, wire to extension leads.js for non-generate updates** | **NEW** |
| D.5 | Leads tab UI updates (FLAGGED filter, chips, badge) | Unchanged |
| **D.6** | **Migration: one-time sync of existing local leads to Supabase. Add sync_pending retry logic.** | **NEW** |

---

## 7. Acceptance Criteria Additions

Add these to section 10 of SPEC-PhaseD.md:

| # | Criterion | Test |
|---|---|---|
| 15 | Supabase row created on Generate | Generate on Glen's thread → check Supabase Table Editor → row exists with thread_id, partner_name, captured_fields, status |
| 16 | Mark Contacted syncs | Mark Glen as contacted → check Supabase → status column shows "contacted" |
| 17 | Mark Flags Resolved syncs | Trigger fitment flag, then mark resolved → check Supabase → open_flags is empty array, flag_history entries have resolved_at |
| 18 | Delete syncs | Delete a lead → check Supabase → row is gone |
| 19 | Migration runs once | After first reload, check console for "migration complete" log, check Supabase has all local leads, then reload again and confirm migration does not re-run |
| 20 | Sync-pending retry | Disconnect internet, mark a lead contacted → reconnect → next Generate should trigger retry and sync should succeed |
| 21 | Concurrent generates don't duplicate | Generate twice quickly on same thread → only one Supabase row exists (the upsert is idempotent on thread_id) |

---

## 8. Known Risks Added

| Risk | Mitigation |
|---|---|
| Supabase free tier limits | 500MB DB + 50,000 monthly active users. Not a concern at single-user scale. |
| Service role key leak | Never sent to extension. Only lives in Netlify env vars. Rotation is one click in Supabase dashboard + one env var update in Netlify. |
| Schema drift between chrome.storage and Supabase | mapToDb function is the single mapper. Any schema change updates one place. |
| Migration runs in middle of active use | One-shot via `supabase_migration_v1` flag in chrome.storage.sync. Idempotent. |
| Supabase region latency | All writes are async with no blocking on the UI side. Worst case: 200-500ms added to Generate response. |

---

End of Supabase addendum.
