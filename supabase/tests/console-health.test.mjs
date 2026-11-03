// Migration 65 (CampConnect Admin's System health document and the people list's Verification filter) against PGlite:
// who may read the health document (staff with a second factor; students and visitors refused, staff without the
// factor told to confirm it); what it holds on this repo's schema (no pg_cron, no media worker, no _migrations table:
// those parts are null, the rest counted) and on production's (the media queue and the staff's second factors
// counted); the 'unverified' filter listing people whose email is unconfirmed or whose campus is unset and nobody
// else, the old filters unchanged and an unknown one refused; the rollback and a second run.
// Usage: node supabase/tests/console-health.test.mjs
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261117000000_console_health.sql";
const ROLLBACK = "rollbacks/20261117000000_console_health.down.sql";
const MFA = { aal: "aal2" };
const check = (cond, message) => { if (!cond) throw new Error(message); };

// =====================================================================================================================
// This repo's schema
// =====================================================================================================================
{
  const { db, mk, as, asAnon } = await boot();
  const val = async (p) => { const row = (await p).rows[0]; return row ? row[Object.keys(row)[0]] : undefined; };
  const health = (uid, claims = MFA) => as(uid, () => val(db.query("select public.console_system_health()")), claims);

  const STUDENT = await mk("stu@txstate.edu", "Stu Dent");
  const MOD = await mk("mod@txstate.edu", "Mo Derator");
  await db.query("insert into public.staff_members (user_id, role) values ($1, 'moderator')", [MOD]);

  await expectError("a student gets not found", () => health(STUDENT), "not_found");
  await expectError("a visitor is refused", () => asAnon(() => db.query("select public.console_system_health()")), "permission denied");
  await expectError("staff without the second factor must confirm it", () => health(MOD, {}), "mfa_required");

  await expectOk("staff with the second factor read the document: the parts this schema has, null for the rest", async () => {
    const h = await health(MOD);
    check(h.cron === null, "cron should be null without pg_cron");
    check(h.media === null, "media should be null without media_jobs");
    check(h.migrations === null, "migrations should be null without _migrations");
    check(h.staff === null, "staff should be null without public.staff");
    check(typeof h.generated_at === "string", "generated_at");
    check(h.feeds.enabled === 0 && h.feeds.failing === 0, JSON.stringify(h.feeds));
    check(h.activity.latest_day === null, JSON.stringify(h.activity));
    check(h.moderation.reports_open === 0 && h.moderation.queue_open === 0 && h.moderation.appeals_open === 0, JSON.stringify(h.moderation));
    check(h.moderation.auto_hides_pending === 0, "auto_hides_pending counts the repo's own table");
    check(h.storage.objects === 0 && h.storage.uploads === 0, JSON.stringify(h.storage));
    check(h.database.size_bytes > 0, "database size");
  });

  await expectOk("the document follows the data: an open report, a failing feed, a stored file", async () => {
    const AUTHOR = await mk("author@txstate.edu", "Ann Author");
    await db.query("update public.profiles set created_at = now() - interval '3 days'");
    const post = await val(db.query("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Hello') returning id", [AUTHOR]));
    await as(STUDENT, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')", [STUDENT, post]));
    const uni = await val(db.query("select id from public.universities limit 1"));
    await db.query("insert into public.event_feeds (university_id, name, url, kind, enabled, last_status, last_error, items_seen) values ($1, 'Campus calendar', 'https://example.edu/cal.ics', 'ics', true, 'error', 'HTTP 500', 12)", [uni]);
    await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', 'posts/x/a.jpg', $1::uuid, $1::text)", [AUTHOR]);
    const h = await health(MOD);
    check(h.moderation.reports_open === 1 && typeof h.moderation.oldest_open_report_at === "string", JSON.stringify(h.moderation));
    check(h.feeds.enabled === 1 && h.feeds.failing === 1 && h.feeds.items_seen === 12, JSON.stringify(h.feeds));
    check(h.storage.objects === 1 && h.storage.uploads === 1, JSON.stringify(h.storage));
  });

  await expectOk("the function is closed to the API roles' direct use except through authenticated, and re-runs", async () => {
    await db.exec(read(MIGRATION));
    check((await val(db.query("select has_function_privilege('anon', 'public.console_system_health()', 'execute')"))) === false, "anon may execute");
  });

  await expectOk("the rollback drops the document and the migration applies again", async () => {
    await db.exec(read(ROLLBACK));
    check((await val(db.query("select to_regprocedure('public.console_system_health()') is null"))) === true, "still there");
    await db.exec(read(MIGRATION));
    check((await val(db.query("select to_regprocedure('public.console_system_health()') is not null"))) === true, "not back");
  });
}

// =====================================================================================================================
// Production's schema (CampConnect Admin's public.staff, media_jobs)
// =====================================================================================================================
{
  const { db, mk, as } = await boot({ live: true });
  const val = async (p) => { const row = (await p).rows[0]; return row ? row[Object.keys(row)[0]] : undefined; };
  const rows = async (p) => (await p).rows;
  const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
  await db.query("select public.admin_bootstrap_owner((select email from auth.users where id = $1))", [OWNER]);
  const MOD = await mk("mod2@txstate.edu", "Mo Derator");
  await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'moderator', $2)", [MOD, OWNER]);
  const CONFIRMED = await mk("fine@txstate.edu", "Fine Student");
  const UNCONFIRMED = await mk("new@txstate.edu", "New Student");
  await db.query("update auth.users set email_confirmed_at = null where id = $1", [UNCONFIRMED]);
  const NO_CAMPUS = await mk("lost@txstate.edu", "Lost Student");
  await db.query("update public.profiles set university_id = null where id = $1", [NO_CAMPUS]);
  await db.query("insert into public.media_jobs (kind, ref, attempts, last_error) values ('delete_object', 'posts/x/a.jpg', 2, 'boom'), ('delete_object', 'posts/x/b.jpg', 0, null)");
  await db.query("update public.media_jobs set done_at = now() where ref = 'posts/x/b.jpg'");

  const list = (uid, filter) => as(uid, () => rows(db.query("select user_id, email from public.admin_users_list($1, 50, null)", [filter])), MFA);

  await expectOk("unverified: the unconfirmed email and the missing campus, nobody else", async () => {
    const ids = (await list(MOD, "unverified")).map((r) => r.user_id);
    check(ids.includes(UNCONFIRMED) && ids.includes(NO_CAMPUS), `missing: ${JSON.stringify(ids)}`);
    check(!ids.includes(CONFIRMED) && !ids.includes(MOD) && !ids.includes(OWNER), "a verified person listed");
  });
  await expectOk("the old filters are unchanged", async () => {
    check((await list(MOD, "all")).length === 5, "all");
    check((await list(MOD, "staff")).length === 2, "staff");
    check((await list(MOD, "suspended")).length === 0, "suspended");
  });
  await expectError("an unknown filter is refused", () => list(MOD, "nope"), "Invalid filter");
  await expectError("a student cannot list people", () => list(CONFIRMED, "unverified"), "Not allowed");

  await expectOk("the health document counts the media queue and the staff's second factors", async () => {
    const h = await as(MOD, () => val(db.query("select public.console_system_health()")), MFA);
    check(h.media.pending === 1 && h.media.failing === 1 && h.media.done_24h === 1 && h.media.last_error === "boom", JSON.stringify(h.media));
    // The owner has no verified factor (bootstrap only); the moderator's was added by as() with aal2.
    check(h.staff.total === 2 && h.staff.without_second_factor === 1, JSON.stringify(h.staff));
    check(h.cron === null && h.migrations === null, "cron and migrations should be null offline");
  });

  await expectOk("the rollback restores migration 16's list ('unverified' refused again) and the migration re-applies", async () => {
    await db.exec(read(ROLLBACK));
    await expectError("after the rollback 'unverified' is unknown", () => list(MOD, "unverified"), "Invalid filter");
    check((await list(MOD, "staff")).length === 2, "staff after rollback");
    await db.exec(read(MIGRATION));
    check((await list(MOD, "unverified")).length === 2, "unverified after re-apply");
  });
}

done("MIGRATION-65 CONSOLE HEALTH");
