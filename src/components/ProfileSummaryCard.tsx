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
      className="flex items-center gap-3 rounded-2xl px-4 py-3"
      style={{ background: "var(--kb-navy-raised)", border: "1px solid var(--kb-navy-line)" }}
    >
      <Avatar url={profile.photoUrl} name={profile.fullName} size={48} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold" style={{ color: "var(--kb-on-navy)" }}>
          {profile.fullName || "Your profile"}
        </span>
        <span className="block truncate text-xs" style={{ color: "var(--kb-on-navy-soft)" }}>
          {profile.phone || "Add your contact number"}
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold" style={{ color: "var(--kb-green)" }}>
        Edit profile &rsaquo;
      </span>
    </Link>
  );
}
