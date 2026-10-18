"use server";

import { createClient } from "@/lib/supabase/server";
import { requestRiderAs, type RequestRiderResult } from "@/lib/rider-request";

/**
 * Server Actions are reachable by direct POST, so the kitchen is always the
 * session's user — never an id sent by the browser — and the time check uses
 * the server's clock.
 */
export async function requestRider(orderId: string): Promise<RequestRiderResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "You're signed out. Please sign in again." };

  return requestRiderAs(supabase, data.user.id, String(orderId ?? ""), Date.now());
}
