// Migration 70 (universities added by the UniBuzz team, from students' requests) rehearsed on the staging project
// through the real Supabase stack: Auth sessions (a TOTP second factor passed as Supabase Auth does it), the REST API
// and the apps' own queries in packages/shared. Before 70, as production is: a signed-in student can write the
// universities table. Then 70 on its own, in one transaction with its public._migrations row, as production will take
// it: no API role writes universities (reading and sign-up unchanged), a student requests one, owners and admins of the
// staff with a second factor review it (a moderator and an admin without the factor refused), approving adds it without
// an email domain, each decision lands in the staff audit log. Then its rollback (students back to a name, a city and
// a country, never a domain), then 70 again so staging is left as production will be (with --restore it is left rolled
// back). Throwaway accounts (confirmed txstate.edu accounts made by the admin API, no email sent); everything made is
// deleted at the end and every table's row count compared with the start. Never runs against production: it refuses
// production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/university-requests.mjs [--restore]
import fs from "node:fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { enrolAuthenticator, passSecondFactor } from "./mfa.mjs";

// The shared sources import their siblings without an extension, as the bundlers resolve them (see packages/shared/tests).
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

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const RESTORE = process.argv.includes("--restore");
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This rehearsal applies and rolls back a migration: it never runs against production.");

const ROOT = new URL("../../../", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), "utf8");
const MIGRATION = "20261122000000_university_requests.sql";
const ROLLBACK = "supabase/rollbacks/20261122000000_university_requests.down.sql";
const q = await import(new URL("packages/shared/src/queries/universities.ts", ROOT));

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.replace(REF, "<staging>")} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const visitor = createClient(URL_, ANON, opts);
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const val = async (query) => { const row = (await sql(query))[0]; return row ? row[Object.keys(row)[0]] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };
/** The error of a supabase-js call, or null: what the apps see. */
const errorOf = async (p) => { const { error } = await p; return error; };
async function counts() {
  const tables = (await sql("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).map((r) => r.relname);
  return Object.fromEntries((await sql(`select ${tables.map((t) => `(select count(*)::int from public."${t}") as "${t}"`).join(", ")}`)).map((r) => Object.entries(r))[0]);
}
const applied = async () => Boolean(await val(`select count(*)::int from public._migrations where name = ${lit(MIGRATION)}`));
async function apply() {
  await sql(`begin;\n${read(`supabase/migrations/${MIGRATION}`)}\n;\ninsert into public._migrations (name) values (${lit(MIGRATION)});\ncommit;`);
  await sql("notify pgrst, 'reload schema'");
  await sleep(3000);
}
async function rollBack() {
  await sql(`begin;\n${read(ROLLBACK)}\n;\ndelete from public._migrations where name = ${lit(MIGRATION)};\ncommit;`);
  await sql("notify pgrst, 'reload schema'");
  await sleep(3000);
}

const run = Date.now().toString(36);
const DOMAIN = `rehearsal-${run}.invalid`;
const accounts = [];
const universitiesMade = [];
console.log(`Staging project ${project.name}: university requests (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (await applied()) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
if (!(await val("select to_regclass('public.staff') is not null"))) throw new Error("Staging lacks CampConnect Admin's staff list: it is not built like production");
const baseline = await counts();

/** A confirmed account signed in with its password: a session at aal1. */
async function account(name) {
  const email = `ur-${run}-${name}@txstate.edu`;
  const password = `Ur-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name[0].toUpperCase()}${name.slice(1)} Rehearsal` } });
  if (error) throw new Error(error.message);
  accounts.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(s.error.message);
  return { id: data.user.id, email, password, c };
}
/** A fresh session for the account: aal1, or aal2 when its authenticator key is given. */
async function session(u, secret) {
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (s.error) throw new Error(s.error.message);
  if (secret) await passSecondFactor(c, secret);
  return c;
}

// The people: a student, a second student, a staff admin and a staff moderator, each staff member with an authenticator.
const student = await account("student");
const classmate = await account("classmate");
const staffAdmin = await account("staffadmin");
const adminSecret = await enrolAuthenticator(staffAdmin.c);
const staffMod = await account("staffmod");
const modSecret = await enrolAuthenticator(staffMod.c);
await sql(`insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin'), (${lit(staffMod.id)}, 'moderator') on conflict (user_id) do update set role = excluded.role`);
const adminAal2 = await session(staffAdmin, adminSecret);
const adminAal1 = await session(staffAdmin);
const modAal2 = await session(staffMod, modSecret);
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");

// --- Before 70: as production is today -----------------------------------------------------------------------------
await check("before 70: a signed-in student's insert into universities is accepted by the API (what 70 closes)", async () => {
  const { data, error } = await student.c.from("universities").insert({ name: `Before ${run} U`, email_domain: DOMAIN }).select("id").single();
  expect(!error && data?.id, `insert: ${error?.message}`);
  universitiesMade.push(data.id);
  await sql(`delete from public.universities where id = ${lit(data.id)}`);
});

// --- 70 on its own ---------------------------------------------------------------------------------------------------
await check("70 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(), "no _migrations row");
});
await check("after 70: a student's insert is refused, with an email domain or by name alone", async () => {
  const withDomain = await errorOf(student.c.from("universities").insert({ name: `Domain ${run} U`, email_domain: DOMAIN }));
  const nameOnly = await errorOf(student.c.from("universities").insert({ name: `Name ${run} U` }));
  expect(withDomain && nameOnly, `refused? ${withDomain?.message} / ${nameOnly?.message}`);
  expect(!(await val(`select count(*)::int from public.universities where name like ${lit(`%${run} U`)}`)), "a row was written");
});
await check("after 70: a student cannot change a university, nor a visitor add one", async () => {
  await student.c.from("universities").update({ email_domain: DOMAIN }).eq("id", TX);
  expect((await val(`select email_domain from public.universities where id = ${lit(TX)}`)) === "txstate.edu", "Texas State's domain changed");
  expect(await errorOf(visitor.from("universities").insert({ name: `Visitor ${run} U` })), "a visitor's insert went through");
});
await check("after 70: students and visitors read the list as before (the apps' own query)", async () => {
  const a = await q.listUniversities(student.c);
  const b = await q.listUniversities(visitor);
  expect(a.length > 10 && a.length === b.length && a.some((u) => u.id === TX), `${a.length} / ${b.length}`);
  expect((await q.universityIdForEmail(visitor, `someone@txstate.edu`)) === TX, "txstate.edu should still map to Texas State");
});
await check("after 70: Auth still refuses a sign-up outside the domains", async () => {
  const { data, error } = await admin.auth.admin.createUser({ email: `outsider-${run}@${DOMAIN}`, password: `Ur-${run}-outsider!`, email_confirm: true });
  if (data?.user?.id) accounts.push(data.user.id);
  expect(error, "the outsider was created");
});

// --- Students' requests ----------------------------------------------------------------------------------------------
let first, second, other;
await check("a student requests a missing university through the website's query; the text is tidied", async () => {
  first = await q.requestUniversity(student.c, { name: `  Rehearsal   ${run} College `, city: "Houston, TX", country: "United States", note: "Transferring" });
  expect(first.status === "pending" && first.name === `Rehearsal ${run} College` && !("requester" in first), JSON.stringify(first));
});
await check("a classmate may ask for the same name; the same student may not ask twice", async () => {
  second = await q.requestUniversity(classmate.c, { name: `Rehearsal ${run} College` });
  let refused = null;
  try { await q.requestUniversity(student.c, { name: `rehearsal ${run} college` }); } catch (e) { refused = e; }
  expect(refused && refused.code === "conflict", `refused: ${refused?.code} ${refused?.message}`);
});
await check("a university already listed is refused, in words written for people", async () => {
  let refused = null;
  try { await q.requestUniversity(student.c, { name: "texas state university" }); } catch (e) { refused = e; }
  expect(refused?.message === "That university is already in the list.", `${refused?.message}`);
});
await check("each student reads only their own requests; the table is closed to the API", async () => {
  const mine = await q.listMyUniversityRequests(student.c);
  const theirs = await q.listMyUniversityRequests(classmate.c);
  expect(mine.length === 1 && mine[0].id === first.id && theirs.length === 1 && theirs[0].id === second.id, `${mine.length} / ${theirs.length}`);
  expect(await errorOf(student.c.from("university_requests").select("*")), "the table answered a student");
  expect(await errorOf(visitor.rpc("request_university", { p_name: `Visitor ${run} College` })), "a visitor sent a request");
});

// --- The UniBuzz team's review ---------------------------------------------------------------------------------------
await check("a moderator with a second factor, an admin without it and a student are refused the review", async () => {
  expect(/not_found/.test((await errorOf(modAal2.rpc("console_university_requests", { p_status: "pending" })))?.message ?? ""), "moderator");
  expect(/mfa_required/.test((await errorOf(adminAal1.rpc("console_university_requests", { p_status: "pending" })))?.message ?? ""), "admin at aal1");
  expect(/not_found/.test((await errorOf(student.c.rpc("console_university_requests", { p_status: "pending" })))?.message ?? ""), "student");
  expect(/not_found/.test((await errorOf(modAal2.rpc("console_decide_university_request", { p_id: first.id, p_decision: "decline" })))?.message ?? ""), "moderator deciding");
});
await check("an admin with a second factor lists the pending requests, with who asked", async () => {
  const { data, error } = await adminAal2.rpc("console_university_requests", { p_status: "pending", p_limit: 100, p_offset: 0 });
  expect(!error, error?.message);
  const mine = data.items.find((r) => r.id === first.id);
  expect(mine && mine.requester.id === student.id && mine.samePending === 1, JSON.stringify(mine));
});
await check("approving adds the university without an email domain, answers the classmate too, and writes the audit log", async () => {
  const { data, error } = await adminAal2.rpc("console_decide_university_request", { p_id: first.id, p_decision: "approve", p_name: `Rehearsal ${run} College`, p_response: "Added." });
  expect(!error && data.status === "approved" && data.universityId, error?.message ?? JSON.stringify(data));
  universitiesMade.push(data.universityId);
  expect((await val(`select coalesce(email_domain, 'none') from public.universities where id = ${lit(data.universityId)}`)) === "none", "a domain was set");
  const theirs = (await q.listMyUniversityRequests(classmate.c))[0];
  expect(theirs.status === "approved" && theirs.universityId === data.universityId, JSON.stringify(theirs));
  expect((await q.listUniversities(student.c)).some((u) => u.id === data.universityId), "students should see it");
  const rows = await val(`select count(*)::int from public.staff_audit_log where actor_id = ${lit(staffAdmin.id)} and action in ('university.create', 'university_request.approve')`);
  expect(rows === 2, `${rows} audit rows`);
});
await check("declining closes a request with the reply the student reads", async () => {
  other = await q.requestUniversity(student.c, { name: `Declined ${run} Institute` });
  const { error } = await adminAal2.rpc("console_decide_university_request", { p_id: other.id, p_decision: "decline", p_response: "Not yet." });
  expect(!error, error?.message);
  const mine = (await q.listMyUniversityRequests(student.c)).find((r) => r.id === other.id);
  expect(mine.status === "declined" && mine.response === "Not yet.", JSON.stringify(mine));
});

// --- Rollback, then 70 again -----------------------------------------------------------------------------------------
await check("the rollback refuses while requests exist", async () => {
  let refused = false;
  try { await rollBack(); } catch (e) { refused = /university_requests has rows/.test(e.message); }
  expect(refused && (await applied()), "the rollback ran with requests in the table");
});
await check("with this run's requests deleted, the rollback runs (another session's requests would stop it: then it says so)", async () => {
  await sql(`delete from public.university_requests where requested_by in (${accounts.map(lit).join(", ")})`);
  const leftover = await val("select count(*)::int from public.university_requests");
  expect(!leftover, `${leftover} requests from another session are on staging: export and remove them on purpose first`);
  await rollBack();
  expect(!(await applied()), "the _migrations row is still there");
});
await check("after the rollback a student adds a name, a city and a country, never an email domain", async () => {
  const { data, error } = await student.c.from("universities").insert({ name: `Rolled ${run} U`, city: "Waco, TX" }).select("id").single();
  expect(!error && data?.id, error?.message);
  universitiesMade.push(data.id);
  expect(await errorOf(student.c.from("universities").insert({ name: `Domain ${run} U`, email_domain: DOMAIN })), "a domain went in after the rollback");
});
if (!RESTORE) {
  await check("70 applies again after the rollback, and writes are closed again", async () => {
    await apply();
    expect(await errorOf(student.c.from("universities").insert({ name: `Again ${run} U` })), "an insert went through");
  });
}

// --- Cleanup ---------------------------------------------------------------------------------------------------------
await check("everything made is deleted; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  if (await val("select to_regclass('public.university_requests') is not null")) await sql(`delete from public.university_requests where requested_by in (${ours})`);
  if (universitiesMade.length) await sql(`delete from public.universities where id in (${universitiesMade.map(lit).join(", ")})`);
  await sql(`delete from public.staff where user_id in (${ours})`);
  await sql(`delete from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours})`).catch(() => {});
  // The staff audit log may refuse deletes (append-only); whatever stays of this run's rows is counted, not hidden.
  const keptAudit = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + keptAudit };
  if (!RESTORE) expected.university_requests = 0;
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  if (keptAudit) console.log(`    ${keptAudit} audit rows of this run stay (the log is append-only)`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} university requests on staging: ${passes} passed, ${failures} failed; 70 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
