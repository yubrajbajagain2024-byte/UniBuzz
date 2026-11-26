import {
  Activity,
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  GraduationCap,
  Mail,
  MailX,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { formatDate, MODERATION_TARGET_TYPE_VALUES, MODERATION_TARGET_TYPES, REPORT_DECISIONS, STAFF_ROLES, type AuditEntry } from "@apartment-book/shared";
import { isUuid } from "@/lib/utils";

/**
 * How an entry of the team's audit log (staff_audit_log) reads: its icon, its one line of detail and where it points.
 * A plain module, so the client list (audit-list.tsx) and the server-rendered feed (audit-feed.tsx) share it.
 */
export const LOOKS: Record<string, { icon: LucideIcon; className: string }> = {
  "owner.bootstrap": { icon: Crown, className: "bg-brand-50 text-brand-700" },
  "invite.accepted": { icon: UserPlus, className: "bg-green-100 text-green-700" },
  "invite.held": { icon: Mail, className: "bg-amber-100 text-amber-800" },
  "staff.add": { icon: UserPlus, className: "bg-green-100 text-green-700" },
  "staff.role": { icon: UserCog, className: "bg-brand-50 text-brand-700" },
  "staff.remove": { icon: UserMinus, className: "bg-red-100 text-red-700" },
  "invite.create": { icon: Mail, className: "bg-gray-100 text-gray-700" },
  "invite.revoke": { icon: MailX, className: "bg-gray-100 text-gray-700" },
  "security.mfa_enrolled": { icon: ShieldCheck, className: "bg-green-100 text-green-700" },
  "security.mfa_removed": { icon: ShieldOff, className: "bg-amber-100 text-amber-800" },
  "user.suspend": { icon: UserX, className: "bg-red-100 text-red-700" },
  "user.unsuspend": { icon: UserCheck, className: "bg-green-100 text-green-700" },
  "content.hide": { icon: EyeOff, className: "bg-amber-100 text-amber-800" },
  "content.restore": { icon: Eye, className: "bg-green-100 text-green-700" },
  "content.delete": { icon: Trash2, className: "bg-red-100 text-red-700" },
  "content.view": { icon: Eye, className: "bg-gray-100 text-gray-700" },
  "report.resolve": { icon: CheckCircle2, className: "bg-brand-50 text-brand-700" },
  "report.reopen": { icon: RotateCcw, className: "bg-gray-100 text-gray-700" },
  "media.retry": { icon: RefreshCw, className: "bg-gray-100 text-gray-700" },
  "university.create": { icon: GraduationCap, className: "bg-green-100 text-green-700" },
  "university_request.approve": { icon: GraduationCap, className: "bg-green-100 text-green-700" },
  "university_request.link": { icon: GraduationCap, className: "bg-brand-50 text-brand-700" },
  "university_request.decline": { icon: GraduationCap, className: "bg-gray-100 text-gray-700" },
};

export const FALLBACK_LOOK = { icon: Activity, className: "bg-gray-100 text-gray-700" };

export function roleName(value: unknown): string {
  if (typeof value !== "string") return "";
  return STAFF_ROLES.find((r) => r.value === value)?.label ?? value;
}

export function typeName(value: unknown): string {
  if (typeof value !== "string") return "";
  return MODERATION_TARGET_TYPES.find((t) => t.value === value)?.label ?? value;
}

/** Why a staff.remove row exists when a trigger wrote it rather than an admin. */
const CAUSES: Record<string, string> = { account_deleted: "deleted their own account", cascade: "account removed" };

/** One line built from `details`: "jane@uni.edu · Admin → Moderator · inviter demoted" or "Apartment listing · Looks fake". */
export function auditSummary(entry: AuditEntry): string {
  const d = entry.details;
  const parts: string[] = [];
  if (typeof d.email === "string") parts.push(d.email);
  if (typeof d.from === "string" && typeof d.to === "string") parts.push(`${roleName(d.from)} → ${roleName(d.to)}`);
  else if (typeof d.role === "string") parts.push(roleName(d.role));
  if (typeof d.target_type === "string") parts.push(typeName(d.target_type));
  else if (entry.action.startsWith("content.") && entry.targetType) parts.push(typeName(entry.targetType));
  if (typeof d.title === "string" && d.title) parts.push(`“${d.title.slice(0, 80)}”`);
  // Universities (migration 70): the university's name, and the reply the student reads.
  if (entry.action.startsWith("university") && typeof d.name === "string" && d.name) parts.push(d.name.slice(0, 120));
  if (entry.action.startsWith("university_request.") && typeof d.note === "string" && d.note) parts.push(`reply: “${d.note.slice(0, 80)}”`);
  if (typeof d.decision === "string") parts.push(REPORT_DECISIONS.find((x) => x.value === d.decision)?.label ?? d.decision);
  if (typeof d.friendly_name === "string" && d.friendly_name) parts.push(d.friendly_name);
  if (typeof d.kind === "string" && typeof d.ref === "string") parts.push(`${d.kind} ${d.ref}`);
  if (d.pending === true) parts.push("pending confirmation");
  if (typeof d.reason === "string" && d.reason) parts.push(d.reason);
  if (typeof d.expires_at === "string") parts.push(`until ${formatDate(d.expires_at)}`);
  else if (entry.action === "user.suspend" && d.expires_at === null) parts.push("until lifted");
  if (typeof d.cause === "string" && d.cause in CAUSES) parts.push(CAUSES[d.cause]);
  if (parts.length === 0 && entry.targetType) parts.push(entry.targetType);
  return parts.join(" · ");
}

/** Where a row points: the person, the report, the content or the university requests it is about. */
export function auditHref(entry: AuditEntry): string | null {
  if (entry.action === "university.create" || entry.action === "university_request.approve" || entry.action === "university_request.link") return "/universities?status=approved";
  if (entry.action === "university_request.decline") return "/universities?status=declined";
  if (!isUuid(entry.targetId)) return null;
  if (entry.action.startsWith("user.") || entry.action.startsWith("staff.")) return `/users/${entry.targetId}`;
  if (entry.action.startsWith("report.")) return `/reports/${entry.targetId}`;
  if (entry.action === "content.hide" || entry.action === "content.restore" || entry.action === "content.view") {
    const type = entry.targetType ?? "";
    if ((MODERATION_TARGET_TYPE_VALUES as readonly string[]).includes(type)) return `/content/${type}/${entry.targetId}`;
  }
  return null;
}
