import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

/**
 * Web Push sender. Supabase calls this from a Database Webhook on every
 * INSERT into `notifications` (setup steps in docs/feature-notifications.md).
 * It looks up the recipient's browser subscriptions and pushes the alert to
 * each, dropping subscriptions the push service says are gone.
 *
 * Authenticated by a shared secret (`x-webhook-secret`), not by a user
 * session — it runs with the service-role key, so it must never be callable
 * without that secret.
 */

function sameSecret(given: string | null, expected: string) {
  if (!given) return false;
  // Hash both so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Names what a mistakenly-pasted key actually is, or null if it could be a real service-role key. */
function wrongKeyKind(key: string, publishableKey?: string) {
  const k = key.trim();
  if (k.startsWith("sb_publishable_") || (publishableKey && k === publishableKey.trim())) {
    return "the publishable (anon) key";
  }
  const parts = k.split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (claims.role === "anon") return "the anon key";
    } catch {
      // not a decodable JWT — let Supabase reject it if it's bad
    }
  }
  return null;
}

interface NotificationRecord {
  id: string;
  user_id: string;
  category: string;
  type: string;
  title: string;
  body: string | null;
  url: string;
}

export async function POST(request: Request) {
  const {
    PUSH_WEBHOOK_SECRET,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_SUBJECT,
    NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
  } = process.env;

  if (
    !PUSH_WEBHOOK_SECRET ||
    !NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !VAPID_PRIVATE_KEY ||
    !NEXT_PUBLIC_SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: "Push sender is not configured" }, { status: 503 });
  }

  if (!sameSecret(request.headers.get("x-webhook-secret"), PUSH_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { type?: string; table?: string; record?: NotificationRecord };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = payload.record;
  if (payload.type !== "INSERT" || payload.table !== "notifications" || !record?.user_id) {
    return NextResponse.json({ error: "Not a notifications INSERT" }, { status: 400 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.com", NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // A key of the wrong kind doesn't error — RLS just hides every row, so pushes
  // would silently go nowhere. Catch that here instead.
  const wrongKey = wrongKeyKind(SUPABASE_SERVICE_ROLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (wrongKey) {
    console.error(`push: SUPABASE_SERVICE_ROLE_KEY is ${wrongKey}`);
    return NextResponse.json({ error: `SUPABASE_SERVICE_ROLE_KEY is ${wrongKey}, not the service_role key` }, { status: 503 });
  }

  // trim(): a pasted key with a trailing newline/space is an invalid header value.
  const admin = createClient(NEXT_PUBLIC_SUPABASE_URL.trim(), SUPABASE_SERVICE_ROLE_KEY.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", record.user_id);

  if (error) {
    console.error("push: loading subscriptions failed:", error);
    // The caller already proved it holds the webhook secret, so it's safe to
    // say *why* — it lands in net._http_response, which makes this diagnosable
    // from the SQL editor. Typical codes: 42501 = missing GRANT to service_role,
    // PGRST205/42P01 = migration not run, 401/"Invalid API key" = wrong key.
    return NextResponse.json(
      {
        error: "Could not load subscriptions",
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
      { status: 500 }
    );
  }

  const message = JSON.stringify({
    title: record.title,
    body: record.body ?? "",
    url: record.url || "/",
    tag: record.id,
    category: record.category,
    type: record.type,
  });

  const gone: string[] = [];
  const failures: { status?: number; message: string }[] = [];
  let sent = 0;

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          message,
          { TTL: 60 * 60, urgency: record.category === "account" ? "normal" : "high" }
        );
        sent += 1;
      } catch (err) {
        const { statusCode: status, body, message: text } = err as { statusCode?: number; body?: string; message?: string };
        if (status === 404 || status === 410) gone.push(s.id); // unsubscribed / expired
        else {
          console.error("push: send failed:", status, err);
          failures.push({ status, message: String(body || text || "unknown error").slice(0, 200) });
        }
      }
    })
  );

  if (gone.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", gone);
  }

  // `subscriptions` vs `sent` tells "recipient has no saved subscription"
  // (subscriptions: 0) apart from "sends are failing" (see `failures`). Safe to
  // return: the caller already proved it holds the webhook secret. Lands in
  // net._http_response.
  return NextResponse.json({
    subscriptions: subs?.length ?? 0,
    sent,
    failed: failures.length,
    removed: gone.length,
    ...(failures.length > 0 && { failures: failures.slice(0, 3) }),
  });
}
