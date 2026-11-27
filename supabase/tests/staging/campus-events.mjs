// Migration 75 (events, organizations and the content browser scoped by campus) rehearsed on the staging project
// through the real Supabase stack: Auth sessions with a TOTP second factor, the REST API and the functions the portal's
// Events and Content pages call (events_console_*, packages/shared listHiddenContent). It needs 74 on staging and 75
// not yet there. A second campus students can sign up from is opened for the run (a throwaway email domain on another
// university, put back at the end). A student of each campus starts an organization with a pending event; a staff
// admin adds a feed for each campus and hides one post by each student. Before 75 the campus admin is refused the
// events console and the content browser. Then 75 on its own, in one transaction with its public._migrations row, as
// production will take it: the staff admin and moderator get the same answers as before; the campus admin sees only
// their campus's events, organizations, feeds and counts, verifies their own organization (publishing its event,
// recorded as campus_admin), hides and restores their event, is told "not found" for the other campus's, cannot save or
// delete a feed, and sees only their students' hidden content; a profile's university is still embeddable. Then its
// rollback (refused again), then 75 again so staging is left as production will be (with --restore it is left rolled
// back). Throwaway accounts made by the admin API (no email sent), everything the run made deleted, and every table's
// row count compared with the start (the append-only logs aside). Never runs against production: it refuses
// production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/campus-events.mjs [--restore]
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
const NEEDS = "20261129000000_campus_users.sql";
const MIGRATION = "20261130000000_campus_events.sql";
const ROLLBACK = "supabase/rollbacks/20261130000000_campus_events.down.sql";
const dash = await import(new URL("packages/shared/src/queries/admin-dashboard.ts", ROOT));
const mod = await import(new URL("packages/shared/src/queries/admin-moderation.ts", ROOT));
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
const DOMAIN = `ce-${run}.example.edu`;
const accounts = [];
console.log(`Staging project ${project.name}: campus events (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (!(await applied(NEEDS))) throw new Error(`${NEEDS} (migration 74) is not on staging: 75 needs it`);
if (await applied(MIGRATION)) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
if (!(await val("select to_regclass('public.staff_audit_log') is not null"))) throw new Error("Staging lacks CampConnect Admin's schema: it is not built like production");
const baseline = await counts();
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
const OTHER = await val(`select id from public.universities where email_domain is null and id <> ${lit(TX)} order by name limit 1`);
if (!OTHER) throw new Error("No second university without a sign-up domain to open for the run");
await sql(`update public.universities set email_domain = ${lit(DOMAIN)} where id = ${lit(OTHER)}`);

async function account(name, domain = "txstate.edu") {
  const email = `ce-${run}-${name}@${domain}`;
  const password = `Ce-${run}-${Math.random().toString(36).slice(2, 10)}!`;
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
const insert = async (u, table, row) => {
  const { data, error } = await u.c.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
};

const txa = await account("txa");
const ota = await account("ota", DOMAIN);
await sql(`update public.profiles set university_id = ${lit(TX)} where id = ${lit(txa.id)}; update public.profiles set university_id = ${lit(OTHER)} where id = ${lit(ota.id)}`);
const staffAdmin = await account("staffadmin");
const adminSecret = await enrolAuthenticator(staffAdmin.c);
const staffMod = await account("staffmod");
const modSecret = await enrolAuthenticator(staffMod.c);
const campus = await account("campus");
const campusSecret = await enrolAuthenticator(campus.c);
await sql(`insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin'), (${lit(staffMod.id)}, 'moderator'), (${lit(campus.id)}, 'campus_admin');
           insert into public.staff_campuses (user_id, university_id) values (${lit(campus.id)}, ${lit(TX)})`);
const adminAal2 = await session(staffAdmin, adminSecret);
const modAal2 = await session(staffMod, modSecret);
const campusAal2 = await session(campus, campusSecret);

// Each campus's calendar and a hidden post by each campus's student.
const soon = new Date(Date.now() + 3 * 86400e3).toISOString();
const O = { tx: await insert(txa, "organizations", { name: `Rehearsal ${run} Robotics` }), other: await insert(ota, "organizations", { name: `Rehearsal ${run} Chess` }) };
const E = {
  tx: await insert(txa, "events", { organization_id: O.tx, title: `Rehearsal ${run} Races`, starts_at: soon, source: "organization" }),
  other: await insert(ota, "events", { organization_id: O.other, title: `Rehearsal ${run} Blitz`, starts_at: soon, source: "organization" }),
};
const feed = async (uni, name) => (await rpc(adminAal2, "events_console_feed_save", { p_feed: { university_id: uni, name, url: `https://calendar.example.edu/${run}-${name.replace(/\W+/g, "-")}.ics`, kind: "ics", enabled: false } })).id;
const FEEDS = { tx: await feed(TX, `Rehearsal ${run} TX`), other: await feed(OTHER, `Rehearsal ${run} Other`) };
const P = {
  tx: await insert(txa, "feed_posts", { author_id: txa.id, kind: "post", body: `Rehearsal ${run}: hidden on Texas State` }),
  other: await insert(ota, "feed_posts", { author_id: ota.id, kind: "post", body: `Rehearsal ${run}: hidden elsewhere` }),
};
for (const id of Object.values(P)) await mod.hideContent(adminAal2, "post", id, "Rehearsal hide");
const ORGS = Object.values(O), EVENTS = Object.values(E), FEED_IDS = Object.values(FEEDS), POSTS = Object.values(P);
const ourEvents = async (c) => (await rpc(c, "events_console_events", { p_filter: { upcoming: false, limit: 100, q: `Rehearsal ${run}` } })).items.filter((e) => EVENTS.includes(e.id));
const ourOrgs = async (c) => (await rpc(c, "events_console_organizations", { p_filter: { q: `Rehearsal ${run}` } })).filter((o) => ORGS.includes(o.id));
const ourFeeds = async (c) => (await rpc(c, "events_console_feeds", {})).filter((f) => FEED_IDS.includes(f.id));
const ourHidden = async (c) => (await dash.listHiddenContent(c, { limit: 200 })).filter((h) => POSTS.includes(h.targetId));

// --- Before 75 -------------------------------------------------------------------------------------------------------
await check("before 75: the campus admin is refused the events console and the content browser", async () => {
  await refused(rpc(campusAal2, "events_console_counts", {}), /not_found/);
  await refused(dash.listHiddenContent(campusAal2, { limit: 5 }), /Not allowed/);
});
const before = JSON.stringify({ e: await ourEvents(modAal2), o: await ourOrgs(modAal2), f: await ourFeeds(adminAal2), h: await ourHidden(modAal2) });

// --- 75 on its own ---------------------------------------------------------------------------------------------------
await check("75 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(MIGRATION), "no _migrations row");
});
await check("the staff admin and moderator get the same answers as before 75", async () => {
  const after = JSON.stringify({ e: await ourEvents(modAal2), o: await ourOrgs(modAal2), f: await ourFeeds(adminAal2), h: await ourHidden(modAal2) });
  expect(after === before, "changed");
});
await check("the campus admin's permissions are the portal's CAMPUS_ADMIN list", async () => {
  const p = await adminQueries.getMyStaffPermissions(campusAal2);
  expect(p.role === "campus_admin" && !p.platform && same(p.permissions, PORTAL_CAMPUS_ADMIN), JSON.stringify(p));
});
await check("events, organizations, feeds: only their campus's of the run; every row of every list on their campus", async () => {
  expect(same((await ourEvents(campusAal2)).map((e) => e.id), [E.tx]), "events");
  expect(same((await ourOrgs(campusAal2)).map((o) => o.id), [O.tx]), "organizations");
  expect(same((await ourFeeds(campusAal2)).map((f) => f.id), [FEEDS.tx]), "feeds");
  const all = await rpc(campusAal2, "events_console_events", { p_filter: { upcoming: false, limit: 100 } });
  expect(all.items.every((e) => e.university_id === TX), "an event from elsewhere");
  expect((await rpc(campusAal2, "events_console_organizations", { p_filter: {} })).every((o) => o.university_id === TX), "an organization from elsewhere");
  expect((await rpc(campusAal2, "events_console_feeds", {})).every((f) => f.university_id === TX), "a feed from elsewhere");
});
await check("another campus's organization and event: not found and untouched", async () => {
  await refused(rpc(campusAal2, "events_console_set_organization", { p_org: O.other, p_verified: true }), /not_found/);
  await refused(rpc(campusAal2, "events_console_set_event", { p_event: E.other, p_status: "hidden" }), /not_found/);
  expect((await val(`select verified from public.organizations where id = ${lit(O.other)}`)) === false, "verified");
  expect((await val(`select status from public.events where id = ${lit(E.other)}`)) === "pending", "changed");
});
await check("their own organization verified (its event published, recorded as campus_admin); their event hidden and restored", async () => {
  await rpc(campusAal2, "events_console_set_organization", { p_org: O.tx, p_verified: true, p_note: "Rehearsal" });
  expect((await val(`select status from public.events where id = ${lit(E.tx)}`)) === "scheduled", "not published");
  expect((await val(`select actor_role from public.audit_log where actor_id = ${lit(campus.id)} and action = 'organization.verify'`)) === "campus_admin", "the recorded role");
  await rpc(campusAal2, "events_console_set_event", { p_event: E.tx, p_status: "hidden" });
  await rpc(campusAal2, "events_console_set_event", { p_event: E.tx, p_status: "scheduled" });
});
await check("feeds stay admin only: the campus admin can neither save nor delete one", async () => {
  await refused(rpc(campusAal2, "events_console_feed_save", { p_feed: { university_id: TX, name: `Rehearsal ${run} theirs`, url: `https://calendar.example.edu/${run}-x.ics`, kind: "ics" } }), /not_found/);
  await refused(rpc(campusAal2, "events_console_feed_delete", { p_id: FEEDS.tx }), /not_found/);
});
await check("the content browser: only hidden content by their campus's students", async () => {
  expect(same((await ourHidden(campusAal2)).map((h) => h.targetId), [P.tx]), "hidden content");
});
await check("still refused: the queue, the staff list, university requests, the audit feed", async () => {
  for (const fn of ["console_queue_counts", "console_university_requests", "console_audit_feed"]) await refused(rpc(campusAal2, fn, {}), /not_found/);
  await refused(rpc(campusAal2, "admin_staff_list", {}), /Not allowed/);
});
await check("the apps' profile embeds still answer (a profile with its university)", async () => {
  const { data, error } = await txa.c.from("profiles").select("id, universities(name)").eq("id", txa.id).single();
  expect(!error && data?.universities?.name === "Texas State University", error ? `${error.code} ${error.message}` : JSON.stringify(data));
});

