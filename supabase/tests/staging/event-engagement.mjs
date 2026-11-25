// Likes, comments and who is going on events (migration 69) on the staging project, through the real Supabase stack the
// app uses: Auth sessions, the REST API (the policies, the trigger, event_going_many) and the app's own shared code for
// every action: eventEngagementReady, likePost and getPostEngagement(Many) with target type 'event', addComment and
// listComments, setEventGoing, getEventGoingMany, listEventGoing, blockUser. Never runs against production: it refuses
// production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/event-engagement.mjs [--restore]
//
// Applies 69 when staging does not have it yet (the file, then its public._migrations row, as db:setup records them),
// as production will take it, on its own. Then three students of one campus (confirmed txstate.edu accounts made by the
// admin API, no email sent) and two events of a throwaway campus calendar, one scheduled, one hidden by staff. Everything
// made is deleted at the end and every table's row count compared with the start. With --restore, 69 is rolled back
// afterwards (its rollback file and the removal of its _migrations row).
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
const MIGRATION = "20261121000000_event_engagement.sql";
const S = (rel) => import(new URL(`packages/shared/src/${rel}`, ROOT));
const { addComment, getPostEngagement, getPostEngagementMany, likePost, listComments } = await S("queries/engagement.ts");
const { eventEngagementReady, getEventGoingMany, listEventGoing, setEventGoing } = await S("queries/events.ts");
const { blockUser } = await S("queries/moderation.ts");

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

const run = Date.now().toString(36);
const accounts = [];
console.log(`Staging project ${project.name} (${REF}): events' likes, comments and who is going (run ${run})${RESTORE ? ", restoring afterwards" : ""}`);

// --- 69 on staging, as production takes it ---------------------------------------------------------------------------------
const before = new Set((await sql("select name from public._migrations")).map((r) => r.name));
if (before.has(MIGRATION)) ok(`${MIGRATION} is already on staging`);
else {
  await check(`${MIGRATION} applies on its own, as the next migration, and is recorded`, async () => {
    const t0 = Date.now();
    await sql(`${read(`supabase/migrations/${MIGRATION}`)}\ninsert into public._migrations (name) values (${lit(MIGRATION)}) on conflict do nothing;`);
    console.log(`    applied in ${Date.now() - t0} ms`);
  });
}
await sql("notify pgrst, 'reload schema'");
await sleep(4000);
await check("the objects are there: the 'event' type, the trigger on likes and comments, the comments' audience policy, event_rsvps with row-level security and its three policies, event_going_many", async () => {
  const o = (await sql(`select
    (select pg_get_constraintdef(oid) like '%event%' from pg_constraint where conname = 'post_likes_target_type_check') as likes_type,
    (select pg_get_constraintdef(oid) like '%event%' from pg_constraint where conname = 'post_comments_target_type_check') as comments_type,
    (select count(*)::int from pg_trigger where tgname in ('post_likes_event_check', 'post_comments_event_check')) as triggers,
    (select count(*)::int from pg_policies where tablename = 'post_comments' and policyname = 'post_comments_event_audience') as audience,
    (select relrowsecurity from pg_class where oid = 'public.event_rsvps'::regclass) as rls,
    (select count(*)::int from pg_policies where tablename = 'event_rsvps') as rsvp_policies,
    (select count(*)::int from pg_proc where proname = 'event_going_many') as going_fn`))[0];
  expect(o.likes_type && o.comments_type && o.triggers === 2 && o.audience === 1 && o.rls === true && o.rsvp_policies === 3 && o.going_fn === 1, JSON.stringify(o));
});
const baseline = await counts();

