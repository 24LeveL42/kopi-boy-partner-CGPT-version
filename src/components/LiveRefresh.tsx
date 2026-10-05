"use client";

import { useRouter } from "next/navigation";
import { useLiveRefresh, type LiveSource } from "@/lib/use-live-refresh";

/** Drop into a server-rendered page to re-fetch it whenever the watched tables change. */
export function LiveRefresh({ sources }: { sources: LiveSource[] }) {
  const router = useRouter();
  useLiveRefresh(sources, () => router.refresh());
  return null;
}
