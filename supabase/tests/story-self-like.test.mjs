// Migration 68 (liking your own story) against PGlite: before it, a story's author cannot like their own story; after
// it they can, the like is read by the author alone as any other is, and every other rule of migration 62 still holds
// (only as yourself, only a story you may see right now, an unlike deletes your own row). Then the rollback, which
// refuses the self-like again and leaves the rows alone, and a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, ok, fail, expectOk, expectError, done } from "./harness.mjs";

const NAME = "20261120000000_story_self_like.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261120000000_story_self_like.down.sql";
const BEFORE = fs
  .readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations"))
  .filter((f) => f.endsWith(".sql") && f < NAME)
  .sort()
  .at(-1);
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

const { db, mk, as } = await boot({ upTo: BEFORE });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const val = async (q, params = []) => {
  const r = await one(db.query(q, params));
  return r[Object.keys(r)[0]];
};

const ANN = await mk("ann@txstate.edu", "Ann Author");
const CARA = await mk("cara@txstate.edu", "Cara Campus");
await db.query("update public.profiles set created_at = now() - interval '3 days'");

let fileNo = 0;
const story = async (uid, audience = "global") => {
  const name = `stories/${uid}/17300000000${String(++fileNo).padStart(2, "0")}-abc.jpg`;
  await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2::uuid, $3)", [name, uid, uid]);
  const url = `https://proj.supabase.co/storage/v1/object/public/uploads/${name}`;
  return as(uid, () => one(db.query("insert into public.stories (author_id, kind, image_url, image_meta, audience) values ($1, 'photo', $2, $3, $4) returning *", [uid, url, JSON.stringify({ width: 1080, height: 1920, blur: null }), audience])));
};
const like = (uid, storyId) => as(uid, () => db.query("insert into public.story_likes (story_id, user_id) values ($1, $2)", [storyId, uid]));

const mine = await story(ANN, "global");
await expectError("before: one's own story cannot be liked (migration 62's rule)", () => like(ANN, mine.id), "row-level security");

await expectOk(`the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read(MIGRATION));
});

await expectOk("after: the author likes their own story, and reads it as they read any like of theirs", async () => {
  await like(ANN, mine.id);
  const seen = await as(ANN, () => rows(db.query("select user_id from public.story_likes where story_id = $1", [mine.id])));
  check(seen.length === 1 && seen[0].user_id === ANN, "the author does not read their own like");
  check((await as(CARA, () => rows(db.query("select user_id from public.story_likes")))).length === 0, "somebody else reads the author's like");
});
await expectOk("after: an unlike deletes it again", async () => {
  await as(ANN, () => db.query("delete from public.story_likes where story_id = $1 and user_id = $2", [mine.id, ANN]));
  check((await val("select count(*)::int from public.story_likes where story_id = $1", [mine.id])) === 0, "the unlike did not go through");
});
await expectError("after: still nobody likes as someone else", () => as(CARA, () => db.query("insert into public.story_likes (story_id, user_id) values ($1, $2)", [mine.id, ANN])), "row-level security");
await expectOk("after: someone else may still like it, as before", () => like(CARA, mine.id));
await expectError("after: a story that is not there cannot be liked", () => like(ANN, "00000000-0000-4000-8000-000000000000"), "row-level security");
await expectOk("after: an expired story cannot be liked", async () => {
  const old = await story(ANN, "global");
  await db.query("update public.stories set expires_at = now() - interval '1 hour' where id = $1", [old.id]);
  try {
    await like(ANN, old.id);
    fail("after: an expired story cannot be liked", "the like went through");
  } catch (e) {
    check(e.message.includes("row-level security"), e.message);
  }
});

await expectOk("the rollback refuses the self-like again and leaves the rows alone", async () => {
  await db.exec(read(ROLLBACK));
  await db.exec(read(ROLLBACK));
  check((await val("select count(*)::int from public.story_likes where story_id = $1", [mine.id])) === 1, "the rollback deleted a like");
  try {
    await like(ANN, mine.id);
    throw new Error("the author still liked their own story");
  } catch (e) {
    check(e.message.includes("row-level security"), e.message);
  }
});
await expectOk("the migration applies again after its rollback", async () => {
  await db.exec(read(MIGRATION));
  await like(ANN, mine.id);
});

ok("migration 68: liking your own story");
done();
