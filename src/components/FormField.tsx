/** A labelled form control: small soft label above, control below. Shared by Kitchen Setup and the deal form. */
export function FormField({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-xs font-semibold ${className ?? ""}`} style={{ color: "var(--kb-ink-soft)" }}>
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
