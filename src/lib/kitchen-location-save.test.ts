import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCATION_UNCONFIRMED_NOTICE,
  canReuseSavedLocation,
  kitchenAddressRow,
  planKitchenLocation,
  savedNotice,
  type KitchenPostalLookup,
} from "./kitchen-location-save.ts";

const realError = console.error;
beforeEach(() => {
  console.error = () => {};
});
afterEach(() => {
  console.error = realError;
});

const SAVED = { postal_code: "310123", latitude: 1.337226, longitude: 103.845573 };
const NONE = { postal_code: "", latitude: null, longitude: null };

function lookup(answer: KitchenPostalLookup | "throw") {
  const calls: string[] = [];
  const fn = async (postal: string) => {
    calls.push(postal);
    if (answer === "throw") throw new Error("server action failed");
    return answer;
  };
  return { fn, calls };
}

describe("planKitchenLocation: saving is never blocked by OneMap", () => {
  it("postal code unchanged and coordinates saved: OneMap isn't called, the saved ones are kept", async () => {
    const l = lookup({ ok: false, reason: "unavailable" });
    assert.deepEqual(await planKitchenLocation(" 310123 ", SAVED, l.fn), {
      kind: "save",
      coords: { latitude: SAVED.latitude, longitude: SAVED.longitude },
      foundAddress: null,
      unconfirmed: false,
    });
    assert.equal(l.calls.length, 0);
  });

  it("postal code unchanged but no coordinates saved yet: looks it up (fills them in later)", async () => {
    const l = lookup({ ok: true, lat: 1.3, lng: 103.8, address: "X" });
    const plan = await planKitchenLocation("310123", { postal_code: "310123", latitude: null, longitude: null }, l.fn);
    assert.deepEqual(l.calls, ["310123"]);
    assert.deepEqual(plan, { kind: "save", coords: { latitude: 1.3, longitude: 103.8 }, foundAddress: "X", unconfirmed: false });
  });

  it("changed postal code, lookup works: the new coordinates are saved", async () => {
    const l = lookup({ ok: true, lat: 1.35, lng: 103.9, address: "NEW ADDRESS" });
    assert.deepEqual(await planKitchenLocation("520123", SAVED, l.fn), {
      kind: "save",
      coords: { latitude: 1.35, longitude: 103.9 },
      foundAddress: "NEW ADDRESS",
      unconfirmed: false,
    });
  });

  it("changed postal code, lookup unavailable: still saves, no coordinates written, the notice is shown", async () => {
    for (const saved of [SAVED, NONE]) {
      assert.deepEqual(await planKitchenLocation("520123", saved, lookup({ ok: false, reason: "unavailable" }).fn), {
        kind: "save",
        coords: null,
        foundAddress: null,
        unconfirmed: true,
      });
    }
  });

  it("the lookup call itself throwing counts as unavailable, not a failed save", async () => {
    const plan = await planKitchenLocation("520123", NONE, lookup("throw").fn);
    assert.equal(plan.kind, "save");
    assert.equal(plan.kind === "save" && plan.unconfirmed, true);
  });

  it("things the owner can fix still stop the save, with the same messages as before", async () => {
    assert.deepEqual(await planKitchenLocation("520123", SAVED, lookup({ ok: false, reason: "not_found" }).fn), {
      kind: "block",
      error: "We couldn't find that postal code. Please check it.",
    });
    assert.deepEqual(await planKitchenLocation("12", SAVED, lookup({ ok: false, reason: "invalid" }).fn), {
      kind: "block",
      error: "Postal code must be 6 digits (e.g. 310123).",
    });
    assert.deepEqual(await planKitchenLocation("520123", SAVED, lookup({ ok: false, reason: "signed_out" }).fn), {
      kind: "block",
      error: "Your session has expired. Please sign in again.",
    });
  });

  it("canReuseSavedLocation needs both coordinates and the same postal code", () => {
    assert.equal(canReuseSavedLocation("310123", SAVED), true);
    assert.equal(canReuseSavedLocation("310124", SAVED), false);
    assert.equal(canReuseSavedLocation("310123", { ...SAVED, longitude: null }), false);
    assert.equal(canReuseSavedLocation("", NONE), false);
  });
});

describe("kitchenAddressRow", () => {
  it("writes the coordinates when there are some", () => {
    assert.deepEqual(
      kitchenAddressRow("k1", " 1 Road ", " 310123 ", { kind: "save", coords: { latitude: 1, longitude: 2 }, foundAddress: null, unconfirmed: false }),
      { kitchen_id: "k1", business_address: "1 Road", postal_code: "310123", latitude: 1, longitude: 2 },
    );
  });

  it("leaves latitude/longitude out entirely when unconfirmed, so saved ones stay and none are made up", () => {
    const row = kitchenAddressRow("k1", "1 Road", "520123", { kind: "save", coords: null, foundAddress: null, unconfirmed: true });
    assert.deepEqual(row, { kitchen_id: "k1", business_address: "1 Road", postal_code: "520123" });
    assert.equal("latitude" in row, false);
    assert.equal("longitude" in row, false);
  });
});

describe("savedNotice", () => {
  it("the location notice, word for word", () => {
    assert.equal(
      LOCATION_UNCONFIRMED_NOTICE,
      "We couldn't confirm your address location right now. Your details are saved; delivery quotes may be unavailable until it's confirmed.",
    );
  });
  it("none, either, or both", () => {
    assert.equal(savedNotice({ uenNote: null, locationUnconfirmed: false }), null);
    assert.equal(savedNotice({ uenNote: "U.", locationUnconfirmed: false }), "U.");
    assert.equal(savedNotice({ uenNote: null, locationUnconfirmed: true }), LOCATION_UNCONFIRMED_NOTICE);
    assert.equal(savedNotice({ uenNote: "U.", locationUnconfirmed: true }), `U. ${LOCATION_UNCONFIRMED_NOTICE}`);
  });
});

describe("Kitchen Setup wiring", () => {
  const form = readFileSync(new URL("../components/KitchenSetupForm.tsx", import.meta.url), "utf8");
  const saveKitchen = form.slice(form.indexOf("async function saveKitchen("), form.indexOf("async function saveAddons("));

  it("the save plans the location from the saved postal code and coordinates, before any write", () => {
    const plan = saveKitchen.indexOf("planKitchenLocation(");
    assert.ok(plan > 0 && plan < saveKitchen.indexOf("runUenStep(") && plan < saveKitchen.indexOf("saveKitchenRow("));
    assert.match(saveKitchen, /postal_code: defaults\.postal_code, latitude: defaults\.latitude \?\? null, longitude: defaults\.longitude \?\? null/);
    assert.match(saveKitchen, /if \(location\.kind === "block"\) \{\s*setError\(location\.error\);\s*return;/);
  });

  it("the address row goes through kitchenAddressRow, never a bare latitude", () => {
    assert.match(saveKitchen, /upsert\(kitchenAddressRow\(userId, businessAddress, postal, location\)\)/);
    assert.doesNotMatch(saveKitchen, /latitude: location/);
  });

  it("an unconfirmed location stays on the page with the notice", () => {
    assert.match(saveKitchen, /locationUnconfirmed: location\.unconfirmed/);
  });

  it("the form never imports the server-side lookup or token code directly", () => {
    assert.doesNotMatch(form, /from "@\/lib\/geocode"|onemap-token/);
  });
});
