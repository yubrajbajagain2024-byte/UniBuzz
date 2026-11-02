// What a viewer can do with a story (migration 62) on the staging project, through the real Supabase stack the app uses:
// Auth sessions, the REST API (PostgREST's upsert for a like, the policies, the card trigger), Storage (each story's
// photo from its author's own stories folder), and the app's own shared code for every action: likeStory and
// unlikeStory (also through createLikeSync, the heart's latest-tap-wins requests), sendStoryReply, sendSharedPost to
// friends and to group chats, listStories, listStoryViewers, listConversations, setStoryMuted. Never runs against
// production: it refuses production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/story-actions.mjs [--restore]
//
// Applies 62 when staging does not have it yet (the file, then its public._migrations row, as db:setup records them),
// as production will take it, on its own. Then five students of one campus (confirmed txstate.edu accounts made by the
// admin API, no email sent): Ann posts four stories (campus, friends, selected, global); Bob and Cara are her friends,
// Dev is Bob's friend and not hers, Eve is nobody's. They like and unlike, reply, share into direct and group chats, and
// the refusals come back with their reasons. Everything made is deleted at the end and every table's row count compared
// with the start. With --restore, 62 is rolled back afterwards (its rollback file and the removal of its _migrations row).
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
const MIGRATION = "20261114000000_story_actions.sql";
const S = (rel) => import(new URL(`packages/shared/src/${rel}`, ROOT));
const { sharedPostFromStory, shareFailureSummary, sharedPostNoun } = await S("share.ts");
const { createLikeSync } = await S("stories.ts");
const { createStory, deleteStory, likeStory, listStories, listStoryMutes, listStoryViewers, sendStoryReply, setStoryMuted, unlikeStory } = await S("queries/stories.ts");
const { createGroupConversation, listConversations, sendSharedPost } = await S("queries/messages.ts");

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
const files = [];
console.log(`Staging project ${project.name} (${REF}): story actions (run ${run})${RESTORE ? ", restoring afterwards" : ""}`);

// --- 62 on staging, as production takes it ---------------------------------------------------------------------------------
const before = new Set((await sql("select name from public._migrations")).map((r) => r.name));
if (before.has(MIGRATION)) ok(`${MIGRATION} is already on staging`);
else {
  await check(`${MIGRATION} applies on its own, as the next migration, and is recorded`, async () => {
    const t0 = Date.now();
    await sql(read(`supabase/migrations/${MIGRATION}`));
    await sql(`insert into public._migrations (name) values (${lit(MIGRATION)}) on conflict do nothing`);
    console.log(`    applied in ${Date.now() - t0} ms`);
  });
}
await sql("notify pgrst, 'reload schema'");
await sleep(4000);
await check("the objects are there: story_likes and story_mutes with row-level security, the card trigger, the widened card check", async () => {
  const o = (await sql(`select
    (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('story_likes', 'story_mutes') and c.relrowsecurity) as tables,
    (select count(*)::int from pg_trigger where tgname = 'messages_guard_story_card') as trigger,
    (select pg_get_constraintdef(oid) like '%story_reply%' from pg_constraint where conname = 'messages_shared_post_check') as card_check`))[0];
  expect(o.tables === 2 && o.trigger === 1 && o.card_check === true, JSON.stringify(o));
});
const baseline = await counts();

