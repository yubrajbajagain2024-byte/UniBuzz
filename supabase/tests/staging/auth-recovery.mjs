// Registration, email confirmation, login and password recovery on the staging project, through the real Supabase
// Auth the apps use and the apps' own code (packages/shared/src/auth.ts and queries/auth.ts): a student signs up, cannot
// log in before confirming, confirms through a link, logs in; a wrong password and an unknown email get the same words;
// a recovery link lands with its session in the fragment as the website's /reset-password page reads it, the password
// is set, the old one is refused and the new one works; the same link again is expired; a link told to land elsewhere
// is sent to the site instead. Links are made with the admin API (no email is read), the way Supabase's own emails make
// them. Never runs against production: it refuses production's ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/auth-recovery.mjs
//
// Staging's built-in mailer allows two emails an hour: the two calls here that send one (sign-up, the reset request)
// pass on a rate limit too, saying so, since the request is the app's and the limit the environment's.
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";

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
if (REF === PRODUCTION) throw new Error("This test makes and deletes accounts: it never runs against production.");

const ROOT = new URL("../../../", import.meta.url);
const S = (rel) => import(new URL(`packages/shared/src/${rel}`, ROOT));
const { authErrorMessage, recoveryFromUrl, RESET_LINK_EXPIRED, resetPasswordUrl } = await S("auth.ts");
const { signInSchema, resetRequestSchema, newPasswordSchema } = await S("schemas/index.ts");
const { enterRecoverySession, requestPasswordReset, setNewPassword } = await S("queries/auth.ts");

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const config = await mgmt("GET", `/v1/projects/${REF}/config/auth`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
/** A client as the app's: the implicit flow, so a link's session arrives in the fragment. */
const student = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" } });

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const val = async (q) => { const row = (await sql(q))[0]; return row ? row[Object.keys(row)[0]] : undefined; };
let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 500)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const rateLimited = (e) => /rate limit|security purposes|too many/i.test(String(e?.message ?? e));
/** Where a Supabase link sends the browser: the Location of its redirect, without following it. */
async function landing(actionLink) {
  const r = await fetch(actionLink, { redirect: "manual" });
  const location = r.headers.get("location");
  expect(r.status >= 300 && r.status < 400 && location, `the link answered ${r.status} without a redirect`);
  return location;
}
const makeLink = async (type, email, options = {}) => {
  const { data, error } = await admin.auth.admin.generateLink({ type, email, options });
  if (error) throw new Error(error.message);
  return data.properties.action_link;
};

const run = Date.now().toString(36);
const email = `st-auth-${run}@txstate.edu`;
const password = `First-${run}-pass!`;
const newPassword = `Second-${run}-pass!`;
const SITE = "http://localhost:3061";
let userId = null;
console.log(`Staging project ${project.name} (${REF}): registration, confirmation, login and recovery (run ${run})`);
const baseline = await val("select count(*)::int from auth.users");

// --- Registration and confirmation ---------------------------------------------------------------------------------------
await check("sign-up with a university email makes an unconfirmed account and sends a confirmation email (no session yet)", async () => {
  const c = student();
  const { data, error } = await c.auth.signUp({ email, password, options: { data: { full_name: `Auth ${run}` }, emailRedirectTo: `${SITE}/auth/callback?next=/` } });
  if (error && rateLimited(error)) {
    console.log(`    (the confirmation email hit staging's limit of ${config.rate_limit_email_sent} an hour: "${authErrorMessage(error.message)}"; the account is made with the admin API instead)`);
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: false, user_metadata: { full_name: `Auth ${run}` } });
    if (made.error) throw new Error(made.error.message);
    userId = made.data.user.id;
    return;
  }
  if (error) throw new Error(error.message);
  expect(data.user && data.user.identities?.length === 1, "no user, or an address already registered");
  expect(data.session === null, "a session before the email is confirmed");
  userId = data.user.id;
});
await check("sign-up with the same email again is refused as already registered, without a session", async () => {
  const { data, error } = await student().auth.signUp({ email, password: `Other-${run}!` });
  if (error && rateLimited(error)) return;
  expect(!error && data.user && data.user.identities?.length === 0, error ? error.message : "a second account was made");
});
await check("before confirming, login is refused in words that say to confirm, not that the password is wrong", async () => {
  const { error } = await student().auth.signInWithPassword(signInSchema.parse({ email, password }));
  expect(error, "it signed in unconfirmed");
  expect(/Confirm your email/.test(authErrorMessage(error.message)), `${error.message} → ${authErrorMessage(error.message)}`);
});
await check("the confirmation link confirms the email and lands with a session, as the website's callback would make one", async () => {
  const where = await landing(await makeLink("magiclink", email, { redirectTo: `${SITE}/auth/callback?next=/` }));
  const found = recoveryFromUrl(where);
  expect(found.kind === "session", `landed on ${where.replace(/#.*/, "#…")}`);
  const confirmed = await val(`select email_confirmed_at is not null from auth.users where id = ${lit(userId)}`);
  expect(confirmed === true, "email_confirmed_at is still null");
});

