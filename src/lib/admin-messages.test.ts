import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_MESSAGE_MAX_LENGTH,
  adminMessageLength,
  adminMessageSendErrorText,
  sortAdminMessagesNewestFirst,
  validateAdminMessage,
  type AdminMessage,
} from "./admin-messages.ts";

describe("validateAdminMessage", () => {
  it("allows up to 500 characters (matching the database check)", () => {
    assert.equal(ADMIN_MESSAGE_MAX_LENGTH, 500);
  });

  it("rejects an empty or whitespace-only message", () => {
    for (const bad of ["", "   ", "\n\t "]) {
      const result = validateAdminMessage(bad);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, "Please write a message first.");
    }
  });

  it("trims the message it accepts", () => {
    assert.deepEqual(validateAdminMessage("  Why am I blocked?  \n"), { ok: true, message: "Why am I blocked?" });
  });

  it("accepts exactly 500 characters and rejects 501", () => {
    assert.equal(validateAdminMessage("a".repeat(500)).ok, true);
    const tooLong = validateAdminMessage("a".repeat(501));
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.match(tooLong.error, /500 characters/);
  });

  it("doesn't count surrounding whitespace toward the limit", () => {
    assert.equal(validateAdminMessage(`  ${"a".repeat(500)}  `).ok, true);
  });

  it("counts an emoji as one character, like Postgres char_length", () => {
    assert.equal(adminMessageLength("😀"), 1);
    assert.equal(validateAdminMessage("😀".repeat(500)).ok, true);
    assert.equal(validateAdminMessage("😀".repeat(501)).ok, false);
  });
});

describe("sortAdminMessagesNewestFirst", () => {
  const msg = (id: string, created_at: string): AdminMessage => ({
    id,
    sender_id: "u",
    sender_role: "rider",
    message: id,
    admin_reply: null,
    replied_at: null,
    status: "open",
    created_at,
  });

  it("puts the newest message first without mutating the input", () => {
    const input = [msg("old", "2026-10-01T08:00:00Z"), msg("new", "2026-10-03T08:00:00Z"), msg("mid", "2026-10-02T08:00:00Z")];
    assert.deepEqual(
      sortAdminMessagesNewestFirst(input).map((m) => m.id),
      ["new", "mid", "old"]
    );
    assert.deepEqual(
      input.map((m) => m.id),
      ["old", "new", "mid"]
    );
  });
});

describe("adminMessageSendErrorText", () => {
  it("passes the database's friendly rate-limit message through", () => {
    const message = "You can send up to 5 messages to the admin every 24 hours. Please wait for a reply or try again later.";
    assert.equal(adminMessageSendErrorText({ code: "P0001", message, hint: "admin_messages_rate_limit" }), message);
  });

  it("hides other raw database errors behind a generic line", () => {
    const text = adminMessageSendErrorText({ code: "42501", message: "new row violates row-level security policy", hint: null });
    assert.doesNotMatch(text, /row-level/);
    assert.match(text, /couldn't be sent/);
  });
});
