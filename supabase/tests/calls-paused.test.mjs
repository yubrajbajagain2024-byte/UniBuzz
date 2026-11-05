// Migration 66 (calls paused for the launch) applied to production on its own, rehearsed offline the way 58 to 65 were:
// a database in production's state (production's migration order, the migrations applied outside this repo, every
// migration up to 65 applied: the Business v2 release, the report auto-hide 64 and the console health 65) holding a call
// that is over, one still ringing and one going on; 66 alone, as the next migration, twice; then no call can start or
// ring, the open calls are ended, past calls stay readable as history and start_call() is untouched; then 66's own
// rollback, which must leave exactly the schema of a database that never had it, with calls ringing again; then 66
// again. (Written as 64 to go live ahead of the release; renamed 66 on 2026-11-04, after the release, 64 and 65 went
// live first.) Run: node supabase/tests/calls-paused.test.mjs
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";
import { callOf } from "../../packages/shared/src/calls.ts";

const PAUSED = "20261118000000_calls_paused.sql";
const ROLLBACK = "rollbacks/20261118000000_calls_paused.down.sql";
const check = (cond, message) => { if (!cond) throw new Error(message); };

const { db, mk, as, asService } = await boot({ live: true, skip: [PAUSED] });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const val = async (q, params = []) => { const r = await one(db.query(q, params)); return r[Object.keys(r)[0]]; };
const has = async (sql) => Boolean((await one(db.query(sql))).ok);
const schema = () => catalog(async (q) => (await db.query(q)).rows);

const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
for (const [x, y] of [[A, B], [B, A], [A, C], [C, A]]) await db.query("insert into public.follows (follower_id, followee_id) values ($1,$2)", [x, y]);
const AB = await as(A, () => val("select public.get_or_create_direct_conversation($1) as id", [B]));
const GROUP = await as(A, () => val("select public.create_group_conversation('Study group', $1::uuid[]) as id", [[B, C]]));

const start = (uid, conv, kind = "audio") => as(uid, async () => (await one(db.query("select public.start_call($1, $2) as r", [conv, kind]))).r);
const answer = (uid, id) => as(uid, async () => (await one(db.query("select public.answer_call($1) as r", [id]))).r);
const leave = (uid, id) => as(uid, () => db.query("select public.leave_call($1)", [id]));
const get = (uid, id) => as(uid, async () => (await one(db.query("select public.get_call($1) as r", [id]))).r);
const call = (id) => one(db.query("select status, ended_reason, ended_at from public.calls where id = $1", [id]));
const states = async (id) => Object.fromEntries((await rows(db.query("select user_id, state from public.call_participants where call_id = $1", [id]))).map((r) => [r.user_id, r.state]));
const missedNotes = async (uid, id) => (await rows(db.query("select 1 from public.notifications where user_id = $1 and type = 'call' and data ->> 'call_id' = $2", [uid, id]))).length;
const counts = async () => one(db.query("select (select count(*)::int from public.calls) as calls, (select count(*)::int from public.call_participants) as participants, (select count(*)::int from public.messages) as messages, (select count(*)::int from public.notifications) as notifications"));

let over, ringing, going, before;
await expectOk("before: production's state (everything up to 65 applied, 66 not); a call over, one ringing, one going on", async () => {
  check(await has("select to_regclass('public.ads') is not null and to_regclass('public.report_auto_hides') is not null and to_regprocedure('public.console_system_health()') is not null and to_regprocedure('public.guard_calls_paused()') is null as ok"), "not production's state");
  over = await start(A, AB);
  await leave(A, over.call_id);
  ringing = await start(A, AB);
  going = await start(A, GROUP, "video");
  await answer(B, going.call_id);
  check((await call(over.call_id)).status === "ended" && (await call(ringing.call_id)).status === "ringing" && (await call(going.call_id)).status === "active", "the calls are not in their states");
  check((await states(going.call_id))[C] === "ringing", "Carol is not being rung in the group call");
  before = { schema: await schema(), over: await call(over.call_id) };
});

