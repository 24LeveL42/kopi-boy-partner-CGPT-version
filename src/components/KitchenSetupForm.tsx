"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel, Spinner } from "./Pending";
import { Logo } from "./Logo";
import { PartnerMenu } from "./PartnerMenu";
import { useBackHandler, useCancelHandler } from "./AppChrome";
import type { Kitchen, MenuItem, MerchantCategory, CuisineType, PaynowType } from "@/lib/types-kitchen";
import type { KitchenDefaults } from "@/lib/partner-routing";
import { KITCHEN_TERMS, MERCHANT_CATEGORIES, isValidPostalCode } from "@/lib/kitchen-profile";

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
  name: string;
  price: string; // kept as text while editing, parsed to a number on submit
  photo_url: string;
  photoUploading: boolean; // local UI state only — never sent to the DB
}

function emptyItem(): DraftItem {
  return { key: crypto.randomUUID(), name: "", price: "", photo_url: "", photoUploading: false };
}

type LocationStatus = "idle" | "locating" | "success" | "denied" | "unavailable" | "unsupported";

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
  const [latitude, setLatitude] = useState<number | null>(defaults.latitude);
  const [longitude, setLongitude] = useState<number | null>(defaults.longitude);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  // Once acknowledged it stays acknowledged (the DB keeps the first
  // timestamp — schema section 33), so the box only gates kitchens that
  // haven't ticked it yet, including ones set up before it existed.
  const alreadyAcknowledged = !!existingKitchen?.acknowledged_terms_at;
  const [acknowledged, setAcknowledged] = useState(alreadyAcknowledged);
  const [items, setItems] = useState<DraftItem[]>(
    existingItems && existingItems.length > 0
      ? existingItems.map((i) => ({ key: i.id, name: i.name, price: String(i.price), photo_url: i.photo_url ?? "", photoUploading: false }))
      : [emptyItem()]
  );
  const { busy: loading, run, startTransition } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  // Set on the first edit of any field — decides whether leaving needs a
  // "discard?" confirmation.
  const [touched, setTouched] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

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

  // Optional — purely additive alongside the address fields. Never
  // blocks kitchen setup: every failure path (no browser support, denied
  // permission, position unavailable/timeout) just resets to a message and
  // leaves latitude/longitude null.
  function handleUseCurrentLocation() {
    setError(null);
    if (!("geolocation" in navigator)) {
      setLocationStatus("unsupported");
      return;
    }
    setLocationStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        setLocationStatus("success");
      },
      (geoError) => {
        setLocationStatus(geoError.code === geoError.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
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
    setError(null);

    const validItems = items
      .map((it) => ({ ...it, name: it.name.trim(), price: parseFloat(it.price) }))
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

    run("save", async () => {
      try {
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
          postal_code: postalCode.trim(),
          latitude,
          longitude,
        });
        if (addressError) throw addressError;

        // Replace-all on every save — simplest correct approach at this scope.
        const { error: deleteError } = await supabase.from("menu_items").delete().eq("kitchen_id", userId);
        if (deleteError) throw deleteError;

        const { error: itemsError } = await supabase.from("menu_items").insert(
          validItems.map((it) => ({
            kitchen_id: userId,
            name: it.name,
            price: it.price,
            photo_url: it.photo_url.trim() || null,
          }))
        );
        if (itemsError) throw itemsError;

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
      } catch (err) {
        setError(describeSupabaseError(err));
      }
    });
  }

  return (
    <div className="mx-auto min-h-page max-w-md px-5 py-8" style={{ background: "var(--kb-navy)" }}>
      <div className="mb-6 flex items-center justify-between">
        <PartnerMenu />
        <Logo size={48} />
        <span className="w-8" aria-hidden="true" /> {/* balances the menu button so the logo stays centred */}
      </div>
      <h1 className="text-center font-display text-lg font-bold" style={{ color: "var(--kb-on-navy)" }}>
        {isEdit ? "Manage your kitchen" : "Set up your kitchen"}
      </h1>
      <p className="mt-1 text-center text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
        {isEdit
          ? "Update your menu and details any time — changes go live immediately."
          : "Add your menu to appear in the Customer app. A photo is optional, but at least one menu item with a price is required."}
      </p>

      <form onSubmit={handleSubmit} onChange={() => setTouched(true)} className="mt-6 space-y-5">
        <section className="space-y-3 rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
          <Field label="Business name">
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              className="w-full rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            />
          </Field>
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as MerchantCategory)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
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
              className="w-full rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            >
              {CUISINES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={isHalal} onChange={(e) => setIsHalal(e.target.checked)} className="h-4 w-4" />
            Halal
          </label>
          <Field label="Business Address">
            <input
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              required
              placeholder="e.g. Blk 123 Toa Payoh Lor 1, #01-23"
              autoComplete="street-address"
              className="w-full rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            />
          </Field>
          <Field label="Postal Code">
            <input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              placeholder="e.g. 310123"
              inputMode="numeric"
              pattern="[0-9]{6}"
              title="6-digit Singapore postal code"
              autoComplete="postal-code"
              className="w-full rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            />
          </Field>
          <Field label="Precise location (optional)">
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={locationStatus === "locating"}
              className="w-full rounded-xl border px-3 py-2.5 text-sm font-medium disabled:opacity-60"
              style={{ borderColor: "#E5E7EB", color: "var(--kb-purple)" }}
            >
              <PendingLabel pending={locationStatus === "locating"} pendingText="Getting your location…">Use my current location</PendingLabel>
            </button>
            {locationStatus === "success" && latitude != null && longitude != null && (
              <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                Location captured ({latitude.toFixed(5)}, {longitude.toFixed(5)}).
              </p>
            )}
            {locationStatus === "denied" && (
              <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                Location permission was denied — that&apos;s fine, your address above is still used. You
                can allow location access in your browser settings and try again any time.
              </p>
            )}
            {locationStatus === "unavailable" && (
              <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                Couldn&apos;t get your location right now — no problem, this is optional and you can try again later.
              </p>
            )}
            {locationStatus === "unsupported" && (
              <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                Your browser doesn&apos;t support location detection — no problem, this is optional.
              </p>
            )}
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
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
                className="w-full text-sm"
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
              className="w-full rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
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
              className="w-full rounded-xl border px-3 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            />
          </Field>
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Menu items</h2>
            <button type="button" onClick={addItem} className="text-sm font-semibold" style={{ color: "var(--kb-purple)" }}>
              + Add item
            </button>
          </div>
          {items.map((it, i) => (
            <div key={it.key} className="space-y-2 border-b pb-3 last:border-0" style={{ borderColor: "#E5E7EB" }}>
              <div className="flex items-end gap-2">
                <Field label={`Item ${i + 1} name`} className="flex-[2]">
                  <input
                    value={it.name}
                    onChange={(e) => updateItem(it.key, { name: e.target.value })}
                    className="w-full rounded-xl border px-3 py-2.5 text-sm"
                    style={{ borderColor: "#E5E7EB" }}
                  />
                </Field>
                <Field label="Price ($)" className="flex-1">
                  <input
                    value={it.price}
                    onChange={(e) => updateItem(it.key, { price: e.target.value })}
                    inputMode="decimal"
                    className="w-full rounded-xl border px-3 py-2.5 text-sm"
                    style={{ borderColor: "#E5E7EB" }}
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => removeItem(it.key)}
                  className="mb-0.5 shrink-0 rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: "var(--kb-cream)" }}
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
                  className="w-full text-xs"
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
          <p className="rounded-xl px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.15)", color: "#B91C1C" }}>
            {error}
          </p>
        )}

        <label
          className="flex items-start gap-3 rounded-2xl bg-white p-4 text-sm"
          style={{ color: "var(--kb-ink)", opacity: alreadyAcknowledged ? 0.7 : 1 }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={alreadyAcknowledged}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>{KITCHEN_TERMS}</span>
        </label>

        <button
          type="submit"
          disabled={loading || !acknowledged || heroUploading || items.some((it) => it.photoUploading)}
          className="w-full rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
          style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
        >
          <PendingLabel pending={loading} pendingText={isEdit ? "Saving changes…" : "Going live…"}>
            {isEdit ? "Save changes" : "Go live"}
          </PendingLabel>
        </button>
        <button
          type="button"
          onClick={requestLeave}
          disabled={loading}
          className="w-full rounded-2xl border py-3 text-[15px] font-semibold disabled:opacity-60"
          style={{ borderColor: "var(--kb-navy-line)", color: "var(--kb-on-navy)" }}
        >
          {isEdit ? "Cancel" : "Cancel setup"}
        </button>
      </form>

      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" role="alertdialog" aria-modal="true" aria-labelledby="leave-title">
          <button
            type="button"
            aria-label="Keep editing"
            onClick={() => setConfirmLeave(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5" style={{ color: "var(--kb-ink)" }}>
            <h2 id="leave-title" className="font-display text-base font-bold">
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
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white"
                style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={leave}
                className="w-full rounded-xl py-2.5 text-sm font-semibold"
                style={{ background: "var(--kb-cream)" }}
              >
                {isEdit ? "Discard changes" : "Yes, cancel setup"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-xs font-medium ${className ?? ""}`} style={{ color: "var(--kb-ink-soft)" }}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
