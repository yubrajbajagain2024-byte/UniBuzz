// Migration 74 (users, suspensions and appeals scoped by campus) rehearsed on the staging project through the real
// Supabase stack: Auth sessions with a TOTP second factor, the REST API and the portal's own queries (packages/shared
// admin-dashboard and admin-moderation; appeals through Trust & Safety's console_appeals and console_decide_appeal).
// It needs 73 on staging and 74 not yet there. A second campus students can sign up from is opened for the run (a
// throwaway email domain on another university, put back at the end). Students of both campuses (one verified
// elsewhere naming Texas State on their profile), a staff admin, a staff moderator and two campus admins of Texas
// State; sanctions and appeals as Trust & Safety records them. Before 74 the campus admin is refused users and appeals.
// Then 74 on its own, in one transaction with its public._migrations row, as production will take it: the staff admin
// and moderator get the same answers as before; the campus admin lists, searches, opens, suspends and lifts only their
// own verified students (never another campus's, the student naming Texas State from elsewhere, or a staff member),
// sees only their students' appeals, decides a warning appeal (recorded as campus_admin) and not a suspension's; a
// moderator can no longer suspend a campus admin, an admin still can; a profile's university is still embeddable.
// Then its rollback (refused again), then 74 again so staging is left as production will be (with --restore it is
// left rolled back). Throwaway accounts made by the admin API (no email sent), everything the run made deleted, and
// every table's row count compared with the start (the append-only logs aside). Never runs against production: it
// refuses production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/campus-users.mjs [--restore]
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
const NEEDS = "20261128000000_campus_moderation.sql";
const MIGRATION = "20261129000000_campus_users.sql";
const ROLLBACK = "supabase/rollbacks/20261129000000_campus_users.down.sql";
const mod = await import(new URL("packages/shared/src/queries/admin-moderation.ts", ROOT));
const dash = await import(new URL("packages/shared/src/queries/admin-dashboard.ts", ROOT));
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
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(error.message); return data; };
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
const DOMAIN = `cu-${run}.example.edu`;
const accounts = [];
console.log(`Staging project ${project.name}: campus users (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (!(await applied(NEEDS))) throw new Error(`${NEEDS} (migration 73) is not on staging: 74 needs it`);
if (await applied(MIGRATION)) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
if (!(await val("select to_regclass('public.staff_audit_log') is not null"))) throw new Error("Staging lacks CampConnect Admin's schema: it is not built like production");
const baseline = await counts();
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
const OTHER = await val(`select id from public.universities where email_domain is null and id <> ${lit(TX)} order by name limit 1`);
if (!OTHER) throw new Error("No second university without a sign-up domain to open for the run");
await sql(`update public.universities set email_domain = ${lit(DOMAIN)} where id = ${lit(OTHER)}`);

async function account(name, domain = "txstate.edu") {
  const email = `cu-${run}-${name}@${domain}`;
  const password = `Cu-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name[0].toUpperCase()}${name.slice(1)} Cu${run}` } });
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

const txa = await account("txa");
const txb = await account("txb");
const ota = await account("ota", DOMAIN);
const spoof = await account("spoof", DOMAIN);
await sql(`update public.profiles set university_id = ${lit(TX)} where id in (${lit(txa.id)}, ${lit(txb.id)}, ${lit(spoof.id)});
           update public.profiles set university_id = ${lit(OTHER)} where id = ${lit(ota.id)}`);
const staffAdmin = await account("staffadmin");
const adminSecret = await enrolAuthenticator(staffAdmin.c);
const staffMod = await account("staffmod");
const modSecret = await enrolAuthenticator(staffMod.c);
const campus = await account("campus");
const campusSecret = await enrolAuthenticator(campus.c);
const campus2 = await account("campustwo");
await sql(`insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin'), (${lit(staffMod.id)}, 'moderator'), (${lit(campus.id)}, 'campus_admin'), (${lit(campus2.id)}, 'campus_admin');
           insert into public.staff_campuses (user_id, university_id) values (${lit(campus.id)}, ${lit(TX)}), (${lit(campus2.id)}, ${lit(TX)})`);
const adminAal2 = await session(staffAdmin, adminSecret);
const modAal2 = await session(staffMod, modSecret);
const campusAal2 = await session(campus, campusSecret);
const OURS = [txa, txb, ota, spoof, staffAdmin, staffMod, campus, campus2].map((u) => u.id);
const MINE = [txa.id, txb.id];

// Sanctions and appeals, as Trust & Safety records them (by the staff moderator).
const appeal = async (user, kind) => val(`with s as (insert into public.user_sanctions (user_id, kind, actor_id) values (${lit(user.id)}, ${lit(kind)}, ${lit(staffMod.id)}) returning id)
  insert into public.appeals (user_id, sanction_id, text) select ${lit(user.id)}, s.id, 'Please look at this again, it was a joke between friends.' from s returning id`);
const A = { txWarning: await appeal(txa, "warning"), txSuspension: await appeal(txb, "suspension"), otherWarning: await appeal(ota, "warning"), staffWarning: await appeal(campus2, "warning") };
const APPEALS = Object.values(A);
const ourUsers = async (c, filter = "all") => (await dash.listUsers(c, { filter, limit: 200 })).filter((u) => OURS.includes(u.userId));
const ourAppeals = async (c) => (await rpc(c, "console_appeals", { p_view: "all", p_limit: 100, p_offset: 0 })).items.filter((a) => APPEALS.includes(a.id));

// --- Before 74 -------------------------------------------------------------------------------------------------------
await check("before 74: the campus admin is refused users and appeals", async () => {
  await refused(dash.listUsers(campusAal2, { filter: "all" }), /Not allowed/);
  await refused(rpc(campusAal2, "console_appeals", { p_view: "all" }), /not_found/);
});
const beforeAdminUsers = JSON.stringify(await ourUsers(adminAal2));
const beforeModAppeals = JSON.stringify(await ourAppeals(modAal2));

// --- 74 on its own ---------------------------------------------------------------------------------------------------
await check("74 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(MIGRATION), "no _migrations row");
});
await check("the staff admin and moderator get the same answers as before 74", async () => {
  expect(JSON.stringify(await ourUsers(adminAal2)) === beforeAdminUsers, "the admin's users changed");
  expect(JSON.stringify(await ourAppeals(modAal2)) === beforeModAppeals, "the moderator's appeals changed");
});
await check("the campus admin's permissions are the portal's CAMPUS_ADMIN list", async () => {
  const p = await adminQueries.getMyStaffPermissions(campusAal2);
  expect(p.role === "campus_admin" && !p.platform && same(p.permissions, PORTAL_CAMPUS_ADMIN), JSON.stringify(p));
});
await check("users: of the run's accounts, exactly their own verified students; never a staff role", async () => {
  const rows = await ourUsers(campusAal2);
  expect(same(rows.map((r) => r.userId), MINE), `saw ${rows.length}`);
  expect((await dash.listUsers(campusAal2, { filter: "all", limit: 200 })).every((r) => r.staffRole === null), "a staff member listed");
  expect((await ourUsers(campusAal2, "staff")).length === 0, "the staff filter");
  expect(same((await mod.searchUsers(campusAal2, `Cu${run}`, 50)).map((r) => r.userId), MINE), "search");
});
await check("another campus's student, one naming Texas State from elsewhere, a staff member: not found", async () => {
  for (const u of [ota, spoof, staffAdmin, campus2]) await refused(mod.getUserDetail(campusAal2, u.id), /User not found/);
  expect((await mod.getUserDetail(campusAal2, txa.id)).email === txa.email, "their own student");
});
await check("suspensions: their own student suspended and lifted; another campus's or a staff member: not found", async () => {
  await refused(mod.suspendUser(campusAal2, ota.id, { reason: "Not their campus" }), /User not found/);
  await refused(mod.suspendUser(campusAal2, campus2.id, { reason: "Not theirs to do" }), /User not found/);
  await mod.suspendUser(campusAal2, txa.id, { reason: "Rehearsal suspension" });
  const mine = (await mod.listRestrictions(campusAal2, { activeOnly: true, limit: 200 })).filter((r) => OURS.includes(r.userId));
  expect(mine.length === 1 && mine[0].userId === txa.id, JSON.stringify(mine.map((r) => r.userId)));
  await mod.unsuspendUser(campusAal2, txa.id, "Rehearsal done");
  expect((await val(`select banned_until from auth.users where id = ${lit(txa.id)}`)) === null, "still banned");
});
await check("a moderator can no longer suspend a campus admin; an admin still can, and lift it", async () => {
  await refused(mod.suspendUser(modAal2, campus2.id, { reason: "Checking the rank rule" }), /Not allowed/);
  await mod.suspendUser(adminAal2, campus2.id, { reason: "Checking the rank rule" });
  await mod.unsuspendUser(adminAal2, campus2.id, "Done checking");
});
await check("appeals: only their own students'; another campus's not found; a suspension's admin only; a warning decided as campus_admin", async () => {
  const mine = await ourAppeals(campusAal2);
  expect(same(mine.map((a) => a.id), [A.txWarning, A.txSuspension]), `saw ${mine.length}`);
  await refused(rpc(campusAal2, "console_decide_appeal", { p_id: A.otherWarning, p_outcome: "reversed", p_note: "Rehearsal decision" }), /not_found/);
  await refused(rpc(campusAal2, "console_decide_appeal", { p_id: A.staffWarning, p_outcome: "reversed", p_note: "Rehearsal decision" }), /not_found/);
  await refused(rpc(campusAal2, "console_decide_appeal", { p_id: A.txSuspension, p_outcome: "reversed", p_note: "Rehearsal decision" }), /admin only/);
  expect((await rpc(campusAal2, "console_decide_appeal", { p_id: A.txWarning, p_outcome: "reversed", p_note: "Rehearsal decision" })).status === "reversed", "not decided");
  expect((await val(`select string_agg(distinct actor_role, ',') from public.audit_log where actor_id = ${lit(campus.id)}`)) === "campus_admin", "the recorded role");
});
await check("every other area still refuses the campus admin; the helpers are closed", async () => {
  await refused(rpc(campusAal2, "console_queue_counts", {}), /not_found/);
  await refused(rpc(campusAal2, "admin_staff_list", {}), /Not allowed/);
  for (const [fn, args] of [["staff_user_university", { p_user: txa.id }], ["ts_require_area", { p_permission: "users.view" }]]) {
    const { error } = await adminAal2.rpc(fn, args);
    expect(error && /permission denied|42501/i.test(`${error.code} ${error.message}`), `${fn}: ${error ? error.message : "answered"}`);
  }
});
await check("the apps' profile embeds still answer (a profile with its university)", async () => {
  const { data, error } = await txa.c.from("profiles").select("id, universities(name)").eq("id", txa.id).single();
  expect(!error && data?.universities?.name === "Texas State University", error ? `${error.code} ${error.message}` : JSON.stringify(data));
});

// --- Rollback, then 74 again -----------------------------------------------------------------------------------------
await check("the rollback runs: the campus admin is refused again; the staff admin unchanged", async () => {
  await rollBack();
  expect(!(await applied(MIGRATION)), "the _migrations row is still there");
  await refused(dash.listUsers(campusAal2, { filter: "all" }), /Not allowed/);
  await refused(rpc(campusAal2, "console_appeals", { p_view: "all" }), /not_found/);
  expect((await ourUsers(adminAal2)).length === OURS.length, "the admin lost users");
});
if (!RESTORE) {
  await check("74 applies again after the rollback", async () => {
    await apply();
    expect(same((await ourUsers(campusAal2)).map((r) => r.userId), MINE), "after the second apply");
  });
}

// --- Cleanup ---------------------------------------------------------------------------------------------------------
await check("everything made is deleted, the second campus closed again; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.appeals where id in (${APPEALS.map(lit).join(", ")}); delete from public.user_sanctions where user_id in (${ours})`);
  await sql(`delete from public.account_restrictions where user_id in (${ours})`);
  await sql(`delete from public.staff_campuses where user_id in (${ours}); delete from public.staff where user_id in (${ours})`);
  await sql(`update public.universities set email_domain = null where id = ${lit(OTHER)} and email_domain = ${lit(DOMAIN)}`);
  if (await val("select to_regclass('public.audit_request_context') is not null")) await sql(`delete from public.audit_request_context where actor_id in (${ours})`);
  const keptStaff = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours})`);
  const keptTs = await val(`select count(*)::int from public.audit_log where actor_id in (${ours}) or target_id in (${ours}) or target_id in (${APPEALS.map(lit).join(", ")})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + keptStaff, audit_log: baseline.audit_log + keptTs };
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  console.log(`    ${keptStaff + keptTs} log rows of this run stay (append-only)`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} campus users on staging: ${passes} passed, ${failures} failed; 74 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
