import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COOK_FORM_FIELDS,
  MAX_BATCH,
  MAX_EVENTS_PER_SESSION,
  RegistrationTracker,
  isTestSession,
  stepOf,
  type RegistrationEvent,
} from "./registration-tracking.ts";

function harness() {
  const batches: { events: RegistrationEvent[]; keepalive: boolean }[] = [];
  let pending: (() => void) | null = null;
  const tracker = new RegistrationTracker({
    send: async (events, { keepalive }) => {
      batches.push({ events, keepalive });
    },
    setTimer: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimer: () => {
      pending = null;
    },
  });
  const tick = () => {
    const fn = pending;
    pending = null;
    fn?.();
  };
  return { tracker, batches, tick, all: () => batches.flatMap((b) => b.events) };
}

describe("RegistrationTracker", () => {
  it("batches events instead of sending each one", () => {
    const { tracker, batches, tick } = harness();
    tracker.track({ event: "page_view" });
    tracker.track({ event: "cook_form_view" });
    tracker.fieldFocused("full_name");
    assert.equal(batches.length, 0);
    tick();
    assert.equal(batches.length, 1);
    assert.deepEqual(
      batches[0].events.map((e) => e.event),
      ["page_view", "cook_form_view", "form_start", "field_reached"]
    );
  });

  it("counts form_start and each field once, however often it is focused", () => {
    const { tracker, tick, all } = harness();
    for (let i = 0; i < 5; i++) {
      tracker.fieldFocused("full_name");
      tracker.fieldFocused("contact_number");
    }
    tick();
    assert.deepEqual(
      all().map((e) => `${e.event}:${e.field ?? ""}:${e.step ?? ""}`),
      ["form_start::", "field_reached:full_name:1", "field_reached:contact_number:2"]
    );
  });

  it("records a validation error once per field + code", () => {
    const { tracker, tick, all } = harness();
    tracker.validationError("paynow_mobile", "invalid_mobile");
    tracker.validationError("paynow_mobile", "invalid_mobile");
    tracker.validationError("paynow_mobile", "paynow_missing");
    tick();
    assert.deepEqual(all().map((e) => e.code), ["invalid_mobile", "paynow_missing"]);
  });

  it("sends submit_success straight away and nothing after it", () => {
    const { tracker, batches, all } = harness();
    tracker.fieldFocused("full_name");
    tracker.track({ event: "submit_success" });
    assert.equal(batches.length, 1);
    tracker.leaving();
    tracker.fieldFocused("postal_code");
    tracker.flush(false);
    assert.equal(all().some((e) => e.event === "abandon" || e.field === "postal_code"), false);
  });

  it("marks abandon with the last field touched when the tab closes mid-form, sent with keepalive", () => {
    const { tracker, batches } = harness();
    tracker.fieldFocused("full_name");
    tracker.fieldFocused("postal_code");
    tracker.leaving();
    const last = batches.at(-1)!;
    assert.equal(last.keepalive, true);
    assert.deepEqual(last.events.at(-1), { event: "abandon", field: "postal_code", step: stepOf("postal_code") });
  });

  it("does not call it abandoned if the form was never started", () => {
    const { tracker, all } = harness();
    tracker.track({ event: "page_view" });
    tracker.leaving();
    assert.deepEqual(all().map((e) => e.event), ["page_view"]);
  });

  it("flushes a full batch early and caps a session", () => {
    const { tracker, batches, all } = harness();
    for (const f of COOK_FORM_FIELDS) tracker.fieldFocused(f);
    for (const f of COOK_FORM_FIELDS) tracker.validationError(f, "required");
    for (const f of COOK_FORM_FIELDS) tracker.validationError(f, "invalid_format");
    for (const f of COOK_FORM_FIELDS) tracker.validationError(f, "server_error");
    for (const f of COOK_FORM_FIELDS) tracker.validationError(f, "invalid_mobile");
    for (const f of COOK_FORM_FIELDS) tracker.validationError(f, "invalid_uen");
    tracker.flush(false);
    assert.ok(batches.every((b) => b.events.length <= MAX_BATCH));
    assert.equal(all().length, MAX_EVENTS_PER_SESSION);
  });

  it("never throws when sending fails", () => {
    const tracker = new RegistrationTracker({
      send: () => {
        throw new Error("offline");
      },
    });
    assert.doesNotThrow(() => {
      tracker.track({ event: "page_view" });
      tracker.flush(true);
    });
    const rejecting = new RegistrationTracker({ send: () => Promise.reject(new Error("500")) });
    assert.doesNotThrow(() => {
      rejecting.track({ event: "page_view" });
      rejecting.flush(true);
    });
  });
});

describe("isTestSession", () => {
  const prod = { hostname: "partner.example.com", search: "", stored: null, production: true };
  it("counts real production visitors", () => assert.equal(isTestSession(prod), false));
  it("excludes localhost and dev builds", () => {
    assert.equal(isTestSession({ ...prod, hostname: "localhost" }), true);
    assert.equal(isTestSession({ ...prod, hostname: "127.0.0.1" }), true);
    assert.equal(isTestSession({ ...prod, production: false }), true);
  });
  it("excludes a device marked with ?kb_test=1, until ?kb_test=0", () => {
    assert.equal(isTestSession({ ...prod, search: "?kb_test=1" }), true);
    assert.equal(isTestSession({ ...prod, stored: "1" }), true);
    assert.equal(isTestSession({ ...prod, stored: "1", search: "?kb_test=0" }), false);
  });
});

describe("kept in sync with docs/supabase-registration-tracking.sql", () => {
  const sql = readFileSync(new URL("../../docs/supabase-registration-tracking.sql", import.meta.url), "utf8");
  it("allows every form field the app sends, in both the table check and the function", () => {
    for (const f of COOK_FORM_FIELDS) {
      assert.equal(sql.split(`'${f}'`).length - 1, 2, f);
    }
  });
  it("allows every error code the app sends", () => {
    const src = readFileSync(new URL("./registration-tracking.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("export type ValidationCode"), src.indexOf("export interface RegistrationEvent"));
    const codes = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(codes.length >= 9);
    for (const c of codes) assert.equal(sql.split(`'${c}'`).length - 1, 2, c);
  });
});
