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

  return (
    <div className="mx-auto flex min-h-page max-w-sm flex-col items-center justify-center px-6 text-center" style={{ background: "var(--kb-navy)" }}>
      <Logo size={48} />
      <div className="mt-6 h-1 w-12 rounded-full" style={{ background: accent }} />
      <h1 className="mt-5 font-display text-lg font-bold" style={{ color: "var(--kb-on-navy)" }}>
        {title}
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
        {message}
      </p>
      {children && <div className="mt-6 w-full">{children}</div>}
      {signOut && (
        <div className="mt-6 w-full">
          <SignOutButton onlyWhenSignedIn={signOut === "if-signed-in"} />
        </div>
      )}
    </div>
  );
}
