// Sign-up email delivery on the staging project, end to end with real emails (2026-11-27: production's sign-ups failed
// with "Error sending confirmation email" when Gmail refused its SMTP login, 535 BadCredentials). For the run, the
// project's Auth SMTP points at a throwaway Ethereal mailbox (mailbox.mjs: it accepts mail and delivers none); the
// project's own settings are put back afterwards, exactly.
//
//  1. A refused SMTP login: sign-up answers "Error sending confirmation email", the apps say EMAIL_NOT_SENT, and no
//     account is left behind (Supabase rolls the sign-up back), so a student can simply try again.
//  2. A working SMTP: sign-up makes one unconfirmed account and its confirmation email arrives with a link to the site's
//     callback; logging in first is refused (EMAIL_NOT_CONFIRMED); signing up again makes no second account.
//  3. A new link (the apps' resendSignupConfirmation): refused within a minute in plain words, then sent; the newest
//     link confirms the email (its session lands in the fragment, as the app's flow asks), the older one is spent;
//     then the student logs in. Signing up again with the confirmed address makes no account and sends nothing new.
//  4. University verification holds: a non-university address is refused by the email-domain trigger (no account),
//     and a new link for it sends nothing.
//  5. Password recovery by email: the reset email's link lands with its session, the new password works and the old
//     one is refused.
// Every account it makes is deleted. Never runs against production: it refuses production's ref and any project not
// named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/auth-email.mjs
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { BUILT_IN_SENDER, createMailbox, countTo, smtpSettings, waitFor } from "./mailbox.mjs";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This test changes Auth's email settings and makes accounts: it never runs against production.");

const ROOT = new URL("../../../", import.meta.url);
const S = (rel) => import(new URL(`packages/shared/src/${rel}`, ROOT));
const { authErrorMessage, EMAIL_NOT_CONFIRMED, EMAIL_NOT_SENT, recoveryFromUrl, resetPasswordUrl } = await S("auth.ts");
const { enterRecoverySession, requestPasswordReset, resendSignupConfirmation, setNewPassword } = await S("queries/auth.ts");

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.replace(REF, "<ref>")} -> ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
/** A client as the app's: the implicit flow, so a link's session arrives in the fragment. */
const student = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" } });

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const rows = async (email) => Number((await sql(`select count(*)::int as n from auth.users where lower(email) = lower(${lit(email)})`))[0].n);
let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Where a Supabase link sends the browser: the Location of its redirect, without following it. */
async function landing(link) {
  const r = await fetch(link, { redirect: "manual" });
  const location = r.headers.get("location");
  expect(r.status >= 300 && r.status < 400 && location, `the link answered ${r.status} without a redirect`);
  return location;
}

// --- The project's email settings, kept to put back exactly ----------------------------------------------------------
// The run assumes Supabase's built-in sender, staging's setting, and puts it back by clearing the SMTP fields (the API
// takes no sender name or email rate without custom SMTP; the built-in sender's limit is fixed). A project with its own
// custom SMTP is refused rather than risk its credentials, which the API never returns to be put back.
const before = await mgmt("GET", `/v1/projects/${REF}/config/auth`);
if (before.smtp_host) throw new Error("Refusing: this project already sends with its own custom SMTP, which this test would replace.");
const SITE = before.site_url.replace(/\/$/, "");
const CALLBACK = `${SITE}/auth/callback?next=/`;
const run = Date.now().toString(36);
const A = `mail-${run}-a@txstate.edu`;
const OUTSIDER = `mail-${run}-x@gmail.com`;
const made = [];
console.log(`Staging project ${project.name}: sign-up email delivery (run ${run}); SMTP before: Supabase's built-in sender`);

