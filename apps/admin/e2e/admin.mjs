// Browser check of the UniBuzz Master Admin Portal (apps/admin): signed-out gates, robots, the Content-Security-Policy
// and the worker endpoint; with test accounts, the staff flow with two-factor authentication and every page of the app,
// the audit log as each role sees it (migration 71), and no CSP violation anywhere. Usage: start it (npm run dev -w admin), then:
//   BASE=http://localhost:3001 node apps/admin/e2e/admin.mjs
// Optional accounts (their checks are skipped with a note when unset):
//   ADMIN_E2E_EMAIL + ADMIN_E2E_PASSWORD   a staff account; ADMIN_E2E_TOTP_SECRET is its authenticator key (base32) for the 2FA step.
//                                          An owner or admin also gets Analytics, Business (migration 63) and Universities (70)
//                                          checked: every view renders, or says it needs its migration; a moderator must not see them,
//                                          nor business entries or request details in the audit log.
//   E2E_USER_EMAIL + E2E_USER_PASSWORD     an ordinary (non-staff) account, which must land on /no-access
//   VERCEL_BYPASS                          bypass secret when Vercel Deployment Protection guards the deployment
//   PLAYWRIGHT_CHANNEL=chrome              use the installed Chrome instead of Playwright's own Chromium
// Staging accounts for all of these: supabase/tests/staging/admin-e2e-accounts.mjs (create, then env)
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3001";
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url)); fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0; const errors = []; const notes = [];
const ok = (m) => console.log(`  ✓ ${m}`); const bad = (m, e) => { failures++; console.log(`  ✗ ${m}: ${(e?.message ?? String(e)).split("\n").slice(0, 3).join(" // ").slice(0, 400)}`); };
const note = (m) => { notes.push(m); console.log(`  - ${m}`); };
const step = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };

/** RFC 6238 TOTP as Supabase Auth issues it: base32 secret, 30-second steps, HMAC-SHA-1, 6 digits. */
function totp(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const bytes = []; let bits = 0, value = 0;
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) { value = (value << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 0xff); value &= (1 << bits) - 1; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}