// --- Rollback, then 75 again -----------------------------------------------------------------------------------------
await check("the rollback runs: the campus admin is refused again; the staff admin unchanged", async () => {
  await rollBack();
  expect(!(await applied(MIGRATION)), "the _migrations row is still there");
  await refused(rpc(campusAal2, "events_console_counts", {}), /not_found/);
  expect((await ourOrgs(adminAal2)).length === 2, "the admin lost organizations");
});
if (!RESTORE) {
  await check("75 applies again after the rollback", async () => {
    await apply();
    expect(same((await ourOrgs(campusAal2)).map((o) => o.id), [O.tx]), "after the second apply");
  });
}

// --- Cleanup ---------------------------------------------------------------------------------------------------------
await check("everything made is deleted, the second campus closed again; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.event_feeds where id in (${FEED_IDS.map(lit).join(", ")})`);
  await sql(`delete from public.events where id in (${EVENTS.map(lit).join(", ")}); delete from public.organizations where id in (${ORGS.map(lit).join(", ")})`);
  await sql(`delete from public.feed_posts where id in (${POSTS.map(lit).join(", ")})`);
  await sql(`delete from public.staff_campuses where user_id in (${ours}); delete from public.staff where user_id in (${ours})`);
  await sql(`update public.universities set email_domain = null where id = ${lit(OTHER)} and email_domain = ${lit(DOMAIN)}`);
  if (await val("select to_regclass('public.audit_request_context') is not null")) await sql(`delete from public.audit_request_context where actor_id in (${ours})`);
  const targets = [...ORGS, ...EVENTS, ...FEED_IDS, ...POSTS].map(lit).join(", ");
  const keptStaff = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours}) or target_id in (${targets})`);
  const keptTs = await val(`select count(*)::int from public.audit_log where actor_id in (${ours}) or target_id in (${ours}) or target_id in (${targets})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + keptStaff, audit_log: baseline.audit_log + keptTs };
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  console.log(`    ${keptStaff + keptTs} log rows of this run stay (append-only)`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} campus events on staging: ${passes} passed, ${failures} failed; 75 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
