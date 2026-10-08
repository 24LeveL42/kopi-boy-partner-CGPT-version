import { SkeletonBlock } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="kb-page min-h-page px-4 py-8 sm:px-6" role="status" aria-label="Loading">
      <div className="relative mx-auto max-w-md space-y-4">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-7 w-28" />
        <div className="kb-card p-5">
          <SkeletonBlock tone="card" className="h-3 w-20" />
          <SkeletonBlock tone="card" className="mt-2 h-5 w-48" />
          <SkeletonBlock tone="card" className="mt-2 h-4 w-24" />
          <SkeletonBlock tone="card" className="mt-5 h-10 w-full" />
        </div>
      </div>
    </div>
  );
}
