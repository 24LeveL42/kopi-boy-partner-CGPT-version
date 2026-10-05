# Feature #003 — Merchant Onboarding (Partner-app half)

## Scope

Cook kitchen/menu setup: after HQ approves a cook application, the cook must
set up their kitchen (business info + category + cuisine + at least one menu
item with a price; photo optional) before their kitchen appears in the
Customer app. The Customer-app read side lives in that repo — see its
`docs/feature-003.md`.

## Locked business rules this feature must not contradict

- Menu items and price tags are mandatory; a food photo is optional.
- Once a cook submits their kitchen, it must appear in the Customer app —
  implemented here as `kitchens.is_live = true` on save, which the Customer
  app's `getLiveMerchants()` filters on directly.

## What changed

| File | Change |
|---|---|
| `docs/supabase-schema.sql` | Appended `kitchens` + `menu_items` tables and RLS policies. Same migration file as Customer/Boss repos — **run it once per Supabase project**, not once per repo, since all three point at the same database. |
| `src/lib/types-kitchen.ts` | New. `Kitchen`, `MenuItem` types — field names/values match the Customer app's `Merchant["category"]` / `Merchant["cuisineType"]` exactly, on purpose, so a kitchen row needs no translation layer to become a `Merchant`. |
| `src/components/KitchenSetupForm.tsx` | New. Handles both first-time setup and later edits (`existingKitchen`/`existingItems` props). Validates business name + business address + 6-digit postal code + the partner-terms acknowledgement + at least one valid menu item before allowing submit (neighbourhood was replaced by address/postal code — schema section 28). On save: upserts the `kitchens` row with `is_live: true`, then replaces all `menu_items` rows for that kitchen (delete-all + insert, not a diff — simplest correct approach at this scope). |
| `src/app/page.tsx` | Cooks with `role: "cook"` and no `kitchens` row yet are routed into `<KitchenSetupForm>` (pre-filled from their approved `cook_applications` row) instead of straight into `<PartnerShell>`. Riders are unaffected. |
| `src/app/kitchen/page.tsx` | New. Lets an already-live cook come back and edit their kitchen/menu — same form, `existingKitchen`/`existingItems` populated from Supabase. |
| `src/components/PartnerShell.tsx` | Added a "Manage kitchen & menu ›" link in the cook view header, linking to `/kitchen`. |

## Known placeholders (intentional, not gaps to silently fix)

- Menu item photos are a plain URL text field — no Supabase Storage upload
  UI yet. Fine as-is per the locked spec (photo is optional); revisit if/when
  a later feature adds real image uploads across the apps.
- "Replace all menu items on every save" is intentional for this scope — a
  real diff-based update (to preserve item IDs, e.g. for order-history
  references) isn't needed until an `order_items` table exists (#005+).

## What's still NOT here

- Orders/deliveries in `PartnerShell` are still 100% demo data
  (`DEMO_ORDERS`, `DEMO_DELIVERIES`) — that's #005/#006 (cart + accept/reject
  + PayNow) and #008 (rider workflow), not #003.
- The cook/rider view toggle inside `PartnerShell` is still a demo artifact
  left over from before real roles existed — harmless since `page.tsx` only
  ever renders `PartnerShell` for a user whose real role is already
  confirmed, but worth removing once there's a reason to touch that file
  again.

## Open question for the Product Owner

None blocking. Worth deciding before #004: should `category`/`cuisine_type`
be editable after a kitchen goes live (currently yes, via `/kitchen`), or
should changing category require re-review by HQ? Left as freely editable
for now since nothing in the handover doc says otherwise.
