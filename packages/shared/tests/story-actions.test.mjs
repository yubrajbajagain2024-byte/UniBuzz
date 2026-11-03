// Unit tests for what a viewer does with a story (migration 62), offline: why a shared card did not reach a chat, read
// from the database's answer (src/share.ts: shareFailureOf, shareFailureSummary); the share sheet's Send to friends and
// group chats, and the reply under a story, with a stand-in Supabase client (src/queries/messages.ts, stories.ts); and
// the heart's requests, one at a time with the last tap winning (src/stories.ts: createLikeSync). Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as in media.test.mjs).
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

const share = await import("../src/share.ts");
const { createLikeSync } = await import("../src/stories.ts");
const { sendSharedPost } = await import("../src/queries/messages.ts");
const { likeStory, sendStoryReply } = await import("../src/queries/stories.ts");

const STORY_ID = "6d074520-5a10-43ee-903a-35779a1a1fcc";
const story = { id: STORY_ID, author: { id: "ann", full_name: "Ann Author", avatar_url: null }, photo: { url: "https://cdn.example/s.jpg", width: 1080, height: 1920 }, video: null };
const storyCard = share.sharedPostFromStory(story);
const postCard = { target_type: "post", target_id: STORY_ID, kind: "post", path: `/posts/${STORY_ID}`, title: null, caption: null, image_url: null, author: { id: "ann", name: "Ann", avatar_url: null } };

// The database's own answers, as PostgREST hands them to supabase-js.
const AUDIENCE = { code: "42501", message: "Some people in this chat can't see this story." };
const GONE = { code: "42501", message: "This story is no longer available." };
const OLD_CHECK = { code: "23514", message: 'new row for relation "messages" violates check constraint "messages_shared_post_check"' };
const NO_LIKES = { code: "PGRST205", message: "Could not find the table 'public.story_likes' in the schema cache" };

/** A stand-in client: direct chats are "dm-<person>", and `refuse` maps a chat id to the error its insert gets. */
function client(refuse = {}) {
  const inserts = [];
  return {
    inserts,
    rpc: async (name, args) => (name === "get_or_create_direct_conversation" ? { data: `dm-${args.p_other_user_id}`, error: null } : { data: null, error: { message: `no ${name}` } }),
    from: (table) => ({
      insert: (row) => ({
        select: () => ({
          single: async () => {
            inserts.push({ table, ...row });
            const error = refuse[row.conversation_id];
            return error ? { data: null, error } : { data: { id: `m${inserts.length}`, ...row, attachments: null, sender: null }, error: null };
          },
        }),
      }),
      upsert: async () => ({ error: refuse.upsert ?? null }),
    }),
  };
}

test("shareFailureOf reads the database's reason: someone out of the audience, a story gone, a database without 62", () => {
  assert.deepEqual(share.shareFailureOf(AUDIENCE, storyCard), { kind: "audience", message: AUDIENCE.message });
  assert.equal(share.shareFailureOf({ code: "42501", message: "Some people in this chat can't see this post." }, postCard).kind, "audience", "a campus post's refusal (migration 45)");
  assert.equal(share.shareFailureOf(GONE, storyCard).kind, "gone");
  assert.deepEqual(share.shareFailureOf(OLD_CHECK, storyCard), { kind: "not_ready", message: share.STORY_ACTIONS_NOT_READY });
  assert.equal(share.shareFailureOf(NO_LIKES, storyCard).kind, "not_ready");
  // The same check failing on a post card is not "the server is out of date": its words are kept.
  assert.deepEqual(share.shareFailureOf(OLD_CHECK, postCard), { kind: "other", message: OLD_CHECK.message });
  assert.deepEqual(share.shareFailureOf(new TypeError("Network request failed"), storyCard), { kind: "other", message: "Network request failed" });
  assert.equal(share.shareFailureOf({}, storyCard).message, "Check your connection and try again.");
});

test("shareFailureSummary names who and which group, one line per reason, never a privacy reason for a network failure", () => {
  const f = (name, group, error) => ({ name, group, ...share.shareFailureOf(error, storyCard) });
  assert.equal(share.shareFailureSummary([f("Bob", false, AUDIENCE)], "story"), "Bob can't see this story.");
  assert.equal(share.shareFailureSummary([f("Bob", false, AUDIENCE), f("Cy", false, AUDIENCE), f("Di", false, AUDIENCE)], "story"), "Bob, Cy and Di can't see this story.");
  assert.equal(share.shareFailureSummary([f("Roommates", true, AUDIENCE)], "story"), "Some people in Roommates can't see this story.");
  assert.equal(share.shareFailureSummary([f("Bob", false, new TypeError("Network request failed"))], "story"), "Bob: Network request failed");
  assert.equal(share.shareFailureSummary([f("Bob", false, GONE), f("Cy", false, GONE)], "story"), "This story is no longer available.", "said once");
  assert.equal(share.shareFailureSummary([f("Bob", false, AUDIENCE), f("Study group", true, OLD_CHECK)], "story"), `Bob can't see this story.\n${share.STORY_ACTIONS_NOT_READY}`);
  assert.equal(share.sharedPostNoun(storyCard), "story");
  assert.equal(share.sharedPostNoun({ target_type: "post", kind: "reel" }), "reel");
  assert.equal(share.sharedPostNoun({ target_type: "item", kind: "listing" }), "listing");
});

