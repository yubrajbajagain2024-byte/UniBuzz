// The business portal's admin screens with migration 67 on the staging project, in a browser: a staff admin signed in
// with a password lands on the portal's two-factor page, types the code from their authenticator and reaches the admin
// screens, which stay open after a reload; an account with the admin role alone (no staff row) gets "not found", not
// the two-factor page. Its accounts are made with the admin API (confirmed txstate.edu, no email sent) and deleted at
// the end. Staging only: it refuses production's ref and any project not named as staging, and fails on any request
// to production.
// Usage: the site pointed at staging (`node supabase/tests/staging/ad-delivery.mjs env` prints the line), then:
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=… BASE=http://localhost:3061 PLAYWRIGHT_CHANNEL=chrome \
//     node apps/web/e2e/business-admin-two-factor.mjs
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { enrolAuthenticator, totp } from "../../../supabase/tests/staging/mfa.mjs";

const BASE = process.env.BASE || "http://localhost:3061";
const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This check makes and deletes accounts: it never runs against production.");

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.replace(REF, "<staging>")} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
if (!(await sql("select count(*)::int as n from public._migrations where name = '20261119000000_admin_authority.sql'"))[0].n) throw new Error("Staging does not have migration 67: apply it first (supabase/tests/staging/admin-authority.mjs)");
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, keys.find((k) => k.name === "service_role").api_key, opts);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

const run = Date.now().toString(36);
const made = [];
async function account(name) {
  const email = `tf-${run}-${name}@txstate.edu`;
  const password = `Tf-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name[0].toUpperCase()}${name.slice(1)} Portal` } });
  if (error) throw new Error(error.message);
  made.push(data.user.id);
  return { id: data.user.id, email, password };
}
// A staff admin with an authenticator (enrolled through Auth, as the portal's page would), and the admin role alone.
const staffAdmin = await account("staffadmin");
const enrol = createClient(URL_, ANON, opts);
await enrol.auth.signInWithPassword({ email: staffAdmin.email, password: staffAdmin.password });
const secret = await enrolAuthenticator(enrol);
await sql(`select public.grant_role(${lit(staffAdmin.id)}, 'admin'); insert into public.staff (user_id, role) values (${lit(staffAdmin.id)}, 'admin') on conflict (user_id) do update set role = excluded.role;`);
const roleOnly = await account("roleonly");
await sql(`select public.grant_role(${lit(roleOnly.id)}, 'admin')`);

const results = [];
const note = (who, step, ok, why = "") => results.push({ who, step, ok, why });
let production = 0;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
async function signIn(u) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.on("request", (r) => { if (r.url().includes(PRODUCTION)) production++; });
  await page.goto(`${BASE}/business/login`);
  await page.fill("#email", u.email);
  await page.fill("#password", u.password);
  await page.locator("button[type=submit]").first().click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {});
  return { ctx, page };
}
try {
  // The staff admin: a password session reaches the two-factor page, the code opens the admin screens.
  {
    const { ctx, page } = await signIn(staffAdmin);
    await page.goto(`${BASE}/business/admin`, { waitUntil: "load" });
    const atTwoFactor = await page.getByTestId("portal-two-factor").waitFor({ timeout: 20000 }).then(() => true, () => false);
    note("staff admin", "password only: sent to two-factor", atTwoFactor && new URL(page.url()).pathname.endsWith("/two-factor"), page.url().replace(BASE, ""));
    if (atTwoFactor) {
      const left = 30 - (Math.floor(Date.now() / 1000) % 30);
      if (left < 6) await page.waitForTimeout(left * 1000 + 300);
      await page.locator("input[autocomplete=one-time-code]").fill(totp(secret));
      await page.getByRole("button", { name: "Confirm" }).click();
      const reached = await page.waitForURL((url) => url.pathname.endsWith("/business/admin") || url.pathname === "/admin", { timeout: 30000 }).then(() => true, () => false);
      note("staff admin", "code accepted: the admin screens open", reached && !(await page.getByTestId("portal-two-factor").count()), page.url().replace(BASE, ""));
      await page.reload({ waitUntil: "load" });
      note("staff admin", "after a reload: still open, no second code", !(await page.getByTestId("portal-two-factor").count()) && !/not found/i.test(await page.locator("body").innerText()), page.url().replace(BASE, ""));
    }
    await ctx.close();
  }
  // The admin role alone: "not found", never the two-factor page.
  {
    const { ctx, page } = await signIn(roleOnly);
    // The portal streams its pages (loading.tsx), so "not found" arrives as its own page under a 200: its words, and no
    // review controls, are what count.
    const NOT_HERE = /This page does not exist/;
    for (const path of ["/business/admin", "/business/admin/ads", "/business/two-factor"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const text = await page.locator("body").innerText();
      const controls = await page.getByRole("button", { name: /^(Approve|Reject|Pause|Record payment|Verify)/ }).count();
      note("admin role alone", `${path}: not found`, NOT_HERE.test(text) && controls === 0 && !(await page.getByTestId("portal-two-factor").count()), controls ? `${controls} review controls shown` : "the portal's \"Not here\" page");
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  const ids = made.map(lit).join(", ");
  await sql(`delete from public.staff where user_id in (${ids}); delete from public.staff_audit_log where actor_id in (${ids}) or target_id in (${ids});`).catch((e) => console.log(`  ! clean-up: ${e.message}`));
  for (const id of made) await admin.auth.admin.deleteUser(id).catch((e) => console.log(`  ! could not delete ${id}: ${e.message}`));
}
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.who.padEnd(17)} ${r.step.padEnd(42)} ${r.why}`);
if (production) console.log(`  ✗ ${production} requests went to production`);
const failed = results.filter((r) => !r.ok).length + (production ? 1 : 0) + (results.length < 6 ? 1 : 0);
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PORTAL TWO-FACTOR CHECKS PASSED (accounts deleted)`);
process.exit(failed ? 1 : 0);
