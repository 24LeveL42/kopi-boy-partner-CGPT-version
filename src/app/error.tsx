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
        className="kb-btn-primary w-full py-3.5 text-[15px]"
      >
        Try again
      </button>
    </StatusScreen>
  );
}
