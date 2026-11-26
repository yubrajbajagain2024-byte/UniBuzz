// Migration 71 (the Master Admin Portal's one audit view, and where staff actions came from) against PGlite, in this
// repo's order and in production's (boot({ live: true }): CampConnect Admin's staff list and staff_audit_log). Request
// context is recorded for a log row only when its actor is on the staff and the API request is their own: through the
// portal's real functions (a university request declined), Trust & Safety's and Business's writers; never for a
// student's appeal, a student's own row, a business team's change, someone else's request, a request without
// PostgREST's headers; malformed or spoofed headers are cleaned or dropped and never block the action. The table and
// the helpers are closed to the API. console_audit_feed: visitors, students and staff without the second factor
// refused; owners and admins see the three logs merged newest first with the context; moderators see each log's own
// rules (their rows and moderation activity in the team's log, a Buzz snapshot without its author, their own Trust &
// Safety rows but never a user tied to an anonymous Buzz item, no business rows, no context); the filters; keyset pages
// that walk the feed once, in order; the old readers unchanged. Then the rollback (context kept, nothing recorded
// after it) and a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const NAME = "20261126000000_audit_feed.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261126000000_audit_feed.down.sql";
const BEFORE = fs
  .readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations"))
  .filter((f) => f.endsWith(".sql") && f < NAME)
  .sort()
  .at(-1);
const SESSION = "11111111-2222-4333-8444-555555555555";
const MFA = { aal: "aal2", session_id: SESSION };
const HEADERS = {
  "x-forwarded-for": "203.0.113.9, 10.0.0.1",
  "user-agent": "node-fetch (portal server)",
  "x-portal-client-ip": "198.51.100.7",
  "x-portal-user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15",
  "x-portal-path": "/universities",
  cookie: "sb-access-token=never-kept",
  authorization: "Bearer never-kept",
};
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};

