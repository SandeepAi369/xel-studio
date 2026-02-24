import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Admin / Service Role Client (server-only) ───────────────
// Bypasses RLS — use ONLY in API routes, never exposed to client.
// Lazy singleton: created once, reused across all requests.
// Prevents connection leak from creating a new client per call.

let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
    if (_supabaseAdmin) return _supabaseAdmin;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    _supabaseAdmin = createClient(url, serviceKey);
    return _supabaseAdmin;
}
