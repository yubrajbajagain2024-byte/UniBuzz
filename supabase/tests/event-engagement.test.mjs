// Migration 69 (likes, comments and who is going, on events) against PGlite. Before it an event cannot be liked. After
// it: a like and a comment on an event anyone may see, counted by post_engagement and post_engagement_many; neither on
// an event the reader may not see (hidden), whose comments nobody else reads either; a reply on an event's thread
// links to /events/<id>; nobody is notified of a like on an event. Who is going: your own row only, on an event you may
// see, read by everyone signed in who may see the event (the owner's choice) less anyone blocked either way, nothing
// for the signed-out, counted by event_going_many. Then the rollback (event likes and comments gone, the type refused
// again, who is going gone) and a second apply. All of it in the repo's order and in production's.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const NAME = "20261121000000_event_engagement.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261121000000_event_engagement.down.sql";
const BEFORE = fs
  .readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations"))
  .filter((f) => f.endsWith(".sql") && f < NAME)
  .sort()
  .at(-1);
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

// Twice: in this repo's order, and in production's (boot({ live: true })), where CampConnect Admin's moderation
// (applied-outside-repo) adds target_visible() to the insert policies of likes and comments. The first rehearsal ran in
// the repo's order alone and missed it; staging refused every like on an event until 69 taught target_visible 'event'.
for (const live of [false, true]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  // Without 69 an event is refused by the type check, or first by target_visible() where CampConnect Admin's moderation is.
  const { db, mk, as, asAnon } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const rows = async (p) => (await p).rows;
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r[Object.keys(r)[0]];
  };

  const ANN = await mk("ann@txstate.edu", "Ann Going");
  const BOB = await mk("bob@txstate.edu", "Bob Browsing");
  const CARA = await mk("cara@txstate.edu", "Cara Careful");
  await db.query("update public.profiles set created_at = now() - interval '3 days'");

  // A campus calendar and two of its events: one anyone may see, one staff hid.
  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
  const feed = await val("insert into public.event_feeds (university_id, name, url, kind) values ($1, 'Campus calendar', 'https://calendar.example.edu/feed.ics', 'ics') returning id", [TX]);
  const event = (title, status, uid) =>
    val("insert into public.events (university_id, feed_id, external_uid, title, starts_at, source, status) values ($1, $2, $3, $4, now() + interval '2 days', 'feed', $5) returning id", [TX, feed, uid, title, status]);
  const SHOW = await event("Fall Fest", "scheduled", "uid-1");
  const HIDDEN = await event("Pulled event", "hidden", "uid-2");

  const like = (uid, id) => as(uid, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('event', $1, $2)", [id, uid]));
  const comment = (uid, id, body, parent = null) =>
    as(uid, () => one(db.query("insert into public.post_comments (target_type, target_id, user_id, body, parent_id) values ('event', $1, $2, $3, $4) returning *", [id, uid, body, parent])));
  const going = (uid, id, who = uid) => as(uid, () => db.query("insert into public.event_rsvps (event_id, user_id) values ($1, $2)", [id, who]));
  const goingMany = (uid, ids) => as(uid, () => rows(db.query("select * from public.event_going_many($1::uuid[])", [ids])));

  await expectError(tag + "before: an event cannot be liked", () => like(ANN, SHOW), live ? "row-level security" : "post_likes_target_type_check");

  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // --- Likes and comments ----------------------------------------------------------------------------------------------
  await expectOk(tag + "a student likes an event; post_engagement and post_engagement_many count it, liked by them alone", async () => {
    await like(ANN, SHOW);
    const mine = await as(ANN, () => one(db.query("select * from public.post_engagement('event', $1)", [SHOW])));
    check(Number(mine.likes) === 1 && mine.liked_by_me === true, JSON.stringify(mine));
    const page = await as(BOB, () => rows(db.query("select * from public.post_engagement_many('event', $1::uuid[])", [[SHOW]])));
    check(page.length === 1 && Number(page[0].likes) === 1 && page[0].liked_by_me === false, JSON.stringify(page));
  });
  await expectOk(tag + "nobody is notified of a like on an event (it has no owner)", async () => {
    check((await val("select count(*)::int from public.notifications where type = 'like'")) === 0, "a like notification was made");
  });
  await expectError(tag + "no like on an event the student may not see", () => like(ANN, HIDDEN), "This event is not available");
  await expectError(tag + "no comment on an event the student may not see", () => comment(ANN, HIDDEN, "hello"), "This event is not available");
  await expectError(tag + "no like in someone else's name", () => as(ANN, () => db.query("insert into public.post_likes (target_type, target_id, user_id) values ('event', $1, $2)", [SHOW, BOB])), "row-level security");

  let first;
  await expectOk(tag + "a comment on an event is read by everyone who may see the event, and counted", async () => {
    first = await comment(ANN, SHOW, "Who else is coming?");
    const seen = await as(BOB, () => rows(db.query("select body from public.post_comments where target_type = 'event' and target_id = $1", [SHOW])));
    check(seen.length === 1 && seen[0].body === "Who else is coming?", JSON.stringify(seen));
    const counts = await as(BOB, () => one(db.query("select * from public.post_engagement('event', $1)", [SHOW])));
    check(Number(counts.comments) === 1, JSON.stringify(counts));
  });
  await expectOk(tag + "a reply on an event's thread notifies the comment's writer with a link to the event", async () => {
    await comment(BOB, SHOW, "Me!", first.id);
    const n = await one(db.query("select link from public.notifications where user_id = $1 order by created_at desc limit 1", [ANN]));
    check(n && n.link === `/events/${SHOW}`, JSON.stringify(n));
  });
  await expectOk(tag + "comments on an event nobody may see are read by their writer alone", async () => {
    // Written before staff hid the event (here straight into the table, as the service would).
    await db.query("insert into public.post_comments (target_type, target_id, user_id, body) values ('event', $1, $2, 'Written before it was hidden')", [HIDDEN, CARA]);
    check((await as(BOB, () => rows(db.query("select id from public.post_comments where target_id = $1", [HIDDEN])))).length === 0, "Bob reads them");
    check((await as(CARA, () => rows(db.query("select id from public.post_comments where target_id = $1", [HIDDEN])))).length === 1, "the writer lost hers");
  });
  await expectOk(tag + "post_link knows events, and every other link is as it was", async () => {
    check((await val("select public.post_link('event', $1)", [SHOW])) === `/events/${SHOW}`, "event link");
    check((await val("select public.post_link('post', $1)", [SHOW])) === `/posts/${SHOW}`, "post link");
    check((await val("select public.post_link('roommate', $1)", [SHOW])) === `/roommates/${SHOW}`, "roommate link");
  });

  // --- Who is going ----------------------------------------------------------------------------------------------------
  await expectOk(tag + "a student says they are going; everyone signed in who may see the event reads who", async () => {
    await going(ANN, SHOW);
    const list = await as(BOB, () => rows(db.query("select user_id from public.event_rsvps where event_id = $1", [SHOW])));
    check(list.length === 1 && list[0].user_id === ANN, JSON.stringify(list));
  });
  await expectOk(tag + "event_going_many counts them, and says whether you are going", async () => {
    const forBob = await goingMany(BOB, [SHOW, HIDDEN]);
    const show = forBob.find((r) => r.event_id === SHOW);
    const hid = forBob.find((r) => r.event_id === HIDDEN);
    check(Number(show.going) === 1 && show.going_by_me === false && Number(hid.going) === 0, JSON.stringify(forBob));
    const forAnn = await goingMany(ANN, [SHOW]);
    check(forAnn[0].going_by_me === true, JSON.stringify(forAnn));
  });
  await expectError(tag + "no going in someone else's name", () => going(BOB, SHOW, ANN), "row-level security");
  await expectError(tag + "no going to an event the student may not see", () => going(BOB, HIDDEN), "row-level security");
  await expectOk(tag + "someone either side blocked is left out of who is going, and of the count", async () => {
    await db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [CARA, ANN]);
    check((await as(CARA, () => rows(db.query("select user_id from public.event_rsvps where event_id = $1", [SHOW])))).length === 0, "Cara reads Ann");
    check(Number((await goingMany(CARA, [SHOW]))[0].going) === 0, "Cara counts Ann");
    check(Number((await goingMany(BOB, [SHOW]))[0].going) === 1, "Bob lost Ann");
  });
  await expectOk(tag + "signed out: who is going is not read at all", async () => {
    check((await asAnon(() => rows(db.query("select user_id from public.event_rsvps")))).length === 0, "anon reads rows");
  });
  await expectOk(tag + "a student takes back only their own going", async () => {
    await going(BOB, SHOW);
    await as(BOB, () => db.query("delete from public.event_rsvps where event_id = $1 and user_id = $2", [SHOW, ANN]));
    check((await val("select count(*)::int from public.event_rsvps where event_id = $1 and user_id = $2", [SHOW, ANN])) === 1, "Bob took back Ann's");
    await as(BOB, () => db.query("delete from public.event_rsvps where event_id = $1 and user_id = $2", [SHOW, BOB]));
    check((await val("select count(*)::int from public.event_rsvps where event_id = $1 and user_id = $2", [SHOW, BOB])) === 0, "Bob's own stayed");
  });

  // --- Rollback and again ----------------------------------------------------------------------------------------------
  await expectOk(tag + "the rollback takes out event likes and comments, who is going and the 'event' type, and re-runs", async () => {
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    check((await val("select count(*)::int from public.post_likes where target_type = 'event'")) === 0, "event likes stayed");
    check((await val("select count(*)::int from public.post_comments where target_type = 'event'")) === 0, "event comments stayed");
    check((await val("select to_regclass('public.event_rsvps') is null")) === true, "event_rsvps stayed");
    check((await val("select public.post_link('event', $1)", [SHOW])) === `/roommates/${SHOW}`, "post_link kept the event case");
  });
  await expectError(tag + "after the rollback an event cannot be liked again", () => like(ANN, SHOW), live ? "row-level security" : "post_likes_target_type_check");
  await expectOk(tag + "the migration applies again after its rollback", async () => {
    await db.exec(read(MIGRATION));
    await like(ANN, SHOW);
  });
}

done("MIGRATION 69: LIKES, COMMENTS AND WHO IS GOING ON EVENTS");
