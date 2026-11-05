// Migration 67 (who is an admin for the business portal's staff actions) rehearsed on the staging project, through the
// real Supabase stack: Auth sessions (a TOTP second factor passed as Supabase Auth does it), the REST API and the app's
// own queries in packages/shared. Before 67, as production is: the admin role decides. Then 67 on its own, in one
// transaction with its public._migrations row, as production will take it; the business portal's admin tools then need
// a staff owner or admin, not suspended, signed in with a second factor (a staff admin without it is told to confirm it);
// then its rollback, which must give back migration 39's functions exactly and their behaviour; then 67 again, so
// staging is left as production will be (with --restore it is left rolled back). Throwaway accounts (confirmed
// txstate.edu accounts made by the admin API, no email sent); everything made is deleted at the end and every table's
// row count compared with the start. Never runs against production: it refuses production's ref and any project not
// named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/admin-authority.mjs [--restore]
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
const MIGRATION = "20261119000000_admin_authority.sql";
const ROLLBACK = "supabase/rollbacks/20261119000000_admin_authority.down.sql";
const q = await import(new URL("packages/shared/src/queries/business.ts", ROOT));

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
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const val = async (query) => { const row = (await sql(query))[0]; return row ? row[Object.keys(row)[0]] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };
/** The error of a supabase-js call, or null: what the website's server actions see. */
const errorOf = async (p) => { const { error } = await p; return error; };
async function counts() {
  const tables = (await sql("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).map((r) => r.relname);
  return Object.fromEntries((await sql(`select ${tables.map((t) => `(select count(*)::int from public."${t}") as "${t}"`).join(", ")}`)).map((r) => Object.entries(r))[0]);
}
/** The two functions 67 replaces and the one it adds, as the database prints them, with who may call them. */
const catalog = () => sql(`select p.proname as name, pg_get_functiondef(p.oid) as def,
    has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('is_admin', 'require_admin', 'admin_standing') order by 1`);
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
/** Milliseconds for 2,000 calls of is_admin() as a student, the cost row-level security pays per row. */
async function costOf(studentId) {
  const plan = await sql(`begin; set local role authenticated;
    select set_config('request.jwt.claims', json_build_object('sub', ${lit(studentId)}, 'role', 'authenticated')::text, true);
    explain (analyze, format json) select count(*) from generate_series(1, 2000) g where public.is_admin(); rollback;`);
  const row = plan.find((r) => r["QUERY PLAN"]) ?? plan[plan.length - 1];
  return Number((row["QUERY PLAN"] ?? Object.values(row)[0])[0]["Execution Time"]);
}

const run = Date.now().toString(36);
const accounts = [];
console.log(`Staging project ${project.name}: admin authority (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (await applied()) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
const baseline = await counts();
const before = await catalog();

/** A confirmed account signed in with its password: a session at aal1. */
async function account(name, meta = {}) {
  const email = `aa-${run}-${name}@txstate.edu`;
  const password = `Aa-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name[0].toUpperCase()}${name.slice(1)} Authority`, ...meta } });
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

// The people: a staff admin with an authenticator, an account with the admin role and no staff row (what migration 39
// trusts), a student; and a business waiting for review, its owner's sign-up.
const staffAdmin = await account("staffadmin");
const secret = await enrolAuthenticator(staffAdmin.c);
await sql(`select public.grant_role(${lit(staffAdmin.id)}, 'admin');
  insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin') on conflict (user_id) do update set role = excluded.role;`);
const roleOnly = await account("roleonly");
await sql(`select public.grant_role(${lit(roleOnly.id)}, 'admin')`);
const student = await account("student");
const owner = await account("owner", { account_type: "business", business_name: `Authority Cafe ${run}`, business_category: "food" });
const pending = async () => val(`select id from public.businesses where owner_id = ${lit(owner.id)}`);
const businessId = await pending();
const listBusinesses = (c) => errorOf(c.rpc("admin_list_businesses", { p_status: "pending" }));
const listAds = (c) => errorOf(c.rpc("admin_list_ads", { p_status: "pending_review" }));
const costBefore = await costOf(student.id);

// --- Before 67: staging as production is --------------------------------------------------------------------------------
await check("before 67: the admin role alone, signed in with a password, lists businesses and ads waiting for review", async () => {
  expect(businessId, "the owner's sign-up made no business");
  expect((await listBusinesses(roleOnly.c)) === null, "refused before 67");
  expect((await listAds(roleOnly.c)) === null, "refused before 67");
});
await check("before 67: the portal's own check (getAdminStanding) falls back to the role, as the website does", async () => {
  expect((await q.getAdminStanding(roleOnly.c, "admin")) === "admin", "no fallback to the role");
});

// --- 67 on its own --------------------------------------------------------------------------------------------------------
await check("67 applies on its own: the file and its _migrations row in one transaction", async () => {
  await apply();
  expect(await applied(), "no _migrations row");
  const names = (await catalog()).map((f) => f.name);
  expect(JSON.stringify(names) === JSON.stringify(["admin_standing", "is_admin", "require_admin"]), names.join(", "));
});
await check("after 67: the admin role alone is refused, with or without a password session", async () => {
  expect(/Only CampConnect admins/.test((await listBusinesses(roleOnly.c))?.message ?? ""), "the role alone still lists businesses");
  expect(/Only CampConnect admins/.test((await listAds(roleOnly.c))?.message ?? ""), "the role alone still lists ads");
  expect((await q.getAdminStanding(roleOnly.c, "admin")) === null, "the portal would let it in");
});
await check("after 67: a staff admin without the second factor is told to confirm it (hint MFA_REQUIRED), and the portal sends them to its two-factor page", async () => {
  const c = await session(staffAdmin);
  const e = await listBusinesses(c);
  expect(e && /authenticator app/.test(e.message) && e.hint === "MFA_REQUIRED", `got ${JSON.stringify(e)}`);
  expect((await q.getAdminStanding(c, "admin")) === "mfa_required", "standing");
});
await check("after 67: the same staff admin, past the second factor, lists, reviews and approves a business", async () => {
  const c = await session(staffAdmin, secret);
  expect((await q.getAdminStanding(c, "admin")) === "admin", "standing");
  expect((await listBusinesses(c)) === null, "refused");
  expect((await listAds(c)) === null, "refused");
  await q.adminReviewBusiness(c, businessId, "approved");
  expect((await val(`select status from public.businesses where id = ${lit(businessId)}`)) === "approved", "not approved");
});
await check("after 67: a suspended staff admin is refused even past the second factor; lifting it restores them", async () => {
  await sql(`insert into public.account_restrictions (user_id, reason) values (${lit(staffAdmin.id)}, 'Rehearsal: suspended staff')`);
  const c = await session(staffAdmin, secret);
  expect(/Only CampConnect admins/.test((await listBusinesses(c))?.message ?? ""), "a suspended staff admin listed businesses");
  await sql(`update public.account_restrictions set lifted_at = now() where user_id = ${lit(staffAdmin.id)} and lifted_at is null`);
  expect((await listBusinesses(c)) === null, "not restored after lifting");
});
await check("after 67: removed from the staff list, the admin role is not enough any more", async () => {
  await sql(`delete from public.staff where user_id = ${lit(staffAdmin.id)}`);
  const c = await session(staffAdmin, secret);
  expect(/Only CampConnect admins/.test((await listBusinesses(c))?.message ?? ""), "removed from staff but still an admin");
  await sql(`insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin')`);
});
await check("after 67: a student is refused and told nothing; a visitor cannot ask", async () => {
  expect(/Only CampConnect admins/.test((await listBusinesses(student.c))?.message ?? ""), "a student listed businesses");
  const { data, error } = await student.c.rpc("admin_standing");
  expect(!error && data === null, `a student's standing: ${JSON.stringify(data ?? error)}`);
  const anon = createClient(URL_, ANON, opts);
  expect(Boolean((await anon.rpc("admin_standing")).error), "a visitor called admin_standing");
});
let costAfter = 0;
await check("after 67: is_admin() stays cheap where row-level security calls it per row", async () => {
  costAfter = await costOf(student.id);
  console.log(`    2,000 calls as a student: ${costBefore.toFixed(1)} ms before 67, ${costAfter.toFixed(1)} ms after`);
  expect(costAfter < 500, `${costAfter} ms`);
});

// --- Rollback, then 67 again ------------------------------------------------------------------------------------------------
await check("67's rollback gives back migration 39's functions exactly (definitions and grants) and removes admin_standing", async () => {
  await rollBack();
  expect(!(await applied()), "the _migrations row is still there");
  const now = await catalog();
  expect(JSON.stringify(now) === JSON.stringify(before), `the functions differ from before the rehearsal: ${now.map((f) => f.name).join(", ")}`);
});
await check("after the rollback the admin role decides again, as on production today", async () => {
  expect((await listBusinesses(roleOnly.c)) === null, "the role alone is refused after the rollback");
  expect((await q.getAdminStanding(roleOnly.c, "admin")) === "admin", "the portal's fallback");
});
if (!RESTORE) {
  await check("67 applies again after the rollback, and the role alone is refused again", async () => {
    await apply();
    expect(/Only CampConnect admins/.test((await listBusinesses(roleOnly.c))?.message ?? ""), "the role alone still lists businesses");
  });
}

// --- Cleanup -----------------------------------------------------------------------------------------------------------------
await check("everything made is deleted; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.staff where user_id in (${ours})`);
  await sql(`delete from public.account_restrictions where user_id in (${ours})`);
  await sql(`delete from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours})`).catch(() => {});
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  // 67's own _migrations row is the one row this run keeps, unless --restore; the review's row in business_audit_log stays
  // too, since that log is append-only (a trigger refuses deletes), so the run adds exactly one there.
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), business_audit_log: baseline.business_audit_log + 1 };
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} admin authority on staging: ${passes} passed, ${failures} failed; 67 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
