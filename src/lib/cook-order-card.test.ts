import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canShowRequestRider, cookCardStage, riderView } from "./cook-order-card.ts";

const req = (status: string, created_at: string, picked_up_at: string | null = null) => ({ status, created_at, picked_up_at });

describe("cookCardStage", () => {
  it("is unpaid until the cook marks payment received, whatever the kitchen did", () => {
    for (const preparation_status of ["not_started", "preparing", "ready"]) {
      assert.equal(cookCardStage({ payment_status: "unpaid", preparation_status }), "unpaid");
    }
  });

  it("follows preparation once paid", () => {
    assert.equal(cookCardStage({ payment_status: "paid", preparation_status: "not_started" }), "not_started");
    assert.equal(cookCardStage({ payment_status: "paid", preparation_status: "preparing" }), "preparing");
    assert.equal(cookCardStage({ payment_status: "paid", preparation_status: "ready" }), "ready");
  });
});

describe("riderView", () => {
  it("is none with no requests, or only cancelled ones", () => {
    assert.deepEqual(riderView([]), { stage: "none" });
    assert.deepEqual(riderView(null), { stage: "none" });
    assert.equal(riderView([req("cancelled", "2026-10-31T01:00:00Z")]).stage, "none");
  });

  it("walks requested → accepted → picked up → delivered", () => {
    assert.equal(riderView([req("open", "2026-10-31T01:00:00Z")]).stage, "requested");
    assert.equal(riderView([req("accepted", "2026-10-31T01:00:00Z")]).stage, "accepted");
    assert.equal(riderView([req("accepted", "2026-10-31T01:00:00Z", "2026-10-31T01:20:00Z")]).stage, "picked_up");
    assert.equal(riderView([req("completed", "2026-10-31T01:00:00Z")]).stage, "delivered");
  });

  it("shows a dropped delivery, until the cook requests again", () => {
    const dropped = req("release_requested", "2026-10-31T01:00:00Z");
    assert.deepEqual(riderView([dropped]), { stage: "released", request: dropped });
    const again = req("open", "2026-10-31T01:30:00Z");
    assert.deepEqual(riderView([dropped, again]), { stage: "requested", request: again });
  });

  it("uses the newest live request when there are several", () => {
    const older = req("open", "2026-10-31T01:00:00Z");
    const newer = req("accepted", "2026-10-31T02:00:00Z");
    assert.equal(riderView([older, newer]).request, newer);
    assert.equal(riderView([newer, older]).request, newer);
  });
});

describe("canShowRequestRider", () => {
  it("never shows before payment is received", () => {
    assert.equal(canShowRequestRider("unpaid", "none"), false);
    assert.equal(canShowRequestRider("unpaid", "released"), false);
  });

  it("shows at every kitchen stage once paid, including before Start Cooking", () => {
    for (const stage of ["not_started", "preparing", "ready"] as const) {
      assert.equal(canShowRequestRider(stage, "none"), true);
      assert.equal(canShowRequestRider(stage, "released"), true);
    }
  });

  it("hides while a rider is requested, on the job, or done", () => {
    for (const rider of ["requested", "accepted", "picked_up", "delivered"] as const) {
      assert.equal(canShowRequestRider("not_started", rider), false);
    }
  });
});
