// Migration 77 (universities in the UniBuzz Master Admin Portal, Phase 3) against PGlite, in production's order
// (CampConnect Admin's staff list: owners exist) and this repo's order (none do). Owners and admins list a university's
// details, verified students, feeds and events, and change its details (name unique, a real time zone, coordinates
// together), audited with what they were; moderators, campus admins, students and a session without the second factor
// are refused. Only owners open or close sign-up for a domain: a host name, never a public mail provider or one another
// university has; a domain confirmed accounts sign in with can be neither changed nor closed (their verified campus
// would vanish); opening one lets that domain sign up, audited. The helper is closed; the rollback drops what 77 added
// and keeps the data; a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = "20261202000000_university_console.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261202000000_university_console.down.sql";
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
  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
  const OTHER = await val("select id from public.universities where email_domain is null order by name limit 1");
  const OTHER_NAME = await val("select name from public.universities where id = $1", [OTHER]);

  const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  const CAMPUS = await mk("cam@txstate.edu", "Cam Campus");
  const STUDENT = await mk("sam@txstate.edu", "Sam Student");
  if (live) {
    await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $4), ($2, 'moderator', $4), ($3, 'campus_admin', $4)", [ADMIN, MOD, CAMPUS, OWNER]);
  } else {
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'admin'), ($2, 'moderator'), ($3, 'campus_admin')", [ADMIN, MOD, CAMPUS]);
  }
  await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [CAMPUS, TX]);
  for (const u of [OWNER, ADMIN, MOD, CAMPUS]) await as(u, () => val("select 1"), MFA);

  await expectError(tag + "before 77 there is no university console", () => asVal(ADMIN, "select public.console_universities()"), "does not exist");
  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // --- Reading ---------------------------------------------------------------------------------------------------------
  await expectOk(tag + "an admin lists every university, those with a sign-up domain first, with verified students, feeds and events", async () => {
    const list = await asVal(ADMIN, "select public.console_universities()");
    check(list.length === Number(await val("select count(*) from public.universities")), "not every university");
    check(list[0].emailDomain === "txstate.edu", "a domain first");
    const tx = list.find((u) => u.id === TX);
    check(tx.verifiedStudents === Number(await val("select count(*) from auth.users where email_confirmed_at is not null and email like '%@txstate.edu'")), `students ${tx.verifiedStudents}`);
    check(typeof tx.feeds === "number" && typeof tx.upcomingEvents === "number" && tx.timezone, JSON.stringify(tx));
    check((await asVal(ADMIN, "select public.console_universities('texas')")).some((u) => u.id === TX), "search");
    check((await asVal(ADMIN, "select public.console_university($1)", [TX])).name === "Texas State University", "one");
  });
  for (const [who, uid] of [["a moderator", MOD], ["a campus admin", CAMPUS], ["a student", STUDENT]]) {
    await expectError(tag + `${who} is refused the university console`, () => asVal(uid, "select public.console_universities()"), "not_found");
  }
  await expectError(tag + "an admin without the second factor is asked for it", () => asVal(ADMIN, "select public.console_universities()", [], { aal: "aal1" }), "mfa_required");
  await expectError(tag + "a university that does not exist: not found", () => asVal(ADMIN, "select public.console_university('00000000-0000-4000-8000-000000000000')"), "not_found");

  // --- Campus details ------------------------------------------------------------------------------------------------
  await expectOk(tag + "an admin changes a campus's details, audited with what they were; the domain is not touched", async () => {
    const out = await asVal(ADMIN, "select public.console_update_university($1, $2::jsonb)", [OTHER, JSON.stringify({ shortName: "Elsewhere", city: "Phoenix", country: "USA", timezone: "America/Phoenix", latitude: 33.42, longitude: -111.93 })]);
    check(out.shortName === "Elsewhere" && out.timezone === "America/Phoenix" && out.latitude === 33.42 && out.emailDomain === null, JSON.stringify(out));
    check((await val("select extensions.st_y(geog::extensions.geometry) from public.universities where id = $1", [OTHER])) > 33, "geog follows the coordinates");
    if (live) {
      const log = await one(db.query("select * from public.staff_audit_log where action = 'university.update' order by id desc limit 1"));
      check(log.actor_id === ADMIN && log.details.after.city === "Phoenix" && "city" in log.details.before, JSON.stringify(log.details));
    } else {
      check((await val("select count(*)::int from public.audit_log where action = 'university.update'")) === 1, "audited");
    }
  });
  await expectOk(tag + "clearing the coordinates together works", async () => {
    const out = await asVal(ADMIN, "select public.console_update_university($1, $2::jsonb)", [OTHER, JSON.stringify({ latitude: null, longitude: null })]);
    check(out.latitude === null && out.longitude === null, JSON.stringify(out));
  });
  for (const [what, patch, message] of [
    ["a one-letter name", { name: "X" }, "2 to 120"],
    ["another university's name", { name: "texas state university" }, "already has that name"],
    ["a time zone PostgreSQL does not know", { timezone: "Mars/Olympus" }, "time zone"],
    ["a latitude without a longitude", { latitude: 30 }, "both latitude and longitude"],
    ["coordinates off the globe", { latitude: 120, longitude: 10 }, "between -90 and 90"],
    ["a word for a latitude", { latitude: "north", longitude: 1 }, "numbers"],
    ["a 31-character short name", { shortName: "x".repeat(31) }, "under 30"],
  ]) {
    await expectError(tag + `refused: ${what}`, () => asVal(ADMIN, "select public.console_update_university($1, $2::jsonb)", [OTHER, JSON.stringify(patch)]), message);
  }
  await expectError(tag + "a moderator cannot change details", () => asVal(MOD, "select public.console_update_university($1, '{\"city\": \"X\"}'::jsonb)", [OTHER]), "not_found");

  // --- Sign-up domains -----------------------------------------------------------------------------------------------
  await expectError(tag + "an admin cannot open sign-up for a domain", () => asVal(ADMIN, "select public.console_set_university_domain($1, 'asu.edu')", [OTHER]), "Only owners");
  if (live) {
    for (const [what, domain, message] of [
      ["a public mail provider", "gmail.com", "public mail provider"],
      ["not a host name", "not a domain", "such as txstate.edu"],
      ["another university's domain", "txstate.edu", "already signs students in"],
    ]) {
      await expectError(tag + `refused: ${what}`, () => asVal(OWNER, "select public.console_set_university_domain($1, $2)", [OTHER, domain]), message);
    }
    await expectError(tag + "a domain confirmed accounts sign in with cannot be closed (their verified campus would vanish)", () => asVal(OWNER, "select public.console_set_university_domain($1, null)", [TX]), "confirmed account");
    await expectError(tag + "nor changed", () => asVal(OWNER, "select public.console_set_university_domain($1, 'txst.edu')", [TX]), "confirmed account");
    await expectOk(tag + "an owner opens sign-up for a domain (normalized), audited; that domain can now sign up", async () => {
      const out = await asVal(OWNER, "select public.console_set_university_domain($1, '  @ASU.edu ')", [OTHER]);
      check(out.emailDomain === "asu.edu", JSON.stringify(out));
      const log = await one(db.query("select * from public.staff_audit_log where action = 'university.domain' order by id desc limit 1"));
      check(log.actor_id === OWNER && log.details.from === null && log.details.to === "asu.edu", JSON.stringify(log.details));
      const uid = await mk("sparky@asu.edu", "Sparky Sun");
      check((await val("select public.verified_university($1)", [uid])) === OTHER, "the new domain's student is not placed");
    });
    await expectError(tag + "once someone signed in with it, the domain stays", () => asVal(OWNER, "select public.console_set_university_domain($1, null)", [OTHER]), "confirmed account");
    await expectOk(tag + "a domain nobody signed in with yet can be closed again, audited", async () => {
      const third = await val("select id from public.universities where email_domain is null order by name limit 1");
      await asVal(OWNER, "select public.console_set_university_domain($1, 'nobody-yet.edu')", [third]);
      const out = await asVal(OWNER, "select public.console_set_university_domain($1, null)", [third]);
      check(out.emailDomain === null, JSON.stringify(out));
      const log = await one(db.query("select * from public.staff_audit_log where action = 'university.domain' order by id desc limit 1"));
      check(log.details.from === "nobody-yet.edu" && log.details.to === null, JSON.stringify(log.details));
    });
    await expectError(tag + "an owner without the second factor is asked for it", () => asVal(OWNER, "select public.console_set_university_domain($1, 'x.edu')", [OTHER], { aal: "aal1" }), "mfa_required");
  } else {
    await expectError(tag + "without CampConnect Admin's staff list there are no owners: everyone is refused", () => asVal(ADMIN, "select public.console_set_university_domain($1, 'asu.edu')", [OTHER]), "Only owners");
  }
  await expectOk(tag + "the functions: signed-in callers, never visitors; the helper closed", async () => {
    for (const sig of ["console_universities(text)", "console_university(uuid)", "console_update_university(uuid,jsonb)", "console_set_university_domain(uuid,text)"]) {
      check((await val("select has_function_privilege('authenticated', $1::regprocedure, 'execute')", [`public.${sig}`])) === true, `${sig} authenticated`);
      check((await val("select has_function_privilege('anon', $1::regprocedure, 'execute')", [`public.${sig}`])) === false, `${sig} anon`);
    }
    check((await val("select has_function_privilege('authenticated', 'public.console_university_json(uuid)'::regprocedure, 'execute')")) === false, "helper");
  });

  // --- Rollback, then a second apply --------------------------------------------------------------------------------
  await expectOk(tag + "the rollback drops what 77 added and keeps the data; then the migration again", async () => {
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    check((await val("select to_regprocedure('public.console_universities(text)') is null")) === true, "left behind");
    check((await val("select city from public.universities where id = $1", [OTHER])) === "Phoenix", "data lost");
    await db.exec(read(MIGRATION));
    check((await asVal(ADMIN, "select public.console_universities()")).length > 0, "after the second apply");
  });
  check(OTHER_NAME, "no second university in the seed");
}

done("UNIVERSITY CONSOLE");
