"use client";

import { REGIONS, normalizeRegions, type RegionCode } from "@/lib/ride-regions";

/**
 * "Where do you ride?" — four checkboxes, North / South / East / West. Only
 * the regions: no address or postal code is asked for. At least one is
 * required; the form using it checks that (validateRideRegions) before saving.
 */
export function RideRegionsPicker({
  value,
  onChange,
  disabled = false,
  hint = "Pick every region you usually ride in. You can change this any time in Profile.",
}: {
  value: readonly RegionCode[];
  onChange: (next: RegionCode[]) => void;
  disabled?: boolean;
  hint?: string;
}) {
  function toggle(code: RegionCode, on: boolean) {
    onChange(normalizeRegions(on ? [...value, code] : value.filter((c) => c !== code)));
  }

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
        Where do you ride?
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {REGIONS.map((r) => {
          const checked = value.includes(r.code);
          return (
            <label
              key={r.code}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold"
              style={{
                borderColor: checked ? "var(--kb-purple)" : "var(--kb-line, rgba(124,58,237,0.12))",
                background: checked ? "rgba(124,58,237,0.06)" : "white",
                color: "var(--kb-ink)",
              }}
            >
              <input
                type="checkbox"
                name="ride-region"
                value={r.code}
                checked={checked}
                onChange={(e) => toggle(r.code, e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[#7B3FE4]"
              />
              {r.label}
            </label>
          );
        })}
      </div>
      <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>
        {hint}
      </p>
    </fieldset>
  );
}
