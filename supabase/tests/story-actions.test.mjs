// Migration 62 (what a viewer can do with a story) against PGlite: likes only on a story the person may see right now,
// never their own, read by the liker and the author alone, gone with the story; mutes that are their owner's alone;
// 'story' reports filed through the reports table, queued, shown to staff with the story's media, removed by staff;
// story cards in chats, refused when the story is gone, expired, unseen by the sender or by anyone else in the chat,
// across a block, or (a reply) sent anywhere but a chat with the author, and rewritten from the story row; the inbox
// line and the quote of a story card; the rollback, which refuses while story rows remain, then restores 61's schema
// exactly, and a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, ok, fail, expectOk, expectError, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";

const NAME = "20261114000000_story_actions.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261114000000_story_actions.down.sql";
const BEFORE = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const check = (cond, message) => { if (!cond) throw new Error(message); };
const expectRefused = async (name, fn, message) => {
  try { await fn(); fail(name, "no error"); } catch (e) { if (e.message.includes(message)) ok(name); else fail(name, `${e.code}: ${e.message}`); }
};

const { db, mk, as } = await boot({ upTo: BEFORE });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const val = async (q, params = []) => { const r = await one(db.query(q, params)); return r[Object.keys(r)[0]]; };
await expectOk(`the migration applies after ${BEFORE} and re-runs cleanly`, async () => { await db.exec(read(MIGRATION)); await db.exec(read(MIGRATION)); });

const UT = await val("select id from public.universities where name = 'University of Texas at Austin'");
await db.query("update public.universities set email_domain = 'utexas.edu' where id = $1", [UT]);
const ANN = await mk("ann@txstate.edu", "Ann Author");
const CARA = await mk("cara@txstate.edu", "Cara Campus"); // Ann's campus
const DEV = await mk("dev@txstate.edu", "Dev Campus"); // Ann's campus too
const OLI = await mk("oli@utexas.edu", "Oli Other"); // another campus
const BLK = await mk("bo@txstate.edu", "Bo Blocker"); // Ann's campus; blocks Ann later
const MOD = await mk("mod@txstate.edu", "Mo Moderator");
await db.query("insert into public.staff_members (user_id, role) values ($1, 'moderator')", [MOD]);
// Accounts a day old, so their reports carry weight (migration 41's eligibility).
await db.query("update public.profiles set created_at = now() - interval '3 days'");

const HOST = "https://proj.supabase.co";
let fileNo = 0;
const upload = async (owner) => {
  const name = `stories/${owner}/17300000000${String(++fileNo).padStart(2, "0")}-abc.jpg`;
  await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [name, owner, owner]);
  return `${HOST}/storage/v1/object/public/uploads/${name}`;
};
const story = async (uid, audience = "global") => {
  const url = await upload(uid);
  return as(uid, () => one(db.query("insert into public.stories (author_id, kind, image_url, image_meta, audience) values ($1, 'photo', $2, $3, $4) returning *", [uid, url, JSON.stringify({ width: 1080, height: 1920, blur: null }), audience])));
};
const like = (uid, storyId) => as(uid, () => db.query("insert into public.story_likes (story_id, user_id) values ($1, $2)", [storyId, uid]));
const dm = (a, b) => as(a, () => val("select public.get_or_create_direct_conversation($1) as id", [b]));
const card = (id, kind = "story", extra = {}) => JSON.stringify({ target_type: "story", target_id: id, kind, path: `/stories/${id}`, title: "Forged", caption: null, image_url: "https://evil.example/fake.jpg", author: { id: CARA, name: "Not Ann", avatar_url: null }, ...extra });
const send = (uid, conv, shared, content = "") => as(uid, () => one(db.query("insert into public.messages (conversation_id, sender_id, content, shared_post) values ($1, $2, $3, $4::jsonb) returning *", [conv, uid, content, shared])));

const campus = await story(ANN, "campus");
const global = await story(ANN, "global");

