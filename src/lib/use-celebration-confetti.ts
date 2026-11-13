"use client";

import { useEffect } from "react";
import { celebrationBursts, isLowPowerDevice } from "./celebration-confetti";

/**
 * Plays the light celebration confetti once while `play` is true. With
 * reduce motion on it plays nothing. canvas-confetti is loaded only here, so
 * normal page loads never pay for it. A failed load just means no confetti.
 */
export function useCelebrationConfetti(play: boolean) {
  useEffect(() => {
    if (!play) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let reset: (() => void) | null = null;
    const nav = navigator as Navigator & { deviceMemory?: number };

    import("canvas-confetti")
      .then(({ default: confetti }) => {
        if (cancelled) return;
        reset = confetti.reset;
        for (const burst of celebrationBursts(isLowPowerDevice(nav))) {
          if (burst.delay === 0) confetti(burst.options);
          else timers.push(setTimeout(() => !cancelled && confetti(burst.options), burst.delay));
        }
      })
      .catch((e) => console.error("Celebration: couldn't load confetti", e));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      reset?.();
    };
  }, [play]);
}
