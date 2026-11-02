// The website's registration, confirmation, login and password recovery, in a browser, against a site that points at the
// staging project (never production: the accounts and links are made there with the admin API):
//
//   BASE=http://localhost:3061 SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node apps/web/e2e/password-recovery.mjs
//
// with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL=$BASE` of the staging project
// in the site's environment. PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome. Sign up on /signup, confirm through the
// callback route, log in; Forgot password; the recovery link landing on /reset-password with its session in the fragment,
// a mismatch refused, the password changed, the fragment gone from the address bar; the new password logs in and the old
// does not; the same link again, the page opened by hand and a refused link through the callback all say what to do.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.BASE ?? "http://localhost:3061").replace(/\/$/, "");
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === "dskbzoqreandwwpxiplh") throw new Error("This test makes and deletes accounts: it never runs against production.");
const mgmt = async (path) => {
  const r = await fetch(`https://api.supabase.com${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};
const project = await mgmt(`/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt(`/v1/projects/${REF}/api-keys?reveal=true`);
const admin = createClient(`https://${REF}.supabase.co`, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const link = async (type, email, redirectTo) => {
  const { data, error } = await admin.auth.admin.generateLink({ type, email, options: { redirectTo } });
  if (error) throw new Error(error.message);
  return data.properties;
};

const run = Date.now().toString(36);
const email = `web-auth-${run}@txstate.edu`;
const password = `First-${run}-pass!`;
const newPassword = `Second-${run}-pass!`;
let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const hosts = new Set();
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on("request", (r) => { try { hosts.add(new URL(r.url()).host); } catch {} });
  return { ctx, page };
}
const text = (page) => page.locator("main").innerText();
console.log(`Website at ${BASE} on staging ${project.name}: registration, login and recovery (run ${run})`);

let userId = null;
const first = await fresh();
await check("/signup makes the account and says a confirmation link was sent (or that the mailer's limit was hit, in words)", async () => {
  await first.page.goto(`${BASE}/signup`);
  await first.page.fill("#fullName", `Web ${run}`);
  await first.page.fill("#email", email);
  await first.page.fill("#password", password);
  await first.page.locator("button[type=submit]").first().click();
  await first.page.waitForTimeout(3000);
  const body = await text(first.page);
  if (/Too many tries/.test(body)) {
    console.log("    (the confirmation email hit staging's mail limit; the account is made with the admin API instead)");
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: false, user_metadata: { full_name: `Web ${run}` } });
    if (made.error) throw new Error(made.error.message);
    userId = made.data.user.id;
    return;
  }
  expect(/sent a confirmation link/.test(body), body.slice(0, 300));
  const { data } = await admin.from("profiles").select("id").eq("full_name", `Web ${run}`).maybeSingle();
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  userId = users.users.find((u) => u.email === email)?.id ?? data?.id ?? null;
  expect(userId, "no account");
});
await check("/login before confirming says to confirm the email", async () => {
  await first.page.goto(`${BASE}/login`);
  await first.page.fill("#email", email);
  await first.page.fill("#password", password);
  await first.page.locator("button[type=submit]").first().click();
  await first.page.waitForTimeout(2500);
  expect(/Confirm your email/.test(await text(first.page)), (await text(first.page)).slice(0, 300));
});
await check("the confirmation link, through the callback route, confirms the email and signs in", async () => {
  const { hashed_token } = await link("magiclink", email, `${BASE}/auth/callback?next=/`);
  await first.page.goto(`${BASE}/auth/callback?token_hash=${hashed_token}&type=magiclink&next=/profile/me`, { waitUntil: "load" });
  await first.page.waitForURL((u) => u.pathname === "/profile/me", { timeout: 30000 });
  expect(!/error=/.test(first.page.url()), first.page.url());
});
await first.ctx.close();

