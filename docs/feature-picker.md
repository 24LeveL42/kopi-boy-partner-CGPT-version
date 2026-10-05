# Picker role — optional rider pickup helper

## Scope

A fourth role, "picker": someone who collects an order from the cook and
hands it to the rider nearby. Optional per-delivery — the rider chooses
whether to use one. Locked business rules from the design conversation:

- Picker must register with OTP (same as cook/rider) — an anonymous
  bystander picker could disappear after collecting food with no
  accountability trail.
- The rider pays the picker directly, off-platform (cash/PayNow) — Kopi Boy
  never touches that money, same pattern as cook-pays-rider.
- Picker lives inside the existing Partner app (not a separate app) —
  same login, same OTP flow, just a third role.
- Term is "picker", not "walker".

## What changed

| Repo | File | Change |
|---|---|---|
| All three | `docs/supabase-schema.sql` | Appended: `profiles.role` check constraint now allows `'picker'`; new `picker_applications` table (mirrors cook/rider applications); new `pickup_requests` table (the rider↔picker handshake). Run once per Supabase project. |
| Partner | `src/lib/types-auth.ts` | `Profile.role` includes `"picker"`; added `PickerApplication`. |
| Partner | `src/lib/types.ts` | `PartnerRole` includes `"picker"` (used for future consistency; `PartnerShell` itself still only handles cook/rider views). |
| Partner | `src/lib/types-picker.ts` | New. `PickupRequest`, `PickupRequestWithKitchen`. |
| Partner | `src/components/ApplyForm.tsx` | Added a third "I'm a picker" option with an optional note field, inserts into `picker_applications`. |
| Partner | `src/components/PickerShell.tsx` | New. The picker's home screen: feed of open pickup requests (any live one, not filtered by proximity — no geolocation yet), Accept, and once accepted, "mark handoff complete". |
| Partner | `src/components/RequestPickerForm.tsx` + `src/app/request-picker/page.tsx` | New. Rider-side: pick a live kitchen from a dropdown, submit a pickup request, see its status (open / picker on the way / handed off). |
| Partner | `src/app/page.tsx` | Picker applications now included in the pending/rejected check; `role === "picker"` routes to `<PickerShell>` instead of `<PartnerShell>`. |
| Partner | `src/components/PartnerShell.tsx` | Added a "Request a picker" link in the rider view header, linking to `/request-picker`. |
| Boss | `src/lib/types-auth.ts` | Same `Profile.role` + `PickerApplication` addition. |
| Boss | `src/lib/actions.ts` | Added `approvePickerApplication` / `rejectPickerApplication` — same shape as the cook/rider actions. |
| Boss | `src/components/HqDashboard.tsx` | Pending picker applications now show in the same approvals list, with Approve/Reject. |
| Boss | `src/app/partners/page.tsx` | Added a "Pickers" section alongside Cooks and Riders, same Block/Reinstate row. |

## Known placeholders (intentional)

- **No link to a real order/delivery yet.** `pickup_requests.kitchen_id` is
  enough to make the full accept → collect → handoff loop testable right
  now, but it isn't tied to a specific delivery — that requires #005/#006/
  #008 to exist first. When those land, add a `delivery_id` column and stop
  letting the rider free-pick a kitchen from a dropdown.
- **No proximity filtering.** The picker feed shows every open request
  Singapore-wide, not just nearby ones — there's no geolocation feature yet.
  Fine for testing; revisit once location exists.
- **"First to accept wins" is enforced by a `WHERE status = 'open'` on the
  update, not a database-level lock.** Two pickers accepting in the same
  instant is a real (small) race window. Acceptable at this stage — same
  level of rigor as the order-locking logic already in the codebase; revisit
  if it becomes a real problem at volume.
- **Suggested fee is a fixed $2.00 default**, shown to both sides, not
  editable yet. Matches the "app shows a suggested figure, both parties
  agree the final amount" pattern already used for rider delivery fees.

## What's still NOT here

- Any UI to browse/manage `picker_applications` note text at length, or any
  picker-specific admin analytics — folded into the generic partners list
  for now.
- HQ warn/suspend for a no-show picker uses the exact same Block/Reinstate
  button as cooks/riders (`profiles.is_active`) — no picker-specific
  warning tier exists, matching how cooks/riders work today.

## Setup reminder

The Boss zip handed over for this feature is missing `package.json`,
`tsconfig.json`, `next.config.ts`, and other root config files — same issue
as before. The Boss code changes above are correct and ready to copy into
the real local Boss folder (which has those files), but this zip alone
won't `npm install`/build standalone.
