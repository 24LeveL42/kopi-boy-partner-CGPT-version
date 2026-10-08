import Link from "next/link";
import { Avatar } from "./Avatar";

export interface ProfileSummary {
  fullName: string | null;
  phone: string | null;
  photoUrl: string | null;
}

/** Photo + name + contact number at the top of a rider/picker home screen; the editor lives at /account. */
export function ProfileSummaryCard({ profile }: { profile: ProfileSummary }) {
  return (
    <Link
      href="/account"
      className="flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{ borderColor: "rgba(124,58,237,0.12)" }}
    >
      <Avatar url={profile.photoUrl} name={profile.fullName} size={48} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold" style={{ color: "var(--kb-ink)" }}>
          {profile.fullName || "Your profile"}
        </span>
        <span className="block truncate text-xs" style={{ color: "var(--kb-ink-soft)" }}>
          {profile.phone || "Add your contact number"}
        </span>
      </span>
      <span
        className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
        style={{ background: "var(--kb-tint)", color: "var(--kb-purple)" }}
      >
        Edit profile &rsaquo;
      </span>
    </Link>
  );
}
