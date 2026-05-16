// Learning capture endpoint for the Auto Response feature.
//
// Same Supabase project the `leads` table lives in. Action-style routing
// mirrors sync-lead.js. Auth: x-api-secret header against SHARED_SECRET.
//
// Actions:
//   insert_event    — atomically supersedes pending rows in the same thread,
//                     then inserts the new capture row (final_sent_message NULL).
//   finalize_event  — updates a row by client_event_id with the send result
//                     (or a send_timeout=true row if no send was detected).
//                     Idempotent via the "finalized_at is null" guard.
//   update_flag     — toggles flagged_for_review on a row (by id).
//   recent          — returns the last 20 rows for the Learning Log tab.
//                     Optional filter: 'all' | 'edited' | 'never_sent' | 'flagged'.
//   delete_event    — hard-deletes a row by id (UUID) or client_event_id.
//                     Use for pruning captures with hallucinated content.
//   delete_by_match — hard-deletes rows whose variant_shown or
//                     final_sent_message matches a case-insensitive substring.
//                     Use sparingly — primarily for purging training-data
//                     hallucinations (e.g. delete_by_match { match: "Haida" }).

import { supabase } from './_shared/supabaseClient.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

async function insertEvent(payload) {
  const {
    client_event_id,
    thread_id,
    variant_kind,
    variant_shown,
    customer_message,
    conversation_history,
    captured_fields,
    listing_title,
    partner_name
  } = payload;

  if (!client_event_id || !variant_kind || typeof variant_shown !== 'string') {
    return respond(400, { ok: false, error: 'missing client_event_id / variant_kind / variant_shown' });
  }
  if (!['quick', 'standard', 'detailed'].includes(variant_kind)) {
    return respond(400, { ok: false, error: `invalid variant_kind: ${variant_kind}` });
  }

  // Supersession: close out any pending row in this thread that isn't
  // the one we're about to insert. Only attempt when we have a thread_id;
  // anonymous captures don't supersede anything.
  if (thread_id) {
    const { error: supErr } = await supabase
      .from('auto_response_learning')
      .update({ superseded_by: client_event_id, finalized_at: new Date().toISOString() })
      .eq('thread_id', thread_id)
      .is('finalized_at', null)
      .neq('client_event_id', client_event_id);
    if (supErr) {
      // Non-fatal — the supersession is best-effort cleanup. Log and
      // continue with the insert so the new capture isn't lost.
      console.warn('[learning-log] supersession update failed:', supErr.message);
    }
  }

  const row = {
    client_event_id,
    thread_id: thread_id || null,
    variant_kind,
    variant_shown,
    customer_message: customer_message ?? null,
    conversation_history: conversation_history ?? null,
    captured_fields: captured_fields ?? null,
    listing_title: listing_title ?? null,
    partner_name: partner_name ?? null
  };

  const { data, error } = await supabase
    .from('auto_response_learning')
    .insert(row)
    .select()
    .maybeSingle();
  if (error) {
    console.error('[learning-log] insert failed:', error.message);
    return respond(500, { ok: false, error: error.message, should_retry: true });
  }
  return respond(200, { ok: true, action: 'insert_event', row: data });
}

async function finalizeEvent(payload) {
  const {
    client_event_id,
    final_sent_message,
    was_edited,
    edit_diff,
    char_distance,
    send_timeout
  } = payload;

  if (!client_event_id) {
    return respond(400, { ok: false, error: 'missing client_event_id' });
  }

  const update = {
    final_sent_message: final_sent_message ?? null,
    was_edited: typeof was_edited === 'boolean' ? was_edited : null,
    edit_diff: edit_diff ?? null,
    char_distance: typeof char_distance === 'number' ? char_distance : null,
    send_timeout: send_timeout === true,
    finalized_at: new Date().toISOString()
  };

  // The "finalized_at is null" guard makes finalize idempotent: if the
  // row was already finalized (by a timeout, supersession, or earlier
  // watcher fire), this becomes a no-op. Whichever path lands first
  // wins.
  const { data, error } = await supabase
    .from('auto_response_learning')
    .update(update)
    .eq('client_event_id', client_event_id)
    .is('finalized_at', null)
    .select();
  if (error) {
    console.error('[learning-log] finalize failed:', error.message);
    return respond(500, { ok: false, error: error.message, should_retry: true });
  }
  return respond(200, { ok: true, action: 'finalize_event', updated: Array.isArray(data) ? data.length : 0 });
}