// --- Likes ----------------------------------------------------------------------------------------------------------
await expectOk("likes: someone on the campus likes a campus story; the author and the liker read the like, nobody else", async () => {
  await like(CARA, campus.id);
  await like(DEV, campus.id);
  check((await as(ANN, () => rows(db.query("select user_id from public.story_likes where story_id = $1", [campus.id])))).length === 2, "the author does not read both likes");
  const own = await as(CARA, () => rows(db.query("select user_id from public.story_likes where story_id = $1", [campus.id])));
  check(own.length === 1 && own[0].user_id === CARA, "the liker reads someone else's like");
  check((await as(OLI, () => rows(db.query("select user_id from public.story_likes")))).length === 0, "a stranger reads likes");
});
await expectError("likes: a story outside one's audience cannot be liked (another campus)", () => like(OLI, campus.id), "row-level security");
await expectError("likes: one's own story cannot be liked", () => like(ANN, global.id), "row-level security");
await expectError("likes: nobody likes as someone else", () => as(OLI, () => db.query("insert into public.story_likes (story_id, user_id) values ($1, $2)", [global.id, CARA])), "row-level security");
await expectError("likes: twice is one like", () => like(CARA, campus.id), "story_likes_pkey");
await expectOk("likes: an unlike deletes one's own like only", async () => {
  await as(ANN, () => db.query("delete from public.story_likes where story_id = $1", [campus.id]));
  check((await val("select count(*)::int from public.story_likes where story_id = $1", [campus.id])) === 2, "the author deleted likes");
  await as(DEV, () => db.query("delete from public.story_likes where story_id = $1 and user_id = $2", [campus.id, DEV]));
  check((await val("select count(*)::int from public.story_likes where story_id = $1", [campus.id])) === 1, "the unlike did not go through");
});
await expectOk("likes: an expired story cannot be liked, and its likes go with it", async () => {
  const old = await story(ANN, "global");
  await like(CARA, old.id);
  await db.query("update public.stories set expires_at = now() - interval '1 minute' where id = $1", [old.id]);
  let refused = false;
  try { await like(DEV, old.id); } catch (e) { refused = /row-level security/.test(e.message); }
  check(refused, "an expired story was liked");
  await db.query("delete from public.stories where id = $1", [old.id]);
  check((await val("select count(*)::int from public.story_likes where story_id = $1", [old.id])) === 0, "likes outlived the story");
});
await expectOk("likes: the API cannot write a like's time", async () => {
  try {
    await as(DEV, () => db.query("insert into public.story_likes (story_id, user_id, created_at) values ($1, $2, '2020-01-01')", [global.id, DEV]));
    throw new Error("written");
  } catch (e) { check(/permission denied/.test(e.message), e.message); }
});

// --- Mutes ----------------------------------------------------------------------------------------------------------
await expectOk("mutes: someone mutes Ann's stories and reads it; Ann never sees it; an unmute deletes it", async () => {
  await as(CARA, () => db.query("insert into public.story_mutes (user_id, author_id) values ($1, $2)", [CARA, ANN]));
  check((await as(CARA, () => rows(db.query("select author_id from public.story_mutes")))).length === 1, "the owner does not read the mute");
  check((await as(ANN, () => rows(db.query("select * from public.story_mutes")))).length === 0, "the muted person reads the mute");
  await as(CARA, () => db.query("delete from public.story_mutes where author_id = $1", [ANN]));
  check((await val("select count(*)::int from public.story_mutes")) === 0, "the unmute did not go through");
});
await expectError("mutes: nobody mutes for someone else", () => as(OLI, () => db.query("insert into public.story_mutes (user_id, author_id) values ($1, $2)", [CARA, ANN])), "row-level security");
await expectError("mutes: nobody mutes themselves", () => as(ANN, () => db.query("insert into public.story_mutes (user_id, author_id) values ($1, $2)", [ANN, ANN])), "story_mutes_not_self");

