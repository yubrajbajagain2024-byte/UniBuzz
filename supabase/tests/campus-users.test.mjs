// Migration 74 (users, suspensions and appeals scoped by campus, Phase 2c) against PGlite, in production's order
// (CampConnect Admin's users functions exist there) and in this repo's order (Trust & Safety's appeals only). Owners,
// admins and moderators get exactly the answers they got before 74 (compared whole), with one new rule: only an owner or
// an admin may suspend or lift a campus admin. A campus admin with a campus and a second factor lists, searches, opens,
// suspends and lifts only the verified students of their campuses: never a student verified elsewhere (whatever their
// profile says), never anyone on the staff, never someone unconfirmed; sees and decides only their own students' appeals,
// never one against a suspension, and is recorded as 'campus_admin'; a staff member's content leaves every campus. No
// campus, no second factor or a suspension refuse them. The helpers are closed, the grants kept, the table matches the
// portal's lib/permissions.ts (read from the file), and the rollback puts every function back exactly as it was
// (pg_get_functiondef); the actor_role checks are never touched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION } from "../../packages/shared/src/buzz/constants.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = "20261129000000_campus_users.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261129000000_campus_users.down.sql";
const BEFORE = fs.readdirSync(path.join(HERE, "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const MFA = { aal: "aal2" };
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

// The portal's own table (apps/admin/src/lib/permissions.ts) for the platform's roles. The campus admin's set is the
// one 74 gives (later migrations add to it; the newest one's suite compares it with the portal's CAMPUS_ADMIN list).
const portal = fs.readFileSync(path.join(HERE, "..", "..", "apps", "admin", "src", "lib", "permissions.ts"), "utf8");
const listIn = (text) => [...text.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]);
const PORTAL_CAMPUS_ADMIN = ["moderation.view", "users.view"];
const PORTAL_MODERATOR = listIn(/const MODERATOR: readonly Permission\[\] = \[([\s\S]*?)\];/.exec(portal)?.[1] ?? "");
if (PORTAL_CAMPUS_ADMIN.length < 2 || PORTAL_MODERATOR.length < 5) throw new Error("could not read the portal's permission table");
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const USERS = [
  "admin_users_list(text,integer,timestamp with time zone)",
  "admin_user_search(text,integer)",
  "admin_user_get(uuid)",
  "admin_restrictions_list(boolean,integer)",
  "admin_user_suspend(uuid,text,timestamp with time zone,text)",
  "admin_user_unsuspend(uuid,text)",
];
const ALWAYS = ["console_appeals(text,integer,integer)", "console_decide_appeal(uuid,text,text,bigint)", "staff_role_permissions(text)", "staff_content_university(text,uuid)"];

for (const live of [true, false]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  const { db, mk, as } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r ? r[Object.keys(r)[0]] : undefined;
  };
  const asVal = (uid, q, params = [], claims = MFA) => as(uid, () => val(q, params), claims);
  const asRows = (uid, q, params = [], claims = MFA) => as(uid, async () => (await db.query(q, params)).rows, claims);
  const SIGS = live ? [...USERS, ...ALWAYS] : ALWAYS;
  const definitions = async () => Object.fromEntries(await Promise.all(SIGS.map(async (s) => [s, await val("select pg_get_functiondef($1::regprocedure)", [`public.${s}`])])));
  const actorChecks = async () => (await db.query(`select c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid) as d from pg_constraint c
      where c.contype = 'c' and c.conrelid in ('public.audit_log'::regclass, 'public.moderation_actions'::regclass) and pg_get_constraintdef(c.oid) ~ 'actor_role' order by 1`)).rows.map((r) => r.d);

  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
  const OTHER = await val("select id from public.universities where id <> $1 order by name limit 1", [TX]);
  await db.query("update public.universities set email_domain = 'other.edu' where id = $1", [OTHER]);
  let n = 0;
  const student = async (name, domain, profileUni, opts) => {
    const uid = await mk(`u${++n}.${name.toLowerCase().replace(/\W+/g, "")}@${domain}`, name, opts);
    await db.query("update public.profiles set university_id = $2, created_at = now() - make_interval(days => 30, secs => $3) where id = $1", [uid, profileUni ?? (domain === "other.edu" ? OTHER : TX), n]);
    return uid;
  };
  const TXA = await student("Tia Texan", "txstate.edu");
  const TXB = await student("Tom Texan", "txstate.edu");
  const OTA = await student("Oscar Other", "other.edu");
  const SPOOF = await student("Sly Spoofer", "other.edu", TX);
  const PENDING = await student("Pat Unconfirmed", "txstate.edu", TX, { confirmed: false });

  // Staff, on the list each schema has.
  const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  const CAMPUS = await mk("cam@txstate.edu", "Cam Campus");
  const CAMPUS2 = await mk("cara@txstate.edu", "Cara Campus");
  const NOCAMPUS = await mk("nell@txstate.edu", "Nell No Campus");
  const BENCHED = await mk("ben@txstate.edu", "Ben Benched");
  if (live) {
    await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $3), ($2, 'moderator', $3)", [ADMIN, MOD, OWNER]);
    await db.query("insert into public.staff (user_id, role, granted_by) select x, 'campus_admin', $1 from unnest($2::uuid[]) x", [OWNER, [CAMPUS, CAMPUS2, NOCAMPUS, BENCHED]]);
    await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'Benched while checking scopes')", [BENCHED]);
  } else {
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'admin'), ($2, 'moderator')", [ADMIN, MOD]);
    await db.query("insert into public.staff_members (user_id, role) select x, 'campus_admin' from unnest($1::uuid[]) x", [[CAMPUS, CAMPUS2, NOCAMPUS]]);
  }
  await db.query("insert into public.staff_campuses (user_id, university_id) select x, $1 from unnest($2::uuid[]) x", [TX, [CAMPUS, CAMPUS2, BENCHED]]);
  for (const u of [OWNER, ADMIN, MOD, CAMPUS, CAMPUS2, NOCAMPUS, BENCHED]) await as(u, () => val("select 1"), MFA);

  // Sanctions and their appeals (as Trust & Safety records them): a warning and a suspension on Texas State students, a
  // warning elsewhere, a warning on a staff member.
  const sanction = async (user, kind) => {
    const s = await val("insert into public.user_sanctions (user_id, kind, actor_id) values ($1, $2, $3) returning id", [user, kind, MOD]);
    return val("insert into public.appeals (user_id, sanction_id, text) values ($1, $2, 'Please look at this again, it was a joke between friends.') returning id", [user, s]);
  };
  const A = { txWarning: await sanction(TXA, "warning"), txSuspension: await sanction(TXB, "suspension"), otherWarning: await sanction(OTA, "warning"), staffWarning: await sanction(CAMPUS2, "warning") };
  const appealIds = async (uid, claims = MFA) => (await asVal(uid, "select public.console_appeals('all', 100, 0)", [], claims)).items.map((i) => i.id);

  // A staff member's post: 73 places it on their verified campus, 74 on none.
  let staffPost = null;
  if (live) {
    await as(ADMIN, () => db.query("select public.buzz_v2_accept_gate($1)", [BUZZ_GUIDELINES_VERSION]));
    staffPost = await as(ADMIN, () => val("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Welcome week schedule') returning id", [ADMIN]));
  }

  // ---------------------------------------------------------------------------
  // Before 74
  // ---------------------------------------------------------------------------
  await expectError(tag + "before 74 a campus admin is refused appeals", () => asVal(CAMPUS, "select public.console_appeals()"), "not_found");
  if (live) {
    await expectError(tag + "and the user list", () => asRows(CAMPUS, "select * from public.admin_users_list('all', 200, null)"), "Not allowed");
    await expectOk(tag + "before 74 a moderator could suspend a campus admin (the rank test alone): suspended, then lifted", async () => {
      await asVal(MOD, "select public.admin_user_suspend($1, 'Checking the rank test', null, null)", [CAMPUS]);
      await asVal(MOD, "select public.admin_user_unsuspend($1, 'Done checking')", [CAMPUS]);
    });
    await expectOk(tag + "73 placed a staff member's post on their campus", async () => {
      check((await val("select public.staff_content_university('post', $1)", [staffPost])) === TX, "not placed");
    });
    // A suspension elsewhere, so the restriction lists have someone out of scope.
    await asVal(MOD, "select public.admin_user_suspend($1, 'Spam elsewhere', null, null)", [OTA]);
  }
  const platformView = async () => ({
    modAppeals: await asVal(MOD, "select public.console_appeals('all', 100, 0)"),
    adminAppeals: await asVal(ADMIN, "select public.console_appeals('open', 100, 0)"),
    ...(live
      ? {
          modUsers: await asRows(MOD, "select * from public.admin_users_list('all', 200, null)"),
          adminStaff: await asRows(ADMIN, "select * from public.admin_users_list('staff', 200, null)"),
          modSearch: await asRows(MOD, "select * from public.admin_user_search('Oscar', 20)"),
          ownerGet: await asVal(OWNER, "select public.admin_user_get($1)", [OTA]),
          modRestrictions: await asRows(MOD, "select * from public.admin_restrictions_list(false, 200)"),
        }
      : {}),
  });
  const before = await platformView();
  const defsBefore = await definitions();
  const checksBefore = await actorChecks();

  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // ---------------------------------------------------------------------------
  // The platform's staff, and the table
  // ---------------------------------------------------------------------------
  await expectOk(tag + "owners, admins and moderators get exactly the answers they got before 74", async () => {
    const after = await platformView();
    for (const k of Object.keys(before)) check(JSON.stringify(after[k]) === JSON.stringify(before[k]), `${k} changed`);
    check(before.modAppeals.items.length === 4, `the moderator saw ${before.modAppeals.items.length} appeals`);
  });
  await expectOk(tag + "the table: campus admins get moderation.view and users.view; the moderator keeps the portal's list", async () => {
    check(same(await val("select public.staff_role_permissions('campus_admin')"), PORTAL_CAMPUS_ADMIN), "campus admin");
    check(same(await val("select public.staff_role_permissions('moderator')"), PORTAL_MODERATOR), "moderator");
    check(same((await asVal(CAMPUS, "select public.admin_my_permissions()")).permissions, PORTAL_CAMPUS_ADMIN), "admin_my_permissions");
  });
  await expectOk(tag + "a person's campus: their verified one; none for anyone on the staff, the unconfirmed, or what does not exist", async () => {
    const uni = (u) => val("select public.staff_user_university($1)", [u]);
    check((await uni(TXA)) === TX && (await uni(OTA)) === OTHER && (await uni(SPOOF)) === OTHER, "students");
    for (const u of [...(live ? [OWNER] : []), ADMIN, MOD, CAMPUS, NOCAMPUS, PENDING, null, "00000000-0000-4000-8000-000000000000"]) check((await uni(u)) === null, `placed ${u}`);
    if (!live) check((await uni(OWNER)) === TX, "off the staff list here, the owner is a student");
    if (live) check((await val("select public.staff_content_university('post', $1)", [staffPost])) === null, "a staff member's post");
  });

  // ---------------------------------------------------------------------------
  // Appeals
  // ---------------------------------------------------------------------------
  await expectOk(tag + "appeals: a campus admin sees only their own students' (not another campus's, not a staff member's)", async () => {
    check(same(await appealIds(CAMPUS), [A.txWarning, A.txSuspension]), JSON.stringify(await appealIds(CAMPUS)));
    const items = (await asVal(CAMPUS, "select public.console_appeals('open', 100, 0)")).items;
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    check(byId[A.txWarning].canReview === true && byId[A.txSuspension].canReview === false, "canReview: a suspension is admin only");
  });
  await expectError(tag + "deciding another campus's appeal: not found", () => asVal(CAMPUS, "select public.console_decide_appeal($1, 'reversed', 'Looks fine on review', null)", [A.otherWarning]), "not_found");
  await expectError(tag + "deciding a staff member's appeal: not found", () => asVal(CAMPUS, "select public.console_decide_appeal($1, 'reversed', 'Looks fine on review', null)", [A.staffWarning]), "not_found");
  await expectError(tag + "an appeal against a suspension stays admin only", () => asVal(CAMPUS, "select public.console_decide_appeal($1, 'reversed', 'Looks fine on review', null)", [A.txSuspension]), "admin only");
  await expectError(tag + "appeals without the second factor: refused", () => appealIds(CAMPUS, { aal: "aal1" }), "mfa_required");
  await expectError(tag + "appeals for a campus admin without a campus: refused", () => appealIds(NOCAMPUS), "not_found");
  if (live) {
    await expectOk(tag + "deciding their own student's warning appeal works and is recorded as 'campus_admin'", async () => {
      const out = await asVal(CAMPUS, "select public.console_decide_appeal($1, 'reversed', 'A joke between friends, lifted', null)", [A.txWarning]);
      check(out.status === "reversed", JSON.stringify(out));
      check((await val("select lifted_by from public.user_sanctions where id = (select sanction_id from public.appeals where id = $1)", [A.txWarning])) === CAMPUS, "not lifted");
      const roles = (await db.query("select distinct actor_role from public.audit_log where actor_id = $1", [CAMPUS])).rows.map((r) => r.actor_role);
      check(JSON.stringify(roles) === '["campus_admin"]', JSON.stringify(roles));
    });
    await expectError(tag + "a suspended campus admin: refused appeals", () => appealIds(BENCHED), "not_found");
  }
  await expectOk(tag + "the other campus's and the staff member's appeals are untouched", async () => {
    for (const id of [A.otherWarning, A.staffWarning, A.txSuspension]) check((await val("select status from public.appeals where id = $1", [id])) === "open", id);
  });

  if (live) {
    // -------------------------------------------------------------------------
    // Users
    // -------------------------------------------------------------------------
    await expectOk(tag + "the user list: only their campus's verified students, never staff, the unconfirmed or someone verified elsewhere", async () => {
      const rows = await asRows(CAMPUS, "select * from public.admin_users_list('all', 200, null)");
      const ids = rows.map((r) => r.user_id);
      check(ids.includes(TXA) && ids.includes(TXB), "their students");
      for (const u of [OTA, SPOOF, PENDING, OWNER, ADMIN, MOD, CAMPUS, CAMPUS2]) check(!ids.includes(u), `listed ${u}`);
      check(rows.every((r) => r.email.endsWith("@txstate.edu") && r.staff_role === null), "an email or a staff role from elsewhere");
      check((await asRows(CAMPUS, "select * from public.admin_users_list('staff', 200, null)")).length === 0, "the staff filter");
      check((await asRows(CAMPUS, "select * from public.admin_users_list('unverified', 200, null)")).length === 0, "the unverified filter");
    });
    await expectOk(tag + "search: their students, not anyone else", async () => {
      check((await asRows(CAMPUS, "select * from public.admin_user_search('Tia', 20)")).map((r) => r.user_id).join() === TXA, "Tia");
      for (const q of ["Oscar", "Sly", "Ada", "Cara", "other.edu"]) check((await asRows(CAMPUS, "select * from public.admin_user_search($1, 20)", [q])).length === 0, q);
    });
    await expectOk(tag + "a student of theirs opens", async () => {
      check((await asVal(CAMPUS, "select public.admin_user_get($1)", [TXA])).email.endsWith("@txstate.edu"), "get");
    });
    for (const [who, uid] of [["a student of another campus", OTA], ["a student verified elsewhere naming their campus", SPOOF], ["a staff admin", ADMIN], ["another campus admin", CAMPUS2], ["someone unconfirmed", PENDING]]) {
      await expectError(tag + `${who}: not found`, () => asVal(CAMPUS, "select public.admin_user_get($1)", [uid]), "User not found");
    }
    await expectError(tag + "suspending a student of another campus: not found", () => asVal(CAMPUS, "select public.admin_user_suspend($1, 'Not their campus', null, null)", [OTA]), "User not found");
    await expectError(tag + "suspending another staff member: not found", () => asVal(CAMPUS, "select public.admin_user_suspend($1, 'Not theirs to do', null, null)", [CAMPUS2]), "User not found");
    await expectError(tag + "lifting another campus's suspension: not found", () => asVal(CAMPUS, "select public.admin_user_unsuspend($1, null)", [OTA]), "User not found");
    await expectOk(tag + "suspending and lifting their own student works", async () => {
      await asVal(CAMPUS, "select public.admin_user_suspend($1, 'Harassment in comments', null, null)", [TXA]);
      check((await val("select banned_until is not null from auth.users where id = $1", [TXA])) === true, "not banned");
      const mine = await asRows(CAMPUS, "select * from public.admin_restrictions_list(true, 200)");
      check(mine.length === 1 && mine[0].user_id === TXA, JSON.stringify(mine.map((r) => r.user_id)));
      await asVal(CAMPUS, "select public.admin_user_unsuspend($1, 'Talked it through')", [TXA]);
      check((await val("select banned_until from auth.users where id = $1", [TXA])) === null, "still banned");
      check((await asRows(CAMPUS, "select * from public.admin_restrictions_list(false, 200)")).every((r) => r.user_id === TXA), "another campus's history");
    });
    await expectOk(tag + "another campus's suspension stands", async () => {
      check((await val("select public.is_suspended($1)", [OTA])) === true, "lifted");
    });
    await expectError(tag + "now a moderator cannot suspend a campus admin", () => asVal(MOD, "select public.admin_user_suspend($1, 'Checking the rank test', null, null)", [CAMPUS]), "Not allowed");
    await expectOk(tag + "an admin still can, and lift it", async () => {
      await asVal(ADMIN, "select public.admin_user_suspend($1, 'Checking the rank test', null, null)", [CAMPUS2]);
      await expectError(tag + "  (meanwhile a moderator cannot lift it)", () => asVal(MOD, "select public.admin_user_unsuspend($1, null)", [CAMPUS2]), "Not allowed");
      await asVal(ADMIN, "select public.admin_user_unsuspend($1, 'Done checking')", [CAMPUS2]);
    });
    await expectError(tag + "users without the second factor: refused", () => asRows(CAMPUS, "select * from public.admin_users_list('all', 200, null)", [], { aal: "aal1" }), "Two-factor authentication required");
    await expectError(tag + "users for a campus admin without a campus: refused", () => asRows(NOCAMPUS, "select * from public.admin_users_list('all', 200, null)"), "Not allowed");
    await expectError(tag + "users for a suspended campus admin: refused", () => asRows(BENCHED, "select * from public.admin_users_list('all', 200, null)"), "Your account is suspended");
    await expectError(tag + "a staff member's post is out of every campus admin's reach", () => asVal(CAMPUS, "select public.admin_content_get('post', $1)", [staffPost]), "Content not found");
    for (const [what, sql, message] of [
      ["the content browser", "select * from public.admin_hidden_content_list(null, 50, null)", "Not allowed"],
      ["deleting content", `select public.admin_content_delete('post', '${staffPost}', 'Delete it')`, "Not allowed"],
      ["the staff list", "select * from public.admin_staff_list()", "Not allowed"],
      ["the queue", "select public.console_queue_counts()", "not_found"],
      ["the events console", "select public.events_console_counts()", "not_found"],
      ["lifting a Trust & Safety sanction", `select public.console_lift('${A.otherWarning}', 'Lifting it')`, "not_found"],
    ]) {
      await expectError(tag + `every other area still refuses them: ${what}`, () => asRows(CAMPUS, sql), message);
    }
    await expectOk(tag + "the six users functions keep their grants: signed-in callers, never visitors", async () => {
      for (const sig of USERS) {
        check((await val("select has_function_privilege('authenticated', $1::regprocedure, 'execute')", [`public.${sig}`])) === true, `${sig} authenticated`);
        check((await val("select has_function_privilege('anon', $1::regprocedure, 'execute')", [`public.${sig}`])) === false, `${sig} anon`);
      }
    });
  }
  for (const fn of [`staff_user_university('${TXA}')`, "ts_require_area('users.view')"]) {
    await expectError(tag + `the helper ${fn.split("(")[0]} cannot be called through the API`, () => asVal(ADMIN, `select public.${fn}`), "permission denied");
  }

  // ---------------------------------------------------------------------------
  // Rollback, then a second apply
  // ---------------------------------------------------------------------------
  await expectOk(tag + "the actor_role checks are as before (audit_log has none; moderation_actions keeps its own)", async () => {
    check(JSON.stringify(await actorChecks()) === JSON.stringify(checksBefore), JSON.stringify(await actorChecks()));
  });
  await expectOk(tag + "the rollback puts every function back word for word", async () => {
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    const after = await definitions();
    for (const sig of Object.keys(defsBefore)) check(after[sig] === defsBefore[sig], `${sig} differs after the rollback`);
    for (const helper of ["staff_user_university(uuid)", "ts_require_area(text)"]) check((await val("select to_regprocedure($1) is null", [`public.${helper}`])) === true, `${helper} left behind`);
    check(JSON.stringify(await actorChecks()) === JSON.stringify(checksBefore), "the actor_role checks changed");
  });
  await expectError(tag + "after the rollback a campus admin is refused appeals again", () => appealIds(CAMPUS), "not_found");
  await expectOk(tag + "applying it again works", async () => {
    await db.exec(read(MIGRATION));
    check((await appealIds(CAMPUS)).includes(A.txSuspension), "after the second apply");
  });
}

done("CAMPUS USERS");
