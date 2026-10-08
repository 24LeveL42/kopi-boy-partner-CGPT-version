"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PartnerRole } from "@/lib/types";
import { businessUenProblem, normalizeBusinessUen, requiresBusinessUen } from "@/lib/business-uen";
import { MERCHANT_CATEGORIES, isValidPostalCode } from "@/lib/kitchen-profile";
import { useBackHandler } from "./AppChrome";
import { Logo } from "./Logo";
import { PendingLabel } from "./Pending";
import { PhotoPicker } from "./PhotoPicker";
import { SignOutButton } from "./SignOutButton";

export function ApplyForm({ userId }: { userId: string }) {
  const [roleChoice, setRoleChoice] = useState<PartnerRole | null>(null);
  const { busy: loading, run, startTransition } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // Shared fields
  const [fullName, setFullName] = useState("");
  const [contactNumber, setContactNumber] = useState("");

  // Cook fields
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("Home Cook");
  const [businessAddress, setBusinessAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [description, setDescription] = useState("");
  const [paynowUen, setPaynowUen] = useState("");
  const [businessUen, setBusinessUen] = useState("");

  // Rider + picker photo
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Rider fields
  const [vehicleType, setVehicleType] = useState("Motorcycle");
  const [licensePlate, setLicensePlate] = useState("");

  // Picker fields
  const [pickerNote, setPickerNote] = useState("");

  // Global Back steps from a role's form to the role picker.
  useBackHandler(roleChoice ? () => setRoleChoice(null) : null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || !contactNumber.trim()) {
      setError("Please fill in your full name and contact number.");
      return;
    }

    if (roleChoice === "cook") {
      if (!businessAddress.trim()) {
        setError("Please enter your business address.");
        return;
      }
      if (!isValidPostalCode(postalCode)) {
        setError("Postal code must be 6 digits (e.g. 310123).");
        return;
      }
      const uenProblem = businessUenProblem(businessType, businessUen);
      if (uenProblem) {
        setError(uenProblem);
        return;
      }
    }

    run("submit", async () => {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          phone: contactNumber.trim(),
          // A rider's or picker's photo also seeds their live profile photo, so
          // it carries over on approval; they can change it later from /account.
          ...((roleChoice === "rider" || roleChoice === "picker") && photoUrl ? { photo_url: photoUrl } : {}),
        })
        .eq("id", userId);

      if (profileError) {
        setError(profileError.message);
        return;
      }

      if (roleChoice === "cook") {
        const { error } = await supabase.from("cook_applications").insert({
          user_id: userId,
          business_name: businessName,
          business_type: businessType,
          business_address: businessAddress.trim(),
          postal_code: postalCode.trim(),
          description,
          paynow_uen: paynowUen,
          // Home cooks don't register a business, so they never send one (the
          // insert trigger also clears it for them).
          business_uen: requiresBusinessUen(businessType) ? normalizeBusinessUen(businessUen) : null,
        });
        if (error) {
          setError(error.message);
          return;
        }
      } else if (roleChoice === "rider") {
        const { error } = await supabase.from("rider_applications").insert({
          user_id: userId,
          vehicle_type: vehicleType,
          license_plate: licensePlate,
          photo_url: photoUrl,
        });
        if (error) {
          setError(error.message);
          return;
        }
      } else if (roleChoice === "picker") {
        const { error } = await supabase.from("picker_applications").insert({
          user_id: userId,
          note: pickerNote || null,
          photo_url: photoUrl,
        });
        if (error) {
          setError(error.message);
          return;
        }
      }

      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    });
  }

  if (!roleChoice) {
    return (
      <main className="kb-page min-h-page overflow-hidden">
        <div className="relative mx-auto flex min-h-page w-full max-w-md flex-col justify-center px-5 py-8">
          <div className="mb-7 flex justify-center">
            <Logo size={52} />
          </div>
          <div className="mb-7 text-center">
            <span className="kb-pill mb-2">Partner sign-up</span>
            <h1 className="font-display text-3xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
              Join as a partner
            </h1>
            <p className="mt-2 text-sm leading-6" style={{ color: "var(--kb-ink-soft)" }}>
              Are you signing up to cook, or to deliver?
            </p>
          </div>

          <div className="kb-card-pop space-y-3 p-5">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.role}
                onClick={() => setRoleChoice(option.role)}
                className="group w-full rounded-2xl border px-5 py-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: "rgba(124,58,237,0.12)", background: "white", color: "var(--kb-ink)" }}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold">{option.title}</span>
                    <span className="mt-1 block text-xs leading-5" style={{ color: "var(--kb-ink-soft)" }}>
                      {option.description}
                    </span>
                  </span>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "rgba(124,58,237,0.08)", color: "var(--kb-purple)" }}
                  >
                    →
                  </span>
                </span>
              </button>
            ))}
          </div>

          <p className="mb-2 mt-6 text-center text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            Wrong account?
          </p>
          <SignOutButton />
        </div>
      </main>
    );
  }

  return (
    <main className="kb-page min-h-page">
      <div className="relative mx-auto w-full max-w-md px-5 py-8">
        <div className="mb-6 text-center">
          <span className="kb-pill mb-2">Partner application</span>
          <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
            {roleChoice === "cook" ? "Cook application" : roleChoice === "rider" ? "Rider application" : "Picker application"}
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            Tell us a little about yourself — HQ reviews every application.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="kb-card-pop space-y-4 p-5">
          <Field label="Full name (as per NRIC)">
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="kb-input"
              placeholder="e.g. Tan Wei Ming"
            />
          </Field>
          <Field label="Contact number">
            <input
              required
              type="tel"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              className="kb-input"
              placeholder="e.g. 91234567"
            />
          </Field>
          {roleChoice === "picker" && (
            <Field label="Anything we should know? (optional)">
              <textarea
                value={pickerNote}
                onChange={(e) => setPickerNote(e.target.value)}
                className="kb-input"
                rows={3}
                placeholder="e.g. usually free after school, near Toa Payoh"
              />
            </Field>
          )}
          {roleChoice === "picker" && (
            <Field label="Your photo (optional — helps HQ verify you)">
              <PhotoPicker
                userId={userId}
                name={fullName}
                value={photoUrl}
                onChange={setPhotoUrl}
                onUploadingChange={setPhotoUploading}
                tone="light"
              />
            </Field>
          )}
          {roleChoice === "cook" ? (
            <>
              <Field label="Business name">
                <input required value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="kb-input" />
              </Field>
              <Field label="Business type">
                <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="kb-input">
                  {MERCHANT_CATEGORIES.map((c) => (
                    <option key={c.id}>{c.label}</option>
                  ))}
                </select>
              </Field>
              {requiresBusinessUen(businessType) && (
                <Field label="Business Registration Number (UEN)">
                  <input
                    required
                    value={businessUen}
                    onChange={(e) => setBusinessUen(e.target.value)}
                    className="kb-input"
                    placeholder="e.g. 53123456X"
                    autoCapitalize="characters"
                    autoComplete="off"
                  />
                </Field>
              )}
              <Field label="Business Address">
                <input
                  required
                  value={businessAddress}
                  onChange={(e) => setBusinessAddress(e.target.value)}
                  className="kb-input"
                  placeholder="e.g. Blk 123 Toa Payoh Lor 1, #01-23"
                  autoComplete="street-address"
                />
              </Field>
              <Field label="Postal Code">
                <input
                  required
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="kb-input"
                  placeholder="e.g. 310123"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  title="6-digit Singapore postal code"
                  autoComplete="postal-code"
                />
              </Field>
              <Field label="Tell customers about your food">
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="kb-input" rows={3} />
              </Field>
              <Field label="PayNow UEN (customers pay you directly)">
                <input value={paynowUen} onChange={(e) => setPaynowUen(e.target.value)} className="kb-input" />
              </Field>
            </>
          ) : roleChoice === "rider" ? (
            <>
              <Field label="Vehicle type">
                <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="kb-input">
                  <option>Bicycle</option>
                  <option>Motorcycle</option>
                  <option>Car</option>
                </select>
              </Field>
              <Field label="License plate (if applicable)">
                <input value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} className="kb-input" />
              </Field>
              <Field label="Your photo (optional — helps HQ verify you)">
                <PhotoPicker
                  userId={userId}
                  name={fullName}
                  value={photoUrl}
                  onChange={setPhotoUrl}
                  onUploadingChange={setPhotoUploading}
                  tone="light"
                />
              </Field>
            </>
          ) : null}

          <button
            type="submit"
            disabled={loading || photoUploading}
            className="kb-btn-primary w-full py-3.5 text-[15px]"
          >
            <PendingLabel pending={loading} pendingText="Submitting…">Submit application</PendingLabel>
          </button>

          {error && (
            <p className="kb-alert-error rounded-2xl px-4 py-3 text-sm">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

const ROLE_OPTIONS: { role: PartnerRole; title: string; description: string }[] = [
  { role: "cook", title: "I'm a cook", description: "Home cook, hawker, bakery, vegetarian, or drinks & desserts" },
  { role: "rider", title: "I'm a rider", description: "Free registration, no fees — you keep the full delivery fee" },
  { role: "picker", title: "I'm a picker", description: "Casual — collect an order from a cook and hand it to a rider nearby" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}
