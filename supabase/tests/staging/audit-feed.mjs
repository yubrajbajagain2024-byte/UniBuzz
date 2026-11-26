// Migration 71 (the Master Admin Portal's one audit view, and where staff actions came from) rehearsed on the staging
// project through the real Supabase stack: Auth sessions (a TOTP second factor passed as Supabase Auth does it), the
// API gateway and PostgREST (whose request headers the triggers read), and the apps' own queries. Before 71 the feed
// does not exist. Then 71 on its own, in one transaction with its public._migrations row, as production will take it:
// the context table and helpers closed to the API; a staff admin's real actions (a university request declined in the
// team's log, the baseline rule pack confirmed in Trust & Safety's) recorded with the gateway's view, the portal's
// headers, the endpoint and the session; a student's own request never recorded; the feed for an admin (every log, the
// context), a moderator (no business entries, no context, not the team's changes) and the refused (a visitor, a
// student, an admin without the second factor); keyset pages; the old readers unchanged. Then its rollback (the feed and
// the triggers gone, the recorded context kept), then 71 again so staging is left as production will be (with
// --restore it is left rolled back). Throwaway accounts (confirmed txstate.edu accounts made by the admin API, no email
// sent); everything made is deleted at the end, this run's request context included (it holds this machine's address),
// and every table's row count compared with the start. The address the gateway saw is never printed, only its shape.
// Never runs against production: it refuses production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/audit-feed.mjs [--restore]
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
const MIGRATION = "20261126000000_audit_feed.sql";
const ROLLBACK = "supabase/rollbacks/20261126000000_audit_feed.down.sql";
const universities = await import(new URL("packages/shared/src/queries/universities.ts", ROOT));
const adminQueries = await import(new URL("packages/shared/src/queries/admin.ts", ROOT));

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
/** What an address looks like, never the address itself. */
const shape = (ip) => (ip ? `${ip.split(",").length} hop(s), ${ip.includes(":") ? "IPv6" : "IPv4"}` : "none");

const run = Date.now().toString(36);
const PORTAL = { "x-portal-client-ip": "198.51.100.7", "x-portal-user-agent": `Mozilla/5.0 (rehearsal ${run})`, "x-portal-path": "/universities", "user-agent": `unibuzz-staging-rehearsal/${run}` };
const accounts = [];
console.log(`Staging project ${project.name}: audit feed (run ${run})${RESTORE ? ", left rolled back afterwards" : ""}`);
if (await applied()) throw new Error(`${MIGRATION} is already on staging: roll it back first (its rollback and _migrations row) to rehearse it`);
if (!(await val("select to_regclass('public.staff_audit_log') is not null"))) throw new Error("Staging lacks CampConnect Admin's staff audit log: it is not built like production");
const contextTableBefore = Boolean(await val("select to_regclass('public.audit_request_context') is not null"));
const baseline = await counts();
const baselinePack = (await sql("select pack_id, enabled, updated_by, updated_at from public.moderation_rule_state where pack_id = 'baseline'"))[0] ?? null;

async function account(name) {
  const email = `af-${run}-${name}@txstate.edu`;
  const password = `Af-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name[0].toUpperCase()}${name.slice(1)} Rehearsal` } });
  if (error) throw new Error(error.message);
  accounts.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(s.error.message);
  return { id: data.user.id, email, password, c };
}
/** A fresh session: aal1, or aal2 when the authenticator key is given; `headers` go with every request it makes. */
async function session(u, secret, headers) {
  const c = createClient(URL_, ANON, { ...opts, global: headers ? { headers } : undefined });
  const s = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (s.error) throw new Error(s.error.message);
  if (secret) await passSecondFactor(c, secret);
  return c;
}
const sessionIdOf = async (c) => {
  const token = (await c.auth.getSession()).data.session?.access_token ?? "";
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString() || "{}").session_id ?? null;
};

const student = await account("student");
const staffAdmin = await account("staffadmin");
const adminSecret = await enrolAuthenticator(staffAdmin.c);
const staffMod = await account("staffmod");
const modSecret = await enrolAuthenticator(staffMod.c);
await sql(`insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin'), (${lit(staffMod.id)}, 'moderator') on conflict (user_id) do update set role = excluded.role`);
const portalAdmin = await session(staffAdmin, adminSecret, PORTAL);
const adminAal1 = await session(staffAdmin);
const modAal2 = await session(staffMod, modSecret, PORTAL);
const feed = (c, filters = {}, limit = 50) => c.rpc("console_audit_feed", { p_filters: filters, p_limit: limit });

// --- Before 71 -------------------------------------------------------------------------------------------------------
await check("before 71: the API does not know the feed", async () => {
  const error = await errorOf(feed(portalAdmin));
  expect(error && /console_audit_feed|PGRST202|Could not find/i.test(`${error.code} ${error.message}`), `${error?.code} ${error?.message}`);
});

