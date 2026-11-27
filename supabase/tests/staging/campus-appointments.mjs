// Migration 76 (appointing campus admins) rehearsed on the staging project through the real Supabase stack: Auth
// sessions with a TOTP second factor, the REST API and the portal's own queries (packages/shared admin.ts:
// appointCampusAdmin, setCampusAdminCampuses, getStaffCampuses). It needs 75 on staging and 76 not yet there. Before 76
// nobody can appoint a campus admin. Then 76 on its own, in one transaction with its public._migrations row, as
// production will take it: a staff admin and a moderator are refused; a staff owner made for the run (staging has no
// owner of its own to use) appoints an existing student at once with Texas State, sees them on the staff list with
// their campus, changes their campuses, and invites a new address as a campus admin (the invitation carries the
// campuses; an admin can neither resend nor withdraw it); the new campus admin gets campus.overview and their campus
// through admin_my_permissions(); an admin changing the campus admin to a moderator takes the campuses away; the
// helpers are closed. Then its rollback (refused while the invitation is pending, then run after withdrawing it), then
// 76 again so staging is left as production will be (with --restore it is left rolled back). Throwaway accounts made by
// the admin API (no email sent), everything the run made deleted, and every table's row count compared with the start
// (the append-only logs aside). Never runs against production: it refuses production's ref and any project not named
// as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/campus-appointments.mjs [--restore]
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
const NEEDS = "20261130000000_campus_events.sql";
const MIGRATION = "20261201000000_campus_appointments.sql";
const ROLLBACK = "supabase/rollbacks/20261201000000_campus_appointments.down.sql";
const adminQueries = await import(new URL("packages/shared/src/queries/admin.ts", ROOT));
const portal = read("apps/admin/src/lib/permissions.ts");
const listIn = (text) => [...text.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]);
const PORTAL_CAMPUS_ADMIN = listIn(/export const CAMPUS_ADMIN: readonly Permission\[\] = \[([\s\S]*?)\];/.exec(portal)?.[1] ?? "");
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
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const val = async (query) => { const row = (await sql(query))[0]; return row ? row[Object.keys(row)[0]] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };
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
console.log(`Staging project ${project.name}: campus appointments (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (!(await applied(NEEDS))) throw new Error(`${NEEDS} (migration 75) is not on staging: 76 needs it`);
if (await applied(MIGRATION)) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
if (!(await val("select to_regclass('public.staff_audit_log') is not null"))) throw new Error("Staging lacks CampConnect Admin's schema: it is not built like production");
const baseline = await counts();
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
const OTHER = await val(`select id from public.universities where id <> ${lit(TX)} order by name limit 1`);

async function account(name) {
  const email = `ca-${run}-${name}@txstate.edu`;
  const password = `Ca-${run}-${Math.random().toString(36).slice(2, 10)}!`;
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

const staffOwner = await account("staffowner");
const ownerSecret = await enrolAuthenticator(staffOwner.c);
const staffAdmin = await account("staffadmin");
const adminSecret = await enrolAuthenticator(staffAdmin.c);
const staffMod = await account("staffmod");
const modSecret = await enrolAuthenticator(staffMod.c);
const appointee = await account("appointee");
const appointeeSecret = await enrolAuthenticator(appointee.c);
const INVITED = `ca-${run}-invited@txstate.edu`;
await sql(`insert into public.staff (user_id, role) values (${lit(staffOwner.id)}, 'owner'), (${lit(staffAdmin.id)}, 'admin'), (${lit(staffMod.id)}, 'moderator')`);
const ownerAal2 = await session(staffOwner, ownerSecret);
const adminAal2 = await session(staffAdmin, adminSecret);
const modAal2 = await session(staffMod, modSecret);

// --- Before 76 -------------------------------------------------------------------------------------------------------
await check("before 76: nobody can appoint a campus admin (the function does not exist; the old paths refuse the role)", async () => {
  await refused(adminQueries.appointCampusAdmin(ownerAal2, { email: appointee.email, universityIds: [TX] }), /admin_campus_admin_add|Could not find|PGRST202/);
  await refused(adminQueries.addStaff(ownerAal2, { email: appointee.email, role: "campus_admin" }), /Invalid role/);
});

// --- 76 on its own ---------------------------------------------------------------------------------------------------
await check("76 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(MIGRATION), "no _migrations row");
});
await check("a staff admin and a moderator cannot appoint a campus admin", async () => {
  await refused(adminQueries.appointCampusAdmin(adminAal2, { email: appointee.email, universityIds: [TX] }), /Not allowed/);
  await refused(adminQueries.appointCampusAdmin(modAal2, { email: appointee.email, universityIds: [TX] }), /Not allowed/);
});
await check("an owner appoints an existing student at once with Texas State; the staff list shows the campus", async () => {
  expect((await adminQueries.appointCampusAdmin(ownerAal2, { email: appointee.email, universityIds: [TX] })) === "added", "not added");
  const c = await adminQueries.getStaffCampuses(modAal2);
  const mine = c.members.find((m) => m.userId === appointee.id);
  expect(mine && mine.universities.length === 1 && mine.universities[0].id === TX, JSON.stringify(c.members));
  expect((await val(`select role from public.staff where user_id = ${lit(appointee.id)}`)) === "campus_admin", "role");
});
await check("the new campus admin gets the portal's CAMPUS_ADMIN list and their campus", async () => {
  const p = await adminQueries.getMyStaffPermissions(await session(appointee, appointeeSecret));
  expect(p.role === "campus_admin" && same(p.permissions, PORTAL_CAMPUS_ADMIN) && p.universities.map((u) => u.id).join() === TX, JSON.stringify(p));
});
await check("an owner changes their campuses (audited); an admin cannot", async () => {
  await refused(adminQueries.setCampusAdminCampuses(adminAal2, appointee.id, [OTHER]), /Not allowed/);
  await adminQueries.setCampusAdminCampuses(ownerAal2, appointee.id, [TX, OTHER]);
  const n = await val(`select count(*)::int from public.staff_campuses where user_id = ${lit(appointee.id)}`);
  expect(n === 2, `${n} campuses`);
  expect((await val(`select count(*)::int from public.staff_audit_log where action = 'staff.campuses' and target_id = ${lit(appointee.id)}`)) === 1, "not audited");
});
await check("an owner invites a new address: the invitation carries the campuses; an admin can neither resend nor withdraw it", async () => {
  expect((await adminQueries.appointCampusAdmin(ownerAal2, { email: INVITED, universityIds: [TX] })) === "invited", "not invited");
  const c = await adminQueries.getStaffCampuses(ownerAal2);
  expect(c.invitations.some((i) => i.email === INVITED && i.universities[0]?.id === TX), JSON.stringify(c.invitations));
  expect((await adminQueries.getStaffCampuses(modAal2)).invitations.length === 0, "a moderator sees invitations (email addresses)");
  await refused(adminQueries.resendStaffInvite(adminAal2, INVITED), /Not allowed/);
  await refused(adminQueries.revokeStaffInvite(adminAal2, INVITED), /Not allowed/);
});
await check("an admin changing the campus admin to a moderator takes the campuses away", async () => {
  await adminQueries.setStaffRole(adminAal2, appointee.id, "moderator");
  expect((await val(`select count(*)::int from public.staff_campuses where user_id = ${lit(appointee.id)}`)) === 0, "campuses kept");
});
await check("the helpers are closed to the API", async () => {
  for (const [fn, args] of [["staff_valid_campuses", { p_universities: [TX] }], ["staff_campuses_follow_role", {}]]) {
    const { error } = await adminAal2.rpc(fn, args);
    expect(error && /permission denied|42501|PGRST202/i.test(`${error.code} ${error.message}`), `${fn}: ${error ? error.message : "answered"}`);
  }
});

// --- Rollback, then 76 again -----------------------------------------------------------------------------------------
await check("the rollback refuses while the invitation is pending; withdrawn, it runs", async () => {
  let refusedIt = false;
  try { await rollBack(); } catch (e) { refusedIt = /Rollback refused/.test(e.message); }
  expect(refusedIt && (await applied(MIGRATION)), "the rollback ran with a pending invitation");
  await adminQueries.revokeStaffInvite(ownerAal2, INVITED);
  await rollBack();
  expect(!(await applied(MIGRATION)), "the _migrations row is still there");
  await refused(adminQueries.appointCampusAdmin(ownerAal2, { email: appointee.email, universityIds: [TX] }), /admin_campus_admin_add|Could not find|PGRST202/);
});
if (!RESTORE) {
  await check("76 applies again after the rollback", async () => {
    await apply();
    expect(Array.isArray((await adminQueries.getStaffCampuses(ownerAal2)).members), "admin_staff_campuses after the second apply");
  });
}

// --- Cleanup ---------------------------------------------------------------------------------------------------------
await check("everything made is deleted; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.staff_invites where email like ${lit(`%${run}%`)}`);
  // The run's owner may be staging's only owner (staging keeps none of its own): the last-owner guard is set aside for
  // this one delete of the run's own rows, in its own transaction, and put back before it commits.
  await sql(`begin;
    alter table public.staff disable trigger staff_guard_last_owner;
    delete from public.staff_campuses where user_id in (${ours});
    delete from public.staff where user_id in (${ours});
    alter table public.staff enable trigger staff_guard_last_owner;
    commit;`);
  if (await val("select to_regclass('public.audit_request_context') is not null")) await sql(`delete from public.audit_request_context where actor_id in (${ours})`);
  const keptStaff = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours}) or target_id like ${lit(`%${run}%`)}`);
  const invited = await val(`select id from auth.users where email = ${lit(INVITED)}`);
  if (invited) accounts.push(invited);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + keptStaff };
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  console.log(`    ${keptStaff} log rows of this run stay (append-only)`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} campus appointments on staging: ${passes} passed, ${failures} failed; 76 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
