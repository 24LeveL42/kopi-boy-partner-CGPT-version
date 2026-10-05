import { SkeletonBlock } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="min-h-page px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)" }} role="status" aria-label="Loading">
      <div className="mx-auto max-w-sm space-y-4">
        <SkeletonBlock className="h-7 w-28" />
        <div className="rounded-2xl bg-white p-5 shadow-lg">
          <SkeletonBlock tone="card" className="h-3 w-20" />
          <SkeletonBlock tone="card" className="mt-2 h-5 w-48" />
          <SkeletonBlock tone="card" className="mt-2 h-4 w-24" />
          <SkeletonBlock tone="card" className="mt-5 h-10 w-full" />
        </div>
      </div>
    </div>
  );
}
