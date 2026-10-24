"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel, Spinner } from "./Pending";
import { Logo } from "./Logo";
import { PartnerMenu } from "./PartnerMenu";
import { FormField as Field } from "./FormField";
import { useBackHandler, useCancelHandler } from "./AppChrome";
import type { Kitchen, MenuItem, MerchantCategory, CuisineType, PaynowType } from "@/lib/types-kitchen";
import type { KitchenDefaults } from "@/lib/partner-routing";
import { KITCHEN_TERMS, MERCHANT_CATEGORIES, isValidPostalCode } from "@/lib/kitchen-profile";
import { lookupKitchenPostalCode, type KitchenPostalLookup } from "@/lib/kitchen-location-actions";
import {
  assignInsertedIds,
  dealsAffectedByRemoval,
  planMenuSave,
  withInserted,
  withoutDeleted,
  withUpdates,
  type AffectedDeal,
  type MenuItemDraft,
  type MenuSavePlan,
  type SavedMenuItem,
} from "@/lib/menu-save";

const PAYNOW_TYPES: { id: PaynowType; label: string }[] = [
  { id: "mobile", label: "PayNow Mobile Number" },
  { id: "uen", label: "PayNow UEN" },
];

const CUISINES: { id: CuisineType; label: string }[] = [
  { id: "chinese", label: "Chinese" },
  { id: "halal", label: "Halal" },
  { id: "indian", label: "Indian" },
  { id: "western", label: "Western" },
];

interface DraftItem {
  key: string; // local React list key only — never sent to the DB
  id?: string; // set only for rows loaded from the DB, so a save updates them in place
  name: string;
  price: string; // kept as text while editing, parsed to a number on submit
  photo_url: string;
  photoUploading: boolean; // local UI state only — never sent to the DB
}

function emptyItem(): DraftItem {
  return { key: crypto.randomUUID(), name: "", price: "", photo_url: "", photoUploading: false };
}

function draftFromSaved(i: SavedMenuItem): DraftItem {
  return { key: i.id, id: i.id, name: i.name, price: String(i.price), photo_url: i.photo_url ?? "", photoUploading: false };
}

// Failed postal lookups block saving — a wrong kitchen position gives
// customers wrong distances, so we'd rather not save one at all.
function postalLookupError(result: KitchenPostalLookup): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case "invalid":
      return "Postal code must be 6 digits (e.g. 310123).";
    case "not_found":
      return "We couldn't find that postal code. Please check it.";
    case "unavailable":
      return "Postal code lookup is temporarily unavailable. Please try again in a minute.";
    case "signed_out":
      return "Your session has expired. Please sign in again.";
  }
}

// Supabase errors (Postgrest, Storage, or a raw fetch/network throw) don't
// share one shape, and `.message` is sometimes empty even when `.details`/
// `.hint` have the actual reason — so pull whatever's there instead of
// trusting any single field, and always log the raw object so the full
// error (code, details, hint, stack) is visible in devtools too.
function describeSupabaseError(err: unknown): string {
  console.error("KitchenSetupForm error:", err);
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint].filter((p): p is string => !!p && p.trim().length > 0);
    if (parts.length > 0) {
      return e.code ? `${parts.join(" — ")} (code: ${e.code})` : parts.join(" — ");
    }
  }
  return "Something went wrong saving your kitchen — check the browser console for the full error.";
}

