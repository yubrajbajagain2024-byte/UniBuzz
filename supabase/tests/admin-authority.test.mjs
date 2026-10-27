// Migration 48 (who is an admin for the business portal's staff actions) against PGlite. On production's schema
// (boot({ live: true }): CampConnect Admin's staff list and suspensions applied where they ran) an admin is a staff
// owner or admin, not suspended, whose session passed two-factor sign-in with a verified factor; the admin role on
// profiles no longer counts on its own. On a database built from this repo alone the admin role still decides. The
// rollback restores migration 39's rule and the migration applies again. Usage: node supabase/tests/admin-authority.test.mjs
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261106000000_admin_authority.sql";
const ROLLBACK = "rollbacks/20261106000000_admin_authority.down.sql";
const MFA = { aal: "aal2" };
const check = (cond, message) => { if (!cond) throw new Error(message); };
const val = async (p) => { const row = (await p).rows[0]; return row ? row[Object.keys(row)[0]] : undefined; };

/** A business owner's sign-up, email confirmed: a pending business only its team and admins can read. */
async function pendingBusiness(db, email) {
  const owner = (await db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2, now()) returning id",
    [email, JSON.stringify({ account_type: "business", full_name: "Rita Rock", business_name: "River Rock Apartments", business_category: "housing" })])).rows[0].id;
  return val(db.query("select id from public.businesses where owner_id = $1", [owner]));
}

// --- Production's schema: CampConnect Admin's staff list decides --------------------------------------------------
{
  console.log("production's schema (staff list, suspensions, two-factor):");
  const { db, mk, as, asAnon } = await boot({ live: true });
  /** As a user with exactly these claims: unlike as(), aal2 here does not add a verified factor. */
  const asClaims = async (uid, claims, fn) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, ...claims })}', false);`);
    try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
  };
  const standing = (uid, claims = MFA) => as(uid, () => val(db.query("select public.admin_standing()")), claims);
  const isAdmin = (uid, claims = MFA) => as(uid, () => val(db.query("select public.is_admin()")), claims);
  const reads = (uid, business, claims = MFA) => as(uid, async () => (await db.query("select id from public.businesses where id = $1", [business])).rows.length === 1, claims);
  const review = (uid, business, decision, claims = MFA) => as(uid, () => db.query("select public.admin_review_business($1, $2, null)", [business, decision]), claims);

  const OWNER = await mk("owner@txstate.edu", "Olivia Owner");
  await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
  const ADMIN = await mk("admin@txstate.edu", "Ada Admin");
  const MOD = await mk("moderator@txstate.edu", "Mo Derator");
  const ROLE_ONLY = await mk("roleonly@txstate.edu", "Rory Role");
  const STUDENT = await mk("student@txstate.edu", "Sam Student");
  await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $3), ($2, 'moderator', $3)", [ADMIN, MOD, OWNER]);
  // The admin role on profiles without a staff row: what migration 39 trusted on its own.
  await db.query("select public.grant_role($1, 'admin')", [ROLE_ONLY]);
  const business = await pendingBusiness(db, "hello@riverrock.example");

  await expectOk("the migration re-runs cleanly", () => db.exec(read(MIGRATION)));

  await expectOk("a staff admin who passed two-factor sign-in is an admin", async () => {
    check((await standing(ADMIN)) === "admin", "standing");
    check((await isAdmin(ADMIN)) === true, "is_admin");
  });
  await expectOk("a staff owner who passed two-factor sign-in is an admin", async () => check((await standing(OWNER)) === "admin", "owner"));
  await expectOk("a staff admin reads a pending business and reviews it", async () => {
    check(await reads(ADMIN, business), "cannot read the pending business");
    await review(ADMIN, business, "rejected");
    check((await val(db.query("select status from public.businesses where id = $1", [business]))) === "rejected", "not rejected");
    await review(ADMIN, business, "pending");
  });

  await expectOk("the admin role alone is not an admin, even with two-factor sign-in", async () => {
    check((await standing(ROLE_ONLY)) === null, "standing");
    check((await isAdmin(ROLE_ONLY)) === false, "is_admin");
  });
  await expectError("the admin role alone cannot review a business", () => review(ROLE_ONLY, business, "approved"), "Only CampConnect admins");
  await expectOk("the admin role alone cannot read a pending business", async () => check(!(await reads(ROLE_ONLY, business)), "read it"));

  await expectOk("a staff admin without two-factor sign-in is told to confirm it, and is not an admin yet", async () => {
    check((await standing(ADMIN, {})) === "mfa_required", "standing");
    check((await isAdmin(ADMIN, {})) === false, "is_admin");
    check(!(await reads(ADMIN, business, {})), "read the pending business");
  });
  await expectOk("require_admin() says so with hint MFA_REQUIRED", async () => {
    try {
      await review(ADMIN, business, "approved", {});
    } catch (e) {
      check(/authenticator app/.test(e.message) && e.hint === "MFA_REQUIRED" && e.code === "42501", `${e.message} / ${e.hint} / ${e.code}`);
      return;
    }
    throw new Error("no error");
  });
  await expectOk("a session that says aal2 without a verified factor is not enough (the factor was deleted)", async () => {
    await db.query("delete from auth.mfa_factors where user_id = $1", [ADMIN]);
    check((await asClaims(ADMIN, MFA, () => val(db.query("select public.admin_standing()")))) === "mfa_required", "standing");
    await db.query("insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')", [ADMIN]);
    check((await asClaims(ADMIN, MFA, () => val(db.query("select public.is_admin()")))) === false, "an unverified factor counted");
  });

  await expectOk("a moderator is not an admin", async () => check((await standing(MOD)) === null, "standing"));
  await expectError("a moderator cannot review a business", () => review(MOD, business, "approved"), "Only CampConnect admins");
  await expectOk("a student is not an admin", async () => check((await standing(STUDENT)) === null, "standing"));

  await expectOk("a suspended staff admin is not an admin; lifting the suspension restores it", async () => {
    await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'Checking suspended staff')", [ADMIN]);
    check((await standing(ADMIN)) === null, "suspended but still an admin");
    await db.query("update public.account_restrictions set lifted_at = now() where user_id = $1", [ADMIN]);
    check((await standing(ADMIN)) === "admin", "not restored");
  });
  await expectError("a suspended staff admin cannot review a business", async () => {
    await db.query("insert into public.account_restrictions (user_id, reason) values ($1, 'Checking suspended staff')", [ADMIN]);
    try { await review(ADMIN, business, "approved"); } finally { await db.query("update public.account_restrictions set lifted_at = now() where user_id = $1", [ADMIN]); }
  }, "Only CampConnect admins");

  await expectOk("removed from the staff list, an admin is not one any more, whatever their role says", async () => {
    const EX = await mk("former@txstate.edu", "Fran Former");
    await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $2)", [EX, OWNER]);
    await db.query("select public.grant_role($1, 'admin')", [EX]);
    check((await standing(EX)) === "admin", "not an admin while on the list");
    await db.query("delete from public.staff where user_id = $1", [EX]);
    check((await standing(EX)) === null, "still an admin");
  });

  await expectOk("signed out: not an admin, and no pending business", async () => {
    check((await asAnon(() => val(db.query("select public.is_admin()")))) === false, "is_admin");
    check((await asAnon(async () => (await db.query("select id from public.businesses where id = $1", [business])).rows.length)) === 0, "read it");
  });
  await expectError("admin_standing() is not callable signed out", () => asAnon(() => db.query("select public.admin_standing()")), "permission denied");
  await expectError("require_admin() is still not callable through the API", () => as(ADMIN, () => db.query("select public.require_admin()"), MFA), "permission denied");

  await expectOk("the rollback restores migration 39's rule: the admin role decides again", async () => {
    await db.exec(read(ROLLBACK));
    check((await isAdmin(ROLE_ONLY)) === true, "the admin role does not count");
    check((await isAdmin(ADMIN)) === false, "a staff admin without the role counts");
    check((await val(db.query("select to_regprocedure('public.admin_standing()')"))) === null, "admin_standing() left behind");
    await db.exec(read(ROLLBACK));
  });
  await expectOk("the migration applies again after the rollback", async () => {
    await db.exec(read(MIGRATION));
    check((await isAdmin(ROLE_ONLY)) === false && (await isAdmin(ADMIN)) === true, "not the staff rule");
  });
}

