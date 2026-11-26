// Migration 70 (universities added by the UniBuzz team, from students' requests) against PGlite, in this repo's order
// and in production's (boot({ live: true }), CampConnect Admin's staff list and suspensions). Before it a signed-in
// account can insert a university with any column, the sign-up email domain included. After it: no API role writes
// universities (everyone still reads them; the service role still writes); sign-up still follows the domains. A student
// asks for a missing university with request_university() (signed in, confirmed, not a business, not suspended, its
// limits, its conflicts) and reads only their own requests; the table is closed. Owners and admins of the staff in a
// two-factor session review them (moderators, students and admins without the second factor refused): approve (a
// university without an email domain, the other pending requests for the name answered), link, decline, each once,
// each in the audit log. A deleted account takes its requests. Then the rollback (refused while requests exist; after
// it students add a name, a city and a country, never a domain) and a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const NAME = "20261122000000_university_requests.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261122000000_university_requests.down.sql";
const BEFORE = fs
  .readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations"))
  .filter((f) => f.endsWith(".sql") && f < NAME)
  .sort()
  .at(-1);
const MFA = { aal: "aal2" };
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

for (const live of [false, true]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  const { db, mk, as, asAnon, asService } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r[Object.keys(r)[0]];
  };
  const json = (uid, q, params = [], claims = {}) => as(uid, () => val(q, params), claims);

  const STUDENT = await mk("sam@txstate.edu", "Sam Student");
  const OTHER = await mk("olu@txstate.edu", "Olu Other");
  const THIRD = await mk("tia@txstate.edu", "Tia Third");
  const UNCONFIRMED = await mk("una@txstate.edu", "Una Unconfirmed", { confirmed: false });
  const BUSINESS = await mk("biz@txstate.edu", "Bea Business");
  await db.query("select public.grant_role($1, 'business_owner')", [BUSINESS]);
  const BENCHED = await mk("ben@txstate.edu", "Ben Benched");
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  if (live) {
    const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
    await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $3), ($2, 'moderator', $3)", [ADMIN, MOD, OWNER]);
    await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'Checking requests while suspended')", [BENCHED]);
  } else {
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'admin'), ($2, 'moderator')", [ADMIN, MOD]);
    await db.query("insert into public.user_sanctions (user_id, kind, scope, origin, effective_at) values ($1, 'suspension', 'all', 'public', now())", [BENCHED]);
  }
  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");

  const request = (uid, name, city = null, country = null, note = null) =>
    json(uid, "select public.request_university($1, $2, $3, $4)", [name, city, country, note]);
  const mine = (uid) => json(uid, "select public.my_university_requests()");
  const list = (uid, status = "pending", claims = MFA) => json(uid, "select public.console_university_requests($1, 50, 0)", [status], claims);
  const decide = (uid, id, decision, opts = {}, claims = MFA) =>
    json(uid, "select public.console_decide_university_request($1, $2, $3, $4, $5, $6, $7)", [id, decision, opts.name ?? null, opts.city ?? null, opts.country ?? null, opts.university ?? null, opts.response ?? null], claims);
  const auditRows = (action) =>
    live
      ? val("select count(*)::int from public.staff_audit_log where action = $1", [action])
      : val("select count(*)::int from public.audit_log where action = $1", [action]);

  // ---------------------------------------------------------------------------
  // Before: what the migration closes
  // ---------------------------------------------------------------------------
  await expectOk(tag + "before: a signed-in account can add a university with an email domain, opening sign-up to it", async () => {
    await as(STUDENT, () => db.query("insert into public.universities (name, email_domain) values ('Before University', 'before.example')"));
    check((await val("select public.university_for_email('anyone@before.example')")) !== null, "the domain should have opened");
    await db.query("delete from public.universities where name = 'Before University'");
  });

  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // ---------------------------------------------------------------------------
  // The universities table
  // ---------------------------------------------------------------------------
  await expectError(tag + "a student cannot add a university with an email domain", () => as(STUDENT, () => db.query("insert into public.universities (name, email_domain) values ('Open Sesame U', 'gmail.com')")), "permission denied");
  await expectError(tag + "a student cannot add a university by name alone either", () => as(STUDENT, () => db.query("insert into public.universities (name) values ('Plain Name U')")), "permission denied");
  await expectError(tag + "a student cannot change a university", () => as(STUDENT, () => db.query("update public.universities set email_domain = 'gmail.com' where id = $1", [TX])), "permission denied");
  await expectError(tag + "a student cannot delete a university", () => as(STUDENT, () => db.query("delete from public.universities where id = $1", [TX])), "permission denied");
  await expectError(tag + "a visitor cannot add a university", () => asAnon(() => db.query("insert into public.universities (name) values ('Anon U')")), "permission denied");
  await expectOk(tag + "students and visitors still read the list; Texas State's domain still decides sign-up", async () => {
    const n = await as(STUDENT, () => val("select count(*)::int from public.universities"));
    const m = await asAnon(() => val("select count(*)::int from public.universities"));
    check(n > 10 && n === m, `read ${n} and ${m}`);
    check((await val("select public.university_for_email('new@txstate.edu')")) === TX, "txstate.edu should map to Texas State");
    check((await val("select public.university_for_email('anyone@gmail.com')")) === null, "gmail.com should map to nothing");
    await mk("newcomer@txstate.edu", "New Comer");
  });
  await expectError(tag + "sign-up with an address outside the domains is still refused", () => db.query("insert into auth.users (email, email_confirmed_at) values ('someone@gmail.com', now())"), "university email");
  await expectOk(tag + "the service role (the website's server, the setup script) still writes universities", async () => {
    await asService(() => db.query("insert into public.universities (name, city) values ('Service Added U', 'Austin, TX')"));
    await db.query("delete from public.universities where name = 'Service Added U'");
  });

  // ---------------------------------------------------------------------------
  // Students' requests
  // ---------------------------------------------------------------------------
  await expectError(tag + "a visitor cannot request a university", () => asAnon(() => db.query("select public.request_university('Anon U')")), "permission denied");
  await expectError(tag + "an unconfirmed account cannot request one", () => request(UNCONFIRMED, "Unconfirmed State"), "Confirm your email");
  await expectError(tag + "a business account cannot request one", () => request(BUSINESS, "Business College"), "Business accounts");
  await expectError(tag + "a suspended account cannot request one", () => request(BENCHED, "Benched Institute"), "forbidden");
  await expectError(tag + "a name shorter than 3 characters is refused", () => request(STUDENT, "  U "), "validation_failed");
  await expectError(tag + "a university already listed is refused, whatever its case", () => request(STUDENT, "texas state  university"), "already in the list");

  const first = await expectOk(tag + "a student asks for a missing university; the text is tidied", async () => {
    const r = await request(STUDENT, "  Lone   Star\tCollege ", "Houston, TX", "United States", "Transferring in spring");
    check(r.status === "pending" && r.name === "Lone Star College" && r.city === "Houston, TX" && r.note === "Transferring in spring", JSON.stringify(r));
    check(!("requester" in r) && !("decidedBy" in r), "the student's view should not carry staff fields");
    return r;
  });
  await expectError(tag + "the same student cannot ask twice for the same name", () => request(STUDENT, "lone star college"), "already asked");
  const second = await expectOk(tag + "another student may ask for the same name", () => request(OTHER, "Lone Star College", "Houston", null));
  await expectOk(tag + "a student reads only their own requests", async () => {
    const a = await mine(STUDENT);
    const b = await mine(OTHER);
    check(a.length === 1 && a[0].id === first.id, JSON.stringify(a));
    check(b.length === 1 && b[0].id === second.id, JSON.stringify(b));
    check((await mine(THIRD)).length === 0, "a third student should see none");
  });
  await expectError(tag + "the requests table is closed to students", () => as(STUDENT, () => db.query("select * from public.university_requests")), "permission denied");
  await expectError(tag + "and to visitors", () => asAnon(() => db.query("select * from public.university_requests")), "permission denied");
  await expectOk(tag + "a student may have 3 requests waiting, not 4", async () => {
    await request(STUDENT, "Prairie View A&M University");
    await request(STUDENT, "Sam Houston State University");
    let refused = false;
    try {
      await request(STUDENT, "Texas Southern University");
    } catch (e) {
      refused = /rate_limited/.test(e.message);
    }
    check(refused, "the fourth pending request should be refused");
  });
  await expectError(tag + "and 5 requests a day, decided or not", async () => {
    await db.query(
      "insert into public.university_requests (requested_by, name, status, decided_at) select $1, 'Old ' || g, 'declined', now() from generate_series(1, 5) g",
      [THIRD],
    );
    await request(THIRD, "Sixth Request College");
  }, "5 requests today");

  // ---------------------------------------------------------------------------
  // The UniBuzz team's review
  // ---------------------------------------------------------------------------
  await expectError(tag + "a student cannot list requests", () => list(STUDENT), "not_found");
  await expectError(tag + "a moderator cannot list requests", () => list(MOD), "not_found");
  await expectError(tag + "an admin without the second factor is asked for it", () => list(ADMIN, "pending", {}), "mfa_required");
  await expectError(tag + "a moderator cannot decide one", () => decide(MOD, first.id, "decline"), "not_found");
  await expectError(tag + "a student cannot decide one", () => decide(STUDENT, first.id, "approve"), "not_found");
  await expectError(tag + "a visitor cannot list requests", () => asAnon(() => db.query("select public.console_university_requests()")), "permission denied");

  await expectOk(tag + "an admin with the second factor lists pending requests, oldest first, with who asked and the same-name count", async () => {
    const page = await list(ADMIN);
    check(page.counts.pending === 4 && page.total === 4, JSON.stringify(page.counts));
    check(page.items[0].id === first.id && page.items[0].requester.id === STUDENT, "oldest first, with the requester");
    check(page.items[0].samePending === 1, `samePending ${page.items[0].samePending}`);
    check((await list(ADMIN, "declined")).counts.declined === 5, "the five old ones are declined");
  });
  await expectError(tag + "an unknown decision is refused", () => decide(ADMIN, first.id, "delete"), "validation_failed");
  await expectError(tag + "an unknown request is not found", () => decide(ADMIN, "00000000-0000-4000-8000-000000000000", "decline"), "not_found");
  await expectError(tag + "approving under a name already listed is refused", () => decide(ADMIN, first.id, "approve", { name: "Texas State University" }), "already listed");

  await expectOk(tag + "approving adds the university, never with an email domain, and answers the other request for the name", async () => {
    const r = await decide(ADMIN, first.id, "approve", { name: "Lone Star College–University Park", response: "Added. Pick it in your profile." });
    check(r.status === "approved" && r.universityId && r.decidedBy.id === ADMIN, JSON.stringify(r));
    const u = await one(db.query("select name, city, country, email_domain from public.universities where id = $1", [r.universityId]));
    check(u.name === "Lone Star College–University Park" && u.city === "Houston, TX" && u.email_domain === null, JSON.stringify(u));
    const theirs = (await mine(OTHER))[0];
    check(theirs.status === "approved" && theirs.universityId === r.universityId, JSON.stringify(theirs));
    const own = (await mine(STUDENT)).find((x) => x.id === first.id);
    check(own.response === "Added. Pick it in your profile." && own.universityName === u.name, JSON.stringify(own));
    check((await as(STUDENT, () => val("select count(*)::int from public.universities where id = $1", [r.universityId]))) === 1, "students should see the new university");
    check((await auditRows("university_request.approve")) === 1 && (await auditRows("university.create")) === 1, "audit rows for the decision and the university");
  });
  await expectError(tag + "a decided request cannot be decided again", () => decide(ADMIN, first.id, "decline"), "already decided");

  const pending = await list(ADMIN);
  const prairie = pending.items.find((x) => x.name === "Prairie View A&M University");
  const houston = pending.items.find((x) => x.name === "Sam Houston State University");
  await expectError(tag + "linking needs a university", () => decide(ADMIN, prairie.id, "link"), "Choose the university");
  await expectOk(tag + "linking points the request at a university already listed", async () => {
    const r = await decide(ADMIN, prairie.id, "link", { university: TX, response: "That one is already listed." });
    check(r.status === "approved" && r.universityId === TX, JSON.stringify(r));
    check((await auditRows("university_request.link")) === 1, "an audit row for the link");
  });
  await expectOk(tag + "declining closes the request with the reply the student reads", async () => {
    const r = await decide(ADMIN, houston.id, "decline", { response: "Not a campus we can support yet." });
    check(r.status === "declined" && r.universityId === null, JSON.stringify(r));
    const own = (await mine(STUDENT)).find((x) => x.id === houston.id);
    check(own.status === "declined" && own.response === "Not a campus we can support yet.", JSON.stringify(own));
    check((await auditRows("university_request.decline")) === 1, "an audit row for the decline");
  });
  await expectOk(tag + "the console functions answer students and visitors nothing about other people", async () => {
    const fns = await db.query(
      "select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('console_university_requests', 'console_decide_university_request', 'request_university', 'my_university_requests', 'university_request_json', 'university_request_text')",
    );
    check(fns.rows.length === 6 && fns.rows.every((f) => !f.anon), JSON.stringify(fns.rows));
    const helpers = await db.query(
      "select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('university_request_json', 'university_request_text') and has_function_privilege('authenticated', p.oid, 'execute')",
    );
    check(helpers.rows.length === 0, "the helpers should not be callable by students");
  });
  await expectOk(tag + "a deleted account takes its requests with it", async () => {
    const before = await val("select count(*)::int from public.university_requests where requested_by = $1", [OTHER]);
    check(before === 1, `before ${before}`);
    await db.query("delete from auth.users where id = $1", [OTHER]);
    check((await val("select count(*)::int from public.university_requests where requested_by = $1", [OTHER])) === 0, "requests should be gone");
  });

  // ---------------------------------------------------------------------------
  // Rollback, then the migration again
  // ---------------------------------------------------------------------------
  await expectError(tag + "the rollback refuses while requests exist", () => db.exec(read(ROLLBACK)), "university_requests has rows");
  await expectOk(tag + "with the requests deleted on purpose, the rollback runs", async () => {
    await db.query("delete from public.university_requests");
    await db.exec(read(ROLLBACK));
    check((await val("select to_regclass('public.university_requests')")) === null, "the table should be gone");
    check((await val("select to_regprocedure('public.request_university(text,text,text,text)')")) === null, "the function should be gone");
  });
  await expectOk(tag + "after the rollback a student adds a name, a city and a country (the old form) and the university stays readable", async () => {
    await as(STUDENT, () => db.query("insert into public.universities (name, city, country) values ('Rolled Back U', 'Waco, TX', 'United States')"));
    check((await val("select email_domain from public.universities where name = 'Rolled Back U'")) === null, "no domain");
  });
  await expectError(tag + "after the rollback a student still cannot set an email domain", () => as(STUDENT, () => db.query("insert into public.universities (name, email_domain) values ('Domain After Rollback', 'gmail.com')")), "permission denied");
  await expectError(tag + "nor coordinates", () => as(STUDENT, () => db.query("insert into public.universities (name, latitude, longitude) values ('Placed U', 1, 1)")), "permission denied");
  await expectError(tag + "nor change one", () => as(STUDENT, () => db.query("update public.universities set email_domain = 'gmail.com' where id = $1", [TX])), "permission denied");
  await expectOk(tag + "the migration applies again after its rollback and closes writes again", async () => {
    await db.exec(read(MIGRATION));
    let refused = false;
    try {
      await as(STUDENT, () => db.query("insert into public.universities (name) values ('Again U')"));
    } catch (e) {
      refused = /permission denied/.test(e.message);
    }
    check(refused, "the insert should be refused again");
    const r = await request(STUDENT, "Blinn College");
    check(r.status === "pending", JSON.stringify(r));
  });
}

done("UNIVERSITY REQUESTS (MIGRATION 70)");
