import { LEGAL_ENTITY_LINE, LEGAL_LINKS, NEW_TAB } from "@/lib/legal-links";

/** App-wide footer: Terms / Privacy (Customer app, new tab) and the legal entity line. */
export function LegalFooter() {
  return (
    // Extra bottom padding so the partner dashboard's fixed BottomNav never covers it.
    <footer
      className="px-4 pt-6 text-center text-[11px] leading-5 pb-[calc(6rem+env(safe-area-inset-bottom))]"
      style={{ color: "var(--kb-ink-soft)" }}
    >
      <nav aria-label="Legal" className="flex items-center justify-center gap-3">
        {LEGAL_LINKS.map((link) => (
          <a key={link.href} href={link.href} {...NEW_TAB} className="font-semibold underline">
            {link.label}
          </a>
        ))}
      </nav>
      <p className="mt-1">{LEGAL_ENTITY_LINE}</p>
    </footer>
  );
}