// --- 71 on its own ---------------------------------------------------------------------------------------------------
await check("71 applies on its own, in one transaction with its _migrations row", async () => {
  await apply();
  expect(await applied(), "no _migrations row");
  const triggers = await val("select count(*)::int from pg_trigger where tgname in ('staff_audit_log_request_context', 'audit_log_request_context', 'business_audit_log_request_context')");
  expect(triggers === 3, `${triggers} triggers`);
});
await check("the context table and the helpers are closed to the API, to students and to staff", async () => {
  expect(await errorOf(student.c.from("audit_request_context").select("*")), "a student read it");
  expect(await errorOf(portalAdmin.from("audit_request_context").select("*")), "an admin read it through the API");
  expect(await errorOf(visitor.from("audit_request_context").select("*")), "a visitor read it");
  const helpers = { audit_context_json: { p_log: "staff", p_entry: "1" }, audit_actor_is_staff: { p_user: staffAdmin.id }, audit_context_text: { p_value: "x", p_max: 5 } };
  for (const [fn, args] of Object.entries(helpers)) {
    const error = await errorOf(portalAdmin.rpc(fn, args));
    expect(error && /permission denied|42501/i.test(`${error.code} ${error.message}`), `${fn}: ${error ? `${error.code} ${error.message}` : "answered"}`);
  }
});

// --- Recording where staff actions came from -------------------------------------------------------------------------
let declineRow = null;
await check("a staff admin declines a request through the API: the team's log row has the gateway's view, the portal's headers, the endpoint and the session", async () => {
  const request = await universities.requestUniversity(student.c, { name: `Audit ${run} College` });
  const { error } = await portalAdmin.rpc("console_decide_university_request", { p_id: request.id, p_decision: "decline", p_response: "Rehearsal." });
  expect(!error, error?.message);
  declineRow = await val(`select id::text from public.staff_audit_log where actor_id = ${lit(staffAdmin.id)} and action = 'university_request.decline' order by id desc limit 1`);
  const c = (await sql(`select * from public.audit_request_context where log = 'staff' and entry_id = ${lit(declineRow)}`))[0];
  expect(c, "no context row");
  console.log(`    the gateway's address: ${shape(c.gateway_ip)}; endpoint ${c.endpoint}; aal ${c.aal}`);
  expect(c.gateway_ip && /^[0-9A-Fa-f:., ]+$/.test(c.gateway_ip), "the gateway's address is missing");
  expect(c.user_agent === PORTAL["user-agent"], `user agent ${c.user_agent}`);
  expect(c.portal_ip === "198.51.100.7" && c.portal_user_agent === PORTAL["x-portal-user-agent"] && c.portal_path === "/universities", JSON.stringify({ ...c, gateway_ip: undefined }));
  expect(c.endpoint === "/rpc/console_decide_university_request", `endpoint ${c.endpoint}`);
  expect(c.aal === "aal2" && c.session_id === (await sessionIdOf(portalAdmin)), `session ${c.session_id} / ${await sessionIdOf(portalAdmin)}`);
});
await check("a Trust & Safety action by the admin (the baseline rule pack confirmed on) is recorded too", async () => {
  const { error } = await portalAdmin.rpc("console_set_rule_pack", { p_id: "baseline", p_enabled: true, p_note: `rehearsal ${run}` });
  expect(!error, error?.message);
  const id = await val(`select id::text from public.audit_log where actor_id = ${lit(staffAdmin.id)} and action = 'rule_pack_toggle' order by seq desc limit 1`);
  const c = (await sql(`select endpoint, portal_path from public.audit_request_context where log = 'trust_safety' and entry_id = ${lit(id)}`))[0];
  expect(c?.endpoint === "/rpc/console_set_rule_pack", JSON.stringify(c));
});
await check("a student's own request is never recorded", async () => {
  await universities.requestUniversity(student.c, { name: `Second ${run} College` });
  expect(!(await val(`select count(*)::int from public.audit_request_context where actor_id = ${lit(student.id)}`)), "a student's request was recorded");
});

