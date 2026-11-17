"use client";

import { useEffect } from "react";
import { createBrowserTracker, markTestDevice, takeSigninTracked } from "@/lib/registration-tracking";

/**
 * Rendered on every signed-in screen except the partner sign-up form. Sends
 * one anonymous existing_account event, and only in a tab that just came
 * through the tracked sign-in screen, so Boss can tell "existing partner
 * signed back in" apart from "new visitor left at Google". Everyday use of
 * the app sends nothing. HQ accounts mark the session and the device as
 * test, so admins are never counted.
 */
export function SigninOutcome({ staff = false }: { staff?: boolean }) {
  useEffect(() => {
    try {
      if (!takeSigninTracked()) return;
      if (staff) markTestDevice();
      const { tracker, dispose } = createBrowserTracker({ forceTest: staff });
      tracker.track({ event: "existing_account" });
      dispose();
    } catch {
      // Tracking never gets in the way.
    }
  }, [staff]);
  return null;
}
