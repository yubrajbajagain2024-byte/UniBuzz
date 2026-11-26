// Dedicated staging accounts for CampConnect Admin's browser check (apps/admin/e2e/admin.mjs) and for signing in to
// the staff app by hand against staging: a staff admin and a staff moderator, each with a TOTP authenticator enrolled
// through Supabase Auth exactly as a real staff member's is (two-factor stays required: nothing here relaxes a check),
// and an ordinary student, who must land on /no-access. Confirmed txstate.edu accounts made by the admin API (no email
// is sent); the admin is an `admin` of the staff, never an owner, with the account's admin role that the Business section
// needs (as production's staff admins who run businesses have). Their passwords and authenticator keys live only in
// the git-ignored state file beside this script (.admin-e2e.json, mode 0600), never in the repository or on screen.
// Never runs against production: it refuses production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/admin-e2e-accounts.mjs create
//       makes the three accounts, or checks and reuses those in the state file; prints their emails and roles only
//   eval "$(node supabase/tests/staging/admin-e2e-accounts.mjs env [admin|moderator])"
//       sets ADMIN_E2E_EMAIL/PASSWORD/TOTP_SECRET (the admin by default) and E2E_USER_EMAIL/PASSWORD for admin.mjs,
//       without printing them
//   node supabase/tests/staging/admin-e2e-accounts.mjs qr [admin|moderator] <file.html>
//       writes the authenticator's QR code to that file (mode 0600), to add the account to an authenticator app
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/admin-e2e-accounts.mjs delete
//       removes the staff rows and the three accounts from staging, then the state file
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import qrcode from "qrcode-generator";
import { enrolAuthenticator, passSecondFactor, assuranceLevel } from "./mfa.mjs";

const PRODUCTION = "dskbzoqreandwwpxiplh";
const STATE_FILE = new URL("./.admin-e2e.json", import.meta.url);
const ROLES = { admin: "admin", moderator: "moderator" };
const EMAILS = { admin: "unibuzz-e2e+staff-admin@txstate.edu", moderator: "unibuzz-e2e+staff-moderator@txstate.edu", student: "unibuzz-e2e+student@txstate.edu" };
const [command = "", arg1, arg2] = process.argv.slice(2);

const readState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { accounts: {} });
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1), { mode: 0o600 });
const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

// --- Commands that only read the state file -----------------------------------------------------------------------
if (command === "env") {
  const state = readState();
  const staff = state.accounts[arg1 || "admin"];
  const student = state.accounts.student;
  if (!staff?.totp || !student) throw new Error("No accounts yet: run `create` first (with SUPABASE_ACCESS_TOKEN and STAGING_SUPABASE_REF).");
  console.log(
    [
      `export ADMIN_E2E_EMAIL=${shellQuote(staff.email)}`,
      `export ADMIN_E2E_PASSWORD=${shellQuote(staff.password)}`,
      `export ADMIN_E2E_TOTP_SECRET=${shellQuote(staff.totp)}`,
      `export E2E_USER_EMAIL=${shellQuote(student.email)}`,
      `export E2E_USER_PASSWORD=${shellQuote(student.password)}`,
    ].join("\n"),
  );
  process.exit(0);
}
if (command === "qr") {
  const who = arg2 ? arg1 : "admin";
  const file = arg2 ?? arg1;
  const staff = readState().accounts[who];
  if (!staff?.totp) throw new Error("No authenticator for that account: run `create` first.");
  if (!file) throw new Error("Give the file to write: qr [admin|moderator] <file.html>");
  const uri = `otpauth://totp/${encodeURIComponent(`UniBuzz staging:${staff.email}`)}?secret=${staff.totp}&issuer=${encodeURIComponent("UniBuzz staging")}&algorithm=SHA1&digits=6&period=30`;
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  const html = `<!doctype html><meta charset="utf-8"><title>UniBuzz staging authenticator</title>
<body style="font-family:system-ui;margin:2rem;max-width:36rem">
<h1 style="font-size:1.2rem">UniBuzz staging: ${staff.email} (${ROLES[who]} of the staff)</h1>
<p>Scan with your authenticator app. Staging only; this file holds the key, so delete it once scanned.</p>
${qr.createSvgTag({ cellSize: 6, margin: 4, scalable: false })}
</body>`;
  fs.writeFileSync(file, html, { mode: 0o600 });
  console.log(`Wrote the ${who}'s authenticator QR code to ${file} (mode 0600). Delete it once scanned.`);
  process.exit(0);
}
if (command !== "create" && command !== "delete") throw new Error("Usage: create | env [admin|moderator] | qr [admin|moderator] <file.html> | delete");

