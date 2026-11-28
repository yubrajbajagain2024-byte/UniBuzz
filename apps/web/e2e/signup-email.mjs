// The website's sign-up email, in a browser, with real emails: a site that points at the staging project (never
// production), whose Auth SMTP points for the run at a throwaway Ethereal mailbox (supabase/tests/staging/mailbox.mjs);
// the project's built-in sender is put back afterwards.
//
//   BASE=http://localhost:3010 SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node apps/web/e2e/signup-email.mjs
//
// with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL=$BASE` of the staging project in
// the site's environment, and BASE an allowed redirect of the project (staging's site URL). PLAYWRIGHT_CHANNEL=chrome
// uses the installed Chrome.
//  1. Sign up on /signup: the confirmation is promised, "Send a new link" offered, one unconfirmed account made.
//  2. The email's link opened in another browser (a phone, say): the email is confirmed and that browser is signed in on
//     the page sign-up asked for, the tokens gone from the address bar.
//  3. Logging in before confirming: the words say so and offer a new link; at once it is refused in plain words, a
//     minute later it is sent; the newest link signs the student in; the older one says it is spent.
//  4. A link as the app asks for it (sign-up through supabase-js, the implicit flow): it signs the student in on the
//     website too.
//  5. A non-university address on /signup is refused, and nothing is made.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { BUILT_IN_SENDER, createMailbox, countTo, smtpSettings, waitFor } from "../../../supabase/tests/staging/mailbox.mjs";

const BASE = (process.env.BASE ?? "http://localhost:3010").replace(/\/$/, "");
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PRODUCTION = "dskbzoqreandwwpxiplh";
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This test changes Auth's email settings and makes accounts: never against production.");

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.replace(REF, "<ref>")} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const before = await mgmt("GET", `/v1/projects/${REF}/config/auth`);
if (before.smtp_host) throw new Error("Refusing: this project already sends with its own custom SMTP, which this test would replace.");
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const appClient = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" } });

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const account = async (email) => (await sql(`select count(*)::int as n, bool_and(email_confirmed_at is not null) as confirmed from auth.users where lower(email) = lower(${lit(email)})`))[0];
let failures = 0, passes = 0;
const step = async (n, fn) => { try { await fn(); passes++; console.log(`  ✓ ${n}`); } catch (e) { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 300)}`); } };
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const confirmLink = (m) => m.links.find((l) => /\/auth\/v1\/verify\?/.test(l) && /type=signup/.test(l));

const run = Date.now().toString(36);
const W = `web-${run}-w@txstate.edu`, U = `web-${run}-u@txstate.edu`, M = `web-${run}-m@txstate.edu`;
const PASSWORD = `Web-${run}!pass`;
const box = await createMailbox();
console.log(`Staging project ${project.name}: the website's sign-up email in a browser at ${BASE} (run ${run})`);