// --- A database built from this repo alone: the admin role still decides ------------------------------------------
{
  console.log("this repo's schema alone (no staff list):");
  const { db, mk, as } = await boot();
  const ADMIN = await mk("ann@txstate.edu", "Ann Avery");
  const STUDENT = await mk("ben@txstate.edu", "Ben Brooks");
  await db.query("select public.grant_role($1, 'admin')", [ADMIN]);
  const business = await pendingBusiness(db, "hello@riverrock.example");
  await expectOk("the admin role is an admin, with or without two-factor sign-in", async () => {
    check((await as(ADMIN, () => val(db.query("select public.admin_standing()")))) === "admin", "standing");
    check((await as(ADMIN, () => val(db.query("select public.is_admin()")), MFA)) === true, "is_admin");
  });
  await expectOk("the admin reviews a business", async () => {
    await as(ADMIN, () => db.query("select public.admin_review_business($1, 'rejected', null)", [business]));
    check((await val(db.query("select status from public.businesses where id = $1", [business]))) === "rejected", "not rejected");
  });
  await expectOk("a student is not an admin", async () => check((await as(STUDENT, () => val(db.query("select public.is_admin()")))) === false, "is_admin"));
  await expectError("a student cannot review a business", () => as(STUDENT, () => db.query("select public.admin_review_business($1, 'approved', null)", [business])), "Only CampConnect admins");
  await expectOk("rollback and migration both run here too", async () => {
    await db.exec(read(ROLLBACK));
    await db.exec(read(MIGRATION));
    check((await as(ADMIN, () => val(db.query("select public.is_admin()")))) === true, "is_admin");
  });
}

done("ADMIN AUTHORITY");