export function KitchenSetupForm({
  userId,
  defaults,
  existingKitchen,
  existingItems,
  onCancel,
}: {
  userId: string;
  defaults: KitchenDefaults;
  existingKitchen?: Kitchen | null;
  existingItems?: MenuItem[];
  /** Where Cancel goes. Defaults to Home; first-time setup (which *is* Home) passes its own. */
  onCancel?: () => void;
}) {
  const isEdit = !!existingKitchen;
  const router = useRouter();
  const supabase = createClient();

  const [businessName, setBusinessName] = useState(existingKitchen?.business_name ?? defaults.business_name);
  const [category, setCategory] = useState<MerchantCategory>(existingKitchen?.category ?? defaults.category);
  const [cuisineType, setCuisineType] = useState<CuisineType>(existingKitchen?.cuisine_type ?? "chinese");
  const [isHalal, setIsHalal] = useState(existingKitchen?.is_halal ?? false);
  const [businessAddress, setBusinessAddress] = useState(defaults.business_address);
  const [postalCode, setPostalCode] = useState(defaults.postal_code);
  const [description, setDescription] = useState(existingKitchen?.description ?? defaults.description ?? "");
  const [heroImage, setHeroImage] = useState(existingKitchen?.hero_image ?? "");
  const [heroUploading, setHeroUploading] = useState(false);
  const [paynowType, setPaynowType] = useState<PaynowType>(existingKitchen?.paynow_type ?? "mobile");
  const [paynowValue, setPaynowValue] = useState(existingKitchen?.paynow_value ?? "");
  // Address OneMap found for the last checked postal code, shown so the
  // cook can confirm it's their kitchen.
  const [foundAddress, setFoundAddress] = useState<{ postal: string; address: string } | null>(null);
  const [postalError, setPostalError] = useState<string | null>(null);
  // Once acknowledged it stays acknowledged (the DB keeps the first
  // timestamp — schema section 33), so the box only gates kitchens that
  // haven't ticked it yet, including ones set up before it existed.
  const alreadyAcknowledged = !!existingKitchen?.acknowledged_terms_at;
  const [acknowledged, setAcknowledged] = useState(alreadyAcknowledged);
  const [items, setItems] = useState<DraftItem[]>(
    existingItems && existingItems.length > 0
      ? existingItems.map(draftFromSaved)
      : [emptyItem()]
  );
  const { busy: loading, isRunning, run, startTransition } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  // Set on the first edit of any field — decides whether leaving needs a
  // "discard?" confirmation.
  const [touched, setTouched] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // A save that would take items out of running or upcoming deals waits here
  // for the cook's answer (the removal dialog below).
  const [removalPrompt, setRemovalPrompt] = useState<{ affected: AffectedDeal[]; plan: MenuSavePlan } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The menu as it is in the database right now: the page's load, then kept
  // up to date after every successful write, so a second Save after a
  // part-way failure plans from what was really saved.
  const savedItems = useRef<SavedMenuItem[]>(
    (existingItems ?? []).map((i) => ({ id: i.id, name: i.name, price: Number(i.price), photo_url: i.photo_url }))
  );
  // Set from the moment a save starts until it ends (see handleSubmit).
  const saveInFlight = useRef(false);

  function leave() {
    if (onCancel) onCancel();
    else router.push("/");
  }

  // Cancel (in-form or the global bar) and Home both land here, so a
  // half-filled form is never wiped or abandoned without asking.
  function requestLeave() {
    if (loading) return;
    if (touched) setConfirmLeave(true);
    else leave();
  }

  // First-time setup has no history behind it, so Back always means "leave
  // setup"; when editing, Back stays the browser's Back until there are
  // unsaved changes to protect.
  useBackHandler(!isEdit || touched ? requestLeave : null);
  useCancelHandler(requestLeave);

  // Uploads a cook-chosen file to the public kitchen-photos bucket under
  // this cook's own folder (required by the bucket's RLS policies — see
  // docs/supabase-schema.sql) and returns its public URL.
  async function uploadPhoto(file: File, prefix: string): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${prefix}-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("kitchen-photos")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) throw uploadError;
    return supabase.storage.from("kitchen-photos").getPublicUrl(path).data.publicUrl;
  }

  async function handleHeroFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setHeroUploading(true);
    try {
      setHeroImage(await uploadPhoto(file, "hero"));
    } catch (err) {
      setError(describeSupabaseError(err));
    } finally {
      setHeroUploading(false);
    }
  }

  async function handleItemPhotoChange(key: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    updateItem(key, { photoUploading: true });
    try {
      const url = await uploadPhoto(file, "dish");
      updateItem(key, { photo_url: url, photoUploading: false });
    } catch (err) {
      setError(describeSupabaseError(err));
      updateItem(key, { photoUploading: false });
    }
  }

  // The kitchen's coordinates come only from its postal code (geocoded on
  // the server), never from the cook's device GPS — a phone's position at
  // the moment of saving isn't necessarily where the kitchen is.
  function handleCheckPostalCode() {
    setPostalError(null);
    setFoundAddress(null);
    if (!isValidPostalCode(postalCode)) {
      setPostalError("Postal code must be 6 digits (e.g. 310123).");
      return;
    }
    const postal = postalCode.trim();
    run("postal", async () => {
      try {
        const result = await lookupKitchenPostalCode(postal);
        if (result.ok) setFoundAddress({ postal, address: result.address });
        else setPostalError(postalLookupError(result));
      } catch {
        setPostalError(postalLookupError({ ok: false, reason: "unavailable" }));
      }
    });
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setTouched(true);
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(key: string) {
    setTouched(true);
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A second click (or Enter) while a save is running is ignored. The
    // button is disabled too, but only after React re-renders.
    if (saveInFlight.current) return;
    setError(null);
    setNotice(null);

    const validItems: MenuItemDraft[] = items
      .map((it) => ({ key: it.key, id: it.id, name: it.name.trim(), price: parseFloat(it.price), photo_url: it.photo_url }))
      .filter((it) => it.name.length > 0 && !Number.isNaN(it.price) && it.price > 0);

    if (!businessName.trim() || !businessAddress.trim()) {
      setError("Business name and business address are required.");
      return;
    }
    if (!isValidPostalCode(postalCode)) {
      setError("Postal code must be 6 digits (e.g. 310123).");
      return;
    }
    if (!acknowledged) {
      setError("Please tick the acknowledgement before saving.");
      return;
    }
    if (validItems.length === 0) {
      setError("Add at least one menu item with a name and a price above $0 — this is required before you can go live.");
      return;
    }

    // Planned against what's really saved now (savedItems), not the page's
    // first load. Blank or invalid rows are dropped (so a saved one is
    // deleted), as before.
    const plan = planMenuSave(savedItems.current, validItems);

    run("save", async () => {
      saveInFlight.current = true;
      try {
        const affected = plan.deleteIds.length > 0 ? await findAffectedDeals(plan.deleteIds) : [];
        if (affected.length > 0) {
          setRemovalPrompt({ affected, plan });
          return;
        }
        await saveKitchen(plan, []);
      } catch (err) {
        setError(describeSupabaseError(err));
      } finally {
        saveInFlight.current = false;
      }
    });
  }

  // The cook's running and upcoming deals that use any item about to be
  // removed. Never blocks the save: if deals can't be read, the menu saves
  // just as it did before deals existed.
  async function findAffectedDeals(deleteIds: string[]): Promise<AffectedDeal[]> {
    const { data, error: dealsError } = await supabase
      .from("promotions")
      .select("id, title, free_item_id, promotion_items(menu_item_id)")
      .eq("kitchen_id", userId)
      .eq("is_active", true)
      .is("disabled_by_admin_at", null)
      .gt("ends_at", new Date().toISOString());
    if (dealsError) {
      console.error("KitchenSetupForm: couldn't check deals before removing items", dealsError);
      return [];
    }
    const deals = (data ?? []) as { id: string; title: string; free_item_id: string | null; promotion_items: { menu_item_id: string }[] | null }[];
    return dealsAffectedByRemoval(
      deals.map((d) => ({ id: d.id, title: d.title, free_item_id: d.free_item_id, item_ids: (d.promotion_items ?? []).map((pi) => pi.menu_item_id) })),
      deleteIds
    );
  }

  // The removal dialog's "go ahead" answers.
  function confirmRemoval(stopDealIds: string[]) {
    const prompt = removalPrompt;
    if (!prompt || saveInFlight.current) return;
    setRemovalPrompt(null);
    run("save", async () => {
      saveInFlight.current = true;
      try {
        await saveKitchen(prompt.plan, stopDealIds);
      } catch (err) {
        setError(describeSupabaseError(err));
      } finally {
        saveInFlight.current = false;
      }
    });
  }

  // "Keep item": puts the items the deals use back into the form as they
  // were saved, without saving; the cook reviews and saves again.
  function keepDealItems() {
    const prompt = removalPrompt;
    if (!prompt) return;
    setRemovalPrompt(null);
    const keep = new Set(prompt.affected.flatMap((a) => [...a.removedItemIds, ...(a.removedFreeItemId ? [a.removedFreeItemId] : [])]));
    const saved = savedItems.current.filter((i) => keep.has(i.id));
    setItems((prev) => {
      const byId = new Map(saved.map((i) => [i.id, i]));
      const next = prev.map((it) => {
        const original = it.id ? byId.get(it.id) : undefined;
        return original ? draftFromSaved(original) : it;
      });
      const present = new Set(next.map((it) => it.id));
      return [...next, ...saved.filter((i) => !present.has(i.id)).map(draftFromSaved)];
    });
    setNotice("We kept the items your deals use. Review your menu, then save again.");
  }

  async function saveKitchen(plan: MenuSavePlan, stopDealIds: string[]) {
    // Geocode before writing anything, so a failed lookup never leaves a
    // half-saved kitchen or a wrong position behind.
    const postal = postalCode.trim();
    const location = await lookupKitchenPostalCode(postal);
    if (!location.ok) {
      setError(postalLookupError(location));
      return;
    }
    setFoundAddress({ postal, address: location.address });

    const { error: kitchenError } = await supabase.from("kitchens").upsert({
      id: userId,
      business_name: businessName.trim(),
      category,
      cuisine_type: cuisineType,
      is_halal: isHalal,
      description: description.trim() || null,
      hero_image: heroImage.trim() || null,
      paynow_type: paynowType,
      paynow_value: paynowValue.trim() || null,
      // Any non-null value means "ticked" — the DB stamps its own now()
      // the first time and keeps that original timestamp afterwards.
      acknowledged_terms_at: new Date().toISOString(),
      is_live: true,
    });
    if (kitchenError) throw kitchenError;

    // Address, full postal code and exact coordinates are private, so they
    // go in kitchen_addresses, never the publicly readable kitchens row;
    // the DB derives the public postal sector + rounded coordinates from
    // them (schema sections 28–29). Saved after the kitchen, since it
    // references it.
    const { error: addressError } = await supabase.from("kitchen_addresses").upsert({
      kitchen_id: userId,
      business_address: businessAddress.trim(),
      postal_code: postal,
      latitude: location.lat,
      longitude: location.lng,
    });
    if (addressError) throw addressError;

    // Deals the cook chose to stop rather than leave without their last
    // item or free item; stopped before the items go.
    if (stopDealIds.length > 0) {
      const { error: stopError } = await supabase
        .from("promotions")
        .update({ is_active: false })
        .in("id", stopDealIds)
        .eq("kitchen_id", userId);
      if (stopError) throw stopError;
    }

    // Menu items keep their ids (order history, carts and deals point at
    // them): update changed rows, insert new ones, and delete only the rows
    // the cook removed, last, so a save that fails part-way leaves extra
    // rows behind, never an empty menu.
    const updateResults = await Promise.all(
      plan.updates.map(({ id, ...fields }) => supabase.from("menu_items").update(fields).eq("id", id).eq("kitchen_id", userId))
    );
    const updateError = updateResults.find((r) => r.error)?.error;
    if (updateError) throw updateError;

    savedItems.current = withUpdates(savedItems.current, plan.updates);

    if (plan.inserts.length > 0) {
      const { data: inserted, error: itemsError } = await supabase
        .from("menu_items")
        .insert(plan.inserts.map(({ name, price, photo_url }) => ({ kitchen_id: userId, name, price, photo_url })))
        .select("id, name, price, photo_url");
      if (itemsError) throw itemsError;
      // Remember the new rows (and give their form rows the ids), so if a
      // later step fails, Save again updates them instead of inserting twice.
      const rows = ((inserted ?? []) as SavedMenuItem[]).map((r) => ({ ...r, price: Number(r.price) }));
      savedItems.current = withInserted(savedItems.current, rows);
      if (rows.length === plan.inserts.length) setItems((prev) => assignInsertedIds(prev, plan.inserts, rows));
    }

    if (plan.deleteIds.length > 0) {
      const { error: deleteError } = await supabase.from("menu_items").delete().in("id", plan.deleteIds).eq("kitchen_id", userId);
      if (deleteError) throw deleteError;
      savedItems.current = withoutDeleted(savedItems.current, plan.deleteIds);
    }

    if (isEdit) {
      // Editing happens on a separate /kitchen route — navigate back to
      // the dashboard.
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    } else {
      // First-time setup is rendered directly at "/" (see src/app/page.tsx),
      // so we're already on the target URL — router.push("/") to the
      // current URL is a same-route no-op here and won't pick up the
      // fresh kitchen row. refresh() alone re-renders this route with the
      // now-existing kitchen, which sends the cook to the dashboard.
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="kb-page min-h-page">
      <div className="relative mx-auto max-w-md px-5 py-6">
        <div className="mb-6 flex items-center justify-between">
          <PartnerMenu isCook={isEdit} />
          <Logo size={36} />
          <span className="w-10" aria-hidden="true" /> {/* balances the menu button so the logo stays centred */}
        </div>
        <div className="text-center">
          <span className="kb-pill mb-2">Kitchen partner</span>
        </div>
        <h1 className="text-center font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
          {isEdit ? "Manage your kitchen" : "Set up your kitchen"}
        </h1>
        <p className="mt-1.5 text-center text-sm leading-6" style={{ color: "var(--kb-ink-soft)" }}>
          {isEdit
            ? "Update your menu and details any time — changes go live immediately."
            : "Add your menu to appear in the Customer app. A photo is optional, but at least one menu item with a price is required."}
        </p>

        <form onSubmit={handleSubmit} onChange={() => setTouched(true)} className="mt-6 space-y-5">
          <section className="kb-card space-y-4 p-5">
            <div>
              <p className="kb-eyebrow">Your kitchen</p>
              <h2 className="mt-1 font-display text-xl font-bold">Kitchen details</h2>
            </div>
            <Field label="Business name">
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
                className="kb-input"
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MerchantCategory)}
                className="kb-input"
              >
                {MERCHANT_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cuisine">
              <select
                value={cuisineType}
                onChange={(e) => setCuisineType(e.target.value as CuisineType)}
                className="kb-input"
              >
                {CUISINES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <label
              className="flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold"
              style={{ borderColor: "rgba(124,58,237,0.12)", background: "var(--kb-field)" }}
            >
              <input type="checkbox" checked={isHalal} onChange={(e) => setIsHalal(e.target.checked)} className="h-4 w-4 accent-[#7B3FE4]" />
              Halal
            </label>
            <Field label="Business Address">
              <input
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
                required
                placeholder="e.g. Blk 123 Toa Payoh Lor 1, #01-23"
                autoComplete="street-address"
                className="kb-input"
              />
            </Field>
            <Field label="Postal Code">
              <input
                value={postalCode}
                onChange={(e) => {
                  setPostalCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setPostalError(null);
                }}
                required
                placeholder="e.g. 310123"
                inputMode="numeric"
                pattern="[0-9]{6}"
                title="6-digit Singapore postal code"
                autoComplete="postal-code"
                className="kb-input"
              />
            </Field>
            <div>
              <button
                type="button"
                onClick={handleCheckPostalCode}
                disabled={loading}
                className="kb-btn-secondary w-full py-3 text-sm"
              >
                <PendingLabel pending={isRunning("postal")} pendingText="Checking postal code…">Check postal code</PendingLabel>
              </button>
              {foundAddress && foundAddress.postal === postalCode.trim() && (
                <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                  Found: <span className="font-semibold" style={{ color: "var(--kb-ink)" }}>{foundAddress.address}</span>
                </p>
              )}
              {postalError && (
                <p className="mt-1 text-xs" style={{ color: "var(--kb-danger)" }}>
                  {postalError}
                </p>
              )}
              <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                Your kitchen&apos;s location on the map comes from this postal code.
              </p>
            </div>
            <Field label="Description (optional)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="kb-input"
              />
            </Field>
            <Field label="Kitchen photo (optional)">
              <div className="flex items-center gap-3">
                {heroImage && (
                  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Supabase Storage URL, not a static asset
                  <img src={heroImage} alt="Kitchen" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleHeroFileChange}
                  disabled={heroUploading}
                  className="w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-[#F1EDFA] file:px-3 file:py-2 file:font-semibold file:text-[color:var(--kb-purple)]"
                />
              </div>
              {heroUploading && (
                <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                  <Spinner size={12} />
                  Uploading…
                </p>
              )}
            </Field>
            <Field label="PayNow method (customers pay you directly)">
              <select
                value={paynowType}
                onChange={(e) => setPaynowType(e.target.value as PaynowType)}
                className="kb-input"
              >
                {PAYNOW_TYPES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={paynowType === "mobile" ? "PayNow mobile number" : "PayNow UEN"}>
              <input
                value={paynowValue}
                onChange={(e) => setPaynowValue(e.target.value)}
                className="kb-input"
              />
            </Field>
          </section>

          <section className="kb-card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="kb-eyebrow">What you sell</p>
                <h2 className="mt-1 font-display text-xl font-bold">Menu items</h2>
              </div>
              <button type="button" onClick={addItem} className="kb-btn-secondary px-4 py-2 text-sm">
                + Add item
              </button>
            </div>
            {items.map((it, i) => (
              <div key={it.key} className="space-y-3 border-b pb-4 last:border-0 last:pb-0" style={{ borderColor: "var(--kb-line)" }}>
                <div className="flex items-end gap-2">
                  <Field label={`Item ${i + 1} name`} className="flex-[2]">
                    <input
                      value={it.name}
                      onChange={(e) => updateItem(it.key, { name: e.target.value })}
                      className="kb-input"
                    />
                  </Field>
                  <Field label="Price ($)" className="flex-1">
                    <input
                      value={it.price}
                      onChange={(e) => updateItem(it.key, { price: e.target.value })}
                      inputMode="decimal"
                      className="kb-input"
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => removeItem(it.key)}
                    className="mb-0.5 shrink-0 rounded-xl px-3 py-3 text-sm font-semibold transition-colors hover:bg-[#FDECEC]"
                    style={{ color: "var(--kb-danger)", background: "rgba(239,68,68,0.06)" }}
                  >
                    Remove
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {it.photo_url && (
                    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Supabase Storage URL, not a static asset
                    <img src={it.photo_url} alt={it.name || "Dish"} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleItemPhotoChange(it.key, e)}
                    disabled={it.photoUploading}
                    className="w-full text-xs file:mr-3 file:rounded-xl file:border-0 file:bg-[#F1EDFA] file:px-3 file:py-2 file:font-semibold file:text-[color:var(--kb-purple)]"
                  />
                  {it.photoUploading && (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                      <Spinner size={12} />
                      Uploading…
                    </span>
                  )}
                </div>
              </div>
            ))}
          </section>

          {error && (
            <p className="kb-alert-error rounded-2xl px-4 py-3 text-sm">
              {error}
            </p>
          )}
          {notice && !error && (
            <p className="kb-alert-success rounded-2xl px-4 py-3 text-sm">
              {notice}
            </p>
          )}

          <label
            className="kb-card flex items-start gap-3 p-4 text-sm leading-6"
            style={{ opacity: alreadyAcknowledged ? 0.7 : 1 }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={alreadyAcknowledged}
              className="mt-1 h-4 w-4 shrink-0 accent-[#7B3FE4]"
            />
            <span>{KITCHEN_TERMS}</span>
          </label>

          <button
            type="submit"
            disabled={loading || !acknowledged || heroUploading || items.some((it) => it.photoUploading)}
            className="kb-btn-primary w-full py-3.5 text-[15px]"
          >
            <PendingLabel pending={isRunning("save")} pendingText={isEdit ? "Saving changes…" : "Going live…"}>
              {isEdit ? "Save changes" : "Go live"}
            </PendingLabel>
          </button>
          <button
            type="button"
            onClick={requestLeave}
            disabled={loading}
            className="kb-btn-ghost w-full py-3 text-[15px]"
          >
            {isEdit ? "Cancel" : "Cancel setup"}
          </button>
        </form>
      </div>

      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" role="alertdialog" aria-modal="true" aria-labelledby="leave-title">
          <button
            type="button"
            aria-label="Keep editing"
            onClick={() => setConfirmLeave(false)}
            className="absolute inset-0 bg-[#1E143C]/40 backdrop-blur-[2px]"
          />
          <div className="kb-card-pop relative w-full max-w-sm p-6">
            <h2 id="leave-title" className="font-display text-xl font-bold">
              {isEdit ? "Discard your changes?" : "Cancel kitchen setup?"}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
              {isEdit
                ? "Your unsaved changes to the kitchen and menu will be lost."
                : "What you've entered so far won't be saved. You can start setup again any time."}
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmLeave(false)}
                className="kb-btn-primary w-full py-3 text-sm"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={leave}
                className="kb-btn-ghost w-full py-3 text-sm"
              >
                {isEdit ? "Discard changes" : "Yes, cancel setup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {removalPrompt && (
        <RemovalDialog
          affected={removalPrompt.affected}
          itemNames={new Map((existingItems ?? []).map((i) => [i.id, i.name]))}
          onStopAndRemove={() => confirmRemoval(removalPrompt.affected.filter((a) => a.critical).map((a) => a.id))}
          onContinue={() => confirmRemoval([])}
          onKeep={keepDealItems}
        />
      )}
    </div>
  );
}

/**
 * Shown before a save that removes items running or upcoming deals use.
 * Taking a deal's last eligible item or its free item would leave a
 * whole-menu deal or a free-item deal that gives nothing, so then the default
 * is to stop that deal; any other removal is only a heads-up.
 */
function RemovalDialog({
  affected,
  itemNames,
  onStopAndRemove,
  onContinue,
  onKeep,
}: {
  affected: AffectedDeal[];
  itemNames: Map<string, string>;
  onStopAndRemove: () => void;
  onContinue: () => void;
  onKeep: () => void;
}) {
  const critical = affected.some((a) => a.critical);
  const names = (ids: string[]) => ids.map((id) => itemNames.get(id) ?? "An item").join(", ");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" role="alertdialog" aria-modal="true" aria-labelledby="removal-title">
      <button type="button" aria-label="Keep item" onClick={onKeep} className="absolute inset-0 bg-[#1E143C]/40 backdrop-blur-[2px]" />
      <div className="kb-card-pop relative max-h-[85vh] w-full max-w-sm overflow-y-auto p-6">
        <h2 id="removal-title" className="font-display text-xl font-bold">
          {critical ? "This item is part of a deal" : "Some deals use these items"}
        </h2>
        <ul className="mt-3 space-y-2 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
          {affected.map((a) => (
            <li key={a.id} className="rounded-xl p-3" style={{ background: "var(--kb-field)" }}>
              <span className="block font-semibold" style={{ color: "var(--kb-ink)" }}>{a.title}</span>
              {removalText(a, names)}
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-2">
          {critical ? (
            <button type="button" autoFocus onClick={onStopAndRemove} className="kb-btn-primary w-full py-3 text-sm">
              Stop the deal and remove item
            </button>
          ) : (
            <button type="button" autoFocus onClick={onContinue} className="kb-btn-primary w-full py-3 text-sm">
              Remove and save
            </button>
          )}
          <button type="button" onClick={onKeep} className="kb-btn-ghost w-full py-3 text-sm">
            Keep item
          </button>
        </div>
      </div>
    </div>
  );
}

function removalText(a: AffectedDeal, names: (ids: string[]) => string): string {
  if (a.losesFreeItem && a.removedFreeItemId) {
    return `${names([a.removedFreeItemId])} is this deal's free item. Without it the deal gives nothing, so it will be stopped.`;
  }
  const one = a.removedItemIds.length === 1;
  if (a.losesLastItem) {
    return `${names(a.removedItemIds)} ${one ? "is the only item" : "are the only items"} in this deal. Without ${one ? "it" : "them"} the deal would apply to your whole menu, so it will be stopped.`;
  }
  return `${names(a.removedItemIds)} will be taken out of this deal.`;
}
