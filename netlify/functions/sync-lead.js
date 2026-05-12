import { supabase } from './_shared/supabaseClient.js';

function mapLeadToRow(lead, threadId) {
  const row = {
    thread_id: threadId,
    last_updated: new Date().toISOString()
  };
  if (lead.partnerName) row.partner_name = lead.partnerName;
  if (lead.fbThreadUrl) row.fb_thread_url = lead.fbThreadUrl;
  if (lead.listingTitle) row.listing_title = lead.listingTitle;
  if (lead.adType) row.ad_type = lead.adType;
  if (lead.capturedFields && typeof lead.capturedFields === 'object') {
    row.captured_fields = lead.capturedFields;
  }
  if (lead.status) row.status = lead.status;
  if (Array.isArray(lead.open_flags)) row.open_flags = lead.open_flags;
  if (Array.isArray(lead.flag_history)) row.flag_history = lead.flag_history;
  if (typeof lead.notes === 'string') row.notes = lead.notes;
  if (lead.createdAt) row.created_at = new Date(lead.createdAt).toISOString();
  return row;
}

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  const secret = event.headers['x-api-secret'] || event.headers['X-Api-Secret'];
  if (!secret || secret !== process.env.SHARED_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }; }

  const { action, thread_id, data } = body;
  if (!action || !thread_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing action or thread_id' }) };
  }

  try {
    let result;
    switch (action) {
      case 'upsert': {
        if (!data || typeof data !== 'object') {
          return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'upsert requires data' }) };
        }
        const row = mapLeadToRow(data, thread_id);
        result = await supabase.from('leads').upsert(row, { onConflict: 'thread_id', ignoreDuplicates: false }).select();
        break;
      }
      case 'update_status': {
        const status = data?.status;
        if (!status) {
          return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'update_status requires data.status' }) };
        }
        result = await supabase.from('leads').update({
          status,
          last_updated: new Date().toISOString()
        }).eq('thread_id', thread_id).select();
        break;
      }
      case 'resolve_flags': {
        const { data: current, error: readErr } = await supabase
          .from('leads')
          .select('flag_history')
          .eq('thread_id', thread_id)
          .maybeSingle();
        if (readErr) throw new Error(`read failed: ${readErr.message}`);
        const now = Date.now();
        const updatedHistory = Array.isArray(current?.flag_history)
          ? current.flag_history.map((e) => (e && e.resolved_at == null ? { ...e, resolved_at: now } : e))
          : [];
        result = await supabase.from('leads').update({
          open_flags: [],
          flag_history: updatedHistory,
          last_updated: new Date().toISOString()
        }).eq('thread_id', thread_id).select();
        break;
      }
      case 'delete': {
        result = await supabase.from('leads').delete().eq('thread_id', thread_id);
        break;
      }
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: `Unknown action: ${action}` }) };
    }

    if (result?.error) {
      console.error('[sync-lead] action failed:', action, thread_id, JSON.stringify(result.error));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, error: result.error.message, should_retry: true })
      };
    }

    console.log('[sync-lead] ok:', action, thread_id);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, thread_id, action })
    };
  } catch (err) {
    console.error('[sync-lead] threw:', action, thread_id, err?.message || err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err?.message || String(err), should_retry: true })
    };
  }
}