// --- People and events -------------------------------------------------------------------------------------------------------
async function student(name) {
  const email = `st-ee-${run}-${name}@txstate.edu`;
  const password = `Ee-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const full = `${name[0].toUpperCase()}${name.slice(1)} Events`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: full } });
  if (error) throw new Error(error.message);
  accounts.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(s.error.message);
  return { id: data.user.id, c, name: full };
}
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
let feedId = null;
const ev = {};
let ann, bob, cara;
await check("three students of one campus sign in; a throwaway campus calendar has a scheduled event and one staff hid", async () => {
  [ann, bob, cara] = [await student("ann"), await student("bob"), await student("cara")];
  await sql(`update public.profiles set university_id = ${lit(TX)}, created_at = now() - interval '3 days' where id in (${accounts.map(lit).join(", ")})`);
  feedId = await val(`insert into public.event_feeds (university_id, name, url, kind) values (${lit(TX)}, 'Staging check ${run}', 'https://calendar.example.edu/${run}.ics', 'ics') returning id`);
  ev.show = await val(`insert into public.events (university_id, feed_id, external_uid, title, starts_at, source, status) values (${lit(TX)}, ${lit(feedId)}, 'ee-${run}-1', 'Fall Fest ${run}', now() + interval '2 days', 'feed', 'scheduled') returning id`);
  ev.hidden = await val(`insert into public.events (university_id, feed_id, external_uid, title, starts_at, source, status) values (${lit(TX)}, ${lit(feedId)}, 'ee-${run}-2', 'Pulled ${run}', now() + interval '2 days', 'feed', 'hidden') returning id`);
});

// --- Through the app's own code ------------------------------------------------------------------------------------------------
await check("eventEngagementReady says the server has it", async () => {
  expect((await eventEngagementReady(ann.c)) === true, "not ready");
});
await check("Like: Ann's heart on the event holds after a fresh read; Bob's page counts it, not liked by him", async () => {
  await likePost(ann.c, ann.id, "event", ev.show);
  const mine = await getPostEngagement(ann.c, "event", ev.show);
  expect(mine.likes === 1 && mine.likedByMe, JSON.stringify(mine));
  const page = await getPostEngagementMany(bob.c, "event", [ev.show]);
  expect(page[ev.show].likes === 1 && !page[ev.show].likedByMe, JSON.stringify(page));
});
await check("Comment: Ann's words on the event are read by Bob and counted", async () => {
  await addComment(ann.c, ann.id, "event", ev.show, `Who else is coming? ${run}`);
  const list = await listComments(bob.c, "event", ev.show);
  expect(list.length === 1 && list[0].body === `Who else is coming? ${run}`, JSON.stringify(list.map((c) => c.body)));
  expect((await getPostEngagement(bob.c, "event", ev.show)).comments === 1, "not counted");
});
await check("Going: Ann says she is going; Bob reads her name and the count, not going himself", async () => {
  await setEventGoing(ann.c, ann.id, ev.show, true);
  await setEventGoing(ann.c, ann.id, ev.show, true); // twice is once
  const people = await listEventGoing(bob.c, ev.show);
  expect(people.length === 1 && people[0].id === ann.id && people[0].full_name === ann.name, JSON.stringify(people));
  const g = await getEventGoingMany(bob.c, [ev.show]);
  expect(g[ev.show].going === 1 && g[ev.show].goingByMe === false, JSON.stringify(g));
  expect((await getEventGoingMany(ann.c, [ev.show]))[ev.show].goingByMe === true, "Ann not going for herself");
});
await check("an event staff hid: no like, no comment, no going, and it counts nobody", async () => {
  await rejects(likePost(bob.c, bob.id, "event", ev.hidden), "not available");
  await rejects(addComment(bob.c, bob.id, "event", ev.hidden, "hi"), "not available");
  await rejects(setEventGoing(bob.c, bob.id, ev.hidden, true), "row-level security");
  expect((await getEventGoingMany(bob.c, [ev.hidden]))[ev.hidden].going === 0, "counted");
});
await check("a block: Cara blocks Ann and no longer sees her going, nor counts her; Bob still does", async () => {
  await blockUser(cara.c, cara.id, ann.id);
  expect((await listEventGoing(cara.c, ev.show)).length === 0, "Cara reads Ann");
  expect((await getEventGoingMany(cara.c, [ev.show]))[ev.show].going === 0, "Cara counts Ann");
  expect((await listEventGoing(bob.c, ev.show)).length === 1, "Bob lost Ann");
});
await check("Going taken back: Ann's own row goes; Bob cannot take back hers", async () => {
  await bob.c.from("event_rsvps").delete().eq("event_id", ev.show).eq("user_id", ann.id);
  expect((await getEventGoingMany(ann.c, [ev.show]))[ev.show].goingByMe === true, "Bob took back Ann's");
  await setEventGoing(ann.c, ann.id, ev.show, false);
  expect((await getEventGoingMany(ann.c, [ev.show]))[ev.show].goingByMe === false, "still going");
});

// --- Cleanup -----------------------------------------------------------------------------------------------------------------
await check("everything made is deleted; every table's row count is as at the start", async () => {
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.blocks where blocker_id in (${ours}) or blocked_id in (${ours})`);
  if (feedId) await sql(`delete from public.events where feed_id = ${lit(feedId)}; delete from public.event_feeds where id = ${lit(feedId)}`);
  await sql(`delete from public.post_likes where user_id in (${ours}); delete from public.post_comments where user_id in (${ours})`);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== baseline[t]).map(([t, n]) => `${t}: ${baseline[t]} → ${n}`);
  expect(drift.length === 0, drift.join(", "));
});
if (RESTORE) {
  await check("69 rolled back: its rollback file and its _migrations row removed", async () => {
    await sql(read("supabase/rollbacks/20261121000000_event_engagement.down.sql"));
    await sql(`delete from public._migrations where name = ${lit(MIGRATION)}`);
    expect((await val("select to_regclass('public.event_rsvps') is null")) === true, "event_rsvps still there");
  });
}
console.log(`${failures ? "✗" : "✓"} events' likes, comments and who is going on staging: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
