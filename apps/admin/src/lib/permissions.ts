import type { AdminStaffRole, StaffAccess } from "@apartment-book/shared";

/**
 * What each staff role may open in the portal: one table that the sidebar, the section tabs and the page gates all
 * read, so a link shows exactly where its page lets the person in. Default deny: a permission a role is not given here
 * is refused, and a role this table does not know has none. The database stays the authority (every function checks
 * the caller again in SQL, e.g. ts_require_admin); this only decides what to show and where to send people.
 * Since migration 72 the database holds the same table (staff_role_permissions(), read through admin_my_permissions() by
 * lib/admin.ts getStaffPermissions, and staff_can() for SQL); this copy names the permissions for TypeScript and
 * stands in where 72 is missing. supabase/tests/staff-scopes.test.mjs reads this file and fails if the two differ.
 * A campus admin (migration 72) has no permissions until Phase 2 scopes an area for them.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "users.view",
  "moderation.view",
  "content.view",
  "universities.manage",
  "business.manage",
  "analytics.view",
  "operations.view",
  "support.view",
  "staff.view",
  "audit.view",
  "audit.context",
  "security.self",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Moderators: the queues and what they need to work them. Their audit view is limited in SQL (console_audit_feed). */
const MODERATOR: readonly Permission[] = [
  "dashboard.view",
  "users.view",
  "moderation.view",
  "content.view",
  "operations.view",
  "support.view",
  "staff.view",
  "audit.view",
  "security.self",
];

/** Admins add universities (requests), businesses and ads, analytics, settings, and see where staff actions came from. */
const ADMIN: readonly Permission[] = [...MODERATOR, "universities.manage", "business.manage", "analytics.view", "audit.context", "settings.manage"];

const GRANTS: Readonly<Record<AdminStaffRole, ReadonlySet<Permission>>> = {
  owner: new Set(ADMIN),
  admin: new Set(ADMIN),
  moderator: new Set(MODERATOR),
};

/** Whether this role (or staff member) may do `permission`. Unknown roles and permissions are refused. */
export function can(who: StaffAccess | AdminStaffRole | null | undefined, permission: Permission): boolean {
  const role = typeof who === "string" ? who : who?.role;
  if (!role || !Object.hasOwn(GRANTS, role)) return false;
  return GRANTS[role].has(permission);
}

/** The permissions of a role, for client components (the sidebar) that cannot receive a function. */
export function permissionsOf(who: StaffAccess | AdminStaffRole | null | undefined): Permission[] {
  return PERMISSIONS.filter((p) => can(who, p));
}
