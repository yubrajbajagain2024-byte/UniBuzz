// Discover (44 and 46) and Buzz (51 to 54) applied to production on their own, ahead of the Business v2 release,
// rehearsed offline the way 58 to 61 were: a database in production's state (production's migration order, the
// migrations applied outside this repo, 47 and 58 to 62 applied although 44, 46 and 49 to 57 are not), with
// posts of every audience, buzzes and prompt answers from before 53 in it; then the two transactions exactly as
// production will run them, one query each, every file followed by its public._migrations row: Discover (44, then 46,
// which ranks Global posts only and refreshes before the transaction ends) and Buzz (51, 52, 53, 54). A failure part-way
// applies nothing. Discover and Buzz are checked through the API roles; then the rest of the release (49, 50, 55, 56, 57)
// applies after them, in file order, as `npm run db:setup` will, and both still work; then the documented undo (the
// six rollbacks newest first, each deleting its row, in one query) leaves the schema of a database that never had them
// except buzz_posts.category, which 54's rollback keeps on purpose; then the two transactions again.
import { boot, read, expectOk, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";
import { BUZZ_GUIDELINES_VERSION as VERSION } from "../../packages/shared/src/buzz/constants.ts";

const DISCOVER = ["20261103000300_discover.sql", "20261104000100_discover_audience.sql"];
const BUZZ = ["20261108000000_buzz_reply_tree.sql", "20261108000100_buzz_top_reply.sql", "20261108000200_buzz_prompt_threads.sql", "20261108000300_buzz_categories.sql"];
// The release these go ahead of, in file order.
const REST = [
  "20261107000000_business_teams.sql",
  "20261107000100_business_ads.sql",
  "20261109000000_media_server_fields.sql",
  "20261109000100_business_hardening.sql",
  "20261110000000_business_hours.sql",
  "20261115000000_console_business.sql",
];
// Others going to production on their own, left out until they are live. 62 (story actions) went live on 2026-11-02,
// so production's state includes it; none waits today.
const AHEAD = [];
const check = (cond, message) => { if (!cond) throw new Error(message); };

const { db, mk, as, asAnon, asService } = await boot({ live: true, skip: [...DISCOVER, ...BUZZ, ...REST, ...AHEAD] });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const val = async (p) => {
  const row = (await p).rows[0];
  return row ? row[Object.keys(row)[0]] : undefined;
};
const has = async (sql) => Boolean((await one(db.query(sql))).ok);

// Production's tracking table, as `npm run db:setup` made it (scripts/supabase-setup.mjs).
const TRACKING = "create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now()); alter table public._migrations enable row level security;";
await db.exec(TRACKING);
/** One transaction as production runs it (supabase/CLAUDE.md): a single query, each file followed by its tracking row. */
const sqlOf = (files) => files.map((f) => `${read(`migrations/${f}`)}\n;\ninsert into public._migrations (name) values ('${f}');`).join("\n");
const apply = (files) => db.exec(sqlOf(files));
/** The documented undo, as one query: the rollbacks newest first, each deleting its tracking row. */
const undo = (files) =>
  db.exec([...files].reverse().map((f) => `${read(`rollbacks/${f.replace(/\.sql$/, ".down.sql")}`)}\n;\ndelete from public._migrations where name = '${f}';`).join("\n"));
const recorded = async (files) => Number(await val(db.query("select count(*) from public._migrations where name = any($1)", [files])));
const NO_BUZZ_YET = "to_regclass('public.buzz_prompt_threads') is null and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'buzz_posts' and column_name = 'category')";

await expectOk("before: production's state (47 and 58 to 62 applied; 44, 46 and 49 to 57 not)", async () => {
  check(await has("select to_regclass('public.stories') is not null and to_regclass('public.events') is not null and to_regclass('public.story_likes') is not null and to_regclass('public.businesses') is not null as ok"), "a live migration is missing");
  check(await has(`select to_regclass('public.discover_post_ranks') is null and to_regclass('public.ads') is null and ${NO_BUZZ_YET} as ok`), "not production's state");
});

// --- What production already holds: posts of every audience, buzzes, prompt answers from before 53 ------------------
const TX = await val(db.query("select id from public.universities where email_domain = 'txstate.edu'"));
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, min_campus_size = 1");
const user = async (email, name) => {
  const uid = await mk(email, name);
  await db.query("update public.profiles set university_id = $2, created_at = now() - interval '30 days' where id = $1", [uid, TX]);
  await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [VERSION]));
  return uid;
};
const ANA = await user("ana@txstate.edu", "Ana Alvarez");
const BO = await user("bo@txstate.edu", "Bo Brooks");
const CY = await user("cy@txstate.edu", "Cy Chen");
const DEE = await user("dee@txstate.edu", "Dee Diaz");
const EVE = await user("eve@txstate.edu", "Eve Evans");