// --- Commands that talk to staging -----------------------------------------------------------------------------------
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("These are test accounts for staging: this script never runs against production.");
async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.replace(REF, "<staging>")} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const state = readState();

if (command === "delete") {
  const ids = Object.values(state.accounts).map((a) => a.id).filter(Boolean);
  if (ids.length) {
    await sql(`delete from public.staff where user_id in (${ids.map(lit).join(", ")})`);
    for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  console.log(`Deleted ${ids.length} staging test account(s) and their staff rows; the state file is gone.`);
  process.exit(0);
}

/** The account in the state file if it still exists on staging with that email, else a new confirmed one. */
async function ensureAccount(key) {
  const known = state.accounts[key];
  if (known?.id) {
    const { data } = await admin.auth.admin.getUserById(known.id);
    if (data?.user?.email === known.email) return known;
  }
  const email = EMAILS[key];
  const password = `Ue2e-${randomBytes(15).toString("base64url")}!9`;
  const name = { admin: "Staging Admin (e2e)", moderator: "Staging Moderator (e2e)", student: "Staging Student (e2e)" }[key];
  let { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error && /already|registered|exists/i.test(error.message)) {
    // Left from an earlier run whose state file is gone: take it over with a new password, its factors reset.
    const found = (await sql(`select id from auth.users where lower(email) = lower(${lit(email)})`))[0];
    if (!found) throw new Error(error.message);
    await sql(`delete from auth.mfa_factors where user_id = ${lit(found.id)}`);
    ({ data, error } = await admin.auth.admin.updateUserById(found.id, { password, email_confirm: true }));
  }
  if (error) throw new Error(error.message);
  state.accounts[key] = { id: data.user.id, email, password };
  saveState(state);
  return state.accounts[key];
}
async function signIn(acct) {
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email: acct.email, password: acct.password });
  if (s.error) throw new Error(`${acct.email}: ${s.error.message}`);
  return c;
}

for (const key of ["admin", "moderator"]) {
  const acct = await ensureAccount(key);
  const c = await signIn(acct);
  const factors = (await c.auth.mfa.listFactors()).data?.totp ?? [];
  if (!acct.totp || !factors.some((f) => f.status === "verified")) {
    for (const f of factors) await c.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
    acct.totp = await enrolAuthenticator(c, "Browser check");
    saveState(state);
  }
  await sql(`insert into public.staff (user_id, role) values (${lit(acct.id)}, ${lit(ROLES[key])}) on conflict (user_id) do update set role = excluded.role`);
  // The Business section (migration 63's console_require_business_admin) also needs the admin role on the account, as
  // production's staff admins who run businesses have it; the moderator keeps the student role.
  await sql(`select public.grant_role(${lit(acct.id)}, ${lit(key === "admin" ? "admin" : "student")})`);
  // Proof the account works as staff: a fresh sign-in passes the second factor, and the staff list answers it.
  const fresh = await signIn(acct);
  await passSecondFactor(fresh, acct.totp);
  if ((await assuranceLevel(fresh)) !== "aal2") throw new Error(`${acct.email}: the session did not reach aal2`);
  const me = await fresh.rpc("admin_me");
  if (me.error) throw new Error(`${acct.email}: admin_me: ${me.error.message}`);
}
const student = await ensureAccount("student");
await sql(`delete from public.staff where user_id = ${lit(student.id)}`);
await signIn(student);

const roles = await sql(`select u.email, s.role, p.role as account_role from auth.users u left join public.staff s on s.user_id = u.id left join public.profiles p on p.id = u.id where u.id in (${Object.values(state.accounts).map((a) => lit(a.id)).join(", ")}) order by 1`);
console.log(`Staging project ${project.name}: test accounts ready (state in supabase/tests/staging/.admin-e2e.json, mode 0600)`);
for (const r of roles) console.log(`  ${r.email}: ${r.role ? `${r.role} of the staff, authenticator enrolled` : "student, not staff"}${r.account_role === "admin" ? ", account role admin (Business)" : ""}`);
