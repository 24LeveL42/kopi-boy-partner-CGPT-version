"use client";

import { useEffect } from "react";
import { StatusScreen } from "@/components/StatusScreen";

// Rendered inside the root layout, so Back / Cancel / Home stay available even
// when a page throws (Next's built-in error page would replace the whole shell).
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      tone="danger"
      signOut="if-signed-in"
      title="Something went wrong"
      message="We couldn't load this page. Try again, or use Back, Cancel or Home above."
    >
      <button
        type="button"
        onClick={() => retry()}
        className="w-full rounded-2xl py-3.5 text-[15px] font-semibold text-white"
        style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
      >
        Try again
      </button>
    </StatusScreen>
  );
}
