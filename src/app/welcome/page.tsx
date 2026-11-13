import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusScreen } from "@/components/StatusScreen";
import { RetryScreen } from "@/components/RetryScreen";
import { RefreshButton } from "@/components/RefreshButton";
import { WelcomeCelebration } from "@/components/WelcomeCelebration";
import { resolvePartnerScreen } from "@/lib/partner-routing";
import { loadPartnerState, loadUser } from "@/lib/partner-state";
import { welcomeDecision } from "@/lib/welcome";
import { APPROVAL_FINISHING_COPY, LOAD_ERROR_COPY, STAFF_ACCOUNT_COPY } from "@/lib/onboarding-copy";

/**
 * The page the Boss approval email links to. Celebrates only an approved
 * cook or rider; anyone else is sent to sign in or to the screen "/" would
 * show them (Application received, rejected, blocked, apply).
 * See welcomeDecision in src/lib/welcome.ts.
 */
export default async function WelcomePage() {
  const supabase = await createClient();
  const auth = await loadUser(supabase);
  if (!auth.ok) return <RetryScreen title={LOAD_ERROR_COPY.title} message={LOAD_ERROR_COPY.message} />;

  const user = auth.user;
  const load = user ? await loadPartnerState(supabase, user.id) : null;
  if (load && !load.ok) return <RetryScreen signOut title={LOAD_ERROR_COPY.title} message={LOAD_ERROR_COPY.message} />;
  const state = load?.ok ? load.state : null;

  const decision = welcomeDecision({
    signedIn: !!user,
    screen: state ? resolvePartnerScreen(state) : null,
    profile: state?.profile ?? null,
    kitchen: state?.kitchen ?? null,
  });

  switch (decision.kind) {
    case "redirect":
      return redirect(decision.to);
    case "staff-account":
      return <StatusScreen tone="neutral" signOut title={STAFF_ACCOUNT_COPY.title} message={STAFF_ACCOUNT_COPY.message} />;
    case "approval-finishing":
      return (
        <StatusScreen tone="neutral" signOut title={APPROVAL_FINISHING_COPY.title} message={APPROVAL_FINISHING_COPY.message}>
          <RefreshButton label={APPROVAL_FINISHING_COPY.checkAgain} pendingText={APPROVAL_FINISHING_COPY.checking} />
        </StatusScreen>
      );
    case "celebrate":
      return (
        <WelcomeCelebration
          userId={user!.id}
          title={decision.title}
          greeting={decision.greeting}
          pricing={decision.pricing}
          primary={decision.primary}
          secondary={decision.secondary}
          confetti={decision.confetti}
        />
      );
  }
}