async function updateFlag(payload) {
  const { id, flagged } = payload;
  if (!id || typeof flagged !== 'boolean') {
    return respond(400, { ok: false, error: 'update_flag requires id (uuid) and flagged (boolean)' });
  }
  const { data, error } = await supabase
    .from('auto_response_learning')
    .update({ flagged_for_review: flagged })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) {
    console.error('[learning-log] update_flag failed:', error.message);
    return respond(500, { ok: false, error: error.message });
  }
  return respond(200, { ok: true, action: 'update_flag', row: data });
}

// Hard-delete a learning row. Used to prune captures that contain
// hallucinated content (e.g. an invented brand+model the AI shouldn't
// learn from). Accepts either an id (UUID) or a client_event_id.
async function deleteEvent(payload) {
  const { id, client_event_id } = payload || {};
  if (!id && !client_event_id) {
    return respond(400, { ok: false, error: 'delete_event requires id or client_event_id' });
  }
  const query = supabase.from('auto_response_learning').delete();
  const filtered = id ? query.eq('id', id) : query.eq('client_event_id', client_event_id);
  const { data, error } = await filtered.select();
  if (error) {
    console.error('[learning-log] delete failed:', error.message);
    return respond(500, { ok: false, error: error.message });
  }
  return respond(200, { ok: true, action: 'delete_event', deleted: Array.isArray(data) ? data.length : 0 });
}

// Bulk-delete rows whose variant_shown or final_sent_message matches a
// case-insensitive substring. Use sparingly — this is for purging
// training-data hallucinations from past captures. Returns count.
async function deleteByMatch(payload) {
  const { match } = payload || {};
  if (typeof match !== 'string' || match.trim().length < 3) {
    return respond(400, { ok: false, error: 'delete_by_match requires match string (>=3 chars)' });
  }
  const m = match.trim();
  const { data, error } = await supabase
    .from('auto_response_learning')
    .delete()
    .or(`variant_shown.ilike.%${m}%,final_sent_message.ilike.%${m}%`)
    .select();
  if (error) {
    console.error('[learning-log] delete_by_match failed:', error.message);
    return respond(500, { ok: false, error: error.message });
  }
  return respond(200, { ok: true, action: 'delete_by_match', match: m, deleted: Array.isArray(data) ? data.length : 0 });
}

async function recent(payload) {
  const filter = (payload && payload.filter) || 'all';
  const limit = 20;

  let query = supabase
    .from('auto_response_learning')
    .select('*')
    .order('inserted_at', { ascending: false })
    .limit(limit);

  if (filter === 'edited') {
    query = query.eq('was_edited', true);
  } else if (filter === 'never_sent') {
    // True abandonment only: no send AND not superseded by a later INSERT.
    query = query.is('final_sent_message', null).is('superseded_by', null);
  } else if (filter === 'flagged') {
    query = query.eq('flagged_for_review', true);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[learning-log] recent failed:', error.message);
    return respond(500, { ok: false, error: error.message });
  }
  return respond(200, { ok: true, action: 'recent', filter, records: data || [] });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, error: 'Method not allowed' });
  }

  const secret = event.headers['x-api-secret'] || event.headers['X-Api-Secret'];
  if (!secret || secret !== process.env.SHARED_SECRET) {
    return respond(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return respond(400, { ok: false, error: 'Invalid JSON' }); }

  const { action } = body || {};
  if (!action) return respond(400, { ok: false, error: 'Missing action' });

  try {
    switch (action) {
      case 'insert_event':    return await insertEvent(body);
      case 'finalize_event':  return await finalizeEvent(body);
      case 'update_flag':     return await updateFlag(body);
      case 'recent':          return await recent(body);
      case 'delete_event':    return await deleteEvent(body);
      case 'delete_by_match': return await deleteByMatch(body);
      default:
        return respond(400, { ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[learning-log] threw:', action, err?.message || err);
    return respond(500, { ok: false, error: err?.message || String(err), should_retry: true });
  }
}
