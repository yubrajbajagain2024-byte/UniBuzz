// Migration 77 (universities in the portal: campus details, sign-up domains opened by owners only) rehearsed on the
// staging project through the real Supabase stack: Auth sessions with a TOTP second factor and the REST API, calling the
// functions the portal's Campuses pages call. It needs 72 on staging and 77 not yet there. A throwaway staff owner,
// admin and moderator are made for the run (staging keeps no owner of its own). Before 77 there is no university
// console. Then 77 on its own, in one transaction with its public._migrations row, as production will take it: the admin
// lists the universities with their verified students and reads one; the moderator is refused; the admin changes a
// university's details and they are put back; the admin cannot open a domain; the owner cannot close Texas State's
// (confirmed accounts sign in with it), opens a throwaway domain on a university without one and closes it again; a
// public mail provider is refused; a profile's university is still embeddable. Then its rollback, then 77 again (with
// --restore it is left rolled back). Everything the run made or changed is put back and every table's row count
// compared with the start (the append-only logs aside). Never runs against production.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/university-console.mjs [--restore]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { enrolAuthenticator, passSecondFactor } from "./mfa.mjs";

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const RESTORE = process.argv.includes("--restore");
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This rehearsal applies and rolls back a migration: it never runs against production.");

const ROOT = new URL("../../../", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), "utf8");
const NEEDS = "20261127000000_staff_scopes.sql";
const MIGRATION = "20261202000000_university_console.sql";
const ROLLBACK = "supabase/rollbacks/20261202000000_university_console.down.sql";

