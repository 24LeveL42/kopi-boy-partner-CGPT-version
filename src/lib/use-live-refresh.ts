"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export interface LiveSource {
  table: string;
  /** PostgREST-style filter, e.g. `kitchen_id=eq.<uuid>`. */
  filter?: string;
}

/**
 * Calls `onChange` whenever a watched table changes (Supabase Realtime), so a
 * dashboard updates itself instead of waiting for a manual Refresh.
 *
 * Realtime alone isn't enough: it only delivers rows the user can *still* see
 * after the change (e.g. a rider is never told an open request was taken by
 * someone else), and a sleeping phone drops its socket. So it's backed by a
 * slow poll and a catch-up whenever the app becomes visible / back online.
 */
export function useLiveRefresh(sources: LiveSource[], onChange: () => void, pollMs = 30_000) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  const key = JSON.stringify(sources);

  useEffect(() => {
    const supabase = createClient();
    const watched = JSON.parse(key) as LiveSource[];
    let debounce: ReturnType<typeof setTimeout> | undefined;

    // A burst of row changes (an order + its items) becomes one refresh.
    const fire = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => latest.current(), 250);
    };

    let channel = supabase.channel(`live:${Math.random().toString(36).slice(2)}`);
    for (const s of watched) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: s.table, ...(s.filter ? { filter: s.filter } : {}) },
        fire
      );
    }
    channel.subscribe();

    const catchUp = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const poll = setInterval(catchUp, pollMs);
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("online", catchUp);

    return () => {
      clearTimeout(debounce);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("online", catchUp);
      void supabase.removeChannel(channel);
    };
  }, [key, pollMs]);
}
