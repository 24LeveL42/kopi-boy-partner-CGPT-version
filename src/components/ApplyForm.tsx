"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PartnerRole } from "@/lib/types";
import { businessUenProblem, normalizeBusinessUen, requiresBusinessUen } from "@/lib/business-uen";
import { MERCHANT_CATEGORIES, isValidPostalCode } from "@/lib/kitchen-profile";
import {
  GPS_CONSENT_COPY,
  PRIVACY_CHECKBOX,
  PRIVACY_LINK_LABEL,
  PRIVACY_POLICY_URL,
  PRIVACY_REQUIRED_MESSAGE,
  consentFields,
  isMissingConsentColumns,
  privacyCopyFor,
  withoutConsentFields,
} from "@/lib/privacy-consent";
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

  // Rider photo
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Rider fields
  const [vehicleType, setVehicleType] = useState("Motorcycle");
  const [licensePlate, setLicensePlate] = useState("");

  // Privacy Policy acknowledgement (required) and the rider's GPS consent
  // (optional). Both start unticked, and again whenever a role is picked.
  const [acknowledged, setAcknowledged] = useState(false);
  const [gpsConsent, setGpsConsent] = useState(false);

  // Global Back steps from a role's form to the role choice.
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

    // The database checks this again and stamps the time itself
    // (docs/supabase-privacy-consent.sql).
    const consent = roleChoice ? consentFields(roleChoice, acknowledged, gpsConsent) : null;
    if (!consent) {
      setError(PRIVACY_REQUIRED_MESSAGE);
      return;
    }

    // Before that SQL has run the consent columns don't exist, so the insert
    // is sent again without them rather than blocking every applicant.
    async function insertApplication(table: "cook_applications" | "rider_applications", row: Record<string, unknown>) {
      const { error } = await supabase.from(table).insert(row);
      if (!isMissingConsentColumns(error)) return error;
      return (await supabase.from(table).insert(withoutConsentFields(row))).error;
    }

    run("submit", async () => {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          phone: contactNumber.trim(),
          // A rider's photo also seeds their live profile photo, so it carries
          // over on approval; they can change it later from /account.
          ...(roleChoice === "rider" && photoUrl ? { photo_url: photoUrl } : {}),
        })
        .eq("id", userId);

      if (profileError) {
        setError(profileError.message);
        return;
      }

      if (roleChoice === "cook") {
        const error = await insertApplication("cook_applications", {
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
          ...consent,
        });
        if (error) {
          setError(error.message);
          return;
        }
      } else if (roleChoice === "rider") {
        const error = await insertApplication("rider_applications", {
          user_id: userId,
          vehicle_type: vehicleType,
          license_plate: licensePlate,
          photo_url: photoUrl,
          ...consent,
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
                onClick={() => {
                  setAcknowledged(false);
                  setGpsConsent(false);
                  setRoleChoice(option.role);
                }}
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
            {roleChoice === "cook" ? "Cook application" : "Rider application"}
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

          {roleChoice && (
            <PrivacyAcknowledgement role={roleChoice} checked={acknowledged} onChange={setAcknowledged} />
          )}
          {roleChoice === "rider" && <GpsConsent checked={gpsConsent} onChange={setGpsConsent} />}

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
];

/** Styled like KitchenSetupForm's partner-terms tick box. Wording: src/lib/privacy-consent.ts. */
function PrivacyAcknowledgement({ role, checked, onChange }: { role: PartnerRole; checked: boolean; onChange: (v: boolean) => void }) {
  const copy = privacyCopyFor(role);
  return (
    <section className="kb-card space-y-3 p-4 text-sm leading-6" style={{ color: "var(--kb-ink)" }}>
      <div>
        <h2 className="font-display text-base font-bold">{copy.heading}</h2>
        <p className="text-xs font-semibold" style={{ color: "var(--kb-purple)" }}>{copy.subheading}</p>
      </div>
      <div className="space-y-2 text-[13px]" style={{ color: "var(--kb-ink-soft)" }}>
        <p>{copy.intro}</p>
        <p>{copy.lead}</p>
        <ul className="list-disc space-y-1 pl-5">
          {copy.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
      {/* Hidden until the policy has a real URL. */}
      {PRIVACY_POLICY_URL && (
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-semibold underline"
          style={{ color: "var(--kb-purple)" }}
        >
          {PRIVACY_LINK_LABEL}
        </a>
      )}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          required
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[#7B3FE4]"
        />
        <span className="font-semibold">{PRIVACY_CHECKBOX}</span>
      </label>
    </section>
  );
}

/** Only recorded with the application; tracking still asks again on the rider's first job. */
function GpsConsent({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <section className="kb-card space-y-2 p-4 text-sm leading-6" style={{ color: "var(--kb-ink)" }}>
      <h2 className="text-xs font-semibold" style={{ color: "var(--kb-purple)" }}>{GPS_CONSENT_COPY.subheading}</h2>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[#7B3FE4]"
        />
        <span>{GPS_CONSENT_COPY.checkbox}</span>
      </label>
      <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>{GPS_CONSENT_COPY.note}</p>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}
