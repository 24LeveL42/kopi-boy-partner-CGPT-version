"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { acceptDeliveryAs, completeDeliveryAs, type RiderActionResult } from "@/lib/rider-delivery";

const SIGNED_OUT: RiderActionResult = { ok: false, error: "You're signed out. Please sign in again." };

// Server Actions are reachable by direct POST, so the rider is always the
// session's user — never an id sent by the browser.
async function asSignedInRider(work: (supabase: Awaited<ReturnType<typeof createClient>>, userId: string) => Promise<RiderActionResult>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return SIGNED_OUT;

  const result = await work(supabase, data.user.id);
  // Blocked since the page loaded — re-render "/" so it becomes the blocked screen.
  if (!result.ok && result.blocked) refresh();
  return result;
}

export async function acceptDelivery(requestId: string): Promise<RiderActionResult> {
  return asSignedInRider((supabase, userId) => acceptDeliveryAs(supabase, userId, String(requestId ?? "")));
}

export async function completeDelivery(requestId: string, photoPath: string): Promise<RiderActionResult> {
  return asSignedInRider((supabase, userId) =>
    completeDeliveryAs(supabase, userId, String(requestId ?? ""), String(photoPath ?? ""))
  );
}
