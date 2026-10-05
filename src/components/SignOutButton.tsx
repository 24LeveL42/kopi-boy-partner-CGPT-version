"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { removeDeviceSubscription } from "@/lib/push-client";
import { PendingLabel } from "./Pending";

export function SignOutButton({ onlyWhenSignedIn = false }: { onlyWhenSignedIn?: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  // For pages that render for signed-out visitors too (404, crash screen):
  // stay hidden until the browser session confirms someone is signed in.
  const [signedIn, setSignedIn] = useState(!onlyWhenSignedIn);
  const { busy, run, startTransition } = usePendingAction();

  useEffect(() => {
    if (!onlyWhenSignedIn) return;
    let live = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (live) setSignedIn(!!data.session);
      });
    return () => {
      live = false;
    };
  }, [onlyWhenSignedIn]);

  function handleSignOut() {
    run("sign-out", async () => {
      // While still signed in, so the RPC is authorised: stop this device
      // receiving the outgoing account's push alerts.
      await removeDeviceSubscription(supabase);
      await supabase.auth.signOut();
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    });
  }

  if (!signedIn) return null;

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className="w-full rounded-xl py-2.5 text-sm font-medium disabled:opacity-60"
      style={{ background: "var(--kb-cream)", color: "var(--kb-ink)" }}
    >
      <PendingLabel pending={busy} pendingText="Signing out…">Sign out</PendingLabel>
    </button>
  );
}
