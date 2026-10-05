/** Round profile photo, falling back to the person's initial when there's no photo yet. */
export function Avatar({ url, name, size = 56 }: { url: string | null; name: string | null; size?: number }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Supabase Storage URL, not a static asset
      <img
        src={url}
        alt={name ? `${name}'s photo` : "Profile photo"}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-display font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: "var(--kb-navy-raised)",
        color: "var(--kb-on-navy-soft)",
        border: "1px solid var(--kb-navy-line)",
      }}
    >
      {(name?.trim().charAt(0) || "?").toUpperCase()}
    </span>
  );
}
