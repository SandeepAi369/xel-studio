import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Admin / Service Role Client (server-only) ───────────────
// Bypasses RLS — use ONLY in API routes, never exposed to client.
// Lazy-initialized to avoid build errors when env vars aren't set.
export function getSupabaseAdmin(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    return createClient(url, serviceKey);
}
