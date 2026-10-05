"use client";

import { useCallback, useRef, useState, useTransition } from "react";

/**
 * The one pattern for buttons that kick off async work (Supabase writes,
 * uploads, sign-in, navigation). `run` executes the work in a React
 * transition, so `busy` is true from the tap until the work — including any
 * reload it awaits — has finished, whether it succeeded or failed.
 *
 * - `key` names what's running (e.g. `${orderId}:accept`); `isRunning(key)`
 *   lets only the tapped button show its busy label, while `busy` disables
 *   every action on the component so nothing conflicting fires mid-flight.
 * - A tap that lands before React re-renders the button as disabled is
 *   dropped, so a double-tap can never run the work twice.
 * - Router calls made after an `await` inside the work lose the transition
 *   context; wrap them in the returned `startTransition` so `busy` also covers
 *   the navigation / refresh and the button doesn't flash back to idle first.
 */
export function usePendingAction() {
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const runningRef = useRef(false);

  const run = useCallback((key: string, work: () => Promise<void>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPendingKey(key);
    startTransition(async () => {
      try {
        await work();
      } finally {
        runningRef.current = false;
      }
    });
  }, []);

  const isRunning = useCallback((key: string) => isPending && pendingKey === key, [isPending, pendingKey]);

  return { busy: isPending, isRunning, run, startTransition };
}
