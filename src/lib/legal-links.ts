/**
 * Kopi Boy's public Terms of Use and Privacy Policy. They live in the
 * Customer app (kopi-boy.com), so the Partner app links out to them in a
 * new tab. Used by the app-wide footer, the kitchen setup terms tick and
 * the cook/rider application's privacy acknowledgement.
 */
export const TERMS_URL = "https://kopi-boy.com/terms";
export const PRIVACY_URL = "https://kopi-boy.com/privacy";

export const TERMS_LINK_LABEL = "Terms of Use";
export const PRIVACY_LINK_LABEL = "Privacy Policy";

export const LEGAL_LINKS: { label: string; href: string }[] = [
  { label: TERMS_LINK_LABEL, href: TERMS_URL },
  { label: PRIVACY_LINK_LABEL, href: PRIVACY_URL },
];

/** The legal entity line shown in the footer. No GST or tax wording. */
export const LEGAL_ENTITY_LINE = "KOPIE BOY (UEN 53535194A), trading as Kopi Boy";

/** Props for an external legal link: always a new tab, no opener. */
export const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;