async function mgmt(method, path, body) {
  for (let i = 0; ; i++) {
    const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if (r.ok) return text ? JSON.parse(text) : null;
    if (r.status < 500 || i >= 3) throw new Error(`${method} ${path.replace(REF, "<staging>")} -> ${r.status}: ${text.slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
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
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const val = async (query) => { const row = (await sql(query))[0]; return row ? row[Object.keys(row)[0]] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(error.message); return data; };
const refused = async (p, pattern) => {
  try { await p; } catch (e) { if (pattern.test(String(e?.message ?? e))) return; throw new Error(`refused with "${e?.message ?? e}", not ${pattern}`); }
  throw new Error(`answered, expected ${pattern}`);
};
async function counts() {
  const tables = (await sql("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).map((r) => r.relname);
  return Object.fromEntries((await sql(`select ${tables.map((t) => `(select count(*)::int from public."${t}") as "${t}"`).join(", ")}`)).map((r) => Object.entries(r))[0]);
}
const applied = async (name) => Boolean(await val(`select count(*)::int from public._migrations where name = ${lit(name)}`));
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
const accounts = [];
console.log(`Staging project ${project.name}: university console (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (!(await applied(NEEDS))) throw new Error(`${NEEDS} (migration 72) is not on staging: 77 needs it`);
if (await applied(MIGRATION)) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
const baseline = await counts();
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
const SPARE = (await sql("select id, name, short_name, city from public.universities where email_domain is null order by name limit 1"))[0];
if (!SPARE) throw new Error("No university without a sign-up domain on staging");
const DOMAIN = `uc-${run}.example.org`;

async function account(name) {
  const email = `uc-${run}-${name}@txstate.edu`;
  const password = `Uc-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name[0].toUpperCase()}${name.slice(1)} Rehearsal` } });
  if (error) throw new Error(`${name}: ${error.message}`);
  accounts.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(s.error.message);
  return { id: data.user.id, email, password, c };
}
async function session(u, secret) {
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (s.error) throw new Error(s.error.message);
  if (secret) await passSecondFactor(c, secret);
  return c;
}
const owner = await account("owner");
const ownerSecret = await enrolAuthenticator(owner.c);
const staffAdmin = await account("admin");
const adminSecret = await enrolAuthenticator(staffAdmin.c);
const mod = await account("mod");
const modSecret = await enrolAuthenticator(mod.c);
await sql(`insert into public.staff (user_id, role) values (${lit(owner.id)}, 'owner'), (${lit(staffAdmin.id)}, 'admin'), (${lit(mod.id)}, 'moderator')`);
const ownerAal2 = await session(owner, ownerSecret);
const adminAal2 = await session(staffAdmin, adminSecret);
const modAal2 = await session(mod, modSecret);

await check("before 77: there is no university console", async () => {
  await refused(rpc(adminAal2, "console_universities", {}), /console_universities|Could not find|PGRST202/);
});
await check("77 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(MIGRATION), "no _migrations row");
});
await check("the admin lists every university, Texas State with its verified students, and reads one; the moderator is refused", async () => {
  const list = await rpc(adminAal2, "console_universities", {});
  const tx = list.find((u) => u.id === TX);
  expect(tx && tx.emailDomain === "txstate.edu" && tx.verifiedStudents > 0, JSON.stringify(tx));
  expect((await rpc(adminAal2, "console_university", { p_id: SPARE.id })).name === SPARE.name, "one");
  await refused(rpc(modAal2, "console_universities", {}), /not_found/);
});
await check("the admin changes a university's details (audited), then they are put back", async () => {
  const out = await rpc(adminAal2, "console_update_university", { p_id: SPARE.id, p_patch: { city: `Rehearsal ${run}` } });
  expect(out.city === `Rehearsal ${run}`, JSON.stringify(out));
  await rpc(adminAal2, "console_update_university", { p_id: SPARE.id, p_patch: { city: SPARE.city } });
  expect((await val(`select city from public.universities where id = ${lit(SPARE.id)}`)) === SPARE.city, "not put back");
});
await check("sign-up domains: the admin cannot open one; the owner cannot close Texas State's; a public mail provider is refused", async () => {
  await refused(rpc(adminAal2, "console_set_university_domain", { p_id: SPARE.id, p_domain: DOMAIN }), /Only owners/);
  await refused(rpc(ownerAal2, "console_set_university_domain", { p_id: TX, p_domain: null }), /confirmed account/);
  await refused(rpc(ownerAal2, "console_set_university_domain", { p_id: SPARE.id, p_domain: "gmail.com" }), /public mail provider/);
});
await check("the owner opens a throwaway domain and closes it again (nobody signed in with it), both audited", async () => {
  expect((await rpc(ownerAal2, "console_set_university_domain", { p_id: SPARE.id, p_domain: DOMAIN })).emailDomain === DOMAIN, "not opened");
  expect((await rpc(ownerAal2, "console_set_university_domain", { p_id: SPARE.id, p_domain: null })).emailDomain === null, "not closed");
  expect((await val(`select count(*)::int from public.staff_audit_log where action = 'university.domain' and actor_id = ${lit(owner.id)}`)) === 2, "not audited");
});
await check("the apps' profile embeds still answer (a profile with its university)", async () => {
  const { data, error } = await staffAdmin.c.from("profiles").select("id, universities(name)").eq("id", staffAdmin.id).single();
  expect(!error && data?.universities?.name === "Texas State University", error ? `${error.code} ${error.message}` : JSON.stringify(data));
});
await check("the rollback runs: the console is gone, the data kept; then 77 again", async () => {
  await rollBack();
  await refused(rpc(adminAal2, "console_universities", {}), /console_universities|Could not find|PGRST202/);
  if (!RESTORE) {
    await apply();
    expect((await rpc(adminAal2, "console_universities", {})).length > 0, "after the second apply");
  }
});

await check("everything made is deleted; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  // The run's owner is staging's only owner: the last-owner guard is set aside for this one delete, in its own transaction.
  await sql(`begin;
    alter table public.staff disable trigger staff_guard_last_owner;
    delete from public.staff where user_id in (${ours});
    alter table public.staff enable trigger staff_guard_last_owner;
    commit;`);
  if (await val("select to_regclass('public.audit_request_context') is not null")) await sql(`delete from public.audit_request_context where actor_id in (${ours})`);
  const kept = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + kept };
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  console.log(`    ${kept} log rows of this run stay (append-only)`);
  expect(drift.length === 0, drift.join(", "));
  expect((await val(`select email_domain from public.universities where id = ${lit(SPARE.id)}`)) === null, "the spare university kept a domain");
});
console.log(`${failures ? "✗" : "✓"} university console on staging: ${passes} passed, ${failures} failed; 77 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