// --- Story cards in chats -------------------------------------------------------------------------------------------
let reply, convAnn;
await expectOk("cards: a reply to Ann's story goes to her chat, its picture and author rewritten from the story row", async () => {
  convAnn = await dm(CARA, ANN);
  reply = await send(CARA, convAnn, card(campus.id, "story_reply"), "Love this!");
  const s = reply.shared_post;
  check(s.kind === "story_reply" && s.image_url === campus.image_url && s.author.id === ANN && s.author.name === "Ann Author" && s.title === null, JSON.stringify(s));
});
await expectOk("cards: a story shared without words names itself in the inbox line", async () => {
  const conv = await dm(CARA, DEV);
  await send(CARA, conv, card(campus.id, "story"));
  check((await val("select last_message_preview from public.conversations where id = $1", [conv])) === "Sent a story", "preview");
});
await expectOk("cards: a reply's inbox line is its words, and a reply without words reads 'Replied to a story'", async () => {
  check((await val("select last_message_preview from public.conversations where id = $1", [convAnn])) === "Love this!", "words");
  check((await val("select public.message_preview('', $1::jsonb, '[]'::jsonb, null::jsonb)", [card(campus.id, "story_reply")])) === "Replied to a story", "no words");
});
await expectOk("cards: a reply quoting a story card quotes a 'story'", async () => {
  const quoted = await as(ANN, () => one(db.query("insert into public.messages (conversation_id, sender_id, content, reply_to) values ($1, $2, 'Thanks!', $3::jsonb) returning reply_to", [convAnn, ANN, JSON.stringify({ id: reply.id })])));
  check(quoted.reply_to.kind === "story", JSON.stringify(quoted.reply_to));
});
await expectRefused("cards: a campus story shared into a chat with someone from another campus is refused", async () => send(CARA, await dm(CARA, OLI), card(campus.id)), "Some people in this chat can't see this story.");
await expectRefused("cards: someone outside the audience cannot send it at all", async () => send(OLI, await dm(OLI, ANN), card(campus.id, "story_reply"), "hi"), "This story is no longer available.");
await expectRefused("cards: a reply goes only to a chat with the author", async () => send(CARA, await dm(CARA, DEV), card(campus.id, "story_reply"), "hi"), "A reply to a story goes to the person who shared it.");
await expectRefused("cards: the author does not reply to her own story", async () => send(ANN, convAnn, card(campus.id, "story_reply"), "me"), "A reply to a story goes to the person who shared it.");
await expectOk("cards: the author shares her own story", async () => {
  const m = await send(ANN, await dm(ANN, DEV), card(global.id));
  check(m.shared_post.kind === "story" && m.shared_post.author.id === ANN, JSON.stringify(m.shared_post));
});
await expectRefused("cards: an expired story is refused", async () => {
  const old = await story(ANN, "global");
  await db.query("update public.stories set expires_at = now() - interval '1 minute' where id = $1", [old.id]);
  return send(CARA, convAnn, card(old.id, "story_reply"), "late");
}, "This story is no longer available.");
await expectRefused("cards: a story that does not exist is refused", () => send(CARA, convAnn, card("00000000-0000-4000-8000-000000000009", "story_reply"), "?"), "This story is no longer available.");
await expectOk("cards: a story card's kind and link are the server's: a stated 'post' is a share, a forged link is rebuilt", async () => {
  const m = await send(CARA, convAnn, card(global.id, "post", { path: `/posts/${global.id}` }));
  check(m.shared_post.kind === "story" && m.shared_post.path === `/stories/${global.id}`, JSON.stringify(m.shared_post));
});
await expectError("cards: other cards still cannot take a story's kind", () => send(CARA, convAnn, JSON.stringify({ target_type: "post", target_id: global.id, kind: "story", path: `/posts/${global.id}` })), "messages_shared_post_check");
await expectOk("cards: other cards are as before (a post card keeps its words)", async () => {
  const post = await as(ANN, () => one(db.query("insert into public.feed_posts (author_id, body) values ($1, 'Hello') returning id", [ANN])));
  const m = await send(CARA, convAnn, JSON.stringify({ target_type: "post", target_id: post.id, kind: "post", path: `/posts/${post.id}`, title: "Mine", caption: "words", image_url: null, author: { id: ANN, name: "Ann", avatar_url: null } }));
  check(m.shared_post.title === "Mine" && m.shared_post.kind === "post", JSON.stringify(m.shared_post));
});
// --- Group chats and every audience: each member must be able to see the story, the sender included ---------------------
const group = (owner, name, members) => as(owner, () => val("select public.create_group_conversation($1, $2::uuid[]) as id", [name, members]));
const follow = async (a, b) => { await db.query("insert into public.follows (follower_id, followee_id) values ($1, $2), ($2, $1) on conflict do nothing", [a, b]); };
await expectOk("groups: a campus story goes into a group whose members are all on the campus, as one message, named in its inbox line", async () => {
  const g = await group(CARA, "Study group", [DEV, ANN]);
  const m = await send(CARA, g, card(campus.id));
  check(m.conversation_id === g && m.shared_post.kind === "story" && m.shared_post.author.id === ANN, JSON.stringify(m.shared_post));
  check((await val("select last_message_preview from public.conversations where id = $1", [g])) === "Sent a story", "inbox line");
  check((await val("select count(*)::int from public.messages where conversation_id = $1", [g])) === 1, "not one message");
});
await expectRefused("groups: a campus story into a group with someone from another campus is refused, naming no one", async () => send(CARA, await group(CARA, "Mixed", [DEV, OLI]), card(campus.id)), "Some people in this chat can't see this story.");
await expectOk("groups: a global story goes into any group", async () => { await send(CARA, await group(CARA, "Anyone", [DEV, OLI]), card(global.id)); });
const friendsOnly = await story(ANN, "friends");
await follow(ANN, CARA);
await follow(ANN, DEV);
await follow(CARA, OLI);
await expectOk("friends: Ann's friend shares her friends-only story with another of Ann's friends, and into a group with Ann in it", async () => {
  await send(CARA, await dm(CARA, DEV), card(friendsOnly.id));
  await send(CARA, await group(CARA, "Ann's friends", [DEV, ANN]), card(friendsOnly.id));
});
await expectRefused("friends: not with Cara's own friend who is not Ann's", async () => send(CARA, await dm(CARA, OLI), card(friendsOnly.id)), "Some people in this chat can't see this story.");
await expectRefused("friends: nor into a group with them", async () => send(CARA, await group(CARA, "Cara's friends", [DEV, OLI]), card(friendsOnly.id)), "Some people in this chat can't see this story.");
await expectRefused("friends: someone who is not Ann's friend cannot share it at all", async () => send(OLI, await dm(OLI, CARA), card(friendsOnly.id)), "This story is no longer available.");
const picked = await story(ANN, "selected");
await as(ANN, () => db.query("select public.set_story_viewers($1, $2::uuid[])", [picked.id, [CARA, DEV]]));
await expectOk("selected: someone Ann picked shares it with someone else she picked", async () => { await send(CARA, await dm(CARA, DEV), card(picked.id)); });
await expectRefused("selected: not with anyone she did not pick", async () => send(CARA, await dm(CARA, BLK), card(picked.id)), "Some people in this chat can't see this story.");
await expectOk("selected: Ann herself shares it only where everyone was picked", async () => {
  await send(ANN, await group(ANN, "Picked", [CARA, DEV]), card(picked.id));
  try { await send(ANN, await dm(ANN, BLK), card(picked.id)); throw new Error("sent to someone not picked"); } catch (e) { check(e.message.includes("can't see this story"), e.message); }
});
await expectOk("groups: a reply under a story goes to the direct chat with the author, never a group without her", async () => {
  try { await send(CARA, await group(CARA, "No Ann", [DEV]), card(campus.id, "story_reply"), "hi"); throw new Error("a reply went into a group without the author"); } catch (e) { check(e.message.includes("A reply to a story goes to the person who shared it."), e.message); }
  const m = await send(CARA, await dm(CARA, ANN), card(campus.id, "story_reply"), "so good");
  check(m.shared_post.kind === "story_reply" && (await val("select last_message_preview from public.conversations where id = $1", [m.conversation_id])) === "so good", "the reply's inbox line");
});

