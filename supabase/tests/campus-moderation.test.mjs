// Migration 73 (the moderation area scoped by campus, Phase 2b) against PGlite, in production's order (boot({ live:
// true }): CampConnect Admin's reports, flags and content functions exist there) and in this repo's order (they do not:
// only the permission table and the helpers change). On production's order: owners, admins and moderators get exactly
// the answers they got before 73 (compared row for row); a campus admin with a campus and a second factor sees and
// acts on reports, flags and content whose author is a verified student of their campus, and nothing else, even when a
// student from elsewhere places content on their campus or names it on their profile; something out of scope is "not
// found"; a reporter's email only for their own students; a moderator's limits (escalated items, no deleting); no
// campus, no second factor or a suspension refuse them; every other area still refuses them; two campuses see both.
// The helpers are closed to the API, the table matches the portal's lib/permissions.ts (read from the file), and the
// rollback puts every function back exactly as it was (pg_get_functiondef), then a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION } from "../../packages/shared/src/buzz/constants.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = "20261128000000_campus_moderation.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261128000000_campus_moderation.down.sql";
const BEFORE = fs.readdirSync(path.join(HERE, "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const MFA = { aal: "aal2" };
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

// The portal's own table (apps/admin/src/lib/permissions.ts) for the platform's roles. The campus admin's set is the
// one 73 gives (later migrations add to it; the newest one's suite compares it with the portal's CAMPUS_ADMIN list).
const portal = fs.readFileSync(path.join(HERE, "..", "..", "apps", "admin", "src", "lib", "permissions.ts"), "utf8");
const listIn = (text) => [...text.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]);
const PORTAL_CAMPUS_ADMIN = ["moderation.view"];
const PORTAL_MODERATOR = listIn(/const MODERATOR: readonly Permission\[\] = \[([\s\S]*?)\];/.exec(portal)?.[1] ?? "");
if (PORTAL_MODERATOR.length < 5) throw new Error("could not read the portal's permission table");
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// The ten functions 73 replaces, by signature, for the rollback's word-for-word check.
const REPLACED = [
  "admin_reports_list(text,integer,timestamp with time zone)",
  "admin_report_get(uuid)",
  "admin_report_resolve(uuid,text,text)",
  "admin_report_reopen(uuid)",
  "admin_auto_hidden_list(text,integer,timestamp with time zone,text,uuid)",
  "admin_auto_hidden_counts()",
  "admin_auto_hide_uphold(uuid,text)",
  "admin_content_get(text,uuid)",
  "admin_content_hide(text,uuid,text)",
  "admin_content_restore(text,uuid)",
];

for (const live of [true, false]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  const { db, mk, as, asService } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r ? r[Object.keys(r)[0]] : undefined;
  };
  const asVal = (uid, q, params = [], claims = MFA) => as(uid, () => val(q, params), claims);
  const asRows = (uid, q, params = [], claims = MFA) => as(uid, async () => (await db.query(q, params)).rows, claims);
  const definitions = async () =>
    Object.fromEntries(await Promise.all(REPLACED.concat("staff_role_permissions(text)").map(async (sig) => [sig, await val("select pg_get_functiondef($1::regprocedure)", [`public.${sig}`])])));

  await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, storage_origin = 'https://proj.supabase.co'");
  const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
  const OTHER = await val("select id from public.universities where id <> $1 order by name limit 1", [TX]);
  // A second campus students can sign up from (the seed opens only txstate.edu).
  await db.query("update public.universities set email_domain = 'other.edu' where id = $1", [OTHER]);

  let n = 0;
  /** A student verified at the campus of `domain` (their email), their profile naming `profileUni` (by default the same). */
  const student = async (name, domain, profileUni) => {
    const uid = await mk(`s${++n}.${name.toLowerCase().replace(/\W+/g, "")}@${domain}`, name);
    await db.query("update public.profiles set university_id = $2, created_at = now() - interval '30 days' where id = $1", [uid, profileUni ?? (domain === "other.edu" ? OTHER : TX)]);
    await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [BUZZ_GUIDELINES_VERSION]));
    return uid;
  };
  const ins = (uid, sql, params) => as(uid, () => val(sql, params));
  const make = {
    post: (a, uni = null) => ins(a, "insert into public.feed_posts (author_id, kind, body, university_id) values ($1, 'post', 'Move-in day at the river apartments', $2) returning id", [a, uni]),
    comment: (a, on) => ins(a, "insert into public.post_comments (user_id, target_type, target_id, body) values ($1, 'post', $2, 'This is not okay at all') returning id", [a, on]),
    apartment: (a) => ins(a, "insert into public.apartments (owner_id, title, description, price_per_month, address) values ($1, 'Two-bed by the river', 'Pool and gym', 900, '1 River Rd') returning id", [a]),
    item: (a) => ins(a, "insert into public.items (seller_id, title, description, price, category) values ($1, 'Desk lamp', 'Barely used, works great', 15, 'furniture') returning id", [a]),
    roommate: (a) => ins(a, "insert into public.roommate_posts (author_id, post_type, title, description) values ($1, 'needs_room', 'Room wanted', 'Quiet student looking for a room.') returning id", [a]),
    buzz: async (a) => {
      await db.query("delete from public.buzz_rate_log");
      return (await asService(() => val("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null)", [a, JSON.stringify({ text: "The east garage elevator is out again", title: "Garage" })]))).id;
    },
    reply: async (a, thread) => {
      await db.query("delete from public.buzz_rate_log");
      return (await asService(() => val("select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null)", [a, thread, JSON.stringify({ text: "Third time this month, take the stairs" })]))).id;
    },
  };
  const contentUni = (type, id) => val("select public.staff_content_university($1, $2)", [type, id]);

  // Students and their content.
  const TXA = await student("Tia Texan", "txstate.edu");
  const OTA = await student("Oscar Other", "other.edu");
  // Verified elsewhere, but naming Texas State on their profile and on their post.
  const SPOOF = await student("Sly Spoofer", "other.edu", TX);
  const C = {
    txPost: await make.post(TXA),
    txPostElsewhere: await make.post(TXA, OTHER),
    otherPost: await make.post(OTA),
    spoofPost: await make.post(SPOOF, TX),
    txApartment: await make.apartment(TXA),
    otherItem: await make.item(OTA),
    txRoommate: await make.roommate(TXA),
    txBuzz: await make.buzz(TXA),
    otherBuzz: await make.buzz(OTA),
  };
  C.txComment = await make.comment(TXA, C.otherPost);
  C.otherComment = await make.comment(OTA, C.txPost);
  C.txReply = await make.reply(TXA, C.txBuzz);

  // ---------------------------------------------------------------------------
  // Before
  // ---------------------------------------------------------------------------
  if (!live) {
    await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
      await db.exec(read(MIGRATION));
      await db.exec(read(MIGRATION));
    });
    // ---------------------------------------------------------------------------
    // This repo's schema: the table and the helpers only
    // ---------------------------------------------------------------------------
    await expectOk(tag + "campus admins get moderation.view; the platform's roles are the portal's, unchanged", async () => {
      check(same(await val("select public.staff_role_permissions('campus_admin')"), PORTAL_CAMPUS_ADMIN), "campus admin");
      check(same(await val("select public.staff_role_permissions('moderator')"), PORTAL_MODERATOR), "moderator");
      check((await val("select cardinality(public.staff_role_permissions('nobody'))")) === 0, "an unknown role");
    });
    await expectOk(tag + "content belongs to its author's verified campus", async () => {
      check((await contentUni("post", C.txPost)) === TX && (await contentUni("post", C.otherPost)) === OTHER, "posts");
      check((await contentUni("post", C.spoofPost)) === OTHER, "a post placed on Texas State by a student verified elsewhere");
      check((await contentUni("comment", C.otherComment)) === OTHER && (await contentUni("buzz_comment", C.txReply)) === TX, "comment, Buzz reply");
      check((await contentUni("profile", SPOOF)) === OTHER, "a profile naming another campus");
    });
    await expectOk(tag + "a campus admin's campuses, from staff_members", async () => {
      const CAMPUS = await mk("cam@txstate.edu", "Cam Campus");
      await db.query("insert into public.staff_members (user_id, role) values ($1, 'campus_admin')", [CAMPUS]);
      await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [CAMPUS, TX]);
      check(JSON.stringify(await val("select public.staff_campus_ids($1)", [CAMPUS])) === JSON.stringify([TX]), "campus ids");
      check((await val("select to_regprocedure('public.staff_require_area(text,text)') is null")) === true, "staff_require_area should not exist here");
    });
    await expectOk(tag + "the rollback, and the migration again", async () => {
      await db.exec(read(ROLLBACK));
      await db.exec(read(ROLLBACK));
      check((await val("select cardinality(public.staff_role_permissions('campus_admin'))")) === 0, "the campus admin's set is not empty");
      check((await val("select to_regprocedure('public.staff_content_university(text,uuid)') is null")) === true, "helper left behind");
      await db.exec(read(MIGRATION));
      check(same(await val("select public.staff_role_permissions('campus_admin')"), PORTAL_CAMPUS_ADMIN), "after the second apply");
    });
    continue;
  }

  // ---------------------------------------------------------------------------
  // Production's schema: staff, reports, flags
  // ---------------------------------------------------------------------------
  const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
  await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  const CAMPUS = await mk("cam@txstate.edu", "Cam Campus");
  const NOCAMPUS = await mk("nell@txstate.edu", "Nell No Campus");
  const BENCHED = await mk("ben@txstate.edu", "Ben Benched");
  await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $3), ($2, 'moderator', $3)", [ADMIN, MOD, OWNER]);
  await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'campus_admin', $4), ($2, 'campus_admin', $4), ($3, 'campus_admin', $4)", [CAMPUS, NOCAMPUS, BENCHED, OWNER]);
  await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $3), ($2, $3)", [CAMPUS, BENCHED, TX]);
  await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'Benched while checking scopes')", [BENCHED]);
  for (const u of [OWNER, ADMIN, MOD, CAMPUS, NOCAMPUS, BENCHED]) await as(u, () => val("select 1"), MFA);

  // Reports, each by its own reporter (Trust & Safety rate-limits reporters).
  const report = async (domain, type, id) => {
    const by = await student(`Reporter ${n}`, domain);
    await as(by, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, 'harassment')", [by, type, id]));
    return { id: await val("select id from public.reports where reporter_id = $1", [by]), by };
  };
  const R = {
    txPostByTx: await report("txstate.edu", "post", C.txPost),
    txApartmentByOther: await report("other.edu", "apartment", C.txApartment),
    otherPostByTx: await report("txstate.edu", "post", C.otherPost),
    spoofPostByTx: await report("txstate.edu", "post", C.spoofPost),
    txProfileByOther: await report("other.edu", "profile", TXA),
    spoofProfileByTx: await report("txstate.edu", "profile", SPOOF),
    txCommentByTx: await report("txstate.edu", "comment", C.txComment),
    otherCommentByTx: await report("txstate.edu", "comment", C.otherComment),
  };
  const IN_SCOPE = [R.txPostByTx, R.txApartmentByOther, R.txProfileByOther, R.txCommentByTx].map((r) => r.id);

  // Two flags: hidden by the platform's moderator, then flagged as the backstop would.
  const flag = async (type, id) => {
    await asVal(MOD, "select public.admin_content_hide($1, $2, 'Reported by ten people')", [type, id]);
    return val("insert into public.report_auto_hides (target_type, target_id, source, reporter_count, hidden_at) values ($1, $2, 'report_threshold', 10, now()) returning id", [type, id]);
  };
  const F = { tx: await flag("roommate", C.txRoommate), other: await flag("item", C.otherItem) };

  await expectError(tag + "before 73 a campus admin is refused the reports", () => asRows(CAMPUS, "select * from public.admin_reports_list('all', 200, null)"), "Not allowed");

  // What the platform's staff see before 73, to compare after it.
  const platformView = async () => ({
    modReports: await asRows(MOD, "select * from public.admin_reports_list('all', 200, null)"),
    adminReports: await asRows(ADMIN, "select * from public.admin_reports_list('open', 200, null)"),
    ownerReport: await asRows(OWNER, "select * from public.admin_report_get($1)", [R.otherPostByTx.id]),
    modFlags: await asRows(MOD, "select * from public.admin_auto_hidden_list('all', 200, null, null, null)"),
    modCounts: await asVal(MOD, "select public.admin_auto_hidden_counts()"),
    modContent: await asVal(MOD, "select public.admin_content_get('post', $1)", [C.spoofPost]),
  });
  const before = await platformView();
  const defsBefore = await definitions();

  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // ---------------------------------------------------------------------------
  // The platform's staff: unchanged
  // ---------------------------------------------------------------------------
  await expectOk(tag + "owners, admins and moderators get exactly the answers they got before 73", async () => {
    const after = await platformView();
    for (const k of Object.keys(before)) check(JSON.stringify(after[k]) === JSON.stringify(before[k]), `${k} changed`);
    check(before.modReports.length === Object.keys(R).length && before.modReports.every((r) => r.reporter_email), "the moderator sees every report and every email");
    check(before.modCounts.pending === 2, JSON.stringify(before.modCounts));
  });
  await expectOk(tag + "the table: campus admins get moderation.view; the moderator keeps the portal's list", async () => {
    const p = await asVal(CAMPUS, "select public.admin_my_permissions()");
    check(p.role === "campus_admin" && !p.platform && same(p.permissions, PORTAL_CAMPUS_ADMIN), JSON.stringify(p));
    check(same((await asVal(MOD, "select public.admin_my_permissions()")).permissions, PORTAL_MODERATOR), "moderator");
  });

  // ---------------------------------------------------------------------------
  // A campus admin: their own campus, nothing else
  // ---------------------------------------------------------------------------
  await expectOk(tag + "reports: only those about their own students' content; a reporter's email only for their own students", async () => {
    const rows = await asRows(CAMPUS, "select * from public.admin_reports_list('all', 200, null)");
    check(same(rows.map((r) => r.id), IN_SCOPE), `saw ${rows.length}: ${JSON.stringify(rows.map((r) => r.target_type))}`);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    check(byId[R.txPostByTx.id].reporter_email?.endsWith("@txstate.edu"), "their own student's email");
    check(byId[R.txApartmentByOther.id].reporter_email === null && byId[R.txProfileByOther.id].reporter_email === null, "another campus's student's email");
    check(byId[R.txApartmentByOther.id].reporter_name, "the reporter's name stays");
    const open = await asRows(CAMPUS, "select * from public.admin_reports_list('open', 200, null)");
    check(same(open.map((r) => r.id), IN_SCOPE), "open");
  });
  for (const [what, r] of [["another campus's post", R.otherPostByTx], ["a post placed on their campus by a student verified elsewhere", R.spoofPostByTx], ["a profile naming their campus, verified elsewhere", R.spoofProfileByTx], ["another campus's comment on their post", R.otherCommentByTx]]) {
    await expectError(tag + `a report about ${what} is not found`, () => asRows(CAMPUS, "select * from public.admin_report_get($1)", [r.id]), "Report not found");
  }
  await expectOk(tag + "a report of theirs opens", async () => {
    const [row] = await asRows(CAMPUS, "select * from public.admin_report_get($1)", [R.txCommentByTx.id]);
    check(row.target_type === "comment" && row.target_exists, JSON.stringify(row));
  });
  await expectError(tag + "resolving another campus's report: not found", () => asVal(CAMPUS, "select public.admin_report_resolve($1, 'dismissed', null)", [R.otherPostByTx.id]), "Report not found");
  await expectError(tag + "nor reopening it", () => asVal(CAMPUS, "select public.admin_report_reopen($1)", [R.otherPostByTx.id]), "Report not found");
  await expectOk(tag + "another campus's report is untouched", async () => {
    check((await val("select status from public.reports where id = $1", [R.otherPostByTx.id])) === "open", "changed");
  });
  await expectOk(tag + "resolving and reopening their own, audited as them", async () => {
    await asVal(CAMPUS, "select public.admin_report_resolve($1, 'no_action', 'Looked fine')", [R.txPostByTx.id]);
    check((await val("select reviewed_by from public.reports where id = $1", [R.txPostByTx.id])) === CAMPUS, "reviewer");
    await asVal(CAMPUS, "select public.admin_report_reopen($1)", [R.txPostByTx.id]);
    check((await val("select status from public.reports where id = $1", [R.txPostByTx.id])) === "open", "reopened");
    const actions = (await db.query("select action from public.staff_audit_log where actor_id = $1 and target_id = $2 order by id", [CAMPUS, String(R.txPostByTx.id)])).rows.map((r) => r.action);
    check(JSON.stringify(actions) === JSON.stringify(["report.resolve", "report.reopen"]), JSON.stringify(actions));
  });

  await expectOk(tag + "flags: only their campus's, and the counts with them", async () => {
    const rows = await asRows(CAMPUS, "select * from public.admin_auto_hidden_list('all', 200, null, null, null)");
    check(rows.length === 1 && rows[0].id === F.tx, JSON.stringify(rows.map((r) => r.target_type)));
    check((await asVal(CAMPUS, "select public.admin_auto_hidden_counts()")).pending === 1, "counts");
    check((await asRows(CAMPUS, "select * from public.admin_auto_hidden_list('all', 200, null, 'item', $1)", [C.otherItem])).length === 0, "asked by target");
  });
  await expectError(tag + "keeping another campus's flag hidden: not found", () => asVal(CAMPUS, "select public.admin_auto_hide_uphold($1, null)", [F.other]), "Flag not found");
  await expectOk(tag + "keeping their own hidden works", async () => {
    await asVal(CAMPUS, "select public.admin_auto_hide_uphold($1, 'Clear harassment')", [F.tx]);
    check((await val("select status from public.report_auto_hides where id = $1", [F.tx])) === "upheld", "not upheld");
    check((await val("select status from public.report_auto_hides where id = $1", [F.other])) === "pending", "the other flag changed");
  });

  await expectOk(tag + "content of their own students opens, wherever it was placed (a post, a comment elsewhere, Buzz)", async () => {
    for (const [type, id] of [["post", C.txPost], ["post", C.txPostElsewhere], ["comment", C.txComment], ["buzz", C.txBuzz], ["buzz_comment", C.txReply], ["apartment", C.txApartment]]) {
      check((await asVal(CAMPUS, "select public.admin_content_get($1, $2)", [type, id])) !== null, `${type} ${id}`);
    }
  });
  for (const [what, type, id] of [
    ["another campus's post", "post", C.otherPost],
    ["a post placed on their campus by a student verified elsewhere", "post", C.spoofPost],
    ["another campus's comment on their student's post", "comment", C.otherComment],
    ["another campus's Buzz", "buzz", C.otherBuzz],
    ["another campus's listing", "item", C.otherItem],
    ["a private message", "message", C.txPost],
    ["something that does not exist", "post", "00000000-0000-4000-8000-000000000000"],
  ]) {
    await expectError(tag + `${what}: not found`, () => asVal(CAMPUS, "select public.admin_content_get($1, $2)", [type, id]), "Content not found");
  }
  await expectError(tag + "hiding another campus's post: not found", () => asVal(CAMPUS, "select public.admin_content_hide('post', $1, 'Not allowed here')", [C.otherPost]), "Content not found");
  await expectError(tag + "restoring another campus's listing: not found", () => asVal(CAMPUS, "select public.admin_content_restore('item', $1)", [C.otherItem]), "Content not found");
  await expectOk(tag + "another campus's content is untouched", async () => {
    check((await val("select hidden_at from public.feed_posts where id = $1", [C.otherPost])) === null, "hidden");
    check((await val("select hidden_at from public.items where id = $1", [C.otherItem])) !== null, "restored");
  });
  await expectOk(tag + "hiding their own student's post works", async () => {
    await asVal(CAMPUS, "select public.admin_content_hide('post', $1, 'Harassment of another student')", [C.txPost]);
    check((await val("select hidden_at from public.feed_posts where id = $1", [C.txPost])) !== null, "not hidden");
  });
  await expectError(tag + "a moderator's limits: an escalated item waits for an admin", async () => {
    const q = await val("select id from public.mod_queue where entity_type = 'post' and entity_id = $1 and status <> 'closed'", [C.txPost]);
    if (q) await db.query("update public.mod_queue set status = 'escalated' where id = $1", [q]);
    else await db.query("insert into public.mod_queue (entity_type, entity_id, surface, source, priority, status) values ('post', $1, 'post', 'system', 'p2', 'escalated')", [C.txPost]);
    await asVal(CAMPUS, "select public.admin_content_restore('post', $1)", [C.txPost]);
  }, "An admin reviews this item");
  await expectOk(tag + "once it is not escalated, restoring their own student's post works", async () => {
    await db.query("update public.mod_queue set status = 'open' where entity_type = 'post' and entity_id = $1 and status = 'escalated'", [C.txPost]);
    await asVal(CAMPUS, "select public.admin_content_restore('post', $1)", [C.txPost]);
    check((await val("select hidden_at from public.feed_posts where id = $1", [C.txPost])) === null, "still hidden");
  });
  await expectError(tag + "deleting content stays admin-only", () => asVal(CAMPUS, "select public.admin_content_delete('post', $1, 'Delete it')", [C.txPostElsewhere]), "Not allowed");

  await expectError(tag + "without the second factor: refused", () => asRows(CAMPUS, "select * from public.admin_reports_list('all', 200, null)", [], { aal: "aal1" }), "Two-factor authentication required");
  await expectError(tag + "a campus admin without a campus: refused", () => asRows(NOCAMPUS, "select * from public.admin_reports_list('all', 200, null)"), "Not allowed");
  await expectError(tag + "a suspended campus admin: refused", () => asRows(BENCHED, "select * from public.admin_reports_list('all', 200, null)"), "Your account is suspended");
  for (const [what, sql, message] of [
    ["the content browser", "select * from public.admin_hidden_content_list(null, 50, null)", "Not allowed"],
    ["the user list", "select * from public.admin_users_list('all', 10, null)", "Not allowed"],
    ["a student's details", `select public.admin_user_get('${TXA}')`, "Not allowed"],
    ["suspending a student", `select public.admin_user_suspend('${TXA}', 'Not their call', null, null)`, "Not allowed"],
    ["the staff audit", "select * from public.admin_audit_list(50, null)", "Not allowed"],
    ["appeals (Phase 2c)", "select public.console_appeals()", "not_found"],
    ["the queue", "select public.console_queue_counts()", "not_found"],
    ["the audit feed", "select public.console_audit_feed()", "not_found"],
  ]) {
    await expectError(tag + `every other area still refuses them: ${what}`, () => asRows(CAMPUS, sql), message);
  }

  await expectOk(tag + "with a second campus they see both; taking it away takes it back", async () => {
    await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [CAMPUS, OTHER]);
    const both = await asRows(CAMPUS, "select id from public.admin_reports_list('all', 200, null)");
    check(both.length === Object.keys(R).length, `saw ${both.length}`);
    await db.query("delete from public.staff_campuses where user_id = $1 and university_id = $2", [CAMPUS, OTHER]);
    check(same((await asRows(CAMPUS, "select id from public.admin_reports_list('all', 200, null)")).map((r) => r.id), IN_SCOPE), "after");
  });
  await expectOk(tag + "a campus row left on a platform moderator changes nothing for them", async () => {
    await db.query("insert into public.staff_campuses (user_id, university_id) values ($1, $2)", [MOD, TX]);
    check(JSON.stringify(await val("select public.staff_campus_ids($1)", [MOD])) === "[]", "campus ids");
    check((await asRows(MOD, "select id from public.admin_reports_list('all', 200, null)")).length === Object.keys(R).length, "the moderator lost reports");
    await db.query("delete from public.staff_campuses where user_id = $1", [MOD]);
  });

  // ---------------------------------------------------------------------------
  // Closed, and where content belongs
  // ---------------------------------------------------------------------------
  for (const fn of ["staff_require_area('moderation.view', 'moderator')", `staff_campus_ids('${CAMPUS}')`, `staff_content_university('post', '${C.txPost}')`]) {
    await expectError(tag + `the helper ${fn.split("(")[0]} cannot be called through the API`, () => asVal(ADMIN, `select public.${fn}`), "permission denied");
  }
  await expectOk(tag + "the ten functions keep their grants: signed-in callers, never visitors", async () => {
    for (const sig of REPLACED) {
      check((await val("select has_function_privilege('authenticated', $1::regprocedure, 'execute')", [`public.${sig}`])) === true, `${sig} authenticated`);
      check((await val("select has_function_privilege('anon', $1::regprocedure, 'execute')", [`public.${sig}`])) === false, `${sig} anon`);
    }
  });
  await expectOk(tag + "content belongs to its author's verified campus: every kind, and nothing for messages or what is gone", async () => {
    const expect = [
      ["post", C.txPost, TX], ["post", C.txPostElsewhere, TX], ["post", C.spoofPost, OTHER], ["comment", C.txComment, TX], ["comment", C.otherComment, OTHER],
      ["apartment", C.txApartment, TX], ["item", C.otherItem, OTHER], ["roommate", C.txRoommate, TX], ["profile", TXA, TX], ["profile", SPOOF, OTHER],
      ["buzz", C.txBuzz, TX], ["buzz", C.otherBuzz, OTHER], ["buzz_comment", C.txReply, TX], ["buzz_reply", C.txReply, TX],
      ["message", C.txPost, null], ["story", C.txPost, null], ["nonsense", C.txPost, null], ["post", "00000000-0000-4000-8000-000000000000", null],
    ];
    for (const [type, id, uni] of expect) check((await contentUni(type, id)) === uni, `${type} ${id}: ${await contentUni(type, id)}`);
  });

  // ---------------------------------------------------------------------------
  // Rollback, then a second apply
  // ---------------------------------------------------------------------------
  await expectOk(tag + "the rollback puts every function back word for word and takes moderation.view away", async () => {
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    const after = await definitions();
    for (const sig of Object.keys(defsBefore)) check(after[sig] === defsBefore[sig], `${sig} differs after the rollback`);
    for (const helper of ["staff_require_area(text,text)", "staff_campus_ids(uuid)", "staff_content_university(text,uuid)"]) {
      check((await val("select to_regprocedure($1) is null", [`public.${helper}`])) === true, `${helper} left behind`);
    }
    check((await asVal(CAMPUS, "select public.admin_my_permissions()")).permissions.length === 0, "the campus admin kept permissions");
  });
  await expectError(tag + "after the rollback a campus admin is refused again", () => asRows(CAMPUS, "select * from public.admin_reports_list('all', 200, null)"), "Not allowed");
  await expectOk(tag + "applying it again works", async () => {
    await db.exec(read(MIGRATION));
    check(same((await asRows(CAMPUS, "select id from public.admin_reports_list('all', 200, null)")).map((r) => r.id), IN_SCOPE), "after the second apply");
  });
}

done("CAMPUS MODERATION");