// --- The feed --------------------------------------------------------------------------------------------------------
await check("a visitor, a student and an admin without the second factor are refused the feed", async () => {
  expect(await errorOf(feed(visitor)), "a visitor read the feed");
  expect(/not_found/.test((await errorOf(feed(student.c)))?.message ?? ""), "a student read the feed");
  expect(/mfa_required/.test((await errorOf(feed(adminAal1)))?.message ?? ""), "an admin at aal1 read the feed");
});
await check("an admin reads every log merged newest first, with the context of the decline", async () => {
  const started = Date.now();
  const { data, error } = await feed(portalAdmin, {}, 50);
  const ms = Date.now() - started;
  expect(!error, error?.message);
  console.log(`    first page: ${data.items.length} entries in ${ms} ms; sources ${data.sources.join(", ")}`);
  expect(JSON.stringify(data.sources) === JSON.stringify(["staff", "trust_safety", "business"]) && data.contextVisible === true, JSON.stringify(data.sources));
  for (let i = 1; i < data.items.length; i++) expect(new Date(data.items[i - 1].createdAt) >= new Date(data.items[i].createdAt), `order at ${i}`);
  const mine = (await feed(portalAdmin, { actor: staffAdmin.id })).data.items;
  const decline = mine.find((e) => e.source === "staff" && e.id === declineRow);
  expect(decline?.context?.portalIp === "198.51.100.7" && decline.context.endpoint === "/rpc/console_decide_university_request", JSON.stringify(decline?.context ?? null).slice(0, 200));
  expect(mine.some((e) => e.source === "trust_safety" && e.action === "rule_pack_toggle" && e.context), "the rule pack entry or its context is missing");
});
await check("a moderator sees no business entries, no context, and not the team's changes", async () => {
  const { data, error } = await feed(modAal2, {}, 100);
  expect(!error, error?.message);
  expect(data.contextVisible === false && !data.sources.includes("business"), JSON.stringify(data.sources));
  expect(data.items.every((e) => e.source !== "business" && !e.context), "business entries or context leaked");
  expect(!data.items.some((e) => e.source === "staff" && e.id === declineRow), "the admin's decision leaked to a moderator");
  expect(data.items.filter((e) => e.source === "trust_safety").every((e) => e.actor?.id === staffMod.id), "others' Trust & Safety rows leaked");
});
await check("pages of 5 walk the newest 15 entries once, in order", async () => {
  const one = (await feed(portalAdmin, {}, 15)).data.items.map((e) => `${e.source}:${e.id}`);
  const walked = [];
  let before = null;
  for (let i = 0; i < 3; i++) {
    const { data } = await feed(portalAdmin, before ? { before } : {}, 5);
    walked.push(...data.items.map((e) => `${e.source}:${e.id}`));
    before = data.nextCursor;
    if (!before) break;
  }
  expect(JSON.stringify(walked) === JSON.stringify(one.slice(0, walked.length)) && new Set(walked).size === walked.length, `walked ${walked.length}`);
});
await check("the team's reader (the portal's old audit page, through the shared query) answers as before", async () => {
  const rows = await adminQueries.listAuditLog(portalAdmin, { limit: 5 });
  expect(rows.length > 0 && rows.every((r) => !("context" in r) && typeof r.action === "string"), JSON.stringify(rows[0]).slice(0, 200));
});

// --- Rollback, then 71 again -----------------------------------------------------------------------------------------
await check("the rollback removes the feed and the triggers; the recorded context stays; nothing more is recorded", async () => {
  const kept = await val("select count(*)::int from public.audit_request_context");
  await rollBack();
  expect(!(await applied()), "the _migrations row is still there");
  expect(await errorOf(feed(portalAdmin)), "the feed still answers");
  expect((await val("select count(*)::int from public.audit_request_context")) === kept, "context rows were lost");
  const { error } = await portalAdmin.rpc("console_set_rule_pack", { p_id: "baseline", p_enabled: true, p_note: `after rollback ${run}` });
  expect(!error, error?.message);
  expect((await val("select count(*)::int from public.audit_request_context")) === kept, "a row was recorded after the rollback");
});
if (!RESTORE) {
  await check("71 applies again after the rollback, records and serves the feed", async () => {
    await apply();
    const { error } = await portalAdmin.rpc("console_set_rule_pack", { p_id: "baseline", p_enabled: true, p_note: `again ${run}` });
    expect(!error, error?.message);
    const { data } = await feed(portalAdmin, { actor: staffAdmin.id, action: "rule_pack_toggle" });
    expect(data.items.length === 3 && data.items[0].context?.endpoint === "/rpc/console_set_rule_pack", `${data.items.length} entries`);
  });
}

// --- Cleanup ---------------------------------------------------------------------------------------------------------
await check("everything made is deleted (this run's request context too); every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.university_requests where requested_by in (${ours})`);
  if (baselinePack) await sql(`update public.moderation_rule_state set enabled = ${baselinePack.enabled}, updated_by = ${lit(baselinePack.updated_by)}, updated_at = ${lit(baselinePack.updated_at)} where pack_id = 'baseline'`);
  else await sql("delete from public.moderation_rule_state where pack_id = 'baseline'");
  if (await val("select to_regclass('public.audit_request_context') is not null")) await sql(`delete from public.audit_request_context where actor_id in (${ours})`);
  await sql(`delete from public.staff where user_id in (${ours})`);
  // The logs are append-only: this run's rows stay and are counted, not hidden.
  const keptStaff = await val(`select count(*)::int from public.staff_audit_log where actor_id in (${ours}) or target_id in (${ours})`);
  const keptTs = await val(`select count(*)::int from public.audit_log where actor_id in (${ours}) or target_id in (${ours})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const expected = { ...baseline, _migrations: baseline._migrations + (RESTORE ? 0 : 1), staff_audit_log: baseline.staff_audit_log + keptStaff, audit_log: baseline.audit_log + keptTs };
  if (!contextTableBefore) expected.audit_request_context = 0;
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  console.log(`    ${keptStaff + keptTs} log rows of this run stay (append-only); this run's request context is deleted`);
  expect(drift.length === 0, drift.join(", "));
});
console.log(`${failures ? "✗" : "✓"} audit feed on staging: ${passes} passed, ${failures} failed; 71 ${RESTORE ? "rolled back" : "applied"} on staging`);
process.exit(failures ? 1 : 0);
