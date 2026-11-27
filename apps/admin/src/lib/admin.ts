import { cache } from "react";
import { redirect } from "next/navigation";
import { getMyRestriction, getMyStaffAccess, getMyStaffPermissions, isPlatformRole, STAFF_ROLE_RANK, STAFF_ROLES, type StaffAccess, type StaffListRole, type StaffPermissions, type AdminStaffRole } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { can, PERMISSIONS, permissionsOf, type Permission } from "@/lib/permissions";
import { SECTIONS } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";

/**
 * Access layer of the admin app. Every layout, page and server action goes through
 * here. The database stays the authority: the RPCs in migrations 14 to 16 re-check the
 * caller's role and two-factor status (JWT claim aal2) in SQL, so these helpers only
 * decide what to render and where to send people. The proxy (src/proxy.ts) adds a
 * first, cheap gate in front of everything: no session, no page; no aal2, /security.
 */

/** The signed-in staff member's row from admin_my_permissions() (migration 72), null when the database gives them none, or "missing" where that function does not exist. Cached per request. */
const getPermissionsRow = cache(async (): Promise<StaffPermissions | null | "missing"> => {
  try {
    return await getMyStaffPermissions(await createClient());
  } catch (error) {
    if (/admin_my_permissions|PGRST202|Could not find the function/i.test(errorMessage(error, ""))) return "missing";
    throw error;
  }
});

/** Staff row of the signed-in user, or null (not signed in / not staff / suspended). Cached per request. Errors propagate. */
export const getStaffAccess = cache(async (): Promise<StaffAccess | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const [access, restriction] = await Promise.all([getMyStaffAccess(supabase), getMyRestriction(supabase).catch(() => null)]);
  // A suspended staff member has no admin powers (every RPC refuses them).
  if (!access || restriction) return null;
  // Nor one under an account-wide sanction in Trust & Safety (migration 78): the database answers
  // admin_my_permissions() with nothing for them, so the portal goes no further than /no-access. Where migration 72 is
  // missing the function is too, and nothing changes.
  if ((await getPermissionsRow()) === null) return null;
  // Default deny: only the roles the portal knows are let in: the platform's three, and campus admins (Phase 2), who
  // pass a page or an action by permission alone (requireStaff), never by a rank they do not have.
  if (!isPlatformRole(access.role) && access.role !== "campus_admin") return null;
  return access;
});

/**
 * What the signed-in staff member may open, as the database decides it (migration 72's admin_my_permissions, the same
 * table as lib/permissions.ts); where that migration is missing, the portal's own table. Empty for anyone without
 * access. Cached per request. Only names the portal knows are kept.
 */
export const getStaffPermissions = cache(async (): Promise<Permission[]> => {
  const access = await getStaffAccess();
  if (!access) return [];
  const fromSql = await getPermissionsRow();
  // Where migration 72 is missing, the portal's own table (a campus admin cannot exist there).
  if (fromSql === "missing") return isPlatformRole(access.role) ? permissionsOf(access) : [];
  if (!fromSql || fromSql.role !== access.role) return [];
  return PERMISSIONS.filter((p) => fromSql.permissions.includes(p));
});

/** A campus admin's campuses (names for the header and their dashboard); empty for the platform's staff and anyone else. */
export const getMyCampuses = cache(async (): Promise<{ id: string; name: string }[]> => {
  const access = await getStaffAccess();
  if (!access || access.role !== "campus_admin") return [];
  const fromSql = await getPermissionsRow();
  return fromSql && fromSql !== "missing" && fromSql.role === "campus_admin" ? fromSql.universities : [];
});

/** Where to send a staff member a page refused: the first section they may open (never `from` itself), or /no-access. */
export function homeFor(permissions: readonly Permission[], from: string): string {
  const path = from.split("?")[0];
  const section = SECTIONS.find((s) => permissions.includes(s.permission) && s.href !== path);
  return section?.href ?? "/no-access";
}

export type RequireStaffOptions = {
  /** Lowest platform role that may pass. Default "moderator", i.e. any of the platform's staff. A campus admin never passes a minRole. */
  minRole?: AdminStaffRole;
  /**
   * What the page or action is (lib/permissions.ts): refused unless the role is given it. Checked on top of minRole.
   * The only way a campus admin passes: a page or action that names no permission refuses them (default deny).
   */
  permission?: Permission;
  /** Require a session that verified the second factor (aal2). Default true; only the Security page turns it off. */
  mfa?: boolean;
  /** The layout: any staff member may see the frame (each page inside it checks its own permission). */
  shell?: boolean;
};

