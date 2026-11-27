// Migration 78 (one standing for the staff across both sanction systems) rehearsed on the staging project through the
// real Supabase stack: Auth sessions with a TOTP second factor and the REST API. It needs 72 on staging and 78 not yet
// there. A throwaway staff admin and moderator are made for the run. With an account-wide Trust & Safety suspension on
// the admin: before 78 their staff functions still answered; after it admin_my_permissions() answers nothing and the
// portal's, Trust & Safety's and the business console's functions refuse them, while the moderator (a Buzz-only ban
// and a mute) is unaffected; lifting the suspension gives the powers back. Then its rollback, then 78 again (with
// --restore it is left rolled back). Everything the run made is deleted and every table's row count compared with the
// start (the append-only logs aside). Never runs against production.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/staff-standing.mjs [--restore]
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
const MIGRATION = "20261203000000_staff_standing.sql";
const ROLLBACK = "supabase/rollbacks/20261203000000_staff_standing.down.sql";

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
const errorOf = async (p) => { const { error } = await p; return error; };
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
console.log(`Staging project ${project.name}: staff standing (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (!(await applied(NEEDS))) throw new Error(`${NEEDS} (migration 72) is not on staging: 78 needs it`);
if (await applied(MIGRATION)) throw new Error(`${MIGRATION} is already on staging: roll it back first to rehearse it`);
const baseline = await counts();

async function account(name) {
  const email = `ss78-${run}-${name}@txstate.edu`;
  const password = `Ss-${run}-${Math.random().toString(36).slice(2, 10)}!`;
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
const staffAdmin = await account("admin");
const adminSecret = await enrolAuthenticator(staffAdmin.c);
const mod = await account("mod");
const modSecret = await enrolAuthenticator(mod.c);
await sql(`insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin'), (${lit(mod.id)}, 'moderator')`);
// The sanctions, as Trust & Safety records them (written by the database owner; ts_apply_sanction would also end sessions).
const suspension = await val(`insert into public.user_sanctions (user_id, kind, scope, effective_at, expires_at) values (${lit(staffAdmin.id)}, 'suspension', 'all', now(), now() + interval '7 days') returning id`);
await sql(`insert into public.user_sanctions (user_id, kind, scope, effective_at) values (${lit(mod.id)}, 'ban', 'buzz_only', now()), (${lit(mod.id)}, 'mute', 'all', now())`);
const adminAal2 = await session(staffAdmin, adminSecret);
const modAal2 = await session(mod, modSecret);

await check("before 78: the suspended admin's staff functions still answer", async () => {
  expect((await adminAal2.rpc("admin_my_permissions")).data?.role === "admin", "admin_my_permissions");
});
await check("78 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(MIGRATION), "no _migrations row");
});
await check("after 78 the suspended admin has no staff permissions and every staff console refuses them", async () => {
  const p = await adminAal2.rpc("admin_my_permissions");
  expect(!p.error && p.data === null, JSON.stringify(p.data));
  const ts = await errorOf(adminAal2.rpc("console_queue_counts"));
  expect(ts && /not_found/.test(ts.message), `Trust & Safety: ${ts?.message ?? "answered"}`);
  const cc = await errorOf(adminAal2.rpc("admin_users_list", { p_filter: "all", p_limit: 5 }));
  expect(cc && /suspended/i.test(cc.message), `CampConnect Admin: ${cc?.message ?? "answered"}`);
  const biz = await errorOf(adminAal2.rpc("admin_list_ads", { p_status: null }));
  expect(biz && /Only CampConnect admins/.test(biz.message), `business: ${biz?.message ?? "answered"}`);
});
await check("the moderator (a Buzz-only ban and a mute) keeps their powers", async () => {
  expect((await modAal2.rpc("admin_my_permissions")).data?.role === "moderator", "permissions");
  expect(!(await errorOf(modAal2.rpc("console_queue_counts"))), "Trust & Safety");
});
await check("lifting the suspension gives the admin's powers back at once", async () => {
  await sql(`update public.user_sanctions set lifted_at = now() where id = ${lit(suspension)}`);
  expect((await adminAal2.rpc("admin_my_permissions")).data?.role === "admin", "permissions back");
  expect(!(await errorOf(adminAal2.rpc("console_queue_counts"))), "Trust & Safety back");
});
await check("the rollback runs, then 78 again", async () => {
  await rollBack();
  expect(!(await applied(MIGRATION)), "the _migrations row is still there");
  if (!RESTORE) await apply();
});

await check("everything made is deleted; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.user_sanctions where user_id in (${ours}); delete from public.staff where user_id in (${ours})`);
  if (await val("select to_regclass('public.audit_request_context') is not null")) await sql(`delete from public.audit_request_context where actor_id in (${ours})`);
  const keptStaff = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours})`);
  const keptTs = await val(`select count(*)::int from public.audit_log where actor_id in (${ours}) or target_id in (${ours})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + keptStaff, audit_log: baseline.audit_log + keptTs };
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  console.log(`    ${keptStaff + keptTs} log rows of this run stay (append-only)`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} staff standing on staging: ${passes} passed, ${failures} failed; 78 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
