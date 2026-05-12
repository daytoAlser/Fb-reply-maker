import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  console.warn('[supabase] SUPABASE_URL or SUPABASE_SERVICE_KEY missing — client calls will fail');
}

export const supabase = createClient(url || '', serviceKey || '', {
  auth: { persistSession: false, autoRefreshToken: false }
});