await check("/login with the password signs in; a wrong password says they don't match", async () => {
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "not-it-12345");
  await page.locator("button[type=submit]").first().click();
  await page.waitForTimeout(2500);
  expect(/don't match/.test(await text(page)), (await text(page)).slice(0, 300));
  await page.fill("#password", password);
  await page.locator("button[type=submit]").first().click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 });
  await ctx.close();
});
await check("/forgot-password, linked from /login, answers the same whether or not the account exists", async () => {
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/login`);
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL((u) => u.pathname === "/forgot-password");
  await page.fill("#email", `nobody-${run}@txstate.edu`);
  await page.locator("button[type=submit]").first().click();
  await page.waitForTimeout(3000);
  const body = await text(page);
  expect(/If there's an account for that email/.test(body) || /Too many tries/.test(body), body.slice(0, 300));
  expect(!/no account|not found|doesn't exist/i.test(body), body.slice(0, 300));
  await ctx.close();
});
let recovery = null;
await check("the recovery link lands on /reset-password with the form, its tokens taken off the address bar", async () => {
  recovery = (await link("recovery", email, `${BASE}/reset-password`)).action_link;
  const { ctx, page } = await fresh();
  await page.goto(recovery, { waitUntil: "load" });
  await page.waitForURL((u) => u.pathname === "/reset-password", { timeout: 30000 });
  // Says what the page shows if the form never comes, which is otherwise a bare timeout.
  await page.locator("#password").waitFor({ timeout: 30000 }).catch(async () => {
    await page.screenshot({ path: "apps/web/e2e/screenshots/password-recovery-no-form.png" }).catch(() => {});
    throw new Error(`no form at ${page.url().replace(/#.*/, "#…")}: "${(await text(page)).replace(/\s+/g, " ").slice(0, 300)}"`);
  });
  await page.waitForFunction(() => !window.location.hash, null, { timeout: 15000 });
  expect(page.url() === `${BASE}/reset-password`, page.url());
  // A mismatch is refused; then the change goes through.
  await page.fill("#password", newPassword);
  await page.fill("#confirm", "different-1234");
  await page.locator("button[type=submit]").first().click();
  await page.waitForTimeout(2000);
  expect(/don't match/.test(await text(page)), (await text(page)).slice(0, 300));
  // A submitted form is reset by React: both fields are typed again.
  await page.fill("#password", newPassword);
  await page.fill("#confirm", newPassword);
  await page.locator("button[type=submit]").first().click();
  await page.getByText("Your password is changed.").waitFor({ timeout: 30000 });
  await ctx.close();
});
await check("the new password logs in and the old one does not", async () => {
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator("button[type=submit]").first().click();
  await page.waitForTimeout(2500);
  expect(/don't match/.test(await text(page)), "the old password still works");
  await page.fill("#password", newPassword);
  await page.locator("button[type=submit]").first().click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 });
  await ctx.close();
});
await check("the same link again, the page opened by hand, and a refused link through the callback each say what to do", async () => {
  const { ctx, page } = await fresh();
  await page.goto(recovery, { waitUntil: "load" });
  await page.waitForURL((u) => u.pathname === "/reset-password", { timeout: 30000 });
  await page.getByRole("link", { name: "Request a new link" }).waitFor({ timeout: 15000 });
  expect(/expired or was already used/.test(await text(page)), (await text(page)).slice(0, 300));
  await page.goto(`${BASE}/reset-password`, { waitUntil: "load" });
  await page.getByRole("link", { name: "Request a new link" }).waitFor({ timeout: 15000 });
  expect(/Open the link from your email/.test(await text(page)), (await text(page)).slice(0, 300));
  await page.goto(`${BASE}/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&next=${encodeURIComponent("/reset-password")}`, { waitUntil: "load" });
  await page.waitForURL((u) => u.pathname === "/reset-password" && u.searchParams.get("error") === "expired", { timeout: 30000 });
  expect(/expired or was already used/.test(await text(page)), (await text(page)).slice(0, 300));
  await ctx.close();
});
await browser.close();
await check("no request went to production; the account is deleted", async () => {
  expect(![...hosts].some((h) => h.includes("dskbzoqreandwwpxiplh")), [...hosts].filter((h) => h.includes("supabase")).join(", "));
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
  }
});
console.log(`${failures ? "✗" : "✓"} website auth and recovery on staging: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
