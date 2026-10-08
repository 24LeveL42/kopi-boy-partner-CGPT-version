import { Logo } from "./Logo";
import { SignOutButton } from "./SignOutButton";

export function StatusScreen({
  title,
  message,
  tone = "neutral",
  signOut = false,
  children,
}: {
  title: string;
  message: string;
  tone?: "neutral" | "warning" | "danger";
  /**
   * Offer Sign out — for signed-in dead ends (pending / rejected / blocked), so a wrong account isn't a trap.
   * "if-signed-in" is for screens signed-out visitors can reach too (404, crash).
   */
  signOut?: boolean | "if-signed-in";
  children?: React.ReactNode;
}) {
  const accent =
    tone === "danger" ? "var(--kb-danger)" : tone === "warning" ? "var(--kb-warn)" : "var(--kb-green)";
  const accentWash =
    tone === "danger" ? "rgba(239,68,68,0.08)" : tone === "warning" ? "rgba(245,158,11,0.10)" : "var(--kb-mint)";

  return (
    <main className="kb-page min-h-page overflow-hidden">
      <div className="relative mx-auto flex min-h-page w-full max-w-md flex-col justify-center px-5 py-8">
        <div className="mb-7 flex justify-center">
          <Logo size={52} />
        </div>
        <div className="kb-card-pop p-6 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: accentWash, color: accent }}
          >
            <StatusIcon tone={tone} />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--kb-ink-soft)" }}>
            {message}
          </p>
          {children && <div className="mt-6 w-full">{children}</div>}
          {signOut && (
            <div className="mt-4 w-full">
              <SignOutButton onlyWhenSignedIn={signOut === "if-signed-in"} />
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--kb-ink-soft)" }}>
          Kopi Boy • Partner network
        </p>
      </div>
    </main>
  );
}

function StatusIcon({ tone }: { tone: "neutral" | "warning" | "danger" }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {tone === "neutral" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </>
      ) : (
        <>
          <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </>
      )}
    </svg>
  );
}