// Ana and Bo are friends (they follow each other); Ana posts to three audiences.
await as(ANA, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [ANA, BO]));
await as(BO, () => db.query("insert into public.follows (follower_id, followee_id) values ($1, $2)", [BO, ANA]));
const post = (audience, body) =>
  as(ANA, async () => (await one(db.query("insert into public.feed_posts (author_id, university_id, kind, body, audience) values ($1, $2, 'post', $3, $4) returning id", [ANA, TX, body, audience]))).id);
const P = {
  global: await post("global", "Open mic tonight #openmic"),
  campus: await post("campus", "Bobcats only #campusnight"),
  friends: await post("friends", "Dinner at mine #friendsdinner"),
};
const PRIVATE_TAGS = ["campusnight", "friendsdinner"];

const unrated = (uid) => db.query("delete from public.buzz_rate_log where user_id = $1", [uid]);
const call = (uid, fn, args) => as(uid, () => val(db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)));
const create = async (uid, input) => {
  await unrated(uid);
  return asService(() => val(db.query("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null) as r", [uid, JSON.stringify(input)])));
};
const reply = async (uid, thread, text, parentId = null) => {
  await unrated(uid);
  return asService(() => val(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null) as r", [uid, thread, JSON.stringify(parentId ? { text, parentId } : { text })])));
};
const feed = async (uid) => (await call(uid, "buzz_v2_feed", ["campus", "new", "day", null, 50, 0, null])).items;
// Today's prompt by the rule Buzz has always used (53 adds buzz_v2_today_prompt() for it).
const PROMPT = await one(db.query("select p.id, p.text from public.buzz_prompts p where p.idx = (floor(extract(epoch from now()) / 86400)::bigint % (select count(*) from public.buzz_prompts))::int"));
const OLD = {
  thread: await create(ANA, { text: "Which dining hall is best on a Sunday?" }),
  blank: await create(BO, { text: "an answer from before, with no title", promptId: PROMPT.id }),
  typed: await create(CY, { title: "Sunrise at the river", text: "an answer from before, with a title of its own", promptId: PROMPT.id }),
};

// --- Discover: 44 and 46 in one transaction ---------------------------------------------------------------------------
await expectOk("Discover applies as one transaction (44, its row, 46, its row)", async () => {
  await apply(DISCOVER);
  check((await recorded(DISCOVER)) === 2, "rows");
});

const ranked = async () => (await rows(db.query("select post_id from public.discover_post_ranks"))).map((r) => r.post_id);
const trending = async (run) => (await run(() => rows(db.query("select tag from public.discover_topics(50)")))).map((r) => r.tag);
/** Discover through the API roles; `refresh` runs the job pg_cron runs every ten minutes on production first. */
async function discoverWorks(label, { refresh = true } = {}) {
  await expectOk(`${label}: only the Global post is ranked and only its #tag trends, for anyone signed in or out; only the database refreshes the rankings`, async () => {
    if (refresh) await db.query("select public.discover_refresh()");
    const ids = await ranked();
    check(ids.includes(P.global) && !ids.includes(P.campus) && !ids.includes(P.friends), JSON.stringify(ids));
    for (const [who, run] of [["signed out", asAnon], ["a friend", (fn) => as(BO, fn)], ["the author", (fn) => as(ANA, fn)]]) {
      const tags = await trending(run);
      check(tags.includes("openmic"), `${who}: #openmic is missing`);
      for (const t of PRIVATE_TAGS) check(!tags.includes(t), `${who} sees #${t}`);
    }
    let refused = false;
    try { await as(ANA, () => db.query("select public.discover_refresh()")); } catch (e) { refused = /permission denied/.test(e.message); }
    check(refused, "a student ran discover_refresh()");
  });
}
// Right after the transaction, before any refresh of our own: 46 re-ranked inside it.
await discoverWorks("Discover, as the transaction left it", { refresh: false });

// --- Buzz: 51 to 54 in one transaction --------------------------------------------------------------------------------
await expectOk("a Buzz transaction that fails part-way applies nothing and records nothing", async () => {
  let failed = false;
  try { await db.exec(`${sqlOf(BUZZ)}\n;\nselect 1 / 0;`); } catch { failed = true; }
  check(failed, "it did not fail");
  check(await has(`select ${NO_BUZZ_YET} as ok`), "part of Buzz was applied");
  check((await recorded(BUZZ)) === 0, "a row was recorded");
});
await expectOk("Buzz applies as one transaction (51, 52, 53, 54, each with its row)", async () => {
  await apply(BUZZ);
  check((await recorded(BUZZ)) === 4, "rows");
});
await expectOk("53 gave the older prompt answer with no title its prompt, and kept the title the other one's author wrote", async () => {
  const title = (id) => val(db.query("select title from public.buzz_posts where id = $1", [id]));
  check((await title(OLD.blank.id)) === PROMPT.text.slice(0, 100), "the blank title was not filled");
  check((await title(OLD.typed.id)) === "Sunrise at the river", "the author's title was overwritten");
});

let asked, chain, top, promptThread;
/** Buzz through the API roles: the checks that must hold right away, after the release, and after the undo and again. */
async function buzzWorks(label) {
  await expectOk(`${label}: a category is kept and shown; replies nest at any depth; a reply with 3 upvotes is the card's top reply; today's prompt has one thread`, async () => {
    asked ??= await create(ANA, { text: "Is the 8am stats lecture worth going to?", category: "question" });
    check((await feed(BO)).find((b) => b.id === asked.id)?.category === "question", "the category is not shown");

    if (!chain) {
      const a = await reply(BO, OLD.thread.id, "Commons, every time");
      const b = await reply(CY, OLD.thread.id, "Commons is closed on Sundays", a.id);
      const c = await reply(DEE, OLD.thread.id, "It opened again in October", b.id);
      chain = { a, b, c };
    }
    const items = (await call(ANA, "buzz_v2_thread", [OLD.thread.id, 50])).replies.items;
    const parent = Object.fromEntries(items.map((r) => [r.id, r.treeParentId]));
    check(parent[chain.b.id] === chain.a.id && parent[chain.c.id] === chain.b.id, JSON.stringify(parent));

    if (!top) {
      for (const v of [CY, DEE, EVE]) {
        await unrated(v);
        await call(v, "buzz_v2_vote", [chain.a.id, 1]);
      }
      top = chain.a;
    }
    check((await feed(BO)).find((b) => b.id === OLD.thread.id)?.topReply?.id === top.id, "no top reply on the card");

    promptThread ??= await call(EVE, "buzz_v2_prompt_thread", [PROMPT.id, "campus"]);
    const meta = await call(BO, "buzz_v2_meta", ["campus"]);
    check(meta.prompt.id === PROMPT.id && meta.prompt.threadId === promptThread, JSON.stringify(meta.prompt));
  });
}
await buzzWorks("Buzz, as the transaction left it");

// --- The rest of the release after them -------------------------------------------------------------------------------
await expectOk("the rest of the release (49, 50, 55, 56, 57) applies after them, in file order, as db:setup will", async () => {
  for (const f of [...REST, ...AHEAD]) await db.exec(read(`migrations/${f}`));
  check(await has("select to_regclass('public.ads') is not null and exists (select 1 from pg_constraint where conname = 'businesses_hours_check') as ok"), "the release is missing");
});
await discoverWorks("after the release");
await buzzWorks("after the release");

// --- The documented undo, then both again -----------------------------------------------------------------------------
await expectOk("the undo (rollbacks newest first, rows deleted, one query) leaves the schema of a database that never had them, but for 54's category, kept on purpose", async () => {
  await undo([...DISCOVER, ...BUZZ]);
  check((await recorded([...DISCOVER, ...BUZZ])) === 0, "rows were left");
  const reference = await boot({ live: true, skip: [...DISCOVER, ...BUZZ] });
  await reference.db.exec(TRACKING);
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  await reference.db.close();
  const kept = ["column buzz_posts.category: added", "constraint buzz_posts.buzz_posts_category_check: added"];
  check(JSON.stringify(changed) === JSON.stringify(kept), changed.join("; "));
});
await expectOk("both transactions apply again afterwards", async () => {
  await apply(DISCOVER);
  await apply(BUZZ);
  check((await recorded([...DISCOVER, ...BUZZ])) === 6, "rows");
});
await discoverWorks("applied again");
await buzzWorks("applied again");

done("DISCOVER AND BUZZ AHEAD OF THE RELEASE (44, 46 AND 51 TO 54 AFTER 62, THEN 49, 50, 55 TO 57)");
