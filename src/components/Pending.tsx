/** Small spinning ring in the current text colour — sized to sit inside a button label. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A button's label: `children` normally, spinner + `pendingText` while its
 * action runs (see usePendingAction).
 */
export function PendingLabel({
  pending,
  pendingText,
  children,
}: {
  pending: boolean;
  pendingText: string;
  children: React.ReactNode;
}) {
  if (!pending) return <>{children}</>;
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Spinner />
      {pendingText}
    </span>
  );
}
