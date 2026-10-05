# Kopi Boy Partner

One app for both cooks and riders (per the locked spec — one partner
login, role determines the dashboard). Next.js 16 + TypeScript + Tailwind
v4, same design tokens as Kopi Boy Customer and Kopi Boy HQ.

## Getting started
```bash
npm install
npm run dev   # http://localhost:3000
npm run build
```

## Current status: Feature #003 — Auth + roles done, cook kitchen/menu setup done

- Design system shared with Customer/HQ (`src/app/globals.css`)
- **Real auth**: phone OTP (Vonage) + Google Sign-In, `/login`
- **Real application flow**: `/` gates on Supabase — sign in → apply
  (cook or rider) → pending/rejected status screen → once HQ approves,
  cooks are routed into kitchen setup, riders straight into the shell
- **Real kitchen/menu setup** (`src/components/KitchenSetupForm.tsx`,
  `/kitchen`): mandatory business info + category + cuisine + at least one
  menu item with a price (photo optional); saving flips `kitchens.is_live`
  and the kitchen appears immediately in the Customer app. See
  `docs/feature-003.md`.
- Order list / delivery list inside `PartnerShell` are still
  PENDING/ACCEPTED/PREPARING/READY/COMPLETED **demo data** — real orders are
  Feature #005/#006, real rider dispatch is #008
- View toggle in `PartnerShell` is still a demo stand-in for switching
  between cook/rider views — not real role-based routing (that part is
  fine since role is now enforced server-side in `page.tsx` before the
  shell ever renders)

`src/lib/demo-data.ts` — orders/deliveries only now, not applications or
kitchens (those are real). No PayNow flow yet (#006).
