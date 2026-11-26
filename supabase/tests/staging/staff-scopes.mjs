// Migration 72 (campus scopes for the staff, default deny) rehearsed on the staging project through the real Supabase
// stack: Auth sessions with a TOTP second factor, the REST API and the apps' own queries. Before 72 the staff list
// refuses the role campus_admin. Then 72 on its own, in one transaction with its public._migrations row, as production
// will take it: a campus admin with a campus and a second factor answered by admin_my_permissions() (their role and campus,
// no permissions) and refused everywhere else (the audit feed, the queue, university requests, the events console,
// CampConnect Admin's team list); admins and moderators unchanged, with the permissions the portal uses; nothing
// grants the role through the API; the new table and helpers closed. Then its rollback (refused while the campus admin
// exists, then run), then 72 again so staging is left as production will be (with --restore it is left rolled back).
// Throwaway accounts (confirmed txstate.edu accounts made by the admin API, no email sent), all deleted at the end, and
// every table's row count compared with the start. It also asks for a profile with its university as the apps do, since
// a table linking the two through its primary key would make that embed ambiguous to PostgREST. Never runs against production: it refuses production's ref and any
// project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/staff-scopes.mjs [--restore]
import fs from "node:fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { enrolAuthenticator, passSecondFactor } from "./mfa.mjs";

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
const MIGRATION = "20261127000000_staff_scopes.sql";
const ROLLBACK = "supabase/rollbacks/20261127000000_staff_scopes.down.sql";
const adminQueries = await import(new URL("packages/shared/src/queries/admin.ts", ROOT));
const portal = read("apps/admin/src/lib/permissions.ts");
const listIn = (text) => [...text.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]);
const PORTAL_MODERATOR = listIn(/const MODERATOR: readonly Permission\[\] = \[([\s\S]*?)\];/.exec(portal)?.[1] ?? "");
const PORTAL_ADMIN = [...PORTAL_MODERATOR, ...listIn(/const ADMIN: readonly Permission\[\] = \[\.\.\.MODERATOR,([\s\S]*?)\];/.exec(portal)?.[1] ?? "")];
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

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
const visitor = createClient(URL_, ANON, opts);
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
const accounts = [];
console.log(`Staging project ${project.name}: staff scopes (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (await applied()) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
if (!(await val("select to_regclass('public.staff') is not null"))) throw new Error("Staging lacks CampConnect Admin's staff list: it is not built like production");
const baseline = await counts();

async function account(name) {
  const email = `ss-${run}-${name}@txstate.edu`;
  const password = `Ss-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name[0].toUpperCase()}${name.slice(1)} Rehearsal` } });
  if (error) throw new Error(error.message);
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

const student = await account("student");
const staffAdmin = await account("staffadmin");
const adminSecret = await enrolAuthenticator(staffAdmin.c);
const staffMod = await account("staffmod");
const modSecret = await enrolAuthenticator(staffMod.c);
const campus = await account("campus");
const campusSecret = await enrolAuthenticator(campus.c);
await sql(`insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin'), (${lit(staffMod.id)}, 'moderator') on conflict (user_id) do update set role = excluded.role`);
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");

// --- Before 72 -------------------------------------------------------------------------------------------------------
await check("before 72: the staff list refuses the role campus_admin, and the API does not know admin_my_permissions", async () => {
  let refused = false;
  try { await sql(`insert into public.staff (user_id, role) values (${lit(campus.id)}, 'campus_admin')`); } catch (e) { refused = /check constraint|violates/i.test(e.message); }
  expect(refused, "the role went in before 72");
  const error = await errorOf(staffAdmin.c.rpc("admin_my_permissions"));
  expect(error && /PGRST202|Could not find/i.test(`${error.code} ${error.message}`), `${error?.code} ${error?.message}`);
});

// --- 72 on its own ---------------------------------------------------------------------------------------------------
await check("72 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(), "no _migrations row");
});
await check("the apps' profile embeds still answer through the API (a profile with its university, as the website and the app ask)", async () => {
  const { data, error } = await student.c.from("profiles").select("id, universities(name)").eq("id", student.id).single();
  expect(!error && data?.universities?.name === "Texas State University", error ? `${error.code} ${error.message}` : JSON.stringify(data));
});
await check("a campus admin can be put on the staff list (here by the database owner), with a campus", async () => {
  await sql(`insert into public.staff (user_id, role) values (${lit(campus.id)}, 'campus_admin')`);
  await sql(`insert into public.staff_campuses (user_id, university_id) values (${lit(campus.id)}, ${lit(TX)})`);
});
const adminAal2 = await session(staffAdmin, adminSecret);
const modAal2 = await session(staffMod, modSecret);
const campusAal2 = await session(campus, campusSecret);