await mgmt("PATCH", `/v1/projects/${REF}/config/auth`, smtpSettings(box, box.pass));
// Auth takes a few seconds to load new settings: wait until a throwaway sign-up goes through.
for (let i = 0; ; i++) {
  await sleep(10_000);
  const { error } = await appClient().auth.signUp({ email: `web-${run}-probe${i}@txstate.edu`, password: PASSWORD });
  if (!error) break;
  if (i > 10) throw new Error(`Auth did not pick up the test SMTP: ${error.message}`);
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const errors = [];
async function page() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(30_000);
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const signedIn = async (p) => (await p.context().cookies()).some((c) => /^sb-.*-auth-token/.test(c.name));
async function signUpOnSite(p, email) {
  await p.goto(`${BASE}/signup`);
  await p.fill("#fullName", "Web Check");
  await p.fill("#email", email);
  await p.fill("#password", PASSWORD);
  await p.getByRole("button", { name: "Create account" }).click();
}

try {
  await step("sign up on /signup: the confirmation promised, a new link offered, one unconfirmed account", async () => {
    const p = await page();
    await signUpOnSite(p, W);
    await p.getByText(`We sent a confirmation link to ${W}`).waitFor();
    await p.getByTestId("resend-confirmation").waitFor();
    const a = await account(W);
    expect(a.n === 1 && a.confirmed === false, `account ${JSON.stringify(a)}`);
    await p.context().close();
  });
  await step("the email's link opened in another browser: confirmed, signed in there, on the page sign-up asked for", async () => {
    const { message } = await waitFor(box, { to: W, subject: /confirm/i });
    const link = confirmLink(message);
    expect(link, "no confirmation link");
    const p = await page();
    await p.goto(link);
    await p.waitForURL((u) => u.pathname === "/settings/profile", { timeout: 30_000 });
    expect(!p.url().includes("access_token"), "the tokens stayed in the address bar");
    expect(await signedIn(p), "not signed in");
    expect((await account(W)).confirmed === true, "not confirmed");
    await p.context().close();
  });

  let firstLink = null;
  await step("logging in before confirming says so and offers a new link; at once it is refused in plain words", async () => {
    const p = await page();
    await signUpOnSite(p, U);
    await p.getByText(`We sent a confirmation link to ${U}`).waitFor();
    firstLink = confirmLink((await waitFor(box, { to: U, subject: /confirm/i })).message);
    await p.goto(`${BASE}/login`);
    await p.fill("#email", U);
    await p.fill("#password", PASSWORD);
    await p.getByRole("button", { name: "Log in", exact: true }).click();
    await p.getByText(/Confirm your email first/).waitFor();
    const form = p.getByTestId("resend-confirmation");
    await form.waitFor();
    expect((await form.locator("input[name=email]").inputValue()) === U, "the address is not filled in");
    await form.getByRole("button", { name: "Send a new link" }).click();
    await form.getByText(/Too many tries/).waitFor();
    await sleep(62_000);
    const already = await countTo(box, U);
    await form.getByRole("button", { name: "Send a new link" }).click();
    await form.getByText(/If that email has an account waiting to be confirmed/).waitFor();
    const { message } = await waitFor(box, { to: U, subject: /confirm/i, after: already });
    const newest = confirmLink(message);
    expect(newest && newest !== firstLink, "no new link");
    // A link asked for on the login page goes where logging in would have (home here), signed in.
    await p.goto(newest);
    await p.waitForURL((u) => u.pathname === "/" && !u.hash.includes("access_token"));
    expect(await signedIn(p), "not signed in");
    await p.context().close();
  });
  await step("the older link says it is spent, and how to go on", async () => {
    const p = await page();
    await p.goto(firstLink);
    await p.getByText(/expired or was already used/).waitFor();
    expect(!(await signedIn(p)), "signed in by a spent link");
    await p.context().close();
  });

  await step("a link as the app asks for it (supabase-js, the implicit flow) signs the student in on the website too", async () => {
    const { error } = await appClient().auth.signUp({ email: M, password: PASSWORD, options: { data: { full_name: "App Check" }, emailRedirectTo: `${BASE}/auth/callback?next=/` } });
    expect(!error, error?.message);
    const { message } = await waitFor(box, { to: M, subject: /confirm/i });
    const p = await page();
    await p.goto(confirmLink(message));
    await p.waitForURL((u) => u.pathname === "/" && !u.hash.includes("access_token"));
    expect(await signedIn(p), "not signed in");
    expect((await account(M)).confirmed === true, "not confirmed");
    await p.context().close();
  });

  await step("a non-university address on /signup is refused, and nothing is made or sent", async () => {
    const outsider = `web-${run}-x@gmail.com`;
    const p = await page();
    await signUpOnSite(p, outsider);
    await p.getByText("Please fix the highlighted fields.").waitFor();
    expect((await account(outsider)).n === 0, "an account was made");
    expect((await countTo(box, outsider)) === 0, "an email was sent");
    await p.context().close();
  });
} finally {
  await browser.close();
  const ids = (await sql(`select id from auth.users where email like ${lit(`web-${run}-%`)}`)).map((r) => r.id);
  for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => failures++);
  await mgmt("PATCH", `/v1/projects/${REF}/config/auth`, BUILT_IN_SENDER);
  const after = await mgmt("GET", `/v1/projects/${REF}/config/auth`);
  const left = (await sql(`select count(*)::int as n from auth.users where email like ${lit(`web-${run}-%`)}`))[0].n;
  console.log(`  cleanup: ${ids.length} test accounts deleted, ${left} left; built-in sender back: ${after.smtp_host ? "NO" : "yes"}`);
  if (left || after.smtp_host) failures++;
}
const real = errors.filter((e) => !/Failed to load resource/.test(e));
if (real.length) { failures++; console.log(`  ✗ browser errors: ${real.slice(0, 3).join(" | ")}`); }
console.log(failures ? `${failures} FAILED, ${passes} passed` : `ALL ${passes} WEBSITE SIGN-UP EMAIL CHECKS PASSED`);
process.exit(failures ? 1 : 0);
