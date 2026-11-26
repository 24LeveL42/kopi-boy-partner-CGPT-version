import type { SupabaseClient } from "@supabase/supabase-js";
import { businessUenProblem, normalizeBusinessUen, requiresBusinessUen } from "./business-uen.ts";

/**
 * The business UEN in Kitchen Setup, for shops whose approved application
 * isn't Home Cook (e.g. a shop Kopi Boy set up and the owner claimed without
 * a UEN). The database won't let those kitchens go live without one, and the
 * owner adds it with set_my_business_uen(p_uen), which works only while the
 * kitchen is not live. Kept free of React/Next.js so it can be tested.
 */

export const KITCHEN_UEN_COPY = {
  title: "Add your UEN to go live",
  why: "Your UEN is needed to put your shop on Kopi Boy.",
  label: "Business Registration Number (UEN)",
  placeholder: "e.g. 53123456X or 201912345K",
  savedLabel: "Business Registration Number (UEN)",
  notAdded: "Not added",
  lockedNote: "Message Kopi Boy HQ to change it.",
  /** Top of Kitchen Setup while the UEN is missing (replaces the PayNow-only note). */
  banner: {
    title: "Add your UEN to go live",
    message: "Customers can't see your shop until you add your UEN and PayNow. Fill them in below and tap Save changes.",
    action: "Go to UEN",
  },
  /** After a save that left the shop not live because the UEN is still missing or wasn't accepted. */
  savedNotLive: "Your changes are saved. Your shop isn't live yet: add your UEN above and save again to go live.",
  /** On the claim page, for these shops. */
  claimLine: "You'll add your UEN in Kitchen Setup before going live.",
  rpcFailed: "We couldn't save your UEN. Please check it and try again.",
} as const;

export type KitchenUenState =
  /** Home Cook, or no approved application: nothing changes. */
  | { kind: "not-needed" }
  /** Needs a UEN, none saved, kitchen not live: show the field. */
  | { kind: "missing" }
  /** UEN saved, kitchen not live yet. */
  | { kind: "saved"; uen: string }
  /** Kitchen is live: read-only, HQ changes it. */
  | { kind: "locked"; uen: string | null };

export function kitchenUenState({
  approvedApp,
  kitchenUen,
  isLive,
}: {
  /** The latest APPROVED cook application; null if there is none. A null type isn't Home Cook, so it needs a UEN. */
  approvedApp: { business_type: string | null } | null;
  kitchenUen: string | null | undefined;
  isLive: boolean;
}): KitchenUenState {
  if (!approvedApp || !requiresBusinessUen(approvedApp.business_type ?? "")) return { kind: "not-needed" };
  const uen = kitchenUen?.trim() || null;
  if (isLive) return { kind: "locked", uen };
  return uen ? { kind: "saved", uen } : { kind: "missing" };
}

type RpcError = { message?: string; details?: string; code?: string } | null;
export type UenRpc = (fn: "set_my_business_uen", args: { p_uen: string }) => PromiseLike<{ data: unknown; error: RpcError }>;

export type UenStepResult =
  /** Send is_live: true with the kitchen save. */
  | { goLive: true; savedUen?: string }
  /** Don't send is_live (the kitchen stays not live); everything else still saves. `error` goes under the UEN field. */
  | { goLive: false; error: string | null };

/**
 * Runs before the kitchen save. Only a "missing" UEN does anything: an empty
 * box saves the rest without going live; a badly formatted one is caught
 * here with the same rule as the application form; otherwise
 * set_my_business_uen is called, and its plain-words error is shown as is.
 */
export async function runUenStep(state: KitchenUenState, input: string, rpc: UenRpc): Promise<UenStepResult> {
  if (state.kind !== "missing") return { goLive: true };
  const uen = normalizeBusinessUen(input);
  if (!uen) return { goLive: false, error: null };
  // Any non-Home Cook type gives the same format check.
  const problem = businessUenProblem("Hawker", uen);
  if (problem) return { goLive: false, error: problem };
  try {
    const { data, error } = await rpc("set_my_business_uen", { p_uen: uen });
    if (error) {
      console.error("KitchenSetupForm: set_my_business_uen failed", error);
      return { goLive: false, error: error.message?.trim() || error.details?.trim() || KITCHEN_UEN_COPY.rpcFailed };
    }
    return { goLive: true, savedUen: typeof data === "string" && data.trim() ? data.trim() : uen };
  } catch (e) {
    console.error("KitchenSetupForm: set_my_business_uen threw", e);
    return { goLive: false, error: KITCHEN_UEN_COPY.rpcFailed };
  }
}

/** The is_live part of the kitchen row: true only once the UEN is in; otherwise left out. */
export function isLiveField(step: UenStepResult): { is_live?: true } {
  return step.goLive ? { is_live: true } : {};
}


/**
 * The latest approved cook application (its business_type), by the same rule as
 * the database's approved_business_uen(): reviewed_at desc (nulls last), then
 * created_at desc. { ok: false } when it couldn't be read.
 */
export async function loadApprovedBusinessType(
  client: Pick<SupabaseClient, "from">,
  userId: string,
  signal: AbortSignal,
): Promise<{ ok: true; approvedApp: { business_type: string | null } | null } | { ok: false }> {
  const { data, error } = await client
    .from("cook_applications")
    .select("business_type")
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .abortSignal(signal)
    .maybeSingle<{ business_type: string | null }>();
  if (error) {
    console.error("Kitchen page: couldn't load the approved application", error);
    return { ok: false };
  }
  return { ok: true, approvedApp: data ? { business_type: data.business_type ?? null } : null };
}

/**
 * The claim page's "You'll add your UEN…" line: a shop that isn't Home Cook
 * and has no UEN yet. The preview carries the kitchen category (set by HQ
 * from the application type), not the application itself.
 */
export function claimShowsUenLine(shop: { category: string; business_uen: string | null }): boolean {
  return shop.category !== "home-cook" && !shop.business_uen?.trim();
}
