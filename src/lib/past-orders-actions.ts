"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  hideAllCookOrdersAs,
  hideAllRiderJobsAs,
  hideCookOrderAs,
  hideRiderJobAs,
  type HideResult,
} from "@/lib/past-orders";

const SIGNED_OUT: HideResult = { ok: false, error: "You're signed out. Please sign in again." };

// Server Actions are reachable by direct POST, so the cook/rider is always the
// session's user — never an id sent by the browser.
async function asSignedIn(work: (supabase: Awaited<ReturnType<typeof createClient>>, userId: string) => Promise<HideResult>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return SIGNED_OUT;

  const result = await work(supabase, data.user.id);
  // Blocked since the page loaded — re-render "/" so it becomes the blocked screen.
  if (!result.ok && result.blocked) refresh();
  return result;
}

export async function hideCookOrder(orderId: string): Promise<HideResult> {
  return asSignedIn((supabase, userId) => hideCookOrderAs(supabase, userId, String(orderId ?? "")));
}

export async function hideAllCookOrders(): Promise<HideResult> {
  return asSignedIn((supabase, userId) => hideAllCookOrdersAs(supabase, userId));
}

export async function hideRiderJob(requestId: string): Promise<HideResult> {
  return asSignedIn((supabase, userId) => hideRiderJobAs(supabase, userId, String(requestId ?? "")));
}

export async function hideAllRiderJobs(): Promise<HideResult> {
  return asSignedIn((supabase, userId) => hideAllRiderJobsAs(supabase, userId));
}
