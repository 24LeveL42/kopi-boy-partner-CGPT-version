import type { Options } from "canvas-confetti";

/** Brand confetti: Kopi Boy purple and green, plus white and gold. */
export const CELEBRATION_COLOURS = ["#7B3FE4", "#10B981", "#FFFFFF", "#F5B70A"];

/** How long the confetti plays (the "You're approved" card waits this long). */
export const CONFETTI_MS = 2000;

/** Never more than this many particles in total, so cheap phones keep up. */
export const MAX_PARTICLES = 200;

export interface ConfettiBurst {
  /** ms after the start */
  delay: number;
  options: Options;
}

/** Fewer cores or little memory: play half the particles. */
export function isLowPowerDevice(nav: { hardwareConcurrency?: number; deviceMemory?: number } | null | undefined): boolean {
  if (!nav) return false;
  return (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4) || (nav.deviceMemory !== undefined && nav.deviceMemory <= 2);
}

/**
 * Two corner bursts, then two short "fireworks". Light on purpose: under
 * MAX_PARTICLES in total, short-lived, and the library itself skips
 * everything when reduce motion is on (disableForReducedMotion).
 */
export function celebrationBursts(lowPower: boolean): ConfettiBurst[] {
  const scale = lowPower ? 0.5 : 1;
  const n = (count: number) => Math.round(count * scale);
  const base: Options = { colors: CELEBRATION_COLOURS, disableForReducedMotion: true, zIndex: 60, ticks: 140 };
  return [
    { delay: 0, options: { ...base, particleCount: n(45), angle: 60, spread: 55, startVelocity: 60, origin: { x: 0, y: 1 } } },
    { delay: 0, options: { ...base, particleCount: n(45), angle: 120, spread: 55, startVelocity: 60, origin: { x: 1, y: 1 } } },
    { delay: 600, options: { ...base, particleCount: n(50), spread: 360, startVelocity: 26, ticks: 80, gravity: 0.8, scalar: 0.9, origin: { x: 0.35, y: 0.32 } } },
    { delay: 1200, options: { ...base, particleCount: n(50), spread: 360, startVelocity: 26, ticks: 80, gravity: 0.8, scalar: 0.9, origin: { x: 0.65, y: 0.3 } } },
  ];
}

export function totalParticles(bursts: ConfettiBurst[]): number {
  return bursts.reduce((sum, b) => sum + (b.options.particleCount ?? 0), 0);
}
