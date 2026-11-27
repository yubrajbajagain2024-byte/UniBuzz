// Migration 78 (one standing for the staff across both sanction systems, Phase 4) against PGlite, in production's order
// (CampConnect Admin's staff list, staff_require) and this repo's order (migration 41's staff_members). Before 78 an
// account-wide Trust & Safety suspension left a staff member's powers in place; after it the role, the portal's
// permissions, Trust & Safety's console, CampConnect Admin's functions and admin standing all go with it, and come back
// when it is lifted or expires. A Buzz-only ban, a mute, a warning and a suspension not yet in effect change nothing;
// a campus admin's campuses go with their role. The helper is closed; the rollback puts every function back word for
// word; a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = "20261203000000_staff_standing.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261203000000_staff_standing.down.sql";
const BEFORE = fs.readdirSync(path.join(HERE, "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const MFA = { aal: "aal2" };
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

for (const live of [true, false]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  const { db, mk, as } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r ? r[Object.keys(r)[0]] : undefined;
  };
  const asVal = (uid, q, params = [], claims = MFA) => as(uid, () => val(q, params), claims);
  const SIGS = ["staff_role_of(uuid)", "admin_standing()", ...(live ? ["staff_require(text,boolean)"] : [])];
  const definitions = async () => Object.fromEntries(await Promise.all(SIGS.map(async (s) => [s, await val("select pg_get_functiondef($1::regprocedure)", [`public.${s}`])])));
  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");

  const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  const CAMPUS = await mk("cam@txstate.edu", "Cam Campus");
  if (live) {
    await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $4), ($2, 'moderator', $4), ($3, 'campus_admin', $4)", [ADMIN, MOD, CAMPUS, OWNER]);
  } else {
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'admin'), ($2, 'moderator'), ($3, 'campus_admin')", [ADMIN, MOD, CAMPUS]);
  }
  await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [CAMPUS, TX]);
  for (const u of [...(live ? [OWNER] : []), ADMIN, MOD, CAMPUS]) await as(u, () => val("select 1"), MFA);
  const sanction = (user, kind, scope = "all", effective = "now()", expires = "now() + interval '7 days'") =>
    val(`insert into public.user_sanctions (user_id, kind, scope, effective_at, expires_at) values ($1, $2, $3, ${effective}, ${expires}) returning id`, [user, kind, scope]);
  const role = (u) => val("select public.staff_role_of($1)", [u]);

  // An account-wide suspension on the admin; harmless sanctions on the others.
  const SUSPENSION = await sanction(ADMIN, "suspension");
  await sanction(MOD, "ban", "buzz_only");
  await sanction(MOD, "mute");
  await sanction(MOD, "warning");
  const LATER = await sanction(CAMPUS, "suspension", "all", "now() + interval '1 day'");
  const defsBefore = await definitions();

  await expectOk(tag + "before 78 an account-wide Trust & Safety suspension left the admin's staff powers in place", async () => {
    check((await role(ADMIN)) === "admin", "the role");
    check((await asVal(ADMIN, "select public.console_queue_counts()")) !== null, "Trust & Safety's console");
  });
  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  await expectOk(tag + "after 78 the suspended admin has no staff role, no portal permissions, no admin standing", async () => {
    check((await role(ADMIN)) === null, "staff_role_of");
    check((await val("select public.ts_role_of($1)", [ADMIN])) === null, "ts_role_of");
    check((await asVal(ADMIN, "select public.admin_my_permissions()")) === null, "admin_my_permissions");
    check((await asVal(ADMIN, "select public.admin_standing()")) === null, "admin_standing");
  });
  await expectError(tag + "Trust & Safety's console refuses them", () => asVal(ADMIN, "select public.console_queue_counts()"), "not_found");
  await expectError(tag + "and the business console's admin check", () => as(ADMIN, () => db.query("select * from public.admin_list_ads(null)"), MFA), "Only CampConnect admins");
  if (live) {
    await expectError(tag + "and CampConnect Admin's functions, as suspended", () => as(ADMIN, () => db.query("select * from public.admin_users_list('all', 10, null)"), MFA), "Your account is suspended");
  }
  await expectOk(tag + "a Buzz-only ban, a mute and a warning leave the moderator's powers in place", async () => {
    check((await role(MOD)) === "moderator", "staff_role_of");
    check((await asVal(MOD, "select public.console_queue_counts()")) !== null, "Trust & Safety");
    if (live) check((await as(MOD, () => db.query("select * from public.admin_users_list('all', 10, null)"), MFA)).rows.length > 0, "CampConnect Admin");
  });
  await expectOk(tag + "a suspension not yet in effect changes nothing until it is; then the campus admin's campuses go with the role", async () => {
    check((await role(CAMPUS)) === "campus_admin", "before it takes effect");
    check(JSON.stringify(await val("select public.staff_campus_ids($1)", [CAMPUS])) === JSON.stringify([TX]), "campuses before");
    await db.query("update public.user_sanctions set effective_at = now() - interval '1 minute' where id = $1", [LATER]);
    check((await role(CAMPUS)) === null, "in effect");
    check(JSON.stringify(await val("select public.staff_campus_ids($1)", [CAMPUS])) === "[]", "campuses kept");
  });
  await expectOk(tag + "lifting the suspension gives the powers back at once; so does expiry", async () => {
    await db.query("update public.user_sanctions set lifted_at = now() where id = $1", [SUSPENSION]);
    check((await role(ADMIN)) === "admin", "after the lift");
    check((await asVal(ADMIN, "select public.admin_my_permissions()")).role === "admin", "permissions back");
    await db.query("update public.user_sanctions set expires_at = now() - interval '1 minute' where id = $1", [LATER]);
    check((await role(CAMPUS)) === "campus_admin", "after expiry");
  });
  if (live) {
    await expectOk(tag + "an account-wide ban on the owner ends their powers too", async () => {
      const ban = await sanction(OWNER, "ban", "all", "now()", "null");
      check((await role(OWNER)) === null && (await asVal(OWNER, "select public.admin_standing()")) === null, "owner");
      await db.query("update public.user_sanctions set lifted_at = now() where id = $1", [ban]);
      check((await role(OWNER)) === "owner", "owner back");
    });
  }
  await expectError(tag + "the helper cannot be called through the API", () => asVal(MOD, `select public.staff_sanctioned('${ADMIN}')`), "permission denied");

  await expectOk(tag + "the rollback puts every function back word for word; then the migration again", async () => {
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    const after = await definitions();
    for (const sig of Object.keys(defsBefore)) check(after[sig] === defsBefore[sig], `${sig} differs after the rollback`);
    check((await val("select to_regprocedure('public.staff_sanctioned(uuid)') is null")) === true, "helper left behind");
    await db.exec(read(MIGRATION));
    const again = await sanction(ADMIN, "suspension");
    check((await role(ADMIN)) === null, "after the second apply");
    await db.query("update public.user_sanctions set lifted_at = now() where id = $1", [again]);
  });
}

done("STAFF STANDING");