await check("admin_my_permissions() (the shared query): the campus admin's role and campus, no permissions, not platform-wide", async () => {
  const p = await adminQueries.getMyStaffPermissions(campusAal2);
  expect(p.role === "campus_admin" && p.platform === false && p.permissions.length === 0 && p.mfaVerified === true, JSON.stringify(p));
  expect(p.universities.length === 1 && p.universities[0].id === TX, JSON.stringify(p.universities));
  expect(await errorOf(campusAal2.rpc("staff_can", { p_permission: "moderation.view", p_university: TX })), "staff_can is internal but answered");
});
await check("admins and moderators get the portal's own permissions, platform-wide; a student and a visitor get none", async () => {
  const a = await adminQueries.getMyStaffPermissions(adminAal2);
  const m = await adminQueries.getMyStaffPermissions(modAal2);
  expect(a.role === "admin" && a.platform && same(a.permissions, PORTAL_ADMIN), JSON.stringify(a.permissions));
  expect(m.role === "moderator" && m.platform && same(m.permissions, PORTAL_MODERATOR), JSON.stringify(m.permissions));
  expect((await adminQueries.getMyStaffPermissions(student.c)) === null, "a student has a staff view");
  expect(await errorOf(visitor.rpc("admin_my_permissions")), "a visitor was answered");
});
for (const [what, fn, args] of [
  ["the audit feed", "console_audit_feed", {}],
  ["the moderation queue counts", "console_queue_counts", {}],
  ["university requests", "console_university_requests", {}],
  ["the events console", "events_console_counts", {}],
]) {
  await check(`the campus admin is refused ${what}; an admin is answered`, async () => {
    const refused = await errorOf(campusAal2.rpc(fn, args));
    expect(refused && /not_found/.test(refused.message), `campus admin: ${refused?.message ?? "answered"}`);
    const answered = await errorOf(adminAal2.rpc(fn, args));
    expect(!answered, `admin: ${answered?.message}`);
  });
}
await check("CampConnect Admin's functions: admin_me tells the campus admin who they are; the team list refuses them", async () => {
  const me = await adminQueries.getMyStaffAccess(campusAal2);
  expect(me?.role === "campus_admin" && me.lastOwner === false, JSON.stringify(me));
  const error = await errorOf(campusAal2.rpc("admin_staff_list"));
  expect(error && /Not allowed/.test(error.message), error?.message ?? "answered");
  expect((await campusAal2.rpc("admin_standing")).data === null, "admin_standing");
});
await check("nothing grants the role through the API: an admin can neither set it nor invite with it", async () => {
  const set = await errorOf(adminAal2.rpc("admin_staff_set_role", { p_user_id: staffMod.id, p_role: "campus_admin" }));
  const invite = await errorOf(adminAal2.rpc("admin_staff_add", { p_email: `invite-${run}@txstate.edu`, p_role: "campus_admin" }));
  expect(set && invite, `set: ${set?.message}; invite: ${invite?.message}`);
  expect((await val(`select role from public.staff where user_id = ${lit(staffMod.id)}`)) === "moderator", "the moderator's role changed");
});
await check("the new table and helpers are closed to the API", async () => {
  expect(await errorOf(campusAal2.from("staff_campuses").select("*")), "the campus admin read staff_campuses");
  expect(await errorOf(adminAal2.from("staff_campuses").select("*")), "an admin read staff_campuses through the API");
  for (const [fn, args] of [["staff_role_of", { p_user: staffAdmin.id }], ["staff_role_permissions", { p_role: "admin" }], ["staff_require_can", { p_permission: "audit.view" }], ["staff_can", { p_permission: "audit.view" }]]) {
    const error = await errorOf(adminAal2.rpc(fn, args));
    expect(error && /permission denied|42501/i.test(`${error.code} ${error.message}`), `${fn}: ${error ? error.message : "answered"}`);
  }
});

// --- Rollback, then 72 again -----------------------------------------------------------------------------------------
await check("the rollback refuses while the campus admin exists", async () => {
  let refused = false;
  try { await rollBack(); } catch (e) { refused = /Rollback refused/.test(e.message); }
  expect(refused && (await applied()), "the rollback ran");
});
await check("without them it runs: the role refused again, the helpers gone, admins and moderators unchanged", async () => {
  await sql(`delete from public.staff_campuses where user_id = ${lit(campus.id)}`);
  await sql(`delete from public.staff where user_id = ${lit(campus.id)}`);
  const leftover = await val("select count(*)::int from public.staff where role = 'campus_admin'");
  expect(!leftover, `${leftover} campus admin(s) from another session are on staging: remove them on purpose first`);
  await rollBack();
  expect(!(await applied()), "the _migrations row is still there");
  let refused = false;
  try { await sql(`insert into public.staff (user_id, role) values (${lit(campus.id)}, 'campus_admin')`); } catch (e) { refused = /check constraint|violates/i.test(e.message); }
  expect(refused, "the role went in after the rollback");
  expect(await errorOf(adminAal2.rpc("admin_my_permissions")), "admin_my_permissions still answers");
  expect(!(await errorOf(adminAal2.rpc("console_audit_feed", {}))) && !(await errorOf(modAal2.rpc("console_queue_counts"))), "the platform's staff lost access");
});
if (!RESTORE) {
  await check("72 applies again after the rollback", async () => {
    await apply();
    expect((await adminQueries.getMyStaffPermissions(adminAal2))?.role === "admin", "admin_my_permissions after the second apply");
  });
}

// --- Cleanup ---------------------------------------------------------------------------------------------------------
await check("everything made is deleted; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  if (await val("select to_regclass('public.staff_campuses') is not null")) await sql(`delete from public.staff_campuses where user_id in (${ours})`);
  await sql(`delete from public.staff_invites where email like ${lit(`%${run}%`)}`);
  await sql(`delete from public.staff where user_id in (${ours})`);
  if (await val("select to_regclass('public.audit_request_context') is not null")) await sql(`delete from public.audit_request_context where actor_id in (${ours})`);
  const keptStaff = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours}) or target_id like ${lit(`%${run}%`)}`);
  const keptTs = await val(`select count(*)::int from public.audit_log where actor_id in (${ours}) or target_id in (${ours})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + keptStaff, audit_log: baseline.audit_log + keptTs };
  if (!RESTORE) expected.staff_campuses = 0;
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  console.log(`    ${keptStaff + keptTs} log rows of this run stay (append-only)`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} staff scopes on staging: ${passes} passed, ${failures} failed; 72 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