// --- People and stories ------------------------------------------------------------------------------------------------------
async function student(name) {
  const email = `st-sa-${run}-${name}@txstate.edu`;
  const password = `Sa-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const full = `${name[0].toUpperCase()}${name.slice(1)} Stories`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: full } });
  if (error) throw new Error(error.message);
  accounts.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(s.error.message);
  return { id: data.user.id, c, name: full };
}
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/** A photo story the way the app posts one: the file in the author's stories folder, then the row (createStory). */
async function post(who, n, audience, viewerIds) {
  const path = `stories/${who.id}/sa-${run}-${n}.png`;
  const up = await who.c.storage.from("uploads").upload(path, png, { contentType: "image/png", upsert: false });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  files.push(path);
  const url = who.c.storage.from("uploads").getPublicUrl(path).data.publicUrl;
  return createStory(who.c, who.id, { photo: { url, width: 1080, height: 1920, blur: null }, audience, universityId: TX, viewerIds });
}
/** A story as the viewer of `who` holds it (listStories): what the app passes to the like, the reply and the share. */
const seen = async (who, id) => (await listStories(who.c, who.id)).find((s) => s.id === id) ?? null;
const follow = async (a, b) => {
  const { error: e1 } = await a.c.from("follows").insert({ follower_id: a.id, followee_id: b.id });
  const { error: e2 } = await b.c.from("follows").insert({ follower_id: b.id, followee_id: a.id });
  if (e1 || e2) throw new Error((e1 ?? e2).message);
};

let ann, bob, cara, dev, eve;
const st = {};
await check("five students of one campus sign in; Bob and Cara are Ann's friends, Dev is Bob's and not Ann's; Ann posts four stories", async () => {
  [ann, bob, cara, dev, eve] = await Promise.all(["ann", "bob", "cara", "dev", "eve"].map(student));
  await sql(`update public.profiles set university_id = ${lit(TX)} where id in (${accounts.map(lit).join(", ")})`);
  await follow(ann, bob);
  await follow(ann, cara);
  await follow(bob, cara);
  await follow(bob, dev);
  st.campus = await post(ann, 1, "campus");
  st.friends = await post(ann, 2, "friends");
  st.selected = await post(ann, 3, "selected", [bob.id, cara.id]);
  st.global = await post(ann, 4, "global");
  expect((await listStories(bob.c, bob.id)).filter((s) => s.author.id === ann.id).length === 4, "Bob does not see Ann's four stories");
  expect((await listStories(dev.c, dev.id)).filter((s) => s.author.id === ann.id).map((s) => s.audience).sort().join() === "campus,global", "Dev sees the wrong stories");
});

// --- Like and Unlike -------------------------------------------------------------------------------------------------------
await check("Like: Bob's heart (likeStory, PostgREST's upsert) holds after a fresh read, twice is one like, and Ann's viewer list marks it", async () => {
  await likeStory(bob.c, bob.id, st.campus);
  await likeStory(bob.c, bob.id, st.campus);
  expect((await seen(bob, st.campus)).liked === true, "Bob's story does not read liked");
  const own = await seen(ann, st.campus);
  expect(own.likes === 1, `Ann reads ${own.likes} likes`);
  await sql(`insert into public.story_views (story_id, viewer_id) values (${lit(st.campus)}, ${lit(bob.id)}) on conflict do nothing`);
  const viewers = await listStoryViewers(ann.c, st.campus);
  expect(viewers.some((v) => v.viewer.id === bob.id && v.liked), JSON.stringify(viewers));
  expect((await seen(cara, st.campus)).likes === 0, "Cara reads Bob's like");
});
await check("Unlike: Bob's unlikeStory empties the heart for him and the count for Ann", async () => {
  await unlikeStory(bob.c, bob.id, st.campus);
  expect((await seen(bob, st.campus)).liked === false && (await seen(ann, st.campus)).likes === 0, "the like is still there");
});
await check("quick taps (like, unlike, like) through the heart's requests end liked, as the screen shows; unlike, like, unlike end unliked", async () => {
  const sync = createLikeSync((v) => (v ? likeStory(cara.c, cara.id, st.global) : unlikeStory(cara.c, cara.id, st.global)), false);
  const outcome = await Promise.all([sync.set(true), sync.set(false), sync.set(true)]);
  expect(outcome[0].value === true && outcome[0].error === null && outcome[1] === null, JSON.stringify(outcome));
  expect((await seen(cara, st.global)).liked === true, "the database ended unliked");
  const back = createLikeSync((v) => (v ? likeStory(cara.c, cara.id, st.global) : unlikeStory(cara.c, cara.id, st.global)), true);
  await Promise.all([back.set(false), back.set(true), back.set(false)]);
  expect((await seen(cara, st.global)).liked === false, "the database ended liked");
});
await check("Like is refused outside the audience (Dev and the friends-only story) and on one's own story", async () => {
  await rejects(likeStory(dev.c, dev.id, st.friends), "row-level security");
  await rejects(likeStory(ann.c, ann.id, st.global), "row-level security");
});

// --- Reply -------------------------------------------------------------------------------------------------------------------
await check("Reply: Bob's words under Ann's friends-only story reach Ann's inbox in their direct chat, as a story_reply card rewritten from the story", async () => {
  const story = await seen(bob, st.friends);
  const conversationId = await sendStoryReply(bob.c, { senderId: bob.id, story: { ...story, photo: { ...story.photo, url: "https://evil.example/fake.png" } }, text: `Love this ${run}` });
  const chats = await listConversations(ann.c, ann.id);
  const chat = chats.find((c) => c.id === conversationId);
  expect(chat && chat.type === "direct" && chat.otherMembers.some((m) => m.id === bob.id), "not in Ann's inbox as her chat with Bob");
  expect(chat.lastMessagePreview === `Love this ${run}`, `inbox line: ${chat.lastMessagePreview}`);
  const { data: msgs, error } = await ann.c.from("messages").select("sender_id, content, shared_post").eq("conversation_id", conversationId);
  expect(!error && msgs.length === 1, error?.message ?? `${msgs.length} messages`);
  const card = msgs[0].shared_post;
  expect(card.kind === "story_reply" && card.target_id === st.friends && card.author.id === ann.id && card.image_url.includes(`/stories/${ann.id}/`), JSON.stringify(card));
});
await check("Reply is refused for someone outside the audience, in words: Dev under the friends-only story", async () => {
  const story = (await seen(bob, st.friends));
  await rejects(sendStoryReply(dev.c, { senderId: dev.id, story, text: "hi" }), "no longer available");
});

// --- Share -------------------------------------------------------------------------------------------------------------------
await check("Share to friends: Bob sends Ann's friends-only story to Cara (her friend) and Dev (not): Cara gets it; Dev is refused, named, for the audience", async () => {
  const card = sharedPostFromStory(await seen(bob, st.friends));
  const r = await sendSharedPost(bob.c, { senderId: bob.id, recipientIds: [cara.id, dev.id], sharedPost: card, note: "look" });
  expect(r.sent.join() === cara.id && r.failed.join() === dev.id && r.reasons[dev.id].kind === "audience", JSON.stringify(r));
  expect(shareFailureSummary([{ name: dev.name, group: false, ...r.reasons[dev.id] }], sharedPostNoun(card)) === `${dev.name} can't see this story.`, "the summary");
  const inbox = await listConversations(cara.c, cara.id);
  expect(inbox.some((c) => c.type === "direct" && c.otherMembers.some((m) => m.id === bob.id) && c.lastMessagePreview === "look"), "not in Cara's inbox");
});
await check("Share to a group: into Bob's group with Cara and Ann it goes as one message; into one with Dev it is refused for the audience", async () => {
  const card = sharedPostFromStory(await seen(bob, st.friends));
  const good = await createGroupConversation(bob.c, `Ann's friends ${run}`, [cara.id, ann.id]);
  const mixed = await createGroupConversation(bob.c, `Mixed ${run}`, [cara.id, dev.id]);
  const r = await sendSharedPost(bob.c, { senderId: bob.id, recipientIds: [], conversationIds: [good, mixed], sharedPost: card });
  expect(r.sent.join() === good && r.failed.join() === mixed && r.reasons[mixed].kind === "audience", JSON.stringify(r));
  expect(shareFailureSummary([{ name: "Mixed", group: true, ...r.reasons[mixed] }], "story") === "Some people in Mixed can't see this story.", "the summary");
  const g = (await listConversations(cara.c, cara.id)).find((c) => c.id === good);
  expect(g && g.type === "group" && g.lastMessagePreview === "Sent a story", JSON.stringify(g && { type: g.type, preview: g.lastMessagePreview }));
  const { data: none } = await dev.c.from("messages").select("id").eq("conversation_id", mixed);
  expect((none ?? []).length === 0, "Dev received something");
});
await check("Share a Selected story: Bob to Cara (picked) goes, to Dev (not picked) is refused; Campus and Global stories go to Eve and Dev", async () => {
  const picked = sharedPostFromStory(await seen(bob, st.selected));
  const r = await sendSharedPost(bob.c, { senderId: bob.id, recipientIds: [cara.id, dev.id], sharedPost: picked });
  expect(r.sent.join() === cara.id && r.reasons[dev.id]?.kind === "audience", JSON.stringify(r));
  const open = await sendSharedPost(bob.c, { senderId: bob.id, recipientIds: [eve.id], sharedPost: sharedPostFromStory(await seen(bob, st.campus)) });
  const world = await sendSharedPost(bob.c, { senderId: bob.id, recipientIds: [dev.id], sharedPost: sharedPostFromStory(await seen(bob, st.global)) });
  expect(open.sent.join() === eve.id && world.sent.join() === dev.id, JSON.stringify({ open, world }));
});
await check("Share a story that is gone: refused with 'no longer available', not a privacy reason", async () => {
  const card = sharedPostFromStory(await seen(bob, st.global));
  await deleteStory(ann.c, st.global);
  const r = await sendSharedPost(bob.c, { senderId: bob.id, recipientIds: [cara.id], sharedPost: card });
  expect(r.reasons[cara.id]?.kind === "gone", JSON.stringify(r));
});

