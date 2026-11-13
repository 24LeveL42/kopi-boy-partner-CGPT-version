import { StatusScreen } from "./StatusScreen";
import { RefreshButton } from "./RefreshButton";
import { RETRY_COPY } from "@/lib/onboarding-copy";

/**
 * A load that failed even after its automatic retry: a clear message and a
 * "Try again" button, never a skeleton or spinner that doesn't stop.
 */
export function RetryScreen({
  title,
  message,
  signOut = "if-signed-in",
}: {
  title: string;
  message: string;
  signOut?: boolean | "if-signed-in";
}) {
  return (
    <StatusScreen tone="warning" signOut={signOut} title={title} message={message}>
      <RefreshButton label={RETRY_COPY.button} pendingText={RETRY_COPY.pending} />
    </StatusScreen>
  );
}
