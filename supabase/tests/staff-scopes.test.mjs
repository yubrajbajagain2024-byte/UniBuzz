// Migration 72 (campus scopes for the staff, default deny) against PGlite, in this repo's order and in production's
// (boot({ live: true }): CampConnect Admin's staff list, invitations and suspensions). Before it the staff list refuses
// the role campus_admin. After it: the role is allowed on the list but nothing grants it through the API; a campus admin
// with a campus and a second factor has no power anywhere yet (Trust & Safety, events, universities, the audit feed,
// CampConnect Admin's admin_* functions, admin_standing) and gets no staff notices; owners, admins and moderators keep
// exactly what they had, and admin_my_permissions() gives them the same permissions as the portal's lib/permissions.ts
// (read from the file, so the two tables cannot drift apart); staff_can() scopes a campus admin to their campuses, never
// platform-wide; staff_require_can() refuses or asks for the second factor; the new table and helpers are closed to the
// API. Then the rollback (refused while a campus admin exists; migration 41's resolvers back) and a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = "20261127000000_staff_scopes.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261127000000_staff_scopes.down.sql";
const BEFORE = fs.readdirSync(path.join(HERE, "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const MFA = { aal: "aal2" };
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

// The portal's own table (apps/admin/src/lib/permissions.ts): the moderator's list, and what admins add to it.
const portal = fs.readFileSync(path.join(HERE, "..", "..", "apps", "admin", "src", "lib", "permissions.ts"), "utf8");
const listIn = (text) => [...text.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]);
const PORTAL_MODERATOR = listIn(/const MODERATOR: readonly Permission\[\] = \[([\s\S]*?)\];/.exec(portal)?.[1] ?? "");
const PORTAL_ADMIN = [...PORTAL_MODERATOR, ...listIn(/const ADMIN: readonly Permission\[\] = \[\.\.\.MODERATOR,([\s\S]*?)\];/.exec(portal)?.[1] ?? "")];
if (PORTAL_MODERATOR.length < 5 || PORTAL_ADMIN.length <= PORTAL_MODERATOR.length) throw new Error("could not read the portal's permission table");
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

for (const live of [false, true]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  const { db, mk, as, asAnon } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r[Object.keys(r)[0]];
  };
  const asVal = (uid, q, params = [], claims = MFA) => as(uid, () => val(q, params), claims);
  // staff_can() is internal: scoped functions call it inside the caller's request, as the database owner does here.
  const canFor = async (uid, permission, university = null) => {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, aal: "aal2", role: "authenticated" })]);
    try {
      return await val("select public.staff_can($1, $2)", [permission, university]);
    } finally {
      await db.query("select set_config('request.jwt.claims', '', false)");
    }
  };

  const STUDENT = await mk("sam@txstate.edu", "Sam Student");
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  const CAMPUS = await mk("cam@txstate.edu", "Cam Campus");
  const BENCHED = await mk("ben@txstate.edu", "Ben Benched Admin");
  let OWNER = null;
  if (live) {
    OWNER = await mk("owner@txstate.edu", "Olivia Owner");
    await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $4), ($2, 'moderator', $4), ($3, 'admin', $4)", [ADMIN, MOD, BENCHED, OWNER]);
    await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'Benched while checking scopes')", [BENCHED]);
  } else {
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'admin'), ($2, 'moderator')", [ADMIN, MOD]);
  }
  for (const u of [ADMIN, MOD, CAMPUS, ...(OWNER ? [OWNER] : [])]) await as(u, () => val("select 1"), MFA);
  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
  const OTHER = await val("select id from public.universities where id <> $1 order by name limit 1", [TX]);
  const addCampusAdmin = () =>
    live
      ? db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'campus_admin', $2)", [CAMPUS, OWNER])
      : db.query("insert into public.staff_members (user_id, role) values ($1, 'campus_admin')", [CAMPUS]);

  // ---------------------------------------------------------------------------
  // Before
  // ---------------------------------------------------------------------------
  await expectError(tag + "before 72 the staff list refuses the role campus_admin", addCampusAdmin, "check constraint");

  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // ---------------------------------------------------------------------------
  // The role, the campuses, what is closed
  // ---------------------------------------------------------------------------
  await expectOk(tag + "the staff list takes a campus admin, and a campus for them", async () => {
    await addCampusAdmin();
    await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [CAMPUS, TX]);
  });
  await expectError(tag + "a role nobody defined is still refused", () =>
    live ? db.query("insert into public.staff (user_id, role) values ($1, 'superadmin')", [STUDENT]) : db.query("insert into public.staff_members (user_id, role) values ($1, 'superadmin')", [STUDENT]),
  "check constraint");
  if (live) {
    await expectError(tag + "an owner cannot make anyone a campus admin through the API yet (set role)", () => asVal(OWNER, "select public.admin_staff_set_role($1, 'campus_admin')", [MOD]), "");
    await expectError(tag + "nor invite one", () => asVal(OWNER, "select public.admin_staff_add('newcampus@txstate.edu', 'campus_admin')"), "");
    await expectOk(tag + "the moderator is still a moderator", async () => {
      check((await val("select role from public.staff where user_id = $1", [MOD])) === "moderator", "role changed");
    });
  }
  for (const [who, uid] of [["a student", STUDENT], ["an admin", ADMIN], ["the campus admin", CAMPUS]]) {
    await expectError(tag + `${who} cannot read staff_campuses through the API`, () => asVal(uid, "select count(*) from public.staff_campuses"), "permission denied");
  }
  await expectError(tag + "nor write it", () => asVal(CAMPUS, "insert into public.staff_campuses (user_id, university_id) values ($1, $2) returning 1", [CAMPUS, OTHER]), "permission denied");
  for (const fn of ["staff_role_of($1)", "staff_role_permissions('admin')", "staff_require_can('audit.view')", "staff_can('audit.view')"]) {
    await expectError(tag + `the helper ${fn.split("(")[0]} cannot be called through the API`, () => asVal(ADMIN, `select public.${fn}`, fn.includes("$1") ? [ADMIN] : []), "permission denied");
  }
  await expectError(tag + "a visitor cannot ask admin_my_permissions()", () => asAnon(() => db.query("select public.admin_my_permissions()")), "permission denied");

  // ---------------------------------------------------------------------------
  // A campus admin has no power anywhere yet
  // ---------------------------------------------------------------------------
  await expectOk(tag + "the campus admin's own view: their role and campus, no permissions, not platform-wide", async () => {
    const p = await asVal(CAMPUS, "select public.admin_my_permissions()");
    check(p.role === "campus_admin" && p.platform === false && p.permissions.length === 0 && p.mfaVerified === true, JSON.stringify(p));
    check(p.universities.length === 1 && p.universities[0].id === TX && p.universities[0].name === "Texas State University", JSON.stringify(p.universities));
    check((await canFor(CAMPUS, "moderation.view", TX)) === false, "staff_can should refuse");
    check((await canFor(CAMPUS, "dashboard.view")) === false, "staff_can should refuse platform-wide");
  });
  for (const [what, sql] of [
    ["the audit feed", "select public.console_audit_feed()"],
    ["the Trust & Safety audit", "select public.console_audit(50, 0, '{}'::jsonb)"],
    ["the queue counts", "select public.console_queue_counts()"],
    ["people search", "select public.console_users('sam', 20, 0)"],
    ["university requests", "select public.console_university_requests()"],
    ["the events console", "select public.events_console_counts()"],
  ]) {
    await expectError(tag + `the campus admin is refused ${what}`, () => asVal(CAMPUS, sql), "not_found");
  }
  await expectOk(tag + "the campus admin is not an admin anywhere (admin_standing, is_admin)", async () => {
    check((await asVal(CAMPUS, "select public.admin_standing()")) === null, "admin_standing");
    check((await asVal(CAMPUS, "select public.is_admin()")) === false, "is_admin");
  });
  if (live) {
    await expectOk(tag + "admin_me() tells the campus admin who they are (their own row, as for anyone on the list)", async () => {
      const me = (await as(CAMPUS, () => db.query("select * from public.admin_me()"), MFA)).rows[0];
      check(me?.role === "campus_admin" && me.last_owner === false, JSON.stringify(me));
    });
    await expectError(tag + "the campus admin is refused CampConnect Admin's team list", () => as(CAMPUS, () => db.query("select * from public.admin_staff_list()"), MFA), "Not allowed");
    await expectError(tag + "and its user list", () => as(CAMPUS, () => db.query("select * from public.admin_users_list('all', 10, null)"), MFA), "Not allowed");
  }
  await expectOk(tag + "staff notices leave the campus admin out; the platform's staff still get them", async () => {
    const all = (await db.query("select x from public.ts_staff_ids(false) x")).rows.map((r) => r.x);
    const admins = (await db.query("select x from public.ts_staff_ids(true) x")).rows.map((r) => r.x);
    check(!all.includes(CAMPUS) && !admins.includes(CAMPUS), "the campus admin would be notified");
    check(all.includes(ADMIN) && all.includes(MOD) && admins.includes(ADMIN) && !admins.includes(MOD), `${all.length} / ${admins.length}`);
    if (live) check(admins.includes(OWNER), "the owner should be notified");
  });

  // ---------------------------------------------------------------------------
  // Owners, admins and moderators: unchanged, and the portal's table in SQL
  // ---------------------------------------------------------------------------
  await expectOk(tag + "admin_my_permissions() gives admins and moderators the portal's own permissions, platform-wide", async () => {
    const a = await asVal(ADMIN, "select public.admin_my_permissions()");
    const m = await asVal(MOD, "select public.admin_my_permissions()");
    check(a.role === "admin" && a.platform && same(a.permissions, PORTAL_ADMIN), `admin ${JSON.stringify(a.permissions)}`);
    check(m.role === "moderator" && m.platform && same(m.permissions, PORTAL_MODERATOR), `moderator ${JSON.stringify(m.permissions)}`);
    if (live) {
      const o = await asVal(OWNER, "select public.admin_my_permissions()");
      check(o.role === "owner" && same(o.permissions, PORTAL_ADMIN), `owner ${JSON.stringify(o.permissions)}`);
    }
  });
  await expectOk(tag + "staff_can(): the platform's roles anywhere, only what they are given", async () => {
    check((await canFor(MOD, "moderation.view", OTHER)) === true, "moderator, any campus");
    check((await canFor(MOD, "moderation.view")) === true, "moderator, platform-wide");
    check((await canFor(MOD, "universities.manage")) === false, "a moderator does not manage universities");
    check((await canFor(ADMIN, "audit.context", TX)) === true, "admin");
    check((await canFor(ADMIN, "everything")) === false, "an unknown permission");
    check((await canFor(STUDENT, "dashboard.view")) === false, "a student");
    check((await asVal(STUDENT, "select public.admin_my_permissions()")) === null, "a student has no staff view");
  });
  if (live) {
    await expectOk(tag + "a suspended admin has no permissions", async () => {
      check((await asVal(BENCHED, "select public.admin_my_permissions()")) === null, "admin_my_permissions");
      check((await canFor(BENCHED, "dashboard.view")) === false, "staff_can");
    });
  }
  await expectOk(tag + "the platform's staff keep their consoles (the feed, requests, the queue)", async () => {
    check(Array.isArray((await asVal(ADMIN, "select public.console_audit_feed()")).items), "admin feed");
    check((await asVal(MOD, "select public.console_audit_feed()")).contextVisible === false, "moderator feed");
    check((await asVal(ADMIN, "select public.console_university_requests()")).items !== undefined, "admin requests");
    check((await asVal(MOD, "select public.console_queue_counts()")) !== null, "moderator queue");
  });
  if (live) {
    await expectOk(tag + "CampConnect Admin's own functions answer the platform's staff as before", async () => {
      check((await as(ADMIN, () => db.query("select * from public.admin_me()"), MFA)).rows[0].role === "admin", "admin_me");
      check((await asVal(ADMIN, "select public.admin_standing()")) === "admin", "admin_standing");
    });
  }

  // staff_require_can(), as the scoped functions will call it (the database owner inside the caller's request).
  const requireCan = async (uid, permission, university = null, aal = "aal2") => {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, aal, role: "authenticated" })]);
    try {
      return await val("select public.staff_require_can($1, $2)", [permission, university]);
    } finally {
      await db.query("select set_config('request.jwt.claims', '', false)");
    }
  };
  await expectOk(tag + "staff_require_can() returns the role of someone allowed", async () => {
    check((await requireCan(MOD, "moderation.view", TX)) === "moderator", "moderator");
  });
  await expectError(tag + "staff_require_can() answers 'not found' to a permission not given", () => requireCan(MOD, "universities.manage"), "not_found");
  await expectError(tag + "and to a campus admin, for now", () => requireCan(CAMPUS, "moderation.view", TX), "not_found");
  await expectError(tag + "and asks an admin without the second factor for it", () => requireCan(ADMIN, "audit.view", null, "aal1"), "mfa_required");

  // The scope itself, as a scoped area will use it: give campus admins one permission here, as its migration would.
  await expectOk(tag + "once an area gives campus admins a permission, staff_can() holds them to their campuses, never platform-wide", async () => {
    await db.exec(`create or replace function public.staff_role_permissions(p_role text) returns text[] language sql immutable set search_path = public as $$
      select case p_role when 'campus_admin' then array['moderation.view'] when 'moderator' then array['moderation.view'] when 'admin' then array['moderation.view'] when 'owner' then array['moderation.view'] else array[]::text[] end $$`);
    check((await canFor(CAMPUS, "moderation.view", TX)) === true, "their campus");
    check((await canFor(CAMPUS, "moderation.view", OTHER)) === false, "another campus");
    check((await canFor(CAMPUS, "moderation.view")) === false, "platform-wide");
    check((await requireCan(CAMPUS, "moderation.view", TX)) === "campus_admin", "staff_require_can, their campus");
    await db.query("delete from public.staff_campuses where user_id = $1", [CAMPUS]);
    check((await canFor(CAMPUS, "moderation.view", TX)) === false, "a campus taken away");
    await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [CAMPUS, TX]);
    await db.exec(read(MIGRATION));
    check((await canFor(CAMPUS, "moderation.view", TX)) === false, "the migration's table is back");
  });
  await expectOk(tag + "no table links profiles and universities through its primary key (PostgREST would make every profile-to-university embed ambiguous)", async () => {
    const links = await db.query(`
      select c.conrelid::regclass::text as tbl, array_agg(distinct c.confrelid::regclass::text) as targets
      from pg_constraint c
      join pg_constraint pk on pk.conrelid = c.conrelid and pk.contype = 'p'
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.conkey <@ pk.conkey
      group by c.conrelid having array_agg(distinct c.confrelid::regclass::text) @> array['profiles', 'universities']`);
    check(links.rows.length === 0, JSON.stringify(links.rows));
  });
  await expectOk(tag + "a deleted account takes its campus assignments with it", async () => {
    const gone = await mk("gone@txstate.edu", "Gone Soon");
    await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [gone, TX]);
    await db.query("delete from auth.users where id = $1", [gone]);
    check((await val("select count(*)::int from public.staff_campuses where user_id = $1", [gone])) === 0, "left behind");
  });
  await expectOk(tag + "a deleted university takes its campus assignments with it", async () => {
    const u = await val("insert into public.universities (name) values ('Short-lived U') returning id");
    await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [CAMPUS, u]);
    await db.query("delete from public.universities where id = $1", [u]);
    check((await val("select count(*)::int from public.staff_campuses where user_id = $1", [CAMPUS])) === 1, "left behind");
  });

  // ---------------------------------------------------------------------------
  // Rollback, then a second apply
  // ---------------------------------------------------------------------------
  await expectError(tag + "the rollback refuses while a campus admin exists", () => db.exec(read(ROLLBACK)), "Rollback refused");
  await expectOk(tag + "without them, the rollback restores migration 41's resolvers and the role checks", async () => {
    await db.query("delete from public.staff_campuses");
    if (live) await db.query("delete from public.staff where role = 'campus_admin'");
    else await db.query("delete from public.staff_members where role = 'campus_admin'");
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    check((await val("select to_regprocedure('public.staff_can(text,uuid)') is null")) === true, "staff_can left behind");
    check((await val("select to_regclass('public.staff_campuses') is null")) === true, "staff_campuses left behind");
    check((await val("select public.ts_role_of($1)", [ADMIN])) === "admin" && (await val("select public.ts_role_of($1)", [MOD])) === "moderator", "the resolver");
    let refused = false;
    try {
      await addCampusAdmin();
    } catch (e) {
      refused = /check constraint/.test(e.message);
    }
    check(refused, "the role check should refuse campus_admin again");
  });
  await expectOk(tag + "applying it again works", async () => {
    await db.exec(read(MIGRATION));
    await addCampusAdmin();
    check((await asVal(CAMPUS, "select public.admin_my_permissions()")).role === "campus_admin", "after the second apply");
    check((await val("select public.ts_role_of($1)", [CAMPUS])) === null, "the resolver refuses again");
  });
}

done("STAFF SCOPES");
