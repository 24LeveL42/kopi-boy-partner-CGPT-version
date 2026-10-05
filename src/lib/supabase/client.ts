import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components ("use client").
 * Reads the public URL + publishable key from env — both are safe to expose
 * in the browser (see NEXT_PUBLIC_ prefix), access control is enforced by
 * Row Level Security policies in the database, not by hiding this key.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
