import Link from "next/link";

/**
 * A gentle nudge for a rider (or rider applicant) with no regions saved yet.
 * Only a link to /account: it never blocks deliveries or anything else.
 */
export function RideRegionsPrompt() {
  return (
    <section
      aria-label="Choose your ride regions"
      className="flex flex-col gap-3 rounded-[22px] border p-4 text-left sm:flex-row sm:items-center sm:justify-between"
      style={{ borderColor: "rgba(124,58,237,0.18)", background: "rgba(124,58,237,0.05)" }}
    >
      <div className="min-w-0">
        <p className="text-sm font-bold" style={{ color: "var(--kb-ink)" }}>
          Where do you usually ride?
        </p>
        <p className="mt-0.5 text-xs leading-5" style={{ color: "var(--kb-ink-soft)" }}>
          Pick your regions (North, South, East, West) so HQ can plan deliveries near you. It takes a few seconds.
        </p>
      </div>
      <Link
        href="/account#ride-regions"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-2xl bg-white px-4 text-sm font-bold"
        style={{ color: "var(--kb-purple)", border: "1px solid var(--kb-line, rgba(124,58,237,0.12))" }}
      >
        Choose regions
      </Link>
    </section>
  );
}
