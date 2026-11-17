"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PartnerRole } from "@/lib/types";
import { businessUenProblem, normalizeBusinessUen, requiresBusinessUen } from "@/lib/business-uen";
import { isMissingPaynowMobileColumn, paynowApplicationFields, paynowProblem } from "@/lib/paynow-details";
import {
  createBrowserTracker,
  isCookFormField,
  type CookFormField,
  type RegistrationTracker,
  type ValidationCode,
} from "@/lib/registration-tracking";
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
import { saveMyRideRegions, validateRideRegions, type RegionCode } from "@/lib/ride-regions";
import { useBackHandler } from "./AppChrome";
import { Logo } from "./Logo";
import { PendingLabel } from "./Pending";
import { PhotoPicker } from "./PhotoPicker";
import { RideRegionsPicker } from "./RideRegionsPicker";
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
  // "Tell customers about your food" is no longer asked here: cooks write it
  // in Kitchen Setup. PayNow: a mobile number and/or a UEN (at least one;
  // the UEN wins if both). See src/lib/paynow-details.ts.
  const [paynowMobile, setPaynowMobile] = useState("");
  const [paynowUen, setPaynowUen] = useState("");
  const [businessUen, setBusinessUen] = useState("");

  // Anonymous sign-up funnel tracking (cook path only). Never blocks or
  // slows the form: see src/lib/registration-tracking.ts.
  const trackerRef = useRef<RegistrationTracker | null>(null);
  useEffect(() => {
    const { tracker, dispose } = createBrowserTracker();
    trackerRef.current = tracker;
    tracker.track({ event: "page_view" });
    return () => {
      trackerRef.current = null;
      dispose();
    };
  }, []);
  const tracker = () => (roleChoice === "cook" ? trackerRef.current : null);
  function trackError(field: CookFormField, code: ValidationCode) {
    tracker()?.validationError(field, code);
  }

  // Rider photo
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Rider fields
  const [vehicleType, setVehicleType] = useState("Motorcycle");
  const [licensePlate, setLicensePlate] = useState("");
  // Where the rider usually rides (regions only — never an address). Saved
  // through set_my_ride_regions after the application goes in.
  const [rideRegions, setRideRegions] = useState<RegionCode[]>([]);
  // The application went in but the regions didn't save: the form isn't
  // shown again (that would send a second application), only a retry.
  const [regionsSaveError, setRegionsSaveError] = useState<string | null>(null);

  // Privacy Policy acknowledgement (required) and the rider's GPS consent
  // (optional). Both start unticked, and again whenever a role is picked.
  const [acknowledged, setAcknowledged] = useState(false);
  const [gpsConsent, setGpsConsent] = useState(false);

  // Global Back steps from a role's form to the role choice (not once the
  // application has been sent).
  useBackHandler(roleChoice && !regionsSaveError ? () => setRoleChoice(null) : null);

  function goHome() {
    startTransition(() => {
      router.push("/");
      router.refresh();
    });
  }

  function retryRideRegions() {
    run("regions", async () => {
      const problem = await saveMyRideRegions(supabase, rideRegions);
      if (problem) {
        setRegionsSaveError(problem);
        return;
      }
      setRegionsSaveError(null);
      goHome();
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || !contactNumber.trim()) {
      trackError(fullName.trim() ? "contact_number" : "full_name", "required");
      setError("Please fill in your full name and contact number.");
      return;
    }

    if (roleChoice === "cook") {
      if (!businessAddress.trim()) {
        trackError("business_address", "required");
        setError("Please enter your business address.");
        return;
      }
      if (!isValidPostalCode(postalCode)) {
        trackError("postal_code", "invalid_postal_code");
        setError("Postal code must be 6 digits (e.g. 310123).");
        return;
      }
      const uenProblem = businessUenProblem(businessType, businessUen);
      if (uenProblem) {
        trackError("business_uen", businessUen.trim() ? "invalid_business_uen" : "required");
        setError(uenProblem);
        return;
      }
      const paynow = paynowProblem(paynowMobile, paynowUen);
      if (paynow) {
        trackError(paynow.field, paynow.code);
        setError(paynow.message);
        return;
      }
    }

    const checkedRegions = roleChoice === "rider" ? validateRideRegions(rideRegions) : null;
    if (checkedRegions && !checkedRegions.ok) {
      setError(checkedRegions.message);
      return;
    }

    // The database checks this again and stamps the time itself
    // (docs/supabase-privacy-consent.sql).
    const consent = roleChoice ? consentFields(roleChoice, acknowledged, gpsConsent) : null;
    if (!consent) {
      trackError("privacy_ack", "privacy_required");
      setError(PRIVACY_REQUIRED_MESSAGE);
      return;
    }

    // Before that SQL has run the consent columns don't exist, so the insert
    // is sent again without them rather than blocking every applicant.
    // Likewise paynow_mobile before docs/supabase-paynow-mobile.sql: the
    // application still goes in (the cook enters PayNow again in Kitchen
    // Setup), it just can't pre-fill the mobile number.
    async function insertApplication(table: "cook_applications" | "rider_applications", row: Record<string, unknown>) {
      let attempt = row;
      for (let i = 0; i < 3; i++) {
        const { error } = await supabase.from(table).insert(attempt);
        if (!error) return null;
        if (isMissingConsentColumns(error) && "privacy_policy_version" in attempt) {
          attempt = withoutConsentFields(attempt);
        } else if (isMissingPaynowMobileColumn(error) && "paynow_mobile" in attempt) {
          const { paynow_mobile: _dropped, ...rest } = attempt;
          void _dropped;
          attempt = rest;
        } else {
          return error;
        }
      }
      return (await supabase.from(table).insert(attempt)).error;
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
          // paynow_uen (existing column) + paynow_mobile (new), normalised.
          ...paynowApplicationFields(paynowMobile, paynowUen),
          // Home cooks don't register a business, so they never send one (the
          // insert trigger also clears it for them).
          business_uen: requiresBusinessUen(businessType) ? normalizeBusinessUen(businessUen) : null,
          ...consent,
        });
        if (error) {
          trackerRef.current?.track({ event: "validation_error", code: "server_error" });
          setError(error.message);
          return;
        }
        trackerRef.current?.track({ event: "submit_success" });
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
        // Needs the application on file, so only after it went in.
        const regionsProblem = await saveMyRideRegions(supabase, rideRegions);
        if (regionsProblem) {
          setRegionsSaveError(regionsProblem);
          return;
        }
      }

      goHome();
    });
  }

  if (regionsSaveError) {
    return (
      <main className="kb-page min-h-page">
        <div className="relative mx-auto flex min-h-page w-full max-w-md flex-col justify-center px-5 py-8">
          <div className="kb-card-pop space-y-4 p-5">
            <div>
              <span className="kb-pill mb-2">Application sent</span>
              <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
                Your regions didn&apos;t save
              </h1>
              <p className="mt-1.5 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
                Your rider application was sent to HQ. Only the regions you ride in still need saving.
              </p>
            </div>
            <RideRegionsPicker value={rideRegions} onChange={setRideRegions} disabled={loading} hint="You can also set these later in Profile." />
            <p role="alert" className="kb-alert-error rounded-2xl px-4 py-3 text-sm">
              {regionsSaveError}
            </p>
            <button type="button" onClick={retryRideRegions} disabled={loading} className="kb-btn-primary w-full py-3.5 text-[15px]">
              <PendingLabel pending={loading} pendingText="Saving…">Try saving regions again</PendingLabel>
            </button>
            <button
              type="button"
              onClick={goHome}
              disabled={loading}
              className="w-full rounded-2xl border bg-white py-3 text-sm font-bold"
              style={{ color: "var(--kb-purple)", borderColor: "var(--kb-line, rgba(124,58,237,0.12))" }}
            >
              Continue, I&apos;ll set them later
            </button>
          </div>
        </div>
      </main>
    );
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
                  setRideRegions([]);
                  setRoleChoice(option.role);
                  if (option.role === "cook") trackerRef.current?.track({ event: "cook_form_view" });
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

        <form
          onSubmit={handleSubmit}
          // Tracking (cook only): the first focus of each field, and the
          // browser's own "please fill in this field" checks, which stop the
          // submit before handleSubmit runs. Field names only, never values.
          onFocusCapture={(e) => {
            const name = (e.target as unknown as HTMLInputElement).name;
            if (name && isCookFormField(name)) tracker()?.fieldFocused(name);
          }}
          onInvalidCapture={(e) => {
            const el = e.target as unknown as HTMLInputElement;
            if (el.name && isCookFormField(el.name)) {
              trackError(el.name, el.validity?.valueMissing ? (el.name === "privacy_ack" ? "privacy_required" : "required") : "invalid_format");
            }
          }}
          className="kb-card-pop space-y-4 p-5"
        >
          <Field label="Full name (as per NRIC)">
            <input
              name="full_name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="kb-input"
              placeholder="e.g. Tan Wei Ming"
            />
          </Field>
          <Field label="Contact number">
            <input
              name="contact_number"
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
                <input name="business_name" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="kb-input" />
              </Field>
              <Field label="Business type">
                <select name="business_type" value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="kb-input">
                  {MERCHANT_CATEGORIES.map((c) => (
                    <option key={c.id}>{c.label}</option>
                  ))}
                </select>
              </Field>
              {requiresBusinessUen(businessType) && (
                <Field label="Business Registration Number (UEN)">
                  <input
                    name="business_uen"
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
                  name="business_address"
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
                  name="postal_code"
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
              <section className="kb-card space-y-3 p-4">
                <div>
                  <h2 className="font-display text-base font-bold" style={{ color: "var(--kb-ink)" }}>
                    How customers pay you (PayNow)
                  </h2>
                  <p className="mt-0.5 text-xs leading-5" style={{ color: "var(--kb-ink-soft)" }}>
                    Customers pay you directly. Fill in one of these. If you fill in both, customers pay your UEN.
                  </p>
                </div>
                <Field label="PayNow mobile number">
                  <input
                    name="paynow_mobile"
                    type="tel"
                    inputMode="tel"
                    value={paynowMobile}
                    onChange={(e) => setPaynowMobile(e.target.value)}
                    className="kb-input"
                    placeholder="e.g. 91234567"
                    autoComplete="off"
                  />
                  {!paynowMobile && contactNumber.trim() && (
                    <UseValueButton onClick={() => setPaynowMobile(contactNumber.trim())}>Use my contact number</UseValueButton>
                  )}
                </Field>
                <Field label="PayNow UEN (if your PayNow is under a UEN)">
                  <input
                    name="paynow_uen"
                    value={paynowUen}
                    onChange={(e) => setPaynowUen(e.target.value)}
                    className="kb-input"
                    placeholder="e.g. 53123456X"
                    autoCapitalize="characters"
                    autoComplete="off"
                  />
                  {!paynowUen && requiresBusinessUen(businessType) && businessUen.trim() && (
                    <UseValueButton onClick={() => setPaynowUen(businessUen.trim())}>Same as my business UEN</UseValueButton>
                  )}
                </Field>
                <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                  You can tell customers about your food when you set up your kitchen, after HQ approves you.
                </p>
              </section>
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
              <RideRegionsPicker value={rideRegions} onChange={setRideRegions} disabled={loading} />
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
            onClick={() => tracker()?.track({ event: "submit_attempt" })}
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
          name="privacy_ack"
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

/** A small "fill this in for me" link under a field. */
function UseValueButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mt-1.5 text-xs font-semibold underline" style={{ color: "var(--kb-purple)" }}>
      {children}
    </button>
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
