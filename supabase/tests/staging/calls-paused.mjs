// Calls paused for the launch (migration 64) on the staging project, through the real Supabase stack and the app's own
// call code (startCall, answerCall, getCall, currentCall from packages/shared): before 64, one call that is over and one
// still ringing; then 64 on its own, as production will take it; then the ringing call ended as missed, every new call
// refused for students (direct and group, audio and video) and for the service role with nothing written, past calls
// still readable, nothing to join, and no LiveKit token for an ended call. Never runs against production: it refuses
// production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/calls-paused.mjs [--restore]
//
// Applies 64 when staging does not have it yet (the file, then its public._migrations row, as db:setup records them).
// Three students of one campus (confirmed txstate.edu accounts made by the admin API, no email sent). Everything made is
// deleted at the end and every table's row count compared with the start. With --restore, 64 is rolled back afterwards
// (its rollback file and the removal of its _migrations row).
import fs from "node:fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";

// The shared sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as the
// unit tests in packages/shared/tests do), so the app's own queries run here against staging.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\.[cm]?[jt]sx?$/.test(specifier);
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
if (REF === PRODUCTION) throw new Error("This test writes, deletes and may roll a migration back: it never runs against production.");

const ROOT = new URL("../../../", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), "utf8");
const MIGRATION = "20261116000000_calls_paused.sql";
const S = (rel) => import(new URL(`packages/shared/src/${rel}`, ROOT));
const { answerCall, currentCall, getCall, leaveCall, startCall } = await S("queries/calls.ts");
const { createGroupConversation } = await S("queries/messages.ts");

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 600)}`);
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
const val = async (q) => { const row = (await sql(q))[0]; return row ? row[Object.keys(row)[0]] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 500)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const rejects = async (p, pattern) => { try { await p; } catch (e) { expect(new RegExp(pattern, "i").test(String(e?.message ?? e)), `other error: ${e?.message ?? e}`); return; } throw new Error("it was allowed"); };
async function counts() {
  const tables = (await sql("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).map((r) => r.relname);
  return Object.fromEntries((await sql(`select ${tables.map((t) => `(select count(*)::int from public."${t}") as "${t}"`).join(", ")}`)).map((r) => Object.entries(r))[0]);
}
const callCounts = () => sql("select (select count(*)::int from public.calls) as calls, (select count(*)::int from public.call_participants) as participants, (select count(*)::int from public.messages) as messages, (select count(*)::int from public.notifications) as notifications").then((r) => r[0]);

const run = Date.now().toString(36);
const accounts = [];
console.log(`Staging project ${project.name} (${REF}): calls paused (run ${run})${RESTORE ? ", restoring afterwards" : ""}`);
const baseline = await counts();

async function student(name) {
  const email = `st-cp-${run}-${name}@txstate.edu`;
  const password = `Cp-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const full = `${name[0].toUpperCase()}${name.slice(1)} Calls`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: full } });
  if (error) throw new Error(error.message);
  accounts.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(s.error.message);
  return { id: data.user.id, c, name: full };
}
const follow = async (a, b) => {
  const { error: e1 } = await a.c.from("follows").insert({ follower_id: a.id, followee_id: b.id });
  const { error: e2 } = await b.c.from("follows").insert({ follower_id: b.id, followee_id: a.id });
  if (e1 || e2) throw new Error((e1 ?? e2).message);
};
const ann = await student("ann"), bob = await student("bob"), cara = await student("cara");
await follow(ann, bob);
await follow(ann, cara);
const { data: direct, error: directError } = await ann.c.rpc("get_or_create_direct_conversation", { p_other_user_id: bob.id });
if (directError) throw new Error(directError.message);
const group = await createGroupConversation(ann.c, "Calls paused group", [bob.id, cara.id]);

// --- Before 64: a call that is over and one still ringing (only when staging does not have 64 yet) -------------------------
const had = new Set((await sql("select name from public._migrations")).map((r) => r.name)).has(MIGRATION);
let over = null, ringing = null, overBefore = null;
if (had) ok(`${MIGRATION} is already on staging (the calls it ends cannot be set up again)`);
else {
  await check("before 64: Ann calls Bob and hangs up; then calls again and leaves it ringing", async () => {
    over = await startCall(ann.c, direct, "audio");
    await leaveCall(ann.c, over.callId);
    ringing = await startCall(ann.c, direct, "audio");
    overBefore = (await sql(`select status, ended_reason, ended_at::text from public.calls where id = ${lit(over.callId)}`))[0];
    expect(overBefore.status === "ended" && (await val(`select status from public.calls where id = ${lit(ringing.callId)}`)) === "ringing", "the calls are not in their states");
  });
  await check(`${MIGRATION} applies on its own, as the next migration, and is recorded`, async () => {
    const t0 = Date.now();
    await sql(read(`supabase/migrations/${MIGRATION}`));
    await sql(`insert into public._migrations (name) values (${lit(MIGRATION)}) on conflict do nothing`);
    console.log(`    applied in ${Date.now() - t0} ms`);
  });
}
await sql("notify pgrst, 'reload schema'");
await sleep(3000);

