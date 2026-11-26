import { createClient } from "@/lib/supabase/server";
import { SigninOutcome } from "@/components/SigninOutcome";
import { LoginForm } from "@/components/LoginForm";
import { ApplyForm } from "@/components/ApplyForm";
import { StatusScreen } from "@/components/StatusScreen";
import { RetryScreen } from "@/components/RetryScreen";
import { RefreshButton } from "@/components/RefreshButton";
import { PartnerShell } from "@/components/PartnerShell";
import { KitchenSetupGate } from "@/components/KitchenSetupGate";
import { AdminMessagePanel } from "@/components/AdminMessagePanel";
import { RideRegionsPrompt } from "@/components/RideRegionsPrompt";
import { ApprovalCelebration } from "@/components/ApprovalCelebration";
import { approvalCelebrationFor } from "@/lib/approval-celebration";
import { KitchenLiveDialog } from "@/components/KitchenLiveDialog";
import { shouldShowKitchenLive } from "@/lib/kitchen-live";
import { loadMyRideRegions, shouldPromptForRideRegions } from "@/lib/ride-regions";
import { BLOCKED_SCREEN_COPY } from "@/lib/admin-messages";
import { resolvePartnerScreen } from "@/lib/partner-routing";
import { loadPartnerState, loadUser } from "@/lib/partner-state";
import { withTimeout } from "@/lib/load-timeout";
import {
  APPROVAL_FINISHING_COPY,
  COOK_PRICING_LINE,
  KITCHEN_LOAD_ERROR_COPY,
  LOAD_ERROR_COPY,
  PENDING_COPY,
  STAFF_ACCOUNT_COPY,
} from "@/lib/onboarding-copy";

export default async function Home() {
  const supabase = await createClient();
  const auth = await loadUser(supabase);
  if (!auth.ok) return <RetryScreen title={LOAD_ERROR_COPY.title} message={LOAD_ERROR_COPY.message} />;

  const user = auth.user;
  if (!user) {
    // Signed-out landing page.
    return <LoginForm />;
  }

  // Profile, latest applications and kitchen, with a time limit and one
  // automatic retry (src/lib/partner-state.ts).
  const load = await loadPartnerState(supabase, user.id);
  if (!load.ok) return <RetryScreen signOut title={LOAD_ERROR_COPY.title} message={LOAD_ERROR_COPY.message} />;
  const { profile, riderApp, kitchen } = load.state;

  // All routing decisions live in resolvePartnerScreen (unit-checkable, no DB).
  const screen = resolvePartnerScreen(load.state);

  // Riders (and rider applicants waiting for HQ) with no regions yet get a
  // gentle prompt. Never blocking: a failed or slow read just shows no prompt.
  const isRiderView = screen.kind === "partner-shell" && screen.view === "rider";
  const isPendingRider = screen.kind === "application-pending" && riderApp?.status === "pending";
  const promptRideRegions =
    (isRiderView || isPendingRider) &&
    shouldPromptForRideRegions(await withTimeout(() => loadMyRideRegions(supabase, user.id)).catch(() => null));

  // One-time "You're approved" confetti + card, for cooks and riders.
  const celebration = approvalCelebrationFor(screen, profile);
  const celebrationCard = celebration ? (
    <ApprovalCelebration
      userId={user.id}
      fullName={profile?.full_name ?? null}
      buttonLabel={celebration.buttonLabel}
      href={celebration.href}
    />
  ) : null;

  // One-time "Your kitchen is live!" pop-up after the first kitchen save.
  const showKitchenLive = shouldShowKitchenLive({ screen, profile, kitchen, approvalCelebrationShowing: celebration !== null });

  // Every signed-in screen except the sign-up form also reports, once per
  // sign-in, that this was an existing account (src/components/SigninOutcome.tsx).
  const content = (() => {
    switch (screen.kind) {
      case "staff-account":
        return <StatusScreen tone="neutral" signOut title={STAFF_ACCOUNT_COPY.title} message={STAFF_ACCOUNT_COPY.message} />;
      case "blocked":
        // Replaces the whole cook / rider area. No block reason is
        // stored, so none is shown — the partner asks HQ through the box below.
        return (
          <StatusScreen tone="warning" signOut title={BLOCKED_SCREEN_COPY.title} message={BLOCKED_SCREEN_COPY.body}>
            <AdminMessagePanel userId={user.id} />
          </StatusScreen>
        );
      case "application-pending":
        return (
          <StatusScreen tone="neutral" signOut title={PENDING_COPY.title} message={PENDING_COPY.message}>
            <div className="space-y-4 text-left">
              <div className="rounded-2xl px-4 py-3" style={{ background: "#F5F3FA" }}>
                <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-purple)" }}>
                  {PENDING_COPY.stepsTitle}
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm" style={{ color: "var(--kb-ink)" }}>
                  {PENDING_COPY.steps[screen.as].map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
              {screen.as === "cook" && (
                <p className="rounded-2xl px-4 py-2.5 text-center text-sm font-semibold" style={{ background: "var(--kb-mint)", color: "var(--kb-green-deep)" }}>
                  {COOK_PRICING_LINE}
                </p>
              )}
              {promptRideRegions ? <RideRegionsPrompt /> : null}
              <RefreshButton label={PENDING_COPY.checkStatus} pendingText={PENDING_COPY.checking} />
            </div>
          </StatusScreen>
        );
      case "approval-finishing":
        return (
          <StatusScreen tone="neutral" signOut title={APPROVAL_FINISHING_COPY.title} message={APPROVAL_FINISHING_COPY.message}>
            <RefreshButton label={APPROVAL_FINISHING_COPY.checkAgain} pendingText={APPROVAL_FINISHING_COPY.checking} />
          </StatusScreen>
        );
      case "application-rejected":
        return (
          <StatusScreen
            tone="danger"
            signOut
            title="Application not approved"
            message="Your application wasn't approved this time. Contact Kopi Boy support if you'd like to know more or reapply."
          />
        );
      case "kitchen-load-error":
        return <RetryScreen signOut title={KITCHEN_LOAD_ERROR_COPY.title} message={KITCHEN_LOAD_ERROR_COPY.message} />;
      case "kitchen-setup":
        return (
          <>
            <KitchenSetupGate userId={user.id} defaults={screen.defaults} />
            {celebrationCard}
          </>
        );
      case "partner-shell":
        return (
          <>
            <PartnerShell
              userId={user.id}
              defaultView={screen.view}
              partnerName={profile?.full_name ?? null}
              businessName={screen.view === "cook" ? kitchen?.business_name ?? null : null}
              promptRideRegions={promptRideRegions}
              kitchenNotLive={screen.view === "cook" && kitchen?.is_live === false}
              riderProfile={
                screen.view === "rider"
                  ? { fullName: profile?.full_name ?? null, phone: profile?.phone ?? null, photoUrl: profile?.photo_url ?? null }
                  : undefined
              }
            />
            {celebrationCard}
            {showKitchenLive ? <KitchenLiveDialog userId={user.id} /> : null}
          </>
        );
      case "apply":
        return <ApplyForm userId={user.id} />;
    }
  })();
  return (
    <>
      {content}
      {screen.kind === "apply" ? null : <SigninOutcome staff={screen.kind === "staff-account"} />}
    </>
  );
}
