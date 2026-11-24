import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client, for server routes only (never import this
 * from a Client Component). It bypasses RLS, so every caller must check who
 * is asking first. null when the env vars are missing.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
