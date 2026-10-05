# Notifications — in-app inbox, live updates, Web Push, reminders

## What it does

| Who | Gets notified when |
|---|---|
| **Cook** | New order · customer cancels · order un-accepted after 5 min (once) · rider accepts · rider drops the delivery · delivery completed · no rider after 10 min (once) |
| **Rider** | New delivery request (all on-duty riders) · cook/customer cancels a delivery they accepted · picker accepts / hands off their pickup request |
| **Picker** | New pickup request (all on-duty pickers) · rider cancels a pickup they accepted |
| **Everyone** | Application approved / rejected by HQ · account blocked / reinstated |

Three layers, each useful on its own:

1. **Live in-app** — a bell with an unread count, a toast + chime + vibration when something arrives, an inbox at `/notifications`, and the Orders / Deliveries / Picker dashboards update themselves (no more tapping Refresh).
2. **Web Push** — the same alerts reach the phone when the app is closed (needs the setup below). The app icon also shows the unread count on installed apps.
3. **Reminders** — timed nudges from `pg_cron`.

Per-user controls (`/notifications`): mute Orders / Deliveries / Pickups, **Available for requests** (riders & pickers — off = not pinged for new requests), Sound, and the device push switch. Account alerts can't be muted.

## How it's wired

- **Events are database triggers** (`docs/supabase-notifications.sql`) on `orders`, `delivery_requests`, `pickup_requests`, the three `*_applications` tables and `profiles`. They fire no matter which app made the change — the Customer app and HQ need **no code changes**.
- Every trigger is wrapped in an exception block: a notification bug can never roll back a real order.
- Triggers write rows to `notifications`. The browser hears about them over **Supabase Realtime** (in-app) and via a **Database Webhook → `/api/push/send`** (Web Push).
- `src/app/api/push/send/route.ts` uses the service-role key, so it only accepts requests carrying the shared `x-webhook-secret`.
- `public/sw.js` shows the push and opens/focuses the app on tap.
- Dashboards use `useLiveRefresh` (Realtime + a 30 s poll + catch-up on focus). The poll is deliberate: Realtime only delivers rows a user can *still* see, so a rider is never told that an open request was taken by someone else.

## One-time setup

### 1. Run the SQL
Supabase Dashboard → SQL Editor → New query → paste `docs/supabase-notifications.sql` → Run. Safe to re-run.

For the two timed reminders it uses `pg_cron`. If the run prints *"pg_cron not available"*, enable it under Database → Extensions and run the file again. Everything else works without it.

### 2. Environment variables
Already generated into your local `.env.local` (git-ignored). Add the same five to your hosting provider's environment settings, then **redeploy** (the `NEXT_PUBLIC_` key is baked in at build time):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public; safe in the browser |
| `VAPID_PRIVATE_KEY` | **secret** |
| `VAPID_SUBJECT` | `mailto:` contact for the push services |
| `PUSH_WEBHOOK_SECRET` | **secret**; must match the webhook header below |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret**; Dashboard → Project Settings → API → `service_role`. Server-only — never expose it |

### 3. Database Webhook (this is what sends the push)
Dashboard → Database → Webhooks → **Create a new hook**:

- Name: `kb-push`
- Table: `notifications` · Events: **Insert**
- Type: **HTTP Request** · Method: `POST`
- URL: `https://<your-deployed-domain>/api/push/send`
- HTTP Headers: `Content-Type: application/json` and `x-webhook-secret: <PUSH_WEBHOOK_SECRET>`

**If the dashboard fails** with *"schema supabase_functions does not exist"* (that schema backs the Webhooks feature and isn't always provisioned), skip it and run `docs/supabase-push-trigger.sql` instead. It does the same thing with `pg_net` directly: edit the two values in its step 3 (your domain and the same `PUSH_WEBHOOK_SECRET`), then run it. To check delivery afterwards:

```sql
select id, status_code, error_msg, left(content, 120) from net._http_response order by created desc limit 5;
```
`200` = sent · `401` = secret doesn't match Vercel's · `503` = env vars missing or not redeployed.

**If `net._http_response` shows a 500**, its `content` column now says why (`select status_code, content from net._http_response order by created desc limit 5;`):

| `code` / message | Cause | Fix |
|---|---|---|
| `42501` permission denied for table push_subscriptions | `service_role` has no grant on the table | `grant select, delete on public.push_subscriptions to service_role;` (also in the migration now) |
| `PGRST205` / `42P01` table not found | `supabase-notifications.sql` wasn't run (fully) | run it |
| `401` / "Invalid API key" | `SUPABASE_SERVICE_ROLE_KEY` is truncated/wrong | re-copy the `service_role` key, redeploy |
| "fetch failed" / empty message | `NEXT_PUBLIC_SUPABASE_URL` wrong on Vercel | fix the URL, redeploy |

A **503** naming the anon/publishable key means the wrong key was pasted into `SUPABASE_SERVICE_ROLE_KEY`.

Without steps 2–3 the in-app layer still works fully; only closed-app push is off.

### 4. Turn it on per device
Open the app → menu → **Notifications** → **Turn on notifications**. The browser permission prompt only appears from that tap.

- **iPhone:** push only works once the app is added to the Home Screen (Share → Add to Home Screen) and opened from there. iOS 16.4+.
- Signing out removes that device's subscription, so a shared phone never keeps buzzing for the previous account.

## Testing it
1. Sign in as a cook on one device; place an order from the Customer app (or insert an `orders` row) → toast + bell + chime; the order appears without refreshing.
2. Close the app, place another → the phone should buzz (after steps 2–3).
3. As a cook, request a rider → every on-duty rider is notified; one accepts → the cook is notified and other riders' lists update.
4. Toggle **Available for requests** off as a rider → new delivery requests skip them.

## Known limits
- The chime plays once per alert, only while the app is open (browsers block audio until the first tap, and a closed app can only show one system notification, not loop a sound).
- Delivery requests go to **all** on-duty riders (kitchens have coordinates, riders don't — nearby-only needs rider location first).
- `delivery_requests` reaches `release_requested` only if something sets it (the Customer app / a future rider "release" button); the cook notification is ready for it.
- Notifications older than 30 days aren't pruned automatically; a commented-out `pg_cron` cleanup job is at the bottom of the SQL.
