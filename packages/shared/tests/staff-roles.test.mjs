// Unit tests for the staff list's roles in the shared helpers (src/constants.ts, src/queries/admin.ts): campus admins
// (migrations 72 to 76) have no rank, only owners appoint them or manage their invitations, admins may change or remove
// them (as SQL allows), and nobody below an owner is offered the role. The database enforces all of this again; these
// helpers only decide what the portal shows. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as in media.test.mjs).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const { isPlatformRole, STAFF_ROLE_LABELS, CAMPUS_ADMIN_ROLE } = await import("../src/constants.ts");
const { canAssignRole, assignableStaffRoles, canChangeMember } = await import("../src/queries/admin.ts");

test("isPlatformRole: the three ranked roles only", () => {
  for (const r of ["owner", "admin", "moderator"]) assert.equal(isPlatformRole(r), true, r);
  for (const r of ["campus_admin", "superadmin", "", null, undefined]) assert.equal(isPlatformRole(r), false, String(r));
});

test("every role on the staff list has a label; the campus admin's is its own", () => {
  assert.deepEqual(STAFF_ROLE_LABELS, { owner: "Owner", admin: "Admin", moderator: "Moderator", campus_admin: "Campus admin" });
  assert.equal(CAMPUS_ADMIN_ROLE.value, "campus_admin");
});

test("canAssignRole: owners any role, campus admin included; admins moderator only; nobody else anything", () => {
  assert.equal(canAssignRole("owner", "campus_admin"), true);
  assert.equal(canAssignRole("owner", "owner"), true);
  assert.equal(canAssignRole("admin", "campus_admin"), false);
  assert.equal(canAssignRole("admin", "moderator"), true);
  assert.equal(canAssignRole("admin", "admin"), false);
  for (const caller of ["moderator", "campus_admin"]) for (const target of ["owner", "admin", "moderator", "campus_admin"]) assert.equal(canAssignRole(caller, target), false, `${caller} → ${target}`);
});

test("assignableStaffRoles: platform roles only (campus admins are appointed with their campuses), none for a campus admin", () => {
  assert.deepEqual(assignableStaffRoles("owner"), ["owner", "admin", "moderator"]);
  assert.deepEqual(assignableStaffRoles("admin"), ["moderator"]);
  assert.deepEqual(assignableStaffRoles("moderator"), []);
  assert.deepEqual(assignableStaffRoles("campus_admin"), []);
});

test("canChangeMember: never yourself; owners anyone; admins moderators and campus admins; moderators and campus admins nobody", () => {
  const me = (role) => ({ role, userId: "me" });
  const them = (role) => ({ role, userId: "them" });
  assert.equal(canChangeMember(me("owner"), { role: "owner", userId: "me" }), false);
  for (const r of ["owner", "admin", "moderator", "campus_admin"]) assert.equal(canChangeMember(me("owner"), them(r)), true, r);
  assert.equal(canChangeMember(me("admin"), them("moderator")), true);
  assert.equal(canChangeMember(me("admin"), them("campus_admin")), true);
  assert.equal(canChangeMember(me("admin"), them("admin")), false);
  assert.equal(canChangeMember(me("admin"), them("owner")), false);
  for (const caller of ["moderator", "campus_admin"]) for (const r of ["owner", "admin", "moderator", "campus_admin"]) assert.equal(canChangeMember(me(caller), them(r)), false, `${caller} → ${r}`);
});