// --- Mute --------------------------------------------------------------------------------------------------------------------
await check("Mute: Bob mutes Ann's stories (his alone to read) and unmutes", async () => {
  await setStoryMuted(bob.c, bob.id, ann.id, true);
  expect((await listStoryMutes(bob.c, bob.id)).join() === ann.id, "not muted");
  const { data } = await ann.c.from("story_mutes").select("user_id");
  expect((data ?? []).length === 0, "Ann reads Bob's mute");
  await setStoryMuted(bob.c, bob.id, ann.id, false);
  expect((await listStoryMutes(bob.c, bob.id)).length === 0, "still muted");
});

// --- Cleanup -----------------------------------------------------------------------------------------------------------------
await check("everything made is deleted; every table's row count is as at the start", async () => {
  await sql(`delete from public.messages where sender_id in (${accounts.map(lit).join(", ")})`);
  // The chats this run made: some member is one of its students and none is anyone else.
  const ours = accounts.map(lit).join(", ");
  await sql(`delete from public.conversations c where exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id in (${ours})) and not exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id not in (${ours}))`);
  if (files.length > 0) await admin.storage.from("uploads").remove(files);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  await sleep(2000);
  const after = await counts();
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== baseline[t]).map(([t, n]) => `${t}: ${baseline[t]} → ${n}`);
  expect(drift.length === 0, drift.join(", "));
});
if (RESTORE) {
  await check("62 rolled back: its rollback file and its _migrations row removed", async () => {
    await sql(read("supabase/rollbacks/20261114000000_story_actions.down.sql"));
    await sql(`delete from public._migrations where name = ${lit(MIGRATION)}`);
    expect((await val("select to_regclass('public.story_likes') is null")) === true, "story_likes still there");
  });
}
console.log(`${failures ? "✗" : "✓"} story actions on staging: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
