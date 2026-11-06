"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { sameRegions, saveMyRideRegions, validateRideRegions, type RegionCode } from "@/lib/ride-regions";
import { PendingLabel } from "./Pending";
import { RideRegionsPicker } from "./RideRegionsPicker";

/**
 * The rider's regions on /account, with its own Save so a failed regions save
 * has its own message and never touches the rider profile above it.
 * `initial` null = the saved regions couldn't be loaded.
 */
export function RideRegionsForm({ initial }: { initial: RegionCode[] | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [regions, setRegions] = useState<RegionCode[]>(initial ?? []);
  const [saved, setSaved] = useState<RegionCode[]>(initial ?? []);
  const { busy: saving, run, startTransition } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = !sameRegions(regions, saved);
  const noneSaved = initial !== null && saved.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJustSaved(false);
    const checked = validateRideRegions(regions);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    run("save-regions", async () => {
      const problem = await saveMyRideRegions(supabase, checked.regions);
      if (problem) {
        setError(problem);
        return;
      }
      setSaved(checked.regions);
      setJustSaved(true);
      startTransition(() => router.refresh());
    });
  }

  return (
    <form id="ride-regions" onSubmit={handleSubmit} className="kb-card scroll-mt-4 space-y-4 p-5">
      <div>
        <p className="kb-eyebrow">Delivery partner</p>
        <h2 className="mt-1 font-display text-xl font-bold">Regions you ride in</h2>
      </div>

      {noneSaved && (
        <p role="status" className="rounded-2xl px-4 py-3 text-sm" style={{ background: "rgba(124,58,237,0.06)", color: "var(--kb-ink)" }}>
          You haven&apos;t chosen any regions yet. Picking them helps HQ plan deliveries near you.
        </p>
      )}
      {initial === null && (
        <p role="status" className="kb-alert-error rounded-2xl px-4 py-3 text-sm">
          Couldn&apos;t load your saved regions. You can still pick them and save.
        </p>
      )}

      <RideRegionsPicker
        value={regions}
        onChange={(next) => {
          setRegions(next);
          setJustSaved(false);
          setError(null);
        }}
        disabled={saving}
        hint="Pick every region you usually ride in."
      />

      {error && (
        <p role="alert" className="kb-alert-error rounded-2xl px-4 py-3 text-sm">
          {error}
        </p>
      )}
      {justSaved && !dirty && (
        <p role="status" className="kb-alert-success rounded-2xl px-4 py-3 text-sm">
          Regions saved.
        </p>
      )}

      <button type="submit" disabled={saving || !dirty} className="kb-btn-primary w-full py-3.5 text-[15px]">
        <PendingLabel pending={saving} pendingText="Saving…">Save regions</PendingLabel>
      </button>
    </form>
  );
}