/** Whether `access` is at least `minRole` (owner > admin > moderator). Never true for a campus admin, who has no rank. */
export function hasRole(access: StaffAccess, minRole: AdminStaffRole): boolean {
  return isPlatformRole(access.role) && STAFF_ROLE_RANK[access.role] >= STAFF_ROLE_RANK[minRole];
}

/** Whether `role` is a campus admin: let in by permission alone, for their own campuses (SQL scopes every call). */
export function isCampusAdmin(role: StaffListRole): boolean {
  return role === "campus_admin";
}

/** The lowest role given a permission, for the "that page needs the … role" note; null if no role has it. */
function lowestRoleWith(permission: Permission): AdminStaffRole | null {
  const byRank = [...STAFF_ROLES].sort((a, b) => STAFF_ROLE_RANK[a.value] - STAFF_ROLE_RANK[b.value]);
  return byRank.find((r) => can(r.value, permission))?.value ?? null;
}

/**
 * For pages and layouts. Signed out → login, coming back to `nextPath`; not staff →
 * /no-access (a clear answer: this app is for staff only); staff whose session has
 * not verified the second factor → /security; role too low, or a permission the role
 * is not given → the overview with a note. Database errors propagate so a broken
 * connection never looks like "not staff".
 */
export async function requireStaff(nextPath: string, opts: RequireStaffOptions = {}): Promise<StaffAccess> {
  const { minRole = "moderator", mfa = true, permission } = opts;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const access = await getStaffAccess();
  if (!access) redirect("/no-access");
  if (mfa && !access.mfaVerified) redirect(`/security?next=${encodeURIComponent(nextPath)}`);
  if (isCampusAdmin(access.role)) {
    if (opts.shell) return access;
    const held = await getStaffPermissions();
    if (!permission || opts.minRole || !held.includes(permission)) redirect(homeFor(held, nextPath));
    return access;
  }
  if (!hasRole(access, minRole)) redirect(`/?denied=${minRole}`);
  if (permission && !(await getStaffPermissions()).includes(permission)) redirect(`/?denied=${lowestRoleWith(permission) ?? "owner"}`);
  return access;
}

/** For server actions: the same checks as `requireStaff`, returned as an error instead of a redirect. */
export async function requireStaffAction(
  opts: RequireStaffOptions = {},
): Promise<{ access: StaffAccess; error?: undefined } | { access?: undefined; error: string }> {
  const { minRole = "moderator", mfa = true, permission } = opts;
  const user = await getCurrentUser();
  if (!user) return { error: "Log in first." };
  let access: StaffAccess | null;
  try {
    access = await getStaffAccess();
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  if (!access) return { error: "Not allowed." };
  if (mfa && !access.mfaVerified) return { error: "Verify your two-factor code first." };
  if (isCampusAdmin(access.role)) {
    if (!permission || opts.minRole || !(await getStaffPermissions()).includes(permission)) return { error: "Not allowed." };
    return { access };
  }
  if (!hasRole(access, minRole)) return { error: `You need the ${minRole} role for that.` };
  if (permission && !(await getStaffPermissions()).includes(permission)) return { error: `You need the ${lowestRoleWith(permission) ?? "owner"} role for that.` };
  return { access };
}

/**
 * Human message for an error from the admin RPCs. The messages the migrations raise on
 * purpose ("Not allowed", "You cannot remove yourself", ...) are written for people and
 * pass through unchanged; the aal2 check gets the wording the Security page uses.
 */
export function adminErrorMessage(error: unknown): string {
  const message = errorMessage(error, "");
  if (message === "Two-factor authentication required") return "Verify your two-factor code first.";
  return errorMessage(error);
}

/**
 * Whether `me` may suspend or unsuspend `target`: never yourself; a staff target needs a strictly higher platform role
 * (migration 15), and a campus admin an owner or an admin (74); a campus admin never acts on anyone on the staff (74:
 * staff belong to no campus). The database applies the same rules.
 */
export function canModerateUser(me: StaffAccess, target: { userId: string; staffRole: StaffListRole | null }): boolean {
  if (me.userId === target.userId) return false;
  if (!target.staffRole) return true;
  if (!isPlatformRole(me.role)) return false;
  if (target.staffRole === "campus_admin") return STAFF_ROLE_RANK[me.role] >= STAFF_ROLE_RANK.admin;
  return isPlatformRole(target.staffRole) && STAFF_ROLE_RANK[me.role] > STAFF_ROLE_RANK[target.staffRole];
}