const box = await createMailbox();
/** Points Auth's SMTP at the test mailbox (with `pass`), then waits until Auth answers with the new setting. */
async function smtp(pass, expectWorking) {
  await mgmt("PATCH", `/v1/projects/${REF}/config/auth`, smtpSettings(box, pass));
  // Auth takes a few seconds to load new settings; probe with a throwaway sign-up until it answers as expected.
  for (let i = 0; i < 12; i++) {
    await sleep(10_000);
    const probe = `mail-${run}-probe${i}${expectWorking ? "w" : "f"}@txstate.edu`;
    const { error } = await student().auth.signUp({ email: probe, password: `Probe-${run}!x` });
    const working = !error;
    if (working) made.push(probe);
    if (working === expectWorking) return;
  }
  throw new Error(`Auth did not pick up the ${expectWorking ? "working" : "refused"} SMTP setting within two minutes`);
}

try {
  // 1 -------------------------------------------------------------------------------------------------------------------
  await smtp("deliberately-wrong", false);
  await check("a refused SMTP login: sign-up fails with Supabase's error, the apps say EMAIL_NOT_SENT, and no account is left", async () => {
    const { data, error } = await student().auth.signUp({ email: A, password: `Mail-${run}!a`, options: { data: { full_name: "Mail Check" }, emailRedirectTo: CALLBACK } });
    expect(error && /error sending confirmation email/i.test(error.message), `expected the send failure, got ${error?.message ?? "success"}`);
    expect(authErrorMessage(error.message) === EMAIL_NOT_SENT, "the apps' words");
    expect(!data?.user, "a user came back");
    expect((await rows(A)) === 0, "an account was left behind");
  });

  // 2 -------------------------------------------------------------------------------------------------------------------
  await smtp(box.pass, true);
  let firstLink = null;
  await check("a working SMTP: sign-up makes one unconfirmed account and its confirmation email arrives with a link to the callback", async () => {
    const { data, error } = await student().auth.signUp({ email: A, password: `Mail-${run}!a`, options: { data: { full_name: "Mail Check" }, emailRedirectTo: CALLBACK } });
    expect(!error, error?.message);
    expect(data.user && !data.session && data.user.identities?.length === 1, "expected a new user with no session");
    made.push(A);
    expect((await rows(A)) === 1, "one account");
    const { message } = await waitFor(box, { to: A, subject: /confirm/i });
    firstLink = message.links.find((l) => /\/auth\/v1\/verify\?/.test(l) && /type=signup/.test(l));
    expect(firstLink, "no confirmation link in the email");
    expect(decodeURIComponent(firstLink).includes(CALLBACK), "the link does not lead to the site's callback");
  });
  await check("logging in before confirming is refused in plain words (EMAIL_NOT_CONFIRMED)", async () => {
    const { error } = await student().auth.signInWithPassword({ email: A, password: `Mail-${run}!a` });
    expect(error && authErrorMessage(error.message) === EMAIL_NOT_CONFIRMED, `got ${error?.message ?? "a session"}`);
  });
  await check("signing up again with the waiting address makes no second account", async () => {
    await student().auth.signUp({ email: A, password: `Mail-${run}!again` });
    expect((await rows(A)) === 1, "a second account");
  });

  // 3 -------------------------------------------------------------------------------------------------------------------
  await check("a new link at once is refused in plain words (one email a minute per account)", async () => {
    try {
      await resendSignupConfirmation(student(), A, CALLBACK);
      throw new Error("sent within the minute");
    } catch (e) {
      expect(/too many tries/i.test(String(e.message)), `got ${e.message}`);
    }
  });
  await sleep(62_000);
  let newLink = null;
  await check("a minute later a new link is sent (the apps' resendSignupConfirmation) and arrives", async () => {
    const already = await countTo(box, A);
    await resendSignupConfirmation(student(), A, CALLBACK);
    const { message } = await waitFor(box, { to: A, subject: /confirm/i, after: already });
    newLink = message.links.find((l) => /\/auth\/v1\/verify\?/.test(l) && /type=signup/.test(l));
    expect(newLink && newLink !== firstLink, "no new link");
  });
  await check("the older link is spent; the newest confirms the email, its session landing in the fragment", async () => {
    const old = recoveryFromUrl(await landing(firstLink));
    expect(old.kind === "expired" || old.kind === "error", `the old link still worked (${old.kind})`);
    const now = recoveryFromUrl(await landing(newLink));
    expect(now.kind === "session" && now.type === "signup", `landed ${now.kind}`);
    const confirmed = (await sql(`select email_confirmed_at is not null as c from auth.users where lower(email) = lower(${lit(A)})`))[0].c;
    expect(confirmed === true, "not confirmed");
  });
  await check("the student logs in", async () => {
    const { data, error } = await student().auth.signInWithPassword({ email: A, password: `Mail-${run}!a` });
    expect(!error && data.session, error?.message);
  });
  await check("signing up again with the confirmed address makes no account and sends nothing", async () => {
    const already = await countTo(box, A);
    const { data, error } = await student().auth.signUp({ email: A, password: `Mail-${run}!dup` });
    expect(!error && data.user?.identities?.length === 0, "expected Supabase's answer for a taken address (no identities)");
    expect((await rows(A)) === 1, "a second account");
    await sleep(8000);
    expect((await countTo(box, A)) === already, "an email was sent");
  });

  // 4 -------------------------------------------------------------------------------------------------------------------
  await check("university verification holds: a non-university address is refused by the trigger, and a new link for it sends nothing", async () => {
    const { error } = await student().auth.signUp({ email: OUTSIDER, password: `Mail-${run}!x` });
    expect(error && /database error saving new user/i.test(error.message), `got ${error?.message ?? "success"}`);
    expect((await rows(OUTSIDER)) === 0, "an account was made");
    await resendSignupConfirmation(student(), OUTSIDER, CALLBACK).catch(() => {});
    await sleep(8000);
    expect((await countTo(box, OUTSIDER)) === 0, "an email was sent");
  });

  // 5 -------------------------------------------------------------------------------------------------------------------
  await check("password recovery by email: the link lands with its session, the new password works, the old one is refused", async () => {
    await sleep(61_000); // one email a minute per account, and the last was the new confirmation link
    await requestPasswordReset(student(), A, resetPasswordUrl(SITE));
    const { message } = await waitFor(box, { to: A, subject: /reset|password/i });
    const link = message.links.find((l) => /type=recovery/.test(l));
    expect(link, "no recovery link in the email");
    const land = recoveryFromUrl(await landing(link));
    expect(land.kind === "session" && land.type === "recovery", `landed ${land.kind}`);
    const c = student();
    await enterRecoverySession(c, land);
    await setNewPassword(c, `Mail-${run}!new`);
    const fresh = await student().auth.signInWithPassword({ email: A, password: `Mail-${run}!new` });
    expect(!fresh.error && fresh.data.session, fresh.error?.message);
    const old = await student().auth.signInWithPassword({ email: A, password: `Mail-${run}!a` });
    expect(old.error, "the old password still works");
  });
} catch (e) {
  fail("the run", e);
} finally {
  for (const email of made) {
    const id = (await sql(`select id from auth.users where lower(email) = lower(${lit(email)})`))[0]?.id;
    if (id) await admin.auth.admin.deleteUser(id).catch((e) => fail(`delete ${email}`, e));
  }
  await mgmt("PATCH", `/v1/projects/${REF}/config/auth`, BUILT_IN_SENDER);
  const after = await mgmt("GET", `/v1/projects/${REF}/config/auth`);
  const same = ["smtp_host", "smtp_port", "smtp_user", "smtp_admin_email"].every((k) => (after[k] ?? null) === null);
  const left = Number((await sql(`select count(*)::int as n from auth.users where email like ${lit(`mail-${run}-%`)}`))[0].n);
  console.log(`  cleanup: ${made.length} test accounts deleted, ${left} left; email settings put back: ${same ? "yes" : "NO"}`);
  if (!same || left) failures++;
}
console.log(failures ? `${failures} FAILED, ${passes} passed` : `ALL ${passes} SIGN-UP EMAIL CHECKS PASSED`);
process.exit(failures ? 1 : 0);