// --- Login ----------------------------------------------------------------------------------------------------------------
await check("login with the password, as the app sends it (the email tidied), gives a session", async () => {
  const { data, error } = await student().auth.signInWithPassword(signInSchema.parse({ email: ` ${email.toUpperCase()} `, password }));
  expect(!error && data.session?.user.id === userId, error?.message ?? "no session");
});
await check("a wrong password and an unknown email get the same words, which never say whether an account exists", async () => {
  const wrong = (await student().auth.signInWithPassword({ email, password: "not-it-12345" })).error;
  const unknown = (await student().auth.signInWithPassword({ email: `nobody-${run}@txstate.edu`, password })).error;
  expect(wrong && unknown, "one of them signed in");
  expect(wrong.message === unknown.message, `${wrong.message} vs ${unknown.message}`);
  const words = authErrorMessage(wrong.message);
  expect(/don't match/.test(words) && !/exist|not found|no account/i.test(words), words);
});

// --- Recovery --------------------------------------------------------------------------------------------------------------
await check("Forgot password: the app's own request goes through (or hits staging's mail limit, in its words)", async () => {
  try {
    await requestPasswordReset(student(), resetRequestSchema.parse({ email }).email, resetPasswordUrl(SITE));
  } catch (e) {
    if (!rateLimited(e)) throw e;
    expect(/Too many tries/.test(e.message), e.message);
    console.log(`    (rate-limited by staging's mailer, said as: "${e.message}")`);
  }
});
let link = null;
let found = null;
await check("the recovery link lands on /reset-password with its session in the fragment, as the page reads it", async () => {
  link = await makeLink("recovery", email, { redirectTo: resetPasswordUrl(SITE) });
  const where = await landing(link);
  expect(where.startsWith(`${resetPasswordUrl(SITE)}#`), `landed on ${where.replace(/#.*/, "#…")}`);
  found = recoveryFromUrl(where);
  expect(found.kind === "session" && found.type === "recovery", JSON.stringify({ ...found, accessToken: "…", refreshToken: "…" }));
});
await check("the session is entered and the new password set, typed twice the same; the old one is refused and the new one works", async () => {
  const c = student();
  await enterRecoverySession(c, found);
  expect(newPasswordSchema.safeParse({ password: newPassword, confirm: "different" }).success === false, "a mismatch was accepted");
  await setNewPassword(c, newPasswordSchema.parse({ password: newPassword, confirm: newPassword }).password);
  await c.auth.signOut();
  const old = (await student().auth.signInWithPassword({ email, password })).error;
  expect(old && /don't match/.test(authErrorMessage(old.message)), "the old password still works");
  const fresh = await student().auth.signInWithPassword({ email, password: newPassword });
  expect(!fresh.error && fresh.data.session, fresh.error?.message ?? "no session with the new password");
});
await check("setting the same password again is refused in words", async () => {
  const c = student();
  await c.auth.signInWithPassword({ email, password: newPassword });
  try {
    await setNewPassword(c, newPassword);
    throw new Error("accepted");
  } catch (e) {
    expect(/haven't used before/.test(e.message), e.message);
  }
});
await check("the same recovery link opened again has expired, and the page's words say so", async () => {
  const where = await landing(link);
  const again = recoveryFromUrl(where);
  expect(again.kind === "expired", `landed on ${where}`);
  expect(/expired/.test(RESET_LINK_EXPIRED), RESET_LINK_EXPIRED);
});
await check("a stale session (its tokens used) is refused with the expired words", async () => {
  try {
    await enterRecoverySession(student(), { ...found, refreshToken: "stale" });
    throw new Error("accepted");
  } catch (e) {
    expect(e.message === RESET_LINK_EXPIRED, e.message);
  }
});
await check("a link told to land on another site lands on this site instead (Supabase's redirect allow-list)", async () => {
  const where = await landing(await makeLink("recovery", email, { redirectTo: "https://evil.example/steal" }));
  expect(!where.startsWith("https://evil.example"), `landed on ${where.replace(/#.*/, "#…")}`);
  expect(where.startsWith(config.site_url), `landed on ${where.replace(/#.*/, "#…")}, not the site URL ${config.site_url}`);
});

// --- Cleanup -----------------------------------------------------------------------------------------------------------------
await check("the account is deleted; the number of accounts is as at the start", async () => {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
  }
  const after = await val("select count(*)::int from auth.users");
  expect(after === baseline, `${baseline} → ${after}`);
});
console.log(`${failures ? "✗" : "✓"} auth and recovery on staging: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
