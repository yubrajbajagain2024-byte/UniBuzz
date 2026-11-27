// Migration 75 (events, organizations and the content browser scoped by campus, Phase 2d) against PGlite, in
// production's order (CampConnect Admin's content browser exists there) and this repo's order (the events console). The
// platform's staff get exactly the answers they got before 75 (compared whole). A campus admin with a campus and a
// second factor sees and changes only their campus's calendar (events, organizations; feeds read-only, never saved or
// deleted) and hidden content by their campus's students; another campus's rows are "not found" and untouched;
// changes are recorded as campus_admin. No campus or no second factor refuse them. Every permission they hold is now
// the portal's CAMPUS_ADMIN list (read from apps/admin/src/lib/permissions.ts). The rollback puts every function back
// exactly as it was (pg_get_functiondef), then a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = "20261130000000_campus_events.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261130000000_campus_events.down.sql";
const BEFORE = fs.readdirSync(path.join(HERE, "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const MFA = { aal: "aal2" };
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

// 75 is the newest scoping migration: its campus admin's set is the portal's CAMPUS_ADMIN list.
const portal = fs.readFileSync(path.join(HERE, "..", "..", "apps", "admin", "src", "lib", "permissions.ts"), "utf8");
const listIn = (text) => [...text.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]);
const PORTAL_CAMPUS_ADMIN = listIn(/export const CAMPUS_ADMIN: readonly Permission\[\] = \[([\s\S]*?)\];/.exec(portal)?.[1] ?? "");
const PORTAL_MODERATOR = listIn(/const MODERATOR: readonly Permission\[\] = \[([\s\S]*?)\];/.exec(portal)?.[1] ?? "");
if (PORTAL_CAMPUS_ADMIN.length < 3 || PORTAL_MODERATOR.length < 5) throw new Error("could not read the portal's permission table");
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const EVENTS = [
  "events_console_events(jsonb)",
  "events_console_set_event(uuid,text,text)",
  "events_console_feeds()",
  "events_console_organizations(jsonb)",
  "events_console_set_organization(uuid,boolean,text,text)",
  "events_console_counts()",
  "staff_role_permissions(text)",
];
const HIDDEN = ["admin_hidden_content_list(text,integer,timestamp with time zone)"];

for (const live of [true, false]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  const { db, mk, as } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r ? r[Object.keys(r)[0]] : undefined;
  };
  const asVal = (uid, q, params = [], claims = MFA) => as(uid, () => val(q, params), claims);
  const asRows = (uid, q, params = [], claims = MFA) => as(uid, async () => (await db.query(q, params)).rows, claims);
  const SIGS = live ? [...EVENTS, ...HIDDEN] : EVENTS;
  const definitions = async () => Object.fromEntries(await Promise.all(SIGS.map(async (s) => [s, await val("select pg_get_functiondef($1::regprocedure)", [`public.${s}`])])));

  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
  const OTHER = await val("select id from public.universities where id <> $1 order by name limit 1", [TX]);
  await db.query("update public.universities set email_domain = 'other.edu' where id = $1", [OTHER]);
  const student = async (name, domain) => {
    const uid = await mk(`${name.toLowerCase().replace(/\W+/g, "")}@${domain}`, name);
    await db.query("update public.profiles set university_id = $2 where id = $1", [uid, domain === "other.edu" ? OTHER : TX]);
    return uid;
  };
  const TXA = await student("Tia Texan", "txstate.edu");
  const OTA = await student("Oscar Other", "other.edu");
  const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  const CAMPUS = await mk("cam@txstate.edu", "Cam Campus");
  const NOCAMPUS = await mk("nell@txstate.edu", "Nell No Campus");
  if (live) {
    await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $3), ($2, 'moderator', $3)", [ADMIN, MOD, OWNER]);
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'campus_admin', $3), ($2, 'campus_admin', $3)", [CAMPUS, NOCAMPUS, OWNER]);
  } else {
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'admin'), ($2, 'moderator'), ($3, 'campus_admin'), ($4, 'campus_admin')", [ADMIN, MOD, CAMPUS, NOCAMPUS]);
  }
  await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [CAMPUS, TX]);
  for (const u of [...(live ? [OWNER] : []), ADMIN, MOD, CAMPUS, NOCAMPUS]) await as(u, () => val("select 1"), MFA);

  // Each campus's calendar: an organization (unverified) with a pending event, and a feed.
  const org = (uid, name) => as(uid, () => val("insert into public.organizations (name, kind) values ($1, 'club') returning id", [name]));
  const event = (uid, o, title) => as(uid, () => val("insert into public.events (organization_id, title, starts_at, source) values ($1, $2, now() + interval '3 days', 'organization') returning id", [o, title]));
  const O = { tx: await org(TXA, "Robotics Club"), other: await org(OTA, "Chess Club") };
  const E = { tx: await event(TXA, O.tx, "Robot Races"), other: await event(OTA, O.other, "Blitz Night") };
  const feed = (uni, name) => asVal(ADMIN, "select public.events_console_feed_save($1::jsonb)", [JSON.stringify({ university_id: uni, name, url: `https://calendar.example.edu/${name.replace(/\W+/g, "-")}.ics`, kind: "ics" })]);
  const FEEDS = { tx: (await feed(TX, "Texas State calendar")).id, other: (await feed(OTHER, "Other calendar")).id };
  const ids = (list) => list.map((x) => x.id);

  // Hidden content by each campus's students (production's order: CampConnect Admin's hidden state).
  let P = null;
  if (live) {
    P = {
      tx: await as(TXA, () => val("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Hidden on Texas State') returning id", [TXA])),
      other: await as(OTA, () => val("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Hidden elsewhere') returning id", [OTA])),
    };
    for (const id of Object.values(P)) await asVal(MOD, "select public.admin_content_hide('post', $1, 'Hidden for the check')", [id]);
  }

  // ---------------------------------------------------------------------------
  // Before 75
  // ---------------------------------------------------------------------------
  await expectError(tag + "before 75 a campus admin is refused the events console", () => asVal(CAMPUS, "select public.events_console_counts()"), "not_found");
  if (live) await expectError(tag + "and the content browser", () => asRows(CAMPUS, "select * from public.admin_hidden_content_list(null, 50, null)"), "Not allowed");
  const platformView = async () => ({
    modEvents: await asVal(MOD, "select public.events_console_events($1::jsonb)", [JSON.stringify({ upcoming: false, limit: 100 })]),
    modOrgs: await asVal(MOD, "select public.events_console_organizations('{}'::jsonb)"),
    adminFeeds: await asVal(ADMIN, "select public.events_console_feeds()"),
    modCounts: await asVal(MOD, "select public.events_console_counts()"),
    ...(live ? { modHidden: await asRows(MOD, "select * from public.admin_hidden_content_list(null, 200, null)") } : {}),
  });
  const before = await platformView();
  const defsBefore = await definitions();

  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // ---------------------------------------------------------------------------
  // The platform's staff, and the table
  // ---------------------------------------------------------------------------
  await expectOk(tag + "owners, admins and moderators get exactly the answers they got before 75", async () => {
    const after = await platformView();
    for (const k of Object.keys(before)) check(JSON.stringify(after[k]) === JSON.stringify(before[k]), `${k} changed`);
    check(before.modOrgs.length === 2 && before.adminFeeds.length >= 2, "the platform sees both campuses");
  });
  await expectOk(tag + "the table: every permission a campus admin holds is the portal's CAMPUS_ADMIN list; the moderator's is unchanged", async () => {
    check(same(await val("select public.staff_role_permissions('campus_admin')"), PORTAL_CAMPUS_ADMIN), "campus admin");
    check(same(await val("select public.staff_role_permissions('moderator')"), PORTAL_MODERATOR), "moderator");
  });

  // ---------------------------------------------------------------------------
  // A campus admin: their calendar, nothing else
  // ---------------------------------------------------------------------------
  await expectOk(tag + "events, organizations and feeds: only their campus's; the counts with them", async () => {
    const ev = await asVal(CAMPUS, "select public.events_console_events($1::jsonb)", [JSON.stringify({ upcoming: false, limit: 100 })]);
    check(same(ids(ev.items), [E.tx]) && ev.total === 1, JSON.stringify(ev.items.map((e) => e.title)));
    const asked = await asVal(CAMPUS, "select public.events_console_events($1::jsonb)", [JSON.stringify({ upcoming: false, university_id: OTHER })]);
    check(asked.items.length === 0 && asked.total === 0, "asking for another campus by filter");
    check(same(ids(await asVal(CAMPUS, "select public.events_console_organizations('{}'::jsonb)")), [O.tx]), "organizations");
    const feeds = await asVal(CAMPUS, "select public.events_console_feeds()");
    check(feeds.length >= 1 && feeds.every((f) => f.university_id === TX) && ids(feeds).includes(FEEDS.tx), "feeds");
    const c = await asVal(CAMPUS, "select public.events_console_counts()");
    check(c.organizations_pending === 1, JSON.stringify(c));
  });
  await expectError(tag + "verifying another campus's organization: not found", () => asVal(CAMPUS, "select public.events_console_set_organization($1, true, null, null)", [O.other]), "not_found");
  await expectError(tag + "hiding another campus's event: not found", () => asVal(CAMPUS, "select public.events_console_set_event($1, 'hidden', null)", [E.other]), "not_found");
  await expectOk(tag + "verifying their own campus's organization publishes its event, recorded as campus_admin", async () => {
    await asVal(CAMPUS, "select public.events_console_set_organization($1, true, null, 'Checked with the student union')", [O.tx]);
    check((await val("select status from public.events where id = $1", [E.tx])) === "scheduled", "not published");
    check((await val("select actor_role from public.audit_log where actor_id = $1 and action = 'organization.verify'", [CAMPUS])) === "campus_admin", "the recorded role");
  });
  await expectOk(tag + "hiding and restoring their own campus's event works", async () => {
    await asVal(CAMPUS, "select public.events_console_set_event($1, 'hidden', 'Duplicate')", [E.tx]);
    check((await val("select status from public.events where id = $1", [E.tx])) === "hidden", "not hidden");
    await asVal(CAMPUS, "select public.events_console_set_event($1, 'scheduled', null)", [E.tx]);
  });
  await expectOk(tag + "another campus's organization and event are untouched", async () => {
    check((await val("select verified from public.organizations where id = $1", [O.other])) === false, "verified");
    check((await val("select status from public.events where id = $1", [E.other])) === "pending", "changed");
  });
  await expectError(tag + "saving a feed stays admin only", () => asVal(CAMPUS, "select public.events_console_feed_save($1::jsonb)", [JSON.stringify({ university_id: TX, name: "Campus admin feed", url: "https://calendar.example.edu/x.ics", kind: "ics" })]), "not_found");
  await expectError(tag + "deleting a feed stays admin only", () => asVal(CAMPUS, "select public.events_console_feed_delete($1)", [FEEDS.tx]), "not_found");
  await expectError(tag + "without the second factor: refused", () => asVal(CAMPUS, "select public.events_console_counts()", [], { aal: "aal1" }), "mfa_required");
  await expectError(tag + "a campus admin without a campus: refused", () => asVal(NOCAMPUS, "select public.events_console_counts()"), "not_found");
  if (live) {
    await expectOk(tag + "the content browser: only hidden content by their campus's students", async () => {
      const rows = await asRows(CAMPUS, "select * from public.admin_hidden_content_list(null, 200, null)");
      check(rows.map((r) => r.target_id).join() === P.tx, JSON.stringify(rows.map((r) => r.preview)));
      check((await asRows(CAMPUS, "select * from public.admin_hidden_content_list('post', 200, null)")).length === 1, "by type");
    });
    for (const [what, sql, message] of [
      ["the queue", "select public.console_queue_counts()", "not_found"],
      ["the staff list", "select * from public.admin_staff_list()", "Not allowed"],
      ["university requests", "select public.console_university_requests()", "not_found"],
      ["analytics", "select public.console_analytics_overview()", "not_found"],
      ["the audit feed", "select public.console_audit_feed()", "not_found"],
    ]) {
      await expectError(tag + `still refused: ${what}`, () => asRows(CAMPUS, sql), message);
    }
  }

  // ---------------------------------------------------------------------------
  // Rollback, then a second apply
  // ---------------------------------------------------------------------------
  await expectOk(tag + "the rollback puts every function back word for word", async () => {
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    const after = await definitions();
    for (const sig of Object.keys(defsBefore)) check(after[sig] === defsBefore[sig], `${sig} differs after the rollback`);
  });
  await expectError(tag + "after the rollback a campus admin is refused the events console again", () => asVal(CAMPUS, "select public.events_console_counts()"), "not_found");
  await expectOk(tag + "applying it again works", async () => {
    await db.exec(read(MIGRATION));
    check(same(ids(await asVal(CAMPUS, "select public.events_console_organizations('{}'::jsonb)")), [O.tx]), "after the second apply");
  });
}

done("CAMPUS EVENTS");