await check("the guard is on calls and closed to the API; start_call() is still granted to students as before", async () => {
  const o = (await sql(`select
    (select count(*)::int from pg_trigger where tgname = 'calls_paused' and tgrelid = 'public.calls'::regclass) as trigger,
    has_function_privilege('authenticated', 'public.guard_calls_paused()', 'execute') as guard_api,
    has_function_privilege('anon', 'public.guard_calls_paused()', 'execute') as guard_anon,
    has_function_privilege('authenticated', 'public.start_call(uuid, text)', 'execute') as start_granted`))[0];
  expect(o.trigger === 1 && !o.guard_api && !o.guard_anon && o.start_granted, JSON.stringify(o));
});
if (ringing) {
  await check("the call left ringing was ended as missed, with Bob's missed-call notification and the chat's row ended", async () => {
    const c = await getCall(bob.c, ringing.callId);
    expect(c?.status === "ended" && c.ended_reason === "missed", JSON.stringify(c));
    expect((await val(`select count(*)::int from public.notifications where user_id = ${lit(bob.id)} and type = 'call' and data ->> 'call_id' = ${lit(ringing.callId)}`)) === 1, "no missed-call notification");
    expect((await val(`select call ->> 'status' from public.messages where id = ${lit(ringing.messageId)}`)) === "ended", "the chat's row still rings");
  });
  await check("the call already over is untouched", async () => {
    const now = (await sql(`select status, ended_reason, ended_at::text from public.calls where id = ${lit(over.callId)}`))[0];
    expect(JSON.stringify(now) === JSON.stringify(overBefore), `${JSON.stringify(overBefore)} became ${JSON.stringify(now)}`);
  });
}

const was = await callCounts();
await check("Ann cannot start a call with Bob through the app's own startCall: 'Calls are paused for now.'", () => rejects(startCall(ann.c, direct, "audio"), "Calls are paused"));
await check("nor a video call in the group, nor can Bob or Cara", async () => {
  await rejects(startCall(ann.c, group, "video"), "Calls are paused");
  await rejects(startCall(bob.c, direct, "video"), "Calls are paused");
  await rejects(startCall(cara.c, group, "audio"), "Calls are paused");
});
await check("nor does the service role write a call", async () => {
  const { error } = await admin.from("calls").insert({ conversation_id: direct, started_by: ann.id, kind: "audio" });
  expect(error && /Calls are paused/.test(error.message), error?.message ?? "it was allowed");
});
await check("the refusals left nothing behind: no call, no one rung, no chat row, no notification", async () => {
  const now = await callCounts();
  expect(JSON.stringify(now) === JSON.stringify(was), `${JSON.stringify(was)} became ${JSON.stringify(now)}`);
});
if (ringing) {
  await check("past calls stay history: both read them; nothing to join in the chat; answering one says it has ended and joins nobody", async () => {
    expect((await getCall(ann.c, over.callId))?.status === "ended" && (await getCall(bob.c, ringing.callId))?.status === "ended", "a past call cannot be read");
    expect((await currentCall(bob.c, direct)) === null, "a call is offered to join");
    await rejects(answerCall(bob.c, ringing.callId), "has ended");
    expect(!(await getCall(bob.c, ringing.callId)).participants.some((p) => p.user_id === bob.id && p.state === "joined"), "Bob joined an ended call");
  });
  await check("no LiveKit token for the ended call", async () => {
    const { data: session } = await bob.c.auth.getSession();
    const r = await fetch(`${URL_}/functions/v1/livekit-token`, { method: "POST", headers: { Authorization: `Bearer ${session.session.access_token}`, apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ call_id: ringing.callId }) });
    const body = await r.json().catch(() => ({}));
    expect(r.status !== 200 && !body.token, `${r.status} ${JSON.stringify(body)}`);
    console.log(`    the function answered ${r.status}${body.error ? `: ${body.error}` : r.status === 404 ? " (not deployed on this project)" : ""}`);
  });
}

// --- Cleanup -----------------------------------------------------------------------------------------------------------------
await check("everything made is deleted; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.messages where sender_id in (${ours})`);
  await sql(`delete from public.calls where started_by in (${ours})`);
  await sql(`delete from public.conversations c where exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id in (${ours})) and not exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id not in (${ours}))`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  // 64's own _migrations row is the one row this run keeps, when it applied 64.
  const expected = { ...baseline, _migrations: baseline._migrations + (had ? 0 : 1) };
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== expected[t]).map(([t, n]) => `${t}: ${expected[t]} → ${n}`);
  expect(drift.length === 0, drift.join(", "));
});
if (RESTORE) {
  await check("64 rolled back: its rollback file and its _migrations row removed", async () => {
    await sql(read("supabase/rollbacks/20261116000000_calls_paused.down.sql"));
    await sql(`delete from public._migrations where name = ${lit(MIGRATION)}`);
    expect((await val("select to_regprocedure('public.guard_calls_paused()') is null")) === true, "the guard is still there");
  });
}
console.log(`${failures ? "✗" : "✓"} calls paused on staging: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