async function login(page, email, password, next = "/") {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`); await page.waitForLoadState("networkidle");
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Log in", exact: true }).click(); await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const expectLogin = (page, next) => { const u = new URL(page.url()); if (u.pathname !== "/login" || u.searchParams.get("next") !== next) throw new Error("url: " + page.url()); };

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); // PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome
// VERCEL_BYPASS: a "Protection Bypass for Automation" secret, when Vercel Deployment Protection is on for the admin project.
const BYPASS = process.env.VERCEL_BYPASS ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS, "x-vercel-set-bypass-cookie": "true" } : undefined;
async function newPage() { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: BYPASS }); await ctx.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "inline"} (${e.sourceFile || "?"}:${e.lineNumber})`))); const page = await ctx.newPage(); page.setDefaultTimeout(30000); const at = () => { try { return new URL(page.url()).pathname + new URL(page.url()).search; } catch { return "?"; } }; page.on("pageerror", (e) => errors.push(`${at()}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error") errors.push(`${at()}: ${m.text().slice(0, 8000)}`); }); return page; }
try {
  const D = await newPage();
  await step("signed out: every page goes to /login with next= pointing back", async () => {
    for (const path of ["/", "/users", "/reports", "/appeals", "/flagged", "/content", "/events", "/media", "/operations/health", "/operations/email", "/support", "/support/issues", "/universities", "/staff", "/audit", "/security", "/settings"]) { await D.goto(BASE + path); await D.waitForURL((u) => u.pathname === "/login"); expectLogin(D, path); }
    await D.waitForLoadState("networkidle"); await D.getByRole("heading", { name: "UniBuzz Master Admin Portal" }).waitFor();
    if (!/UniBuzz Master Admin Portal/.test(await D.title())) throw new Error(`title "${await D.title()}"`);
    if (await D.getByText(/create an account/i).count()) throw new Error("a sign-up link is offered");
    await D.screenshot({ caret: "initial", path: SHOTS + "admin-01-login.png" });
  });
  await step("robots: everything disallowed, X-Robots-Tag noindex on the login page, nothing cacheable", async () => {
    const robots = await (await D.goto(BASE + "/robots.txt")).text(); if (!/^Disallow:\s*\/\s*$/m.test(robots)) throw new Error("robots.txt: " + robots.replace(/\s+/g, " ").slice(0, 200));
    const res = await D.request.get(BASE + "/login"); const h = res.headers();
    if (!/noindex/.test(h["x-robots-tag"] || "")) throw new Error(`x-robots-tag "${h["x-robots-tag"]}"`);
    // Next.js sets its own Cache-Control on dynamic pages (no-cache in dev, private no-store in production), over the proxy's; either way nothing is cacheable.
    if (!/no-store|no-cache/.test(h["cache-control"] || "")) throw new Error(`cache-control "${h["cache-control"]}"`);
  });
  await step("Content-Security-Policy: scripts by a fresh nonce only, no framing, no plugins; the login page still runs", async () => {
    const policies = [];
    for (let i = 0; i < 2; i++) {
      const res = await D.request.get(BASE + "/login"); const csp = res.headers()["content-security-policy"] || "";
      for (const part of ["default-src 'self'", "'strict-dynamic'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) if (!csp.includes(part)) throw new Error(`missing ${part}: ${csp}`);
      if (/script-src[^;]*'unsafe-inline'/.test(csp)) throw new Error("script-src allows inline scripts");
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]; if (!nonce) throw new Error("no nonce: " + csp);
      const html = await res.text(); const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      const bare = scripts.filter((t) => !t.includes(`nonce="${nonce}"`)); if (!scripts.length || bare.length) throw new Error(`${bare.length} of ${scripts.length} scripts without this response's nonce: ${bare[0] ?? ""}`);
      policies.push(nonce);
    }
    if (policies[0] === policies[1]) throw new Error("the nonce did not change between responses");
    const redirect = await D.request.get(BASE + "/reports", { maxRedirects: 0 }); if (!(redirect.headers()["content-security-policy"] || "").includes("frame-ancestors")) throw new Error("a redirect without the policy");
    await D.goto(BASE + "/login"); await D.waitForFunction(() => typeof window.next === "object", null, { timeout: 15000 }); // hydrated: Next.js's scripts ran
  });
  await step("worker endpoint: refused without the secret (401 or 503), by GET and POST", async () => {
    for (const method of ["get", "post"]) { const r = await D.request[method](BASE + "/api/media/worker"); if (![401, 503].includes(r.status())) throw new Error(`${method} ${r.status()}`); }
    const r = await D.request.get(BASE + "/api/media/worker", { headers: { authorization: "Bearer wrong" } }); if (![401, 503].includes(r.status())) throw new Error(`wrong secret ${r.status()}`);
  });
  await step("/no-access signed out goes to login", async () => { await D.goto(BASE + "/no-access"); await D.waitForURL((u) => u.pathname === "/login"); });
  if (process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD) {
    await step("a student who signs in lands on /no-access and sees no admin shell", async () => {
      const U = await newPage(); await login(U, process.env.E2E_USER_EMAIL, process.env.E2E_USER_PASSWORD);
      await U.waitForURL((u) => u.pathname === "/no-access"); await U.getByRole("heading", { name: /not on the team/i }).waitFor(); // Next 16.4's route announcer repeats the title, so a text match finds two
      if (await U.getByText("Audit log").count()) throw new Error("admin navigation shown to a non-staff user");
      await U.goto(BASE + "/reports"); await U.waitForURL((u) => u.pathname === "/no-access" || u.pathname === "/security");
      await U.screenshot({ caret: "initial", path: SHOTS + "admin-02-student-no-access.png" }); await U.context().close();
    });
  } else note("non-staff check skipped: set E2E_USER_EMAIL and E2E_USER_PASSWORD (an ordinary account)");
  if (process.env.ADMIN_E2E_EMAIL && process.env.ADMIN_E2E_PASSWORD) {
    await step("staff login lands on the Security page first: two-factor authentication before anything else", async () => {
      await login(D, process.env.ADMIN_E2E_EMAIL, process.env.ADMIN_E2E_PASSWORD, "/reports");
      // The proxy sends the signed-in session to /security. Since Next 16.4 the address bar can keep the page asked for
      // while the Security page is what renders (the redirect is followed inside the navigation), so wait for the page, not the URL.
      await D.getByText(/two-factor/i).first().waitFor();
      if (await D.getByRole("heading", { name: "Reports", exact: true }).count()) throw new Error("the Reports page rendered before the second factor");
      await D.screenshot({ caret: "initial", path: SHOTS + "admin-03-security.png" });
    });
    if (process.env.ADMIN_E2E_TOTP_SECRET) {
      await step("the authenticator code opens the page asked for; every section renders", async () => {
        await D.waitForLoadState("networkidle");
        const code = D.locator("input[name='code']"); if (!(await code.count())) throw new Error("no code field on /security: has this account set up an authenticator yet?");
        const left = 30 - (Math.floor(Date.now() / 1000) % 30); if (left < 4) await D.waitForTimeout(left * 1000 + 300);
        await code.fill(totp(process.env.ADMIN_E2E_TOTP_SECRET)); await code.press("Enter");
        // The code's verification sets the aal2 session cookie and the action redirects to the page asked for: wait for that page.
        await D.getByRole("heading", { name: "Reports", exact: true }).first().waitFor(); await D.screenshot({ caret: "initial", path: SHOTS + "admin-04-reports.png" });
        const pages = [["/", "Dashboard"], ["/users", "Users"], ["/users?filter=unverified", "Users"], ["/appeals", "Appeals"], ["/flagged", "Flagged"], ["/content", "Content"], ["/events", "Events"], ["/media", "Media"], ["/operations/health", "System health"], ["/operations/email", "Email"], ["/support", "Support"], ["/support/issues", "Issues"], ["/staff", "Staff"], ["/audit", "Audit log"]];
        for (const [path, heading] of pages) { await D.goto(BASE + path); await D.getByRole("heading", { name: heading, exact: true }).first().waitFor(); await D.screenshot({ caret: "initial", path: SHOTS + `admin-05${path.replace(/[\/?=]/g, "-") || "-dashboard"}.png` }); }
      });
      await step("the audit log: every log for owners and admins with where staff actions came from; moderators never business entries or request details", async () => {
        await D.goto(BASE + "/audit"); await D.waitForLoadState("networkidle");
        const main = D.locator("main"); const text = await main.innerText();
        if (/needs migration 20261126000000/.test(text)) { note("audit log: migration 71 is not on this database, so the page shows the team's log as before"); return; }
        const role = (await D.locator("header").innerText()).toLowerCase(); const moderator = /moderator/.test(role);
        const logs = D.getByRole("navigation", { name: "Logs" });
        const businessPill = await logs.getByRole("link", { name: "Business", exact: true }).count();
        const businessRows = await main.locator('[data-testid="audit-entry"][data-source="business"]').count();
        const requests = await main.locator("summary", { hasText: "Request" }).count();
        if (moderator) {
          if (businessPill || businessRows || requests) throw new Error(`a moderator sees business entries (${businessPill}, ${businessRows}) or request details (${requests})`);
        } else {
          if (!businessPill) throw new Error("no Business log for an owner or admin");
          if (requests) { await main.locator("summary", { hasText: "Request" }).first().click(); await main.getByText("Address the API saw").first().waitFor(); }
          else note("audit log: no entry with request details yet on this database");
        }
        await D.screenshot({ caret: "initial", path: SHOTS + "admin-07-audit.png", fullPage: true });
        await logs.getByRole("link", { name: "Trust & Safety", exact: true }).click(); await D.waitForURL((u) => u.searchParams.get("source") === "trust_safety");
        const sources = await main.locator('[data-testid="audit-entry"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-source")))]);
        if (sources.some((x) => x !== "trust_safety")) throw new Error("the Trust & Safety filter shows " + sources.join(","));
        const older = main.getByRole("link", { name: "Older entries" });
        if (await older.count()) { await older.click(); await D.waitForURL((u) => u.searchParams.has("before")); await main.getByRole("link", { name: "Back to the newest" }).waitFor(); }
        await D.goto(BASE + "/audit?action=not.an.action."); await main.getByText("Nothing matches").waitFor();
      });
      await step("Analytics and Business: shown to owners and admins only, and every view renders", async () => {
        await D.goto(BASE + "/"); await D.waitForLoadState("networkidle");
        const nav = D.getByRole("navigation", { name: "Admin" }).first();
        // By address: a sidebar link's name is its label and its description ("Business & Ads Advertisers, campaigns, …").
        const shown = await nav.locator('a[href="/business"]').count();
        const role = (await D.locator("header").innerText()).toLowerCase();
        const universitiesShown = await nav.locator('a[href="/universities"]').count();
        if (/moderator/.test(role)) {
          if (shown || universitiesShown) throw new Error("a moderator sees Business or Universities");
          await D.goto(BASE + "/universities"); await D.waitForLoadState("networkidle");
          if (new URL(D.url()).pathname === "/universities") throw new Error("a moderator opened /universities");
          note("Analytics, Business and Universities skipped: this account is a moderator"); return;
        }
        if (!universitiesShown) throw new Error("no Universities link for an owner or admin");
        if (!shown) throw new Error("no Business link for an owner or admin");
        const views = ["/analytics", "/analytics?view=ads", "/analytics?view=revenue&range=90", "/business", "/business/advertisers", "/business/campaigns", "/business/campaigns?status=all",
          "/business/payments", "/business/pricing", "/business/reports", "/business/audit", "/settings", "/universities", "/universities?status=approved"];
        for (const path of views) {
          const res = await D.goto(BASE + path); await D.waitForLoadState("networkidle");
          const text = await D.locator("main").innerText();
          if (!res || res.status() >= 400 || /Something went wrong|Application error/.test(text)) throw new Error(`${path}: ${res?.status()} ${text.slice(0, 120)}`);
          if (new URL(D.url()).pathname === "/security" || /two-factor code/i.test(text)) throw new Error(`${path}: sent back to the Security page (the aal2 session was lost)`);
          if (!/needs migration 63|needs migration 20261122000000|Buzz rule packs|Who can sign up|not available to this account|need the UniBuzz admin role|Platform|Waiting|Overview|Advertisers|Campaigns|Payments|Rate card|reports|Nothing logged yet|When/.test(text)) throw new Error(`${path}: unexpected page ${text.slice(0, 160)}`);
          await D.screenshot({ caret: "initial", path: SHOTS + `admin-06${path.replace(/[/?=&]/g, "-")}.png`, fullPage: true });
        }
        const first = D.locator("a[href^='/business/campaigns/']").first();
        await D.goto(BASE + "/business/campaigns?status=all");
        if (await first.count()) { await first.click(); await D.waitForLoadState("networkidle"); if (/Something went wrong/.test(await D.locator("main").innerText())) throw new Error("a campaign page failed"); }
        else note("no campaign to open on this database");
      });
    } else note("two-factor step skipped: set ADMIN_E2E_TOTP_SECRET (the base32 key shown at /security when the authenticator was set up)");
  } else note("staff checks skipped: set ADMIN_E2E_EMAIL and ADMIN_E2E_PASSWORD (a staff account)");
  // Every browser error, in full, beside the screenshots (the step's report shows the first line of each only).
  fs.writeFileSync(SHOTS + "browser-errors.txt", errors.join("\n\n"));
  await step("no browser errors", async () => { const real = errors.filter((e) => !/favicon|DevTools|Failed to load resource.*(mux|picsum)|net::ERR_ABORTED|404|401|503/i.test(e)); if (real.length) throw new Error(real.slice(0, 4).join(" | ")); });
} finally { await browser.close(); if (notes.length) console.log(`\n${notes.length} optional check(s) skipped`); console.log(failures ? `\n${failures} ADMIN APP CHECK(S) FAILED` : "\nALL ADMIN APP CHECKS PASSED"); process.exit(failures ? 1 : 0); }
