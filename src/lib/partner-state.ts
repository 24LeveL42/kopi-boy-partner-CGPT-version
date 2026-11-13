import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Profile, CookApplication, RiderApplication } from "./types-auth";
import { READ_TIMEOUT_MS, retryOnce, withTimeout } from "./load-timeout.ts";

/** The cook's kitchens row: public columns only (never "*": kitchen privacy Phase 2). */
export interface PartnerKitchen {
  id: string;
  business_name: string;
  is_live: boolean;
  is_blocked: boolean;
}

/** Everything "/" and "/welcome" need to pick a screen (see resolvePartnerScreen). */
export interface PartnerState {
  profile: Profile | null;
  cookApp: CookApplication | null;
  riderApp: RiderApplication | null;
  kitchen: PartnerKitchen | null;
  /** The kitchen read failed (not "there isn't one"): never send the cook to setup. */
  kitchenError: boolean;
}

export type PartnerStateLoad = { ok: true; state: PartnerState } | { ok: false };
export type UserLoad = { ok: true; user: User | null } | { ok: false };

type ReadError = { code?: string } | null;

/** One attempt's results. */
export interface PartnerReads {
  state: PartnerState;
  /** The profile or an application read failed: the screen can't be decided. */
  coreFailed: boolean;
}

/** Worth the automatic retry: anything failed, the kitchen read included. */
const anyFailed = (r: PartnerReads) => r.coreFailed || r.state.kitchenError;

/** profiles .single() with no row: not a failure, there just isn't a profile. */
const NO_ROWS = "PGRST116";

export function partnerReadsFrom(results: {
  profile: { data: Profile | null; error: ReadError };
  cookApp: { data: CookApplication | null; error: ReadError };
  riderApp: { data: RiderApplication | null; error: ReadError };
  kitchen: { data: PartnerKitchen | null; error: ReadError };
}): PartnerReads {
  const profileFailed = !!results.profile.error && results.profile.error.code !== NO_ROWS;
  return {
    state: {
      profile: results.profile.data,
      cookApp: results.cookApp.data,
      riderApp: results.riderApp.data,
      kitchen: results.kitchen.data,
      kitchenError: !!results.kitchen.error,
    },
    coreFailed: profileFailed || !!results.cookApp.error || !!results.riderApp.error,
  };
}

/**
 * Loads a partner's state with a time limit and one automatic retry.
 * - Profile / application reads that still fail (or time out) after the
 *   retry: { ok: false }, so the page shows "Try again" rather than guessing
 *   (a missing application must never be read as "no application").
 * - Only the kitchen read still failing: ok, with kitchenError set, so
 *   routing shows the kitchen error screen (never Kitchen Setup).
 *
 * `readOnce` is injectable for tests; the default reads Supabase.
 */
export async function loadPartnerState(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  {
    timeoutMs = READ_TIMEOUT_MS,
    readOnce = (signal: AbortSignal) => readPartnerOnce(supabase, userId, signal),
  }: { timeoutMs?: number; readOnce?: (signal: AbortSignal) => Promise<PartnerReads> } = {},
): Promise<PartnerStateLoad> {
  try {
    const reads = await retryOnce(() => withTimeout(readOnce, timeoutMs), anyFailed);
    if (reads.coreFailed) return { ok: false };
    return { ok: true, state: reads.state };
  } catch (e) {
    console.error("Partner state: couldn't load", e);
    return { ok: false };
  }
}

async function readPartnerOnce(supabase: Pick<SupabaseClient, "from">, userId: string, signal: AbortSignal): Promise<PartnerReads> {
  const [profile, cookApp, riderApp, kitchen] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).abortSignal(signal).single<Profile>(),
    supabase
      .from("cook_applications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .abortSignal(signal)
      .maybeSingle<CookApplication>(),
    supabase
      .from("rider_applications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .abortSignal(signal)
      .maybeSingle<RiderApplication>(),
    // The name is for the cook's header; the row's existence decides setup
    // vs shell; is_live / is_blocked decide the "Your kitchen is live!" pop-up.
    supabase
      .from("kitchens")
      .select("id, business_name, is_live, is_blocked")
      .eq("id", userId)
      .abortSignal(signal)
      .maybeSingle<PartnerKitchen>(),
  ]);
  return partnerReadsFrom({ profile, cookApp, riderApp, kitchen });
}

/**
 * auth.getUser() with the same time limit and one retry. A missing session
 * is "signed out" ({ ok: true, user: null }); only a call that never comes
 * back counts as a failure.
 */
export async function loadUser(
  supabase: Pick<SupabaseClient, "auth">,
  timeoutMs: number = READ_TIMEOUT_MS,
): Promise<UserLoad> {
  try {
    const user = await retryOnce(() => withTimeout(async () => (await supabase.auth.getUser()).data.user, timeoutMs));
    return { ok: true, user };
  } catch (e) {
    console.error("Partner state: couldn't check the session", e);
    return { ok: false };
  }
}