await expectOk("cards and likes: across a block, neither goes through", async () => {
  await as(BLK, () => db.query("insert into public.story_likes (story_id, user_id) values ($1, $2)", [global.id, BLK]));
  const conv = await dm(BLK, DEV);
  await as(BLK, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [BLK, ANN]));
  let refusedLike = false;
  try { await like(BLK, campus.id); } catch (e) { refusedLike = /row-level security/.test(e.message); }
  check(refusedLike, "a like across a block");
  let refusedCard = false;
  try { await send(BLK, conv, card(global.id)); } catch (e) { refusedCard = e.message.includes("This story is no longer available."); }
  check(refusedCard, "a card across a block");
  // Dev may see it, but Bo is in a chat with Dev: a share from Dev to Bo is refused for Bo's block.
  let refusedShare = false;
  try { await send(DEV, conv, card(global.id)); } catch (e) { refusedShare = e.message.includes("Some people in this chat can't see this story."); }
  check(refusedShare, "a share to someone across a block");
});

// --- Reports --------------------------------------------------------------------------------------------------------
let reported;
await expectOk("reports: a story is reported through the reports table and queued, with its photo for staff", async () => {
  reported = await story(ANN, "global");
  await as(CARA, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'story', $2, 'harassment')", [CARA, reported.id]));
  const q = await one(db.query("select entity_type, status, report_count from public.mod_queue where entity_id = $1", [reported.id]));
  check(q && q.entity_type === "story" && q.status === "open", JSON.stringify(q));
  const s = await val("select public.ts_snapshot('story', $1)", [reported.id]);
  check(s.label === "story" && s.media[0].url === reported.image_url && s.href === `/profile/${ANN}` && s.fields.length === 2, JSON.stringify(s));
  check((await val("select public.ts_author_of('story', $1)", [reported.id])) === ANN, "author");
});
await expectRefused("reports: the author cannot report her own story", () => as(ANN, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'story', $2, 'spam')", [ANN, reported.id])), "You can't report your own content.");
await expectRefused("reports: a story that is gone cannot be reported", () => as(CARA, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'story', '00000000-0000-4000-8000-000000000009', 'spam')", [CARA])), "That content isn't available.");
await expectOk("reports: staff's Remove deletes the story", async () => {
  await db.query("select public.ts_set_content_status('story', $1, 'removed')", [reported.id]);
  check((await val("select count(*)::int from public.stories where id = $1", [reported.id])) === 0, "the story stayed");
  check((await val("select public.ts_snapshot('story', $1) is null", [reported.id])) === true, "the snapshot stayed");
});
await expectOk("reports: other types are unchanged ('post' still reports, Buzz still refuses the table)", async () => {
  const types = await val("select pg_get_constraintdef(oid) from pg_constraint where conname = 'reports_target_type_check'");
  for (const t of ["apartment", "buzz", "buzz_comment", "comment", "item", "message", "post", "profile", "roommate", "story"]) check(types.includes(`'${t}'`), `${t} missing: ${types}`);
});
await expectOk("the new functions are closed to the API", async () => {
  for (const f of ["public.ts_story_snapshot(uuid)", "public.guard_message_story_card()"]) {
    const can = await val("select has_function_privilege('authenticated', $1, 'execute') or has_function_privilege('anon', $1, 'execute')", [f]);
    check(can === false, `${f} is callable`);
  }
  check((await val("select has_table_privilege('anon', 'public.story_likes', 'select') or has_table_privilege('anon', 'public.story_mutes', 'select')")) === false, "anon reads the tables");
});

// --- Rollback -------------------------------------------------------------------------------------------------------
await expectError("the rollback refuses while chats hold story cards", () => db.exec(read(ROLLBACK)), "Chats still hold story cards");
await expectOk("with the story cards and reports deleted, the rollback restores 61's schema exactly; the migration applies again", async () => {
  await db.query("delete from public.messages where shared_post ->> 'target_type' = 'story'");
  await db.query("delete from public.reports where target_type = 'story'");
  await db.exec(read(ROLLBACK));
  const reference = await boot({ upTo: BEFORE });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
  await db.exec(read(MIGRATION));
  check((await val("select to_regclass('public.story_likes') is not null and to_regclass('public.story_mutes') is not null")) === true, "not re-applied");
});

done("MIGRATION-62 STORY ACTIONS");