for (const live of [false, true]) {
  const tag = live ? "[production's order] " : "[repo order] ";
  const { db, mk, as, asAnon } = await boot({ upTo: BEFORE, live });
  const one = async (p) => (await p).rows[0];
  const val = async (q, params = []) => {
    const r = await one(db.query(q, params));
    return r[Object.keys(r)[0]];
  };
  const setRequest = (headers, pathName) =>
    db.query("select set_config('request.headers', $1, false), set_config('request.path', $2, false)", [
      headers === null ? "" : typeof headers === "string" ? headers : JSON.stringify(headers),
      pathName ?? "",
    ]);
  /** fn runs as `uid` in an API request carrying `headers`: the function's own role (authenticated), as PostgREST runs it. */
  const api = async (uid, headers, fn, { pathName = "/rpc/test", claims = MFA } = {}) =>
    as(
      uid,
      async () => {
        await setRequest(headers, pathName);
        try {
          return await fn();
        } finally {
          await setRequest(null, null);
        }
      },
      claims,
    );
  /** The database owner writing a log row inside uid's request (how the security-definer writers run). */
  const ownerInRequest = async (uid, headers, sql, params = []) => {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, aal: "aal2", session_id: SESSION, role: "authenticated" })]);
    await setRequest(headers, "/rpc/test");
    try {
      return await val(sql, params);
    } finally {
      await setRequest(null, null);
      await db.query("select set_config('request.jwt.claims', '', false)");
    }
  };
  const feed = (uid, filters = {}, limit = 50, claims = MFA) => as(uid, () => val("select public.console_audit_feed($1::jsonb, $2)", [JSON.stringify(filters), limit]), claims);
  const contextFor = (log, id) => one(db.query("select * from public.audit_request_context where log = $1 and entry_id = $2", [log, String(id)]));
  const contextCount = () => val("select count(*)::int from public.audit_request_context");
  const tsAudit = (actor, role, action, targetType, targetId, queue = null, metadata = {}) =>
    `select public.ts_audit(${actor ? `'${actor}'` : "null"}, '${role}', '${action}', '${targetType}', '${targetId}', ${queue ? `'${queue}'` : "null"}, null, null, 'checking', '${JSON.stringify(metadata)}'::jsonb)::text`;
  const bizAudit = (business, kind, action) =>
    `select (public.business_audit_write('${business}', '${kind}', '${action}', 'business', '${business}', '{}'::jsonb) is null)::text as x, (select max(id) from public.business_audit_log)::text as id`;
  const lastBizId = () => val("select max(id)::text from public.business_audit_log");

  const STUDENT = await mk("sam@txstate.edu", "Sam Student");
  const BIZ_OWNER = await mk("bea@txstate.edu", "Bea Business");
  await db.query("select public.grant_role($1, 'business_owner')", [BIZ_OWNER]);
  const ADMIN = await mk("ada@txstate.edu", "Ada Admin");
  const MOD = await mk("mo@txstate.edu", "Mo Moderator");
  let OWNER = null;
  if (live) {
    OWNER = await mk("owner@txstate.edu", "Olivia Owner");
    await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $3), ($2, 'moderator', $3)", [ADMIN, MOD, OWNER]);
  } else {
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'admin'), ($2, 'moderator')", [ADMIN, MOD]);
  }
  // Two-factor sessions for the staff (their factors are written before the migration, as on production).
  for (const u of [ADMIN, MOD, ...(OWNER ? [OWNER] : [])]) await as(u, () => val("select 1"), MFA);
  const BUSINESS = "6b0f6f6e-0000-4000-8000-00000000b001";
  const STAFF_LOG = live ? "staff" : "trust_safety";

  await expectOk(tag + `the migration applies after ${BEFORE} and re-runs cleanly`, async () => {
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
  });

  // ---------------------------------------------------------------------------
  // Closed to the API
  // ---------------------------------------------------------------------------
  for (const [who, uid] of [["a student", STUDENT], ["an admin of the staff", ADMIN]]) {
    await expectError(tag + `${who} cannot read the request context table`, () => as(uid, () => db.query("select * from public.audit_request_context"), MFA), "permission denied");
    await expectError(tag + `${who} cannot write it`, () => as(uid, () => db.query("insert into public.audit_request_context (log, entry_id, actor_id) values ('staff', '1', $1)", [uid]), MFA), "permission denied");
  }
  await expectError(tag + "a visitor cannot read it", () => asAnon(() => db.query("select * from public.audit_request_context")), "permission denied");
  for (const fn of ["audit_context_json('staff', '1')", "audit_actor_is_staff(null)", "audit_context_text('x', 5)"]) {
    await expectError(tag + `the helper ${fn.split("(")[0]} cannot be called through the API`, () => as(ADMIN, () => db.query(`select public.${fn}`), MFA), "permission denied");
  }

  // ---------------------------------------------------------------------------
  // Recording where staff actions came from
  // ---------------------------------------------------------------------------
  const asked = await as(STUDENT, () => val("select public.request_university('Lone Star College', 'Houston, TX', null, null)"));
  const decision = await expectOk(tag + "a university request declined through the portal records the staff member's request with the log row", async () => {
    await api(ADMIN, HEADERS, () => val("select public.console_decide_university_request($1, 'decline', null, null, null, null, 'Not yet.')", [asked.id]), {
      pathName: "/rpc/console_decide_university_request",
    });
    const row = live
      ? await one(db.query("select id::text from public.staff_audit_log where action = 'university_request.decline'"))
      : await one(db.query("select id::text from public.audit_log where action = 'university_request.decline'"));
    const c = await contextFor(STAFF_LOG, row.id);
    check(c, "no context row");
    check(c.actor_id === ADMIN && c.gateway_ip === "203.0.113.9, 10.0.0.1" && c.user_agent === "node-fetch (portal server)", JSON.stringify(c));
    check(c.portal_ip === "198.51.100.7" && c.portal_user_agent === HEADERS["x-portal-user-agent"] && c.portal_path === "/universities", JSON.stringify(c));
    check(c.endpoint === "/rpc/console_decide_university_request" && c.session_id === SESSION && c.aal === "aal2", JSON.stringify(c));
    check(!JSON.stringify(c).includes("never-kept"), "cookies and the bearer token must never be kept");
    return row.id;
  });

  await expectOk(tag + "a Trust & Safety row by an admin in their own request is recorded", async () => {
    const id = await ownerInRequest(ADMIN, HEADERS, tsAudit(ADMIN, "admin", "rule_pack_toggle", "rule_pack", "pii"));
    check((await contextFor("trust_safety", id))?.portal_ip === "198.51.100.7", "missing");
  });
  await expectOk(tag + "a business row by the UniBuzz team is recorded; a business team's own change is not", async () => {
    await ownerInRequest(ADMIN, HEADERS, bizAudit(BUSINESS, "admin", "business_approved"));
    const teamRow = await lastBizId();
    check((await contextFor("business", teamRow))?.actor_id === ADMIN, "the team's row should have context");
    await ownerInRequest(BIZ_OWNER, HEADERS, bizAudit(BUSINESS, "team", "profile_updated"));
    check(!(await contextFor("business", await lastBizId())), "a business team's row must not have context");
  });
  await expectOk(tag + "a student's appeal (logged with no actor during the student's request) is not recorded", async () => {
    const n = await contextCount();
    await ownerInRequest(STUDENT, HEADERS, tsAudit(null, "system", "appeal_create", "appeal", "00000000-0000-4000-8000-0000000000a1"));
    await ownerInRequest(STUDENT, HEADERS, tsAudit(STUDENT, "user", "appeal_create", "appeal", "00000000-0000-4000-8000-0000000000a2"));
    check((await contextCount()) === n, "a student's request must never be recorded");
  });
  await expectOk(tag + "a staff member named as the actor of someone else's request is not recorded", async () => {
    const n = await contextCount();
    await ownerInRequest(STUDENT, HEADERS, tsAudit(ADMIN, "admin", "strike_add", "post", "00000000-0000-4000-8000-0000000000b1"));
    check((await contextCount()) === n, "recorded");
  });
  await expectOk(tag + "a staff row written outside the API (no request headers) is not recorded", async () => {
    const n = await contextCount();
    const id = await ownerInRequest(ADMIN, null, tsAudit(ADMIN, "admin", "rule_pack_toggle", "rule_pack", "slurs"));
    check(id && (await contextCount()) === n, "recorded");
  });
  await expectOk(tag + "headers that are not JSON never block the action", async () => {
    const n = await contextCount();
    const id = await ownerInRequest(ADMIN, "{not json", tsAudit(ADMIN, "admin", "rule_pack_toggle", "rule_pack", "spam"));
    check(id && (await val("select count(*)::int from public.audit_log where id = $1", [id])) === 1 && (await contextCount()) === n, "the row should be written, without context");
  });
  await expectOk(tag + "spoofed or oversized values are dropped or cut: addresses must look like addresses, no control characters", async () => {
    const id = await ownerInRequest(ADMIN, {
      "x-forwarded-for": "javascript:alert(1)",
      "x-portal-client-ip": "198.51.100.7<script>",
      "user-agent": `Evil\u0007Agent\n${"x".repeat(1000)}`,
      "x-portal-path": "/\u001buniversities",
    }, tsAudit(ADMIN, "admin", "rule_pack_toggle", "rule_pack", "links"));
    const c = await contextFor("trust_safety", id);
    check(c && c.gateway_ip === null && c.portal_ip === null, JSON.stringify(c));
    check(c.user_agent.startsWith("EvilAgent") && c.user_agent.length === 300 && !/[\u0000-\u001f]/.test(c.user_agent) && c.portal_path === "/universities", JSON.stringify(c).slice(0, 200));
  });
  await expectOk(tag + "an IPv6 address is kept", async () => {
    const id = await ownerInRequest(ADMIN, { "x-forwarded-for": "2001:db8::1", "x-portal-client-ip": "2001:db8::7" }, tsAudit(ADMIN, "admin", "rule_pack_toggle", "rule_pack", "v6"));
    const c = await contextFor("trust_safety", id);
    check(c?.gateway_ip === "2001:db8::1" && c.portal_ip === "2001:db8::7", JSON.stringify(c));
  });

  // Rows for the visibility checks: a moderator's own Trust & Safety row, one of theirs tied to an anonymous Buzz item,
  // the team's own changes, and (production's order) a deleted Buzz thread's snapshot in the team's log.
  const queue = await val("insert into public.mod_queue (entity_type, entity_id, surface, source, priority) values ('buzz', gen_random_uuid(), 'buzz', 'user_report', 'p2') returning id::text");
  const modOwn = await ownerInRequest(MOD, HEADERS, tsAudit(MOD, "moderator", "approve", "buzz", "00000000-0000-4000-8000-0000000000c1", queue));
  const modAnonUser = await ownerInRequest(MOD, HEADERS, tsAudit(MOD, "moderator", "strike_add", "user", STUDENT, queue));
  if (live) {
    await db.query(
      "insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details) values ($1, 'owner@txstate.edu', 'staff.role', 'user', $2, '{\"from\":\"moderator\",\"to\":\"admin\"}'), ($1, 'owner@txstate.edu', 'content.delete', 'buzz', gen_random_uuid()::text, '{\"snapshot\":{\"body\":\"hello\",\"author_id\":\"x\",\"author_name\":\"Sam\",\"author_email\":\"sam@txstate.edu\"},\"children\":[1]}')",
      [OWNER, MOD],
    );
  }

  // ---------------------------------------------------------------------------
  // The feed
  // ---------------------------------------------------------------------------
  await expectError(tag + "a visitor cannot read the feed", () => asAnon(() => db.query("select public.console_audit_feed()")), "permission denied");
  await expectError(tag + "a student cannot", () => feed(STUDENT, {}, 50, {}), "not_found");
  await expectError(tag + "an admin without the second factor is asked for it", () => feed(ADMIN, {}, 50, {}), "mfa_required");

  const all = await expectOk(tag + "an admin reads every log merged newest first, with the request context", async () => {
    const f = await feed(ADMIN, {}, 100);
    const sources = new Set(f.items.map((i) => i.source));
    check(live ? sources.size === 3 : sources.size === 2 && !sources.has("staff"), [...sources].join(","));
    check(JSON.stringify(f.sources) === JSON.stringify(live ? ["staff", "trust_safety", "business"] : ["trust_safety", "business"]) && f.contextVisible === true, JSON.stringify(f.sources));
    for (let i = 1; i < f.items.length; i++) check(new Date(f.items[i - 1].createdAt) >= new Date(f.items[i].createdAt), `order at ${i}`);
    const d = f.items.find((i) => i.action === "university_request.decline");
    check(d && d.source === STAFF_LOG && d.context?.portalIp === "198.51.100.7" && d.context.sessionId === SESSION && d.actor?.id === ADMIN, JSON.stringify(d));
    const biz = f.items.find((i) => i.source === "business" && i.action === "business_approved");
    check(biz?.business?.id === BUSINESS && biz.context?.gatewayIp === "203.0.113.9, 10.0.0.1", JSON.stringify(biz));
    check(f.nextCursor === null, "one page holds everything");
    return f;
  });

  await expectOk(tag + "a moderator sees each log's own rules, never business rows or request context", async () => {
    const f = await feed(MOD, {}, 100);
    check(f.contextVisible === false && !f.sources.includes("business"), JSON.stringify(f.sources));
    check(f.items.every((i) => i.context === null || i.context === undefined) && f.items.every((i) => i.source !== "business"), "context or business rows leaked");
    const ts = f.items.filter((i) => i.source === "trust_safety");
    check(ts.length > 0 && ts.every((i) => i.actor?.id === MOD), "Trust & Safety rows of others leaked");
    check(ts.some((i) => i.id === modOwn) && !ts.some((i) => i.id === modAnonUser), "the user tied to an anonymous Buzz item must stay hidden");
    if (live) {
      const staff = f.items.filter((i) => i.source === "staff");
      check(!staff.some((i) => i.action === "staff.role" || i.action === "university_request.decline"), "the team's changes leaked to a moderator");
      const del = staff.find((i) => i.action === "content.delete");
      check(del && del.details.snapshot.body === "hello" && !("author_name" in del.details.snapshot) && !("author_email" in del.details.snapshot) && !("children" in del.details), JSON.stringify(del?.details));
    }
  });
  if (live) {
    await expectOk(tag + "an owner sees the deleted thread's author", async () => {
      const f = await feed(OWNER, { action: "content.delete" });
      check(f.items.length === 1 && f.items[0].details.snapshot.author_name === "Sam", JSON.stringify(f.items));
    });
  }
  await expectOk(tag + "the admin sees the moderator's row tied to the anonymous item", async () => {
    check(all.items.some((i) => i.id === modAnonUser), "missing for an admin");
  });

  await expectOk(tag + "filters: source, actor, action, an action prefix, target, business, dates", async () => {
    const bySource = await feed(ADMIN, { source: "business" });
    check(bySource.items.length >= 2 && bySource.items.every((i) => i.source === "business"), "source");
    const byActor = await feed(ADMIN, { actor: MOD });
    check(byActor.items.length >= 2 && byActor.items.every((i) => i.actor?.id === MOD), "actor");
    const exact = await feed(ADMIN, { action: "rule_pack_toggle" });
    check(exact.items.length === 5 && exact.items.every((i) => i.action === "rule_pack_toggle"), `action ${exact.items.length}`);
    const prefix = await feed(ADMIN, { action: "university_request." });
    check(prefix.items.length === 1 && prefix.items[0].action === "university_request.decline", "prefix");
    const target = await feed(ADMIN, { targetType: "rule_pack", targetId: "pii" });
    check(target.items.length === 1, "target");
    const business = await feed(ADMIN, { business: BUSINESS });
    check(business.items.length === 2 && business.items.every((i) => i.business?.id === BUSINESS), "business");
    const future = await feed(ADMIN, { from: String(Date.now() + 86_400_000) });
    check(future.items.length === 0, "from");
    const past = await feed(ADMIN, { to: "1000" });
    check(past.items.length === 0, "to");
    const unknown = await feed(ADMIN, { source: "everything" });
    check(unknown.items.length === all.items.length, "an unknown source means all");
  });

  await expectOk(tag + "pages of 2 walk the whole feed once, in the same order, and end", async () => {
    const seen = [];
    let before = null;
    for (let guard = 0; guard < 200; guard++) {
      const page = await feed(ADMIN, before ? { before } : {}, 2);
      check(page.items.length <= 2, "page too long");
      seen.push(...page.items.map((i) => `${i.source}:${i.id}`));
      if (!page.nextCursor) break;
      before = page.nextCursor;
    }
    const expected = all.items.map((i) => `${i.source}:${i.id}`);
    check(JSON.stringify(seen) === JSON.stringify(expected), `walked ${seen.length}, expected ${expected.length}`);
  });
  await expectOk(tag + "a malformed cursor is ignored and the limit is kept between 1 and 100", async () => {
    const f = await feed(ADMIN, { before: "1-9-x'; drop table audit_log; --" }, 0);
    check(f.items.length === 1 && f.items[0].id === all.items[0].id, "a bad cursor reads from the newest; limit 0 becomes 1");
    const big = await feed(ADMIN, {}, 100000);
    check(big.items.length === all.items.length, "the limit tops out at 100");
  });

  // ---------------------------------------------------------------------------
  // The logs' own readers are unchanged
  // ---------------------------------------------------------------------------
  await expectOk(tag + "the Trust & Safety reader (console_audit) answers as before, without context", async () => {
    const r = await as(ADMIN, () => val("select public.console_audit(50, 0, '{}'::jsonb)"), MFA);
    check(r.items.length > 0 && r.items.every((i) => !("context" in i)), "changed");
  });
  if (live) {
    await expectOk(tag + "the team's reader (admin_audit_list) answers as before, without context", async () => {
      const r = await as(ADMIN, () => db.query("select * from public.admin_audit_list(50, null)"), MFA);
      check(r.rows.length > 0 && Object.keys(r.rows[0]).join(",") === "id,actor_id,actor_email,actor_name,action,target_type,target_id,details,created_at", Object.keys(r.rows[0]).join(","));
    });
  }

  // ---------------------------------------------------------------------------
  // Rollback, then a second apply
  // ---------------------------------------------------------------------------
  await expectOk(tag + "the rollback removes the feed and the triggers and keeps what was recorded", async () => {
    const kept = await contextCount();
    await db.exec(read(ROLLBACK));
    await db.exec(read(ROLLBACK));
    check((await val("select to_regprocedure('public.console_audit_feed(jsonb,integer)') is null")) === true, "the feed should be gone");
    check((await contextCount()) === kept, "the context rows must stay");
    await ownerInRequest(ADMIN, HEADERS, tsAudit(ADMIN, "admin", "rule_pack_toggle", "rule_pack", "after-rollback"));
    check((await contextCount()) === kept, "nothing is recorded after the rollback");
    check((await val("select count(*)::int from pg_trigger where tgname like '%request_context'")) === 0, "triggers left behind");
  });
  await expectOk(tag + "applying it again records context and serves the feed", async () => {
    await db.exec(read(MIGRATION));
    const id = await ownerInRequest(ADMIN, HEADERS, tsAudit(ADMIN, "admin", "rule_pack_toggle", "rule_pack", "again"));
    check((await contextFor("trust_safety", id))?.actor_id === ADMIN, "not recorded");
    check((await feed(ADMIN, { targetId: "again" })).items.length === 1, "feed");
    check((await val("select count(*)::int from pg_trigger where tgname like '%request_context'")) === (live ? 3 : 2), "triggers");
  });
}

done("AUDIT FEED");
