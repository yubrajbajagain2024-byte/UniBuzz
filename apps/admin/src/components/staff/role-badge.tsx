import { STAFF_ROLE_LABELS, type StaffListRole } from "@apartment-book/shared";
import { Badge } from "@/components/ui/badge";

const TONES: Record<StaffListRole, "blue" | "green" | "gray" | "amber"> = { owner: "blue", admin: "green", moderator: "gray", campus_admin: "amber" };

/** "Owner", "Admin", "Moderator" or "Campus admin". */
export function roleLabel(role: StaffListRole): string {
  return STAFF_ROLE_LABELS[role] ?? role;
}

/** Role pill: owner indigo, admin green, moderator gray, campus admin amber. Works in server and client components. */
export function RoleBadge({ role, className }: { role: StaffListRole; className?: string }) {
  return (
    <Badge tone={TONES[role] ?? "gray"} className={className}>
      {roleLabel(role)}
    </Badge>
  );
}
