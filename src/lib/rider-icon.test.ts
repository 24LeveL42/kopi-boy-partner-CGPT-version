import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type * as Leaflet from "leaflet";
import { riderIcon, dropoffIcon, RIDER_ICON_SIZE, DROPOFF_PIN_SIZE } from "./riderIcon.ts";

// divIcon just hands back its options, so the test reads exactly what Leaflet gets.
const L = { divIcon: (opts: unknown) => opts } as unknown as typeof Leaflet;
type Opts = { iconSize: [number, number]; iconAnchor: [number, number]; html: string };

describe("riderIcon", () => {
  it("is 24px, anchored at its centre", () => {
    const icon = riderIcon(L) as unknown as Opts;
    assert.equal(RIDER_ICON_SIZE, 24);
    assert.deepEqual(icon.iconSize, [24, 24]);
    assert.deepEqual(icon.iconAnchor, [12, 12]);
    assert.ok(icon.html.includes('width="24" height="24"'));
  });

  it("pulses while live, not when stale, and flips when heading west", () => {
    const live = riderIcon(L, { heading: 90 }) as unknown as Opts;
    assert.ok(live.html.includes("kb-rider__pulse"));
    assert.ok(live.html.includes("transform:none"));
    const stale = riderIcon(L, { heading: 270, stale: true }) as unknown as Opts;
    assert.ok(!stale.html.includes("kb-rider__pulse"));
    assert.ok(stale.html.includes("kb-rider--stale"));
    assert.ok(stale.html.includes("scaleX(-1)"));
  });
});

describe("dropoffIcon", () => {
  it("is 20x26px with its tip (bottom centre) on the address", () => {
    const icon = dropoffIcon(L) as unknown as Opts;
    assert.deepEqual(DROPOFF_PIN_SIZE, [20, 26]);
    assert.deepEqual(icon.iconSize, [20, 26]);
    assert.deepEqual(icon.iconAnchor, [10, 26]);
  });
});