test("sendSharedPost sends to each friend's direct chat and each group chat, and says why each failure failed", async () => {
  const c = client({ "dm-bob": AUDIENCE, "group-2": AUDIENCE });
  const r = await sendSharedPost(c, { senderId: "me", recipientIds: ["ann", "bob"], conversationIds: ["group-1", "group-2"], sharedPost: storyCard, note: "  look  " });
  assert.deepEqual(r.sent, ["ann", "group-1"]);
  assert.deepEqual(r.failed, ["bob", "group-2"]);
  assert.equal(r.reasons.bob.kind, "audience");
  assert.equal(r.reasons["group-2"].kind, "audience");
  // Every message carries the same card and the note, in the right chat: the friend's direct chat, the group as given.
  assert.deepEqual(c.inserts.map((m) => m.conversation_id), ["dm-ann", "dm-bob", "group-1", "group-2"]);
  assert.ok(c.inserts.every((m) => m.content === "look" && m.shared_post.target_type === "story" && m.shared_post.kind === "story" && m.shared_post.path === `/stories/${STORY_ID}`));
  // Without groups, as the website sends: friends only, as before.
  const w = await sendSharedPost(client(), { senderId: "me", recipientIds: ["ann"], sharedPost: postCard });
  assert.deepEqual([w.sent, w.failed, w.reasons], [["ann"], [], {}]);
});

test("sendStoryReply goes to the author's direct chat as a story_reply card; a refusal is thrown in the person's words", async () => {
  const c = client();
  assert.equal(await sendStoryReply(c, { senderId: "me", story, text: "  so good  " }), "dm-ann");
  assert.equal(c.inserts[0].conversation_id, "dm-ann");
  assert.equal(c.inserts[0].content, "so good");
  assert.equal(c.inserts[0].shared_post.kind, "story_reply");
  await assert.rejects(sendStoryReply(client({ "dm-ann": OLD_CHECK }), { senderId: "me", story, text: "hi" }), { message: share.STORY_ACTIONS_NOT_READY });
  await assert.rejects(sendStoryReply(client({ "dm-ann": GONE }), { senderId: "me", story, text: "hi" }), { message: GONE.message });
  await assert.rejects(sendStoryReply(client(), { senderId: "ann", story, text: "hi" }), /your own story/);
  await assert.rejects(sendStoryReply(client(), { senderId: "me", story, text: "   " }), /Write a reply/);
});

test("a like on a database without story_likes says so in words; other refusals keep theirs", async () => {
  await assert.rejects(likeStory(client({ upsert: NO_LIKES }), "me", STORY_ID), { message: share.STORY_ACTIONS_NOT_READY });
  await assert.rejects(likeStory(client({ upsert: { code: "42501", message: "new row violates row-level security policy" } }), "me", STORY_ID), /row-level security/);
  await likeStory(client(), "me", STORY_ID);
});

/** A send that waits until `release()`, recording each value it was asked to set. */
function slowSend(fail = () => false) {
  const sent = [];
  const waiting = [];
  return {
    sent,
    send: (v) => new Promise((resolve, reject) => { sent.push(v); waiting.push(() => (fail(v) ? reject(new Error(`no ${v}`)) : resolve())); }),
    release: async () => { while (waiting.length) { waiting.shift()(); await new Promise((r) => setTimeout(r, 0)); } },
  };
}

test("createLikeSync: requests go one at a time and the last tap wins", async () => {
  // Like, then Unlike while the like is out: the unlike follows it, so the database ends unliked, as the screen shows.
  let s = slowSend();
  let sync = createLikeSync(s.send, false);
  const first = sync.set(true);
  assert.equal(await sync.set(false), null, "a tap joining a running request reports nothing");
  await s.release();
  assert.deepEqual(await first, { value: false, error: null, attempted: false });
  assert.deepEqual(s.sent, [true, false]);
  // Like, Unlike, Like while the first like is out: nothing more to send.
  s = slowSend();
  sync = createLikeSync(s.send, false);
  const run = sync.set(true);
  void sync.set(false);
  void sync.set(true);
  await s.release();
  assert.deepEqual(await run, { value: true, error: null, attempted: true });
  assert.deepEqual(s.sent, [true]);
  // A tap to what the database already holds sends nothing.
  s = slowSend();
  sync = createLikeSync(s.send, true);
  assert.deepEqual(await sync.set(true), { value: true, error: null, attempted: true });
  assert.deepEqual(s.sent, []);
});

test("createLikeSync: a failure stops the run, goes back to what the database holds, and is reported once", async () => {
  const s = slowSend((v) => v === true);
  const sync = createLikeSync(s.send, false);
  const run = sync.set(true);
  await s.release();
  const out = await run;
  assert.equal(out.value, false);
  assert.equal(out.attempted, true);
  assert.match(out.error.message, /no true/);
  assert.equal(sync.wanted(), false, "the heart goes back");
  // The next tap starts afresh.
  const again = createLikeSync(async () => {}, false);
  assert.deepEqual(await again.set(true), { value: true, error: null, attempted: true });
});