await expectOk("66 applies alone, as the next migration, and re-runs cleanly", async () => { await db.exec(read(`migrations/${PAUSED}`)); await db.exec(read(`migrations/${PAUSED}`)); });

await expectOk("the open calls ended as the app ends them: the ring missed (Bob notified), the call going on completed (Carol, still rung, missed and notified)", async () => {
  const r = await call(ringing.call_id), g = await call(going.call_id);
  check(r.status === "ended" && r.ended_reason === "missed", JSON.stringify(r));
  check(g.status === "ended" && g.ended_reason === "completed", JSON.stringify(g));
  check((await states(ringing.call_id))[B] === "missed" && (await states(going.call_id))[C] === "missed", "the people still rung are not marked missed");
  check((await missedNotes(B, ringing.call_id)) === 1 && (await missedNotes(C, going.call_id)) === 1, "a missed-call notification is missing");
  const rowOf = async (messageId) => callOf((await one(db.query("select call from public.messages where id = $1", [messageId]))).call);
  check((await rowOf(ringing.message_id)).status === "ended" && (await rowOf(going.message_id)).status === "ended", "a chat's call row still shows the call as going on");
});
await expectOk("the call already over is untouched", async () => {
  check(JSON.stringify(await call(over.call_id)) === JSON.stringify(before.over), "the past call changed");
});

const refusals = async (label) => {
  const was = await counts();
  await expectError(`${label}: a member cannot start a call in a direct chat`, () => start(A, AB), "Calls are paused");
  await expectError(`${label}: nor a video call in a group`, () => start(C, GROUP, "video"), "Calls are paused");
  await expectOk(`${label}: a refused call leaves nothing behind (no call, no one rung, no chat row, no notification)`, async () => {
    check(JSON.stringify(await counts()) === JSON.stringify(was), `${JSON.stringify(was)} became ${JSON.stringify(await counts())}`);
  });
  await expectError(`${label}: nor does the service role write a call`, () => asService(() => db.query("insert into public.calls (conversation_id, started_by, kind) values ($1, $2, 'audio')", [AB, A])), "Calls are paused");
};
await refusals("66 alone");

await expectOk("past calls stay history: both read them, current_call finds none to join, answer_call hands an ended call back unjoined", async () => {
  check((await get(B, ringing.call_id)).status === "ended" && (await get(A, over.call_id)).status === "ended", "a past call cannot be read");
  check((await as(A, () => val("select public.current_call($1) as c", [GROUP]))) === null, "a call is still offered to join");
  const before = await states(going.call_id);
  const back = await answer(C, going.call_id);
  check(back.status === "ended" && JSON.stringify(await states(going.call_id)) === JSON.stringify(before), "answering joined an ended call");
});
await expectOk("start_call() and every other object keep their definitions and grants: only the guard and its trigger are new", async () => {
  const changed = diffCatalogs(before.schema, await schema());
  check(JSON.stringify(changed) === JSON.stringify(["function guard_calls_paused(): added", "trigger calls.calls_paused: added"]), changed.join("; "));
});
await expectOk("the guard is closed to the API", async () => {
  check(await has("select not has_function_privilege('authenticated', 'public.guard_calls_paused()', 'execute') and not has_function_privilege('anon', 'public.guard_calls_paused()', 'execute') as ok"), "the API may call the guard");
});

let again;
await expectOk("66's rollback leaves exactly the schema of a database that never had it", async () => {
  await db.exec(read(ROLLBACK));
  const reference = await boot({ live: true, skip: [PAUSED] });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await schema());
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
});
await expectOk("after the rollback a call starts and rings again", async () => {
  again = await start(A, AB);
  check((await states(again.call_id))[B] === "ringing", "Bob is not rung");
});
await expectOk("66 applies again afterwards and ends that ring", async () => {
  await db.exec(read(`migrations/${PAUSED}`));
  const r = await call(again.call_id);
  check(r.status === "ended" && r.ended_reason === "missed", JSON.stringify(r));
});
await refusals("66 re-applied");

done("CALLS PAUSED ON PRODUCTION'S STATE (66 AFTER 65)");
