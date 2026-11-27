// Migration 76 (appointing campus admins, Phase 2e) against PGlite, in production's order (CampConnect Admin's staff
// list and invitations) and this repo's order (migration 41's staff_members). Owners alone appoint: an existing
// confirmed account joins at once with its campuses, anyone else gets an invitation carrying them, claimed through the
// usual email binding and only while its inviter is still an owner; owners change a campus admin's campuses; admins,
// moderators, students and a session without the second factor are refused; bad campuses are refused; campus admin
// invitations are the owners' to resend and withdraw; a former campus admin's campuses go with the role (a role change
// or a removal); everything is in staff_audit_log with the universities; the appointed campus admin gets the portal's
// CAMPUS_ADMIN list (campus.overview included) and works on their campuses at once. The helpers are closed; the
// rollback refuses while a campus admin invitation is pending, then puts every function back exactly as it was.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = "20261201000000_campus_appointments.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261201000000_campus_appointments.down.sql";
const BEFORE = fs.readdirSync(path.join(HERE, "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const MFA = { aal: "aal2" };
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

// 76 is the newest migration to change the table: its campus admin's set is the portal's CAMPUS_ADMIN list.
const portal = fs.readFileSync(path.join(HERE, "..", "..", "apps", "admin", "src", "lib", "permissions.ts"), "utf8");
const listIn = (text) => [...text.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]);
const PORTAL_CAMPUS_ADMIN = listIn(/export const CAMPUS_ADMIN: readonly Permission\[\] = \[([\s\S]*?)\];/.exec(portal)?.[1] ?? "");
if (!PORTAL_CAMPUS_ADMIN.includes("campus.overview")) throw new Error("could not read the portal's campus admin permissions");
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const SIGS = ["staff_role_permissions(text)", "staff_invite_for_caller(text)", "staff_claim_invite()"];

for (const live of [true, false]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  const { db, mk, as } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r ? r[Object.keys(r)[0]] : undefined;
  };
  const asVal = (uid, q, params = [], claims = MFA) => as(uid, () => val(q, params), claims);
  const campusesOf = async (uid) => (await db.query("select university_id from public.staff_campuses where user_id = $1 order by 1", [uid])).rows.map((r) => r.university_id);
  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
  const OTHER = await val("select id from public.universities where id <> $1 order by name limit 1", [TX]);

  if (!live) {
    // -------------------------------------------------------------------------
    // This repo's schema: the table, and campuses following the role on staff_members
    // -------------------------------------------------------------------------
    const defsBefore = await val("select pg_get_functiondef('public.staff_role_permissions(text)'::regprocedure)");
    await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
      await db.exec(read(MIGRATION));
      await db.exec(read(MIGRATION));
    });
    await expectOk(tag + "campus admins get the portal's CAMPUS_ADMIN list, campus.overview included; nobody else gets campus.overview", async () => {
      check(same(await val("select public.staff_role_permissions('campus_admin')"), PORTAL_CAMPUS_ADMIN), "campus admin");
      for (const r of ["owner", "admin", "moderator"]) check(!(await val("select public.staff_role_permissions($1)", [r])).includes("campus.overview"), r);
    });
    await expectOk(tag + "a campus admin's campuses go when they change role or leave staff_members", async () => {
      const A = await mk("cam@txstate.edu", "Cam Campus");
      const B = await mk("cara@txstate.edu", "Cara Campus");
      await db.query("insert into public.staff_members (user_id, role) values ($1, 'campus_admin'), ($2, 'campus_admin')", [A, B]);
      await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $3), ($2, $3)", [A, B, TX]);
      await db.query("update public.staff_members set role = 'moderator' where user_id = $1", [A]);
      check((await campusesOf(A)).length === 0, "kept after a role change");
      await db.query("delete from public.staff_members where user_id = $1", [B]);
      check((await campusesOf(B)).length === 0, "kept after leaving");
    });
    await expectOk(tag + "the rollback restores 75's table, then the migration again", async () => {
      await db.exec(read(ROLLBACK));
      await db.exec(read(ROLLBACK));
      check((await val("select pg_get_functiondef('public.staff_role_permissions(text)'::regprocedure)")) === defsBefore, "the table differs");
      check((await val("select count(*)::int from pg_trigger where tgname = 'staff_campuses_follow_role'")) === 0, "the trigger stayed");
      await db.exec(read(MIGRATION));
    });
    continue;
  }

  // ---------------------------------------------------------------------------
  // Production's schema
  // ---------------------------------------------------------------------------
  const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
  await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  const STUDENT = await mk("tia@txstate.edu", "Tia Texan");
  const STUDENT2 = await mk("tom@txstate.edu", "Tom Texan");
  await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $3), ($2, 'moderator', $3)", [ADMIN, MOD, OWNER]);
  for (const u of [OWNER, ADMIN, MOD, STUDENT]) await as(u, () => val("select 1"), MFA);
  const lastLog = (action) => one(db.query("select * from public.staff_audit_log where action = $1 order by id desc limit 1", [action]));
  const defsBefore = Object.fromEntries(await Promise.all(SIGS.map(async (s) => [s, await val("select pg_get_functiondef($1::regprocedure)", [`public.${s}`])])));

  await expectError(tag + "before 76 there is no way to appoint a campus admin", () => asVal(OWNER, "select public.admin_campus_admin_add('tia@txstate.edu', $1)", [[TX]]), "does not exist");
  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // --- Appointing an existing account ------------------------------------------------------------------------------
  for (const [who, uid, message] of [["an admin", ADMIN, "Not allowed"], ["a moderator", MOD, "Not allowed"], ["a student", STUDENT, "Not allowed"]]) {
    await expectError(tag + `${who} cannot appoint a campus admin`, () => asVal(uid, "select public.admin_campus_admin_add('tom@txstate.edu', $1)", [[TX]]), message);
  }
  await expectError(tag + "nor an owner without the second factor", () => asVal(OWNER, "select public.admin_campus_admin_add('tom@txstate.edu', $1)", [[TX]], { aal: "aal1" }), "Two-factor authentication required");
  for (const [what, args, message] of [
    ["no campus", ["tom@txstate.edu", []], "Pick at least one campus"],
    ["an unknown campus", ["tom@txstate.edu", ["00000000-0000-4000-8000-000000000000"]], "Unknown campus"],
    ["21 campuses", ["tom@txstate.edu", Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)], "at most 20"],
    ["yourself", ["owner@txstate.edu", [TX]], "your own role"],
    ["someone already on the staff", ["ada@txstate.edu", [TX]], "already on the team"],
    ["a malformed address", ["not-an-email", [TX]], "valid email"],
  ]) {
    await expectError(tag + `refused: ${what}`, () => asVal(OWNER, "select public.admin_campus_admin_add($1, $2)", args), message);
  }
  await expectOk(tag + "an owner appoints an existing student at once, with their campus (repeats dropped), audited", async () => {
    check((await asVal(OWNER, "select public.admin_campus_admin_add('TIA@txstate.edu ', $1)", [[TX, TX]])) === "added", "not added");
    const s = await one(db.query("select role, granted_by from public.staff where user_id = $1", [STUDENT]));
    check(s.role === "campus_admin" && s.granted_by === OWNER, JSON.stringify(s));
    check(JSON.stringify(await campusesOf(STUDENT)) === JSON.stringify([TX]), "campuses");
    const log = await lastLog("staff.add");
    check(log.actor_id === OWNER && log.details.role === "campus_admin" && JSON.stringify(log.details.universities) === JSON.stringify([TX]), JSON.stringify(log.details));
  });
  await expectOk(tag + "the new campus admin has the portal's CAMPUS_ADMIN list on their campus, and works there at once", async () => {
    const p = await asVal(STUDENT, "select public.admin_my_permissions()");
    check(same(p.permissions, PORTAL_CAMPUS_ADMIN) && p.universities.length === 1 && p.universities[0].id === TX && !p.platform, JSON.stringify(p));
    check(Array.isArray((await as(STUDENT, () => db.query("select * from public.admin_reports_list('all', 10, null)"), MFA)).rows), "reports");
  });
  await expectError(tag + "the old paths still refuse the role (no campuses there)", () => asVal(OWNER, "select public.admin_staff_add('tom@txstate.edu', 'campus_admin')"), "Invalid role");
  await expectError(tag + "nor can a role change make one", () => asVal(OWNER, "select public.admin_staff_set_role($1, 'campus_admin')", [MOD]), "Invalid role");

  // --- Changing campuses --------------------------------------------------------------------------------------------
  await expectError(tag + "an admin cannot change a campus admin's campuses", () => asVal(ADMIN, "select public.admin_campus_admin_set_campuses($1, $2)", [STUDENT, [OTHER]]), "Not allowed");
  await expectError(tag + "only a campus admin has campuses", () => asVal(OWNER, "select public.admin_campus_admin_set_campuses($1, $2)", [MOD, [TX]]), "Not a campus admin");
  await expectOk(tag + "an owner changes them, audited with before and after; the same set again changes nothing", async () => {
    await asVal(OWNER, "select public.admin_campus_admin_set_campuses($1, $2)", [STUDENT, [OTHER, TX]]);
    check(same(await campusesOf(STUDENT), [TX, OTHER]), "campuses");
    const log = await lastLog("staff.campuses");
    check(JSON.stringify(log.details.from) === JSON.stringify([TX]) && same(log.details.to, [TX, OTHER]), JSON.stringify(log.details));
    const n = await val("select count(*)::int from public.staff_audit_log where action = 'staff.campuses'");
    await asVal(OWNER, "select public.admin_campus_admin_set_campuses($1, $2)", [STUDENT, [TX, OTHER]]);
    check((await val("select count(*)::int from public.staff_audit_log where action = 'staff.campuses'")) === n, "a no-op was logged");
    await asVal(OWNER, "select public.admin_campus_admin_set_campuses($1, $2)", [STUDENT, [TX]]);
  });

  // --- Invitations ---------------------------------------------------------------------------------------------------
  await expectOk(tag + "anyone without an account gets an invitation carrying the campuses, audited", async () => {
    check((await asVal(OWNER, "select public.admin_campus_admin_add('new.campus@txstate.edu', $1)", [[TX, OTHER]])) === "invited", "not invited");
    const i = await one(db.query("select role, invited_by, university_ids from public.staff_invites where email = 'new.campus@txstate.edu'"));
    check(i.role === "campus_admin" && i.invited_by === OWNER && same(i.university_ids, [TX, OTHER]), JSON.stringify(i));
    check((await lastLog("invite.create")).details.role === "campus_admin", "log");
  });
  await expectOk(tag + "the staff list's readers see who acts for which campuses, members and invitations", async () => {
    const c = await asVal(MOD, "select public.admin_staff_campuses()");
    check(c.members.length === 1 && c.members[0].userId === STUDENT && c.members[0].universities[0].id === TX, JSON.stringify(c.members));
    check(c.invitations.length === 1 && c.invitations[0].universities.length === 2, JSON.stringify(c.invitations));
  });
  await expectError(tag + "a student cannot read them", () => asVal(STUDENT2, "select public.admin_staff_campuses()"), "Not allowed");
  await expectError(tag + "an admin cannot resend a campus admin's invitation", () => asVal(ADMIN, "select public.admin_invite_resend('new.campus@txstate.edu')"), "Not allowed");
  await expectError(tag + "nor withdraw it", () => asVal(ADMIN, "select public.admin_invite_revoke('new.campus@txstate.edu')"), "Not allowed");
  await expectError(tag + "nor record its email", () => asVal(ADMIN, "select public.admin_invite_email_result('new.campus@txstate.edu', false, null, 'x')"), "Not allowed");
  await expectOk(tag + "an owner can resend it", async () => {
    check((await asVal(OWNER, "select public.admin_invite_resend('new.campus@txstate.edu')")) === "campus_admin", "resend");
  });
  await expectOk(tag + "claimed by its account: the role and its campuses, audited with them", async () => {
    const uid = await mk("new.campus@txstate.edu", "Nia New");
    check((await val("select role from public.staff where user_id = $1", [uid])) === "campus_admin", "not claimed");
    check(same(await campusesOf(uid), [TX, OTHER]), "campuses");
    check((await val("select count(*)::int from public.staff_invites where email = 'new.campus@txstate.edu'")) === 0, "invitation left");
    const log = await lastLog("invite.accepted");
    check(log.details.role === "campus_admin" && same(log.details.universities, [TX, OTHER]), JSON.stringify(log.details));
  });
  await expectOk(tag + "an invitation whose inviter is no longer an owner is withdrawn when claimed, granting nothing", async () => {
    const OWNER2 = await mk("owen@txstate.edu", "Owen Owner");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'owner', $2)", [OWNER2, OWNER]);
    await as(OWNER2, () => val("select 1"), MFA);
    check((await asVal(OWNER2, "select public.admin_campus_admin_add('late.campus@txstate.edu', $1)", [[TX]])) === "invited", "not invited");
    await db.query("update public.staff set role = 'admin' where user_id = $1", [OWNER2]);
    const uid = await mk("late.campus@txstate.edu", "Lee Late");
    check((await val("select count(*)::int from public.staff where user_id = $1", [uid])) === 0, "granted");
    check((await campusesOf(uid)).length === 0, "campuses granted");
    check((await lastLog("invite.revoke")).details.reason === "inviter no longer able to grant this role", "not logged");
  });

  // --- Campuses follow the role ------------------------------------------------------------------------------------
  await expectOk(tag + "an admin may change a campus admin to a role they can grant: the campuses go", async () => {
    const uid = await val("select user_id from public.staff s join auth.users u on u.id = s.user_id where u.email = 'new.campus@txstate.edu'");
    await asVal(ADMIN, "select public.admin_staff_set_role($1, 'moderator')", [uid]);
    check((await campusesOf(uid)).length === 0, "kept");
    const p = await asVal(uid, "select public.admin_my_permissions()", [], MFA);
    check(p.role === "moderator" && p.universities.length === 0, JSON.stringify(p));
  });
  await expectOk(tag + "an admin may remove a campus admin: the campuses go", async () => {
    await asVal(ADMIN, "select public.admin_staff_remove($1)", [STUDENT]);
    check((await campusesOf(STUDENT)).length === 0, "kept");
  });
  for (const fn of ["staff_valid_campuses('{}')", "staff_campuses_follow_role()"]) {
    await expectError(tag + `the helper ${fn.split("(")[0]} cannot be called through the API`, () => asVal(ADMIN, `select public.${fn}`), "permission denied");
  }
  await expectOk(tag + "the three new functions: signed-in callers, never visitors", async () => {
    for (const sig of ["admin_campus_admin_add(text,uuid[])", "admin_campus_admin_set_campuses(uuid,uuid[])", "admin_staff_campuses()"]) {
      check((await val("select has_function_privilege('authenticated', $1::regprocedure, 'execute')", [`public.${sig}`])) === true, `${sig} authenticated`);
      check((await val("select has_function_privilege('anon', $1::regprocedure, 'execute')", [`public.${sig}`])) === false, `${sig} anon`);
    }
  });

  // --- Rollback, then a second apply ---------------------------------------------------------------------------------
  await expectOk(tag + "(a pending campus admin invitation for the rollback to refuse)", async () => {
    check((await asVal(OWNER, "select public.admin_campus_admin_add('pending.campus@txstate.edu', $1)", [[TX]])) === "invited", "not invited");
  });
  await expectError(tag + "the rollback refuses while a campus admin invitation is pending", () => db.exec(read(ROLLBACK)), "Rollback refused");
  await expectOk(tag + "withdrawn, the rollback puts every function back word for word and drops what 76 added", async () => {
    await asVal(OWNER, "select public.admin_invite_revoke('pending.campus@txstate.edu')");
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    for (const s of SIGS) check((await val("select pg_get_functiondef($1::regprocedure)", [`public.${s}`])) === defsBefore[s], `${s} differs`);
    for (const f of ["admin_campus_admin_add(text,uuid[])", "admin_campus_admin_set_campuses(uuid,uuid[])", "admin_staff_campuses()", "staff_valid_campuses(uuid[])", "staff_campuses_follow_role()"]) {
      check((await val("select to_regprocedure($1) is null", [`public.${f}`])) === true, `${f} left behind`);
    }
    check((await val("select count(*)::int from information_schema.columns where table_name = 'staff_invites' and column_name = 'university_ids'")) === 0, "the column stayed");
  });
  await expectOk(tag + "applying it again works", async () => {
    await db.exec(read(MIGRATION));
    check((await asVal(OWNER, "select public.admin_campus_admin_add('tom@txstate.edu', $1)", [[TX]])) === "added", "after the second apply");
  });
}

done("CAMPUS APPOINTMENTS");
