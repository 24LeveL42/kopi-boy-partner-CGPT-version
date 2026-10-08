/**
 * Placeholder shapes for route `loading.tsx` files and in-panel first loads,
 * laid out like the screens they stand in for so the page doesn't jump when
 * the real content arrives.
 */

export function SkeletonBlock({ className = "", tone = "navy" }: { className?: string; tone?: "navy" | "card" }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl ${className}`}
      style={{ background: tone === "navy" ? "#E9E5F2" : "#F0EEF5" }}
    />
  );
}

/** White order/request cards, as in the cook, rider and picker lists. */
export function SkeletonCards({ count = 2, withButton = true }: { count?: number; withButton?: boolean }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="kb-card rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <SkeletonBlock tone="card" className="h-4 w-32" />
            <SkeletonBlock tone="card" className="h-4 w-12" />
          </div>
          <SkeletonBlock tone="card" className="mt-2 h-3 w-48" />
          {withButton && <SkeletonBlock tone="card" className="mt-3 h-10 w-full" />}
        </div>
      ))}
    </div>
  );
}

/** The shared header row: menu button, logo, bell + role badge. */
function SkeletonTopBar() {
  return (
    <div className="flex items-center justify-between px-1 py-2">
      <SkeletonBlock className="h-10 w-10" />
      <SkeletonBlock className="h-8 w-28 rounded-full" />
      <SkeletonBlock className="h-8 w-24 rounded-full" />
    </div>
  );
}

/** Dashboard / list screens: header, title, then a column of cards. */
export function DashboardSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="kb-page min-h-page">
      <div className="relative mx-auto max-w-md px-4 pt-3 sm:max-w-lg sm:px-6">
        <SkeletonTopBar />
        <div className="kb-card mt-4 rounded-[28px] p-5">
          <SkeletonBlock tone="card" className="h-3 w-32" />
          <SkeletonBlock tone="card" className="mt-3 h-7 w-48" />
          <SkeletonBlock tone="card" className="mt-2 h-4 w-56" />
        </div>
        <div className="mt-4">
          <SkeletonCards count={cards} />
        </div>
      </div>
    </div>
  );
}

/** Form screens: title, intro line, then labelled fields and a submit button. */
export function FormSkeleton({ fields = 5, withTopBar = false }: { fields?: number; withTopBar?: boolean }) {
  return (
    <div className="kb-page min-h-page" role="status" aria-label="Loading">
      <div className="relative mx-auto max-w-md px-5 py-8">
        {withTopBar ? <SkeletonTopBar /> : <SkeletonBlock className="mx-auto h-12 w-36 rounded-full" />}
        <SkeletonBlock className="mx-auto mt-6 h-5 w-28 rounded-full" />
        <SkeletonBlock className="mx-auto mt-3 h-7 w-56" />
        <SkeletonBlock className="mx-auto mt-2 h-4 w-64" />
        <div className="kb-card-pop mt-6 space-y-4 p-5">
          {Array.from({ length: fields }, (_, i) => (
            <div key={i}>
              <SkeletonBlock tone="card" className="h-3 w-24" />
              <SkeletonBlock tone="card" className="mt-1.5 h-12 w-full rounded-2xl" />
            </div>
          ))}
          <SkeletonBlock className="h-12 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
