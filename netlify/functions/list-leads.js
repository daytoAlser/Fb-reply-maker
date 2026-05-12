import { supabase } from './_shared/supabaseClient.js';

// Phase F.1: full-screen lead center. Returns leads ordered by last_updated
// desc so the fullscreen UI can render its thread list directly from Supabase
// (rather than relying on chrome.storage.local cache, which only fills as the
// extension processes generates).

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-secret',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  const secret = event.headers['x-api-secret'] || event.headers['X-Api-Secret'];
  if (!secret || secret !== process.env.SHARED_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  const rawLimit = parseInt(event.queryStringParameters?.limit || '500', 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(2000, rawLimit)) : 500;

  try {
    const { data, error } = await supabase
      .from('leads')
      .select('thread_id, partner_name, fb_thread_url, listing_title, ad_type, captured_fields, status, open_flags, flag_history, products_of_interest, conversation_mode, silence_duration_ms, last_customer_message_at, last_updated, created_at, notes')
      .order('last_updated', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[list-leads] supabase error:', error.message);
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, leads: data || [], count: (data || []).length })
    };
  } catch (err) {
    console.error('[list-leads] threw:', err?.message || err);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err?.message || String(err) }) };
  }
}
