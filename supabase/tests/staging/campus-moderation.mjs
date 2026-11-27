// Migration 73 (the moderation area scoped by campus) rehearsed on the staging project through the real Supabase stack:
// Auth sessions with a TOTP second factor, the REST API and the portal's own queries (packages/shared admin-moderation
// and admin-dashboard). It needs 72 on staging and 73 not yet there. A second campus students can sign up from is
// opened for the run (a throwaway email domain on another university, put back at the end). Students of both campuses
// post, list, comment, and report each other's content; a staff admin hides two listings and they are flagged as the
// backstop would flag them. Before 73 a campus admin is refused the reports. Then 73 on its own, in one transaction with
// its public._migrations row, as production will take it: the staff admin and moderator see every report and flag of
// the run as before; the campus admin sees exactly their own students' (not a post a student from elsewhere placed on
// Texas State), a reporter's email only for their own students, opens, hides and restores their own students' content
// and keeps their flag hidden, and is told "not found" for everything else; every other area still refuses them;
// a profile's university is still embeddable. Then its rollback (the campus admin refused again), then 73 again so
// staging is left as production will be (with --restore it is left rolled back). Throwaway accounts made by the admin
// API (no email sent), everything the run made deleted, and every table's row count compared with the start (the
// append-only logs aside). Never runs against production: it refuses production's ref and any project not named as
// staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/campus-moderation.mjs [--restore]
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
const NEEDS = "20261127000000_staff_scopes.sql";
const MIGRATION = "20261128000000_campus_moderation.sql";
const ROLLBACK = "supabase/rollbacks/20261128000000_campus_moderation.down.sql";
const mod = await import(new URL("packages/shared/src/queries/admin-moderation.ts", ROOT));
const dash = await import(new URL("packages/shared/src/queries/admin-dashboard.ts", ROOT));
const adminQueries = await import(new URL("packages/shared/src/queries/admin.ts", ROOT));
// The set 73 gives campus admins (later migrations add to it).
const PORTAL_CAMPUS_ADMIN = ["moderation.view"];
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
const DOMAIN = `cm-${run}.example.edu`;
const accounts = [];
console.log(`Staging project ${project.name}: campus moderation (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (!(await applied(NEEDS))) throw new Error(`${NEEDS} (migration 72) is not on staging: 73 needs it`);
if (await applied(MIGRATION)) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
if (!(await val("select to_regclass('public.staff_audit_log') is not null"))) throw new Error("Staging lacks CampConnect Admin's schema: it is not built like production");
const baseline = await counts();
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
const OTHER = await val("select id from public.universities where email_domain is null and id <> " + lit(TX) + " order by name limit 1");
if (!OTHER) throw new Error("No second university without a sign-up domain to open for the run");
await sql(`update public.universities set email_domain = ${lit(DOMAIN)} where id = ${lit(OTHER)}`);

async function account(name, domain = "txstate.edu") {
  const email = `cm-${run}-${name}@${domain}`;
  const password = `Cm-${run}-${Math.random().toString(36).slice(2, 10)}!`;
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

// People, content and reports. Reports are filed through the API by their reporters, as the apps file them; a report's
// eligibility needs an account a day old, so the reporters' profiles are dated back (the database owner, as tests do).
const txa = await account("txauthor");
const ota = await account("otherauthor", DOMAIN);
const spoof = await account("spoofer", DOMAIN);
await sql(`update public.profiles set university_id = ${lit(TX)} where id = ${lit(txa.id)};
           update public.profiles set university_id = ${lit(OTHER)} where id = ${lit(ota.id)};
           update public.profiles set university_id = ${lit(TX)} where id = ${lit(spoof.id)}`);
const C = {
  txPost: await insert(txa, "feed_posts", { author_id: txa.id, kind: "post", body: `Rehearsal ${run}: move-in day` }),
  otherPost: await insert(ota, "feed_posts", { author_id: ota.id, kind: "post", body: `Rehearsal ${run}: from elsewhere` }),
  spoofPost: await insert(spoof, "feed_posts", { author_id: spoof.id, kind: "post", body: `Rehearsal ${run}: placed on Texas State`, university_id: TX }),
  txRoommate: await insert(txa, "roommate_posts", { author_id: txa.id, post_type: "needs_room", title: `Rehearsal ${run}`, description: "Quiet student looking for a room." }),
  otherItem: await insert(ota, "items", { seller_id: ota.id, title: `Rehearsal ${run}`, description: "Barely used, works great", price: 15, category: "furniture" }),
};
const reporters = [];
async function report(domain, type, id) {
  const by = await account(`reporter${reporters.length}`, domain);
  reporters.push(by);
  await sql(`update public.profiles set created_at = now() - interval '30 days' where id = ${lit(by.id)}`);
  const { error } = await by.c.from("reports").insert({ reporter_id: by.id, target_type: type, target_id: id, reason: "harassment" });
  if (error) throw new Error(`report ${type}: ${error.message}`);
  return await val(`select id from public.reports where reporter_id = ${lit(by.id)}`);
}
const R = {
  txPostByTx: await report("txstate.edu", "post", C.txPost),
  txPostByOther: await report(DOMAIN, "post", C.txPost),
  otherPostByTx: await report("txstate.edu", "post", C.otherPost),
  spoofPostByTx: await report("txstate.edu", "post", C.spoofPost),
  txProfileByOther: await report(DOMAIN, "profile", txa.id),
};
const IN_SCOPE = [R.txPostByTx, R.txPostByOther, R.txProfileByOther];
const OURS = Object.values(R);

// Staff.
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

// Two flags, as the backstop leaves them: hidden by a staff member, then flagged.
await mod.hideContent(adminAal2, "roommate", C.txRoommate, "Reported by ten people");
await mod.hideContent(adminAal2, "item", C.otherItem, "Reported by ten people");
const F = {
  tx: await val(`insert into public.report_auto_hides (target_type, target_id, source, reporter_count, hidden_at) values ('roommate', ${lit(C.txRoommate)}, 'report_threshold', 10, now()) returning id`),
  other: await val(`insert into public.report_auto_hides (target_type, target_id, source, reporter_count, hidden_at) values ('item', ${lit(C.otherItem)}, 'report_threshold', 10, now()) returning id`),
};
const ourReports = async (c) => (await mod.listReports(c, { status: "all", limit: 200 })).filter((r) => OURS.includes(r.id));
const ourFlags = async (c) => (await mod.listAutoHidden(c, { status: "all", limit: 200 })).filter((f) => [F.tx, F.other].includes(f.id));

// --- Before 73 -------------------------------------------------------------------------------------------------------
await check("before 73: the campus admin is refused the reports; the staff admin and moderator see all of the run's", async () => {
  await refused(mod.listReports(campusAal2, { status: "all" }), /Not allowed/);
  expect((await ourReports(adminAal2)).length === OURS.length && (await ourReports(modAal2)).length === OURS.length, "the platform's staff");
});
const beforeAdmin = JSON.stringify(await ourReports(adminAal2));
const beforeModFlags = JSON.stringify(await ourFlags(modAal2));

// --- 73 on its own ---------------------------------------------------------------------------------------------------
await check("73 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(MIGRATION), "no _migrations row");
});
await check("the staff admin and moderator get the same answers as before 73", async () => {
  expect(JSON.stringify(await ourReports(adminAal2)) === beforeAdmin, "the admin's reports changed");
  expect(JSON.stringify(await ourFlags(modAal2)) === beforeModFlags, "the moderator's flags changed");
  expect((await ourReports(modAal2)).every((r) => r.reporterEmail), "an email went missing for the moderator");
});
await check("the campus admin's permissions are 73's (moderation.view), on their campus only", async () => {
  const p = await adminQueries.getMyStaffPermissions(campusAal2);
  expect(p.role === "campus_admin" && !p.platform && same(p.permissions, PORTAL_CAMPUS_ADMIN), JSON.stringify(p));
});
await check("reports: exactly their own students' of the run; a reporter's email only for their own students", async () => {
  const rows = await ourReports(campusAal2);
  expect(same(rows.map((r) => r.id), IN_SCOPE), `saw ${rows.length}`);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  expect(byId[R.txPostByTx].reporterEmail?.endsWith("@txstate.edu"), "their own student's email");
  expect(byId[R.txPostByOther].reporterEmail === null && byId[R.txProfileByOther].reporterEmail === null, "another campus's student's email");
});
await check("a report about another campus's post, or one placed on Texas State from elsewhere: not found", async () => {
  await refused(dash.getReport(campusAal2, R.otherPostByTx), /Report not found/);
  await refused(dash.getReport(campusAal2, R.spoofPostByTx), /Report not found/);
  await refused(mod.resolveReport(campusAal2, R.otherPostByTx, "dismissed"), /Report not found/);
  expect((await val(`select status from public.reports where id = ${lit(R.otherPostByTx)}`)) === "open", "changed");
});
await check("their own report: opened, resolved and reopened", async () => {
  expect((await dash.getReport(campusAal2, R.txPostByTx)).id === R.txPostByTx, "get");
  await mod.resolveReport(campusAal2, R.txPostByTx, "no_action", "Rehearsal");
  await mod.reopenReport(campusAal2, R.txPostByTx);
  expect((await val(`select status from public.reports where id = ${lit(R.txPostByTx)}`)) === "open", "not reopened");
});
await check("content: their own student's opens, is hidden and restored; another campus's is not found and untouched", async () => {
  expect((await mod.getContentSnapshot(campusAal2, "post", C.txPost)) !== null, "their own");
  await refused(mod.getContentSnapshot(campusAal2, "post", C.otherPost), /Content not found/);
  await refused(mod.getContentSnapshot(campusAal2, "post", C.spoofPost), /Content not found/);
  await refused(mod.hideContent(campusAal2, "post", C.otherPost, "Not their campus"), /Content not found/);
  expect((await val(`select hidden_at from public.feed_posts where id = ${lit(C.otherPost)}`)) === null, "another campus's post hidden");
  await mod.hideContent(campusAal2, "post", C.txPost, "Rehearsal hide");
  await mod.restoreContent(campusAal2, "post", C.txPost);
  expect((await val(`select hidden_at from public.feed_posts where id = ${lit(C.txPost)}`)) === null, "still hidden");
});
await check("flags: only their campus's, counted; keeping it hidden works; another campus's is not found", async () => {
  const rows = await ourFlags(campusAal2);
  expect(rows.length === 1 && rows[0].id === F.tx, `saw ${rows.length}`);
  await refused(mod.upholdAutoHide(campusAal2, F.other, null), /Flag not found/);
  await mod.upholdAutoHide(campusAal2, F.tx, "Rehearsal");
  expect((await val(`select status from public.report_auto_hides where id = ${lit(F.tx)}`)) === "upheld", "not upheld");
  expect((await val(`select status from public.report_auto_hides where id = ${lit(F.other)}`)) === "pending", "the other flag changed");
});
await check("every other area still refuses the campus admin; the staff admin is answered", async () => {
  await refused(dash.listUsers(campusAal2, { filter: "all", limit: 5 }), /Not allowed/);
  await refused(mod.deleteContentPermanently(campusAal2, "post", C.txPost, "Rehearsal"), /Not allowed/);
  for (const fn of ["console_appeals", "console_queue_counts", "console_audit_feed"]) {
    const error = await errorOf(campusAal2.rpc(fn));
    expect(error && /not_found/.test(error.message), `${fn}: ${error?.message ?? "answered"}`);
  }
  expect(!(await errorOf(adminAal2.rpc("console_queue_counts"))), "the admin lost the queue");
});
await check("the helpers are closed to the API", async () => {
  for (const [fn, args] of [["staff_content_university", { p_type: "post", p_id: C.txPost }], ["staff_campus_ids", { p_user: campus.id }], ["staff_require_area", { p_permission: "moderation.view", p_min_role: "moderator" }]]) {
    const error = await errorOf(adminAal2.rpc(fn, args));
    expect(error && /permission denied|42501/i.test(`${error.code} ${error.message}`), `${fn}: ${error ? error.message : "answered"}`);
  }
});
await check("the apps' profile embeds still answer (a profile with its university)", async () => {
  const { data, error } = await txa.c.from("profiles").select("id, universities(name)").eq("id", txa.id).single();
  expect(!error && data?.universities?.name === "Texas State University", error ? `${error.code} ${error.message}` : JSON.stringify(data));
});

// --- Rollback, then 73 again -----------------------------------------------------------------------------------------
await check("the rollback runs: the campus admin is refused again; the staff admin unchanged", async () => {
  await rollBack();
  expect(!(await applied(MIGRATION)), "the _migrations row is still there");
  await refused(mod.listReports(campusAal2, { status: "all" }), /Not allowed/);
  expect((await ourReports(adminAal2)).length === OURS.length, "the admin lost reports");
});
if (!RESTORE) {
  await check("73 applies again after the rollback", async () => {
    await apply();
    expect(same((await ourReports(campusAal2)).map((r) => r.id), IN_SCOPE), "after the second apply");
  });
}

// --- Cleanup ---------------------------------------------------------------------------------------------------------
await check("everything made is deleted, the second campus closed again; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  const content = Object.values(C).map(lit).join(", ");
  await sql(`delete from public.report_auto_hides where id in (${lit(F.tx)}, ${lit(F.other)})`);
  await sql(`delete from public.reports where id in (${OURS.map(lit).join(", ")})`);
  await sql(`delete from public.mod_queue where entity_id in (${content}, ${lit(txa.id)})`);
  if (await val("select to_regclass('public.moderation_events') is not null")) await sql(`delete from public.moderation_events where entity_id in (${content}, ${lit(txa.id)})`);
  await sql(`delete from public.feed_posts where id in (${lit(C.txPost)}, ${lit(C.otherPost)}, ${lit(C.spoofPost)}); delete from public.roommate_posts where id = ${lit(C.txRoommate)}; delete from public.items where id = ${lit(C.otherItem)}`);
  await sql(`delete from public.staff_campuses where user_id in (${ours}); delete from public.staff where user_id in (${ours})`);
  await sql(`update public.universities set email_domain = null where id = ${lit(OTHER)} and email_domain = ${lit(DOMAIN)}`);
  if (await val("select to_regclass('public.audit_request_context') is not null")) await sql(`delete from public.audit_request_context where actor_id in (${ours})`);
  const keptStaff = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours}) or target_id in (${[...Object.values(C), ...OURS].map(lit).join(", ")})`);
  const keptTs = await val(`select count(*)::int from public.audit_log where actor_id in (${ours}) or target_id in (${ours}) or target_id in (${Object.values(C).map(lit).join(", ")})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + keptStaff, audit_log: baseline.audit_log + keptTs };
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  console.log(`    ${keptStaff + keptTs} log rows of this run stay (append-only)`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} campus moderation on staging: ${passes} passed, ${failures} failed; 73 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
