// Browser check of the UniBuzz Master Admin Portal as a campus admin (Phase 2e): two-factor sign-in first, then their
// campus overview at "/" (migration 76's campus.overview), the navigation their permissions give and nothing else,
// their campus and role in the header, every page they may open rendering, and every page they may not open sending
// them back to their overview (never rendering, never looping), with no console error or CSP violation anywhere.
// Usage: start the portal against staging (a production build is closest), then:
//   eval "$(node supabase/tests/staging/campus-e2e-account.mjs env)"
//   BASE=http://localhost:3001 node apps/admin/e2e/campus-admin.mjs
// PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of Playwright's own Chromium.
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3001";
const { CAMPUS_E2E_EMAIL: EMAIL, CAMPUS_E2E_PASSWORD: PASSWORD, CAMPUS_E2E_TOTP_SECRET: SECRET, CAMPUS_E2E_CAMPUS: CAMPUS } = process.env;
if (!EMAIL || !PASSWORD || !SECRET || !CAMPUS) throw new Error("Set the campus admin's account: eval \"$(node supabase/tests/staging/campus-e2e-account.mjs env)\"");
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url));
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const errors = [];
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}: ${(e?.message ?? String(e)).split("\n").slice(0, 3).join(" // ").slice(0, 400)}`);
  }
};

/** RFC 6238 TOTP as Supabase Auth issues it (the same as admin.mjs). */
function totp(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let bits = 0, value = 0;
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 0xff); value &= (1 << bits) - 1; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "inline"}`)));
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`${page.url()}: ${m.text().slice(0, 2000)}`); });

console.log(`Campus admin browser check at ${BASE} (${CAMPUS})`);
await step("sign-in lands on the Security page: the second factor before anything else", async () => {
  await page.goto(`${BASE}/login?next=%2F`);
  await page.waitForLoadState("networkidle");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByText(/two-factor/i).first().waitFor();
  if (await page.getByRole("heading", { name: "My campus", exact: true }).count()) throw new Error("the overview rendered before the second factor");
});
await step("the authenticator code opens their campus overview at /", async () => {
  await page.waitForLoadState("networkidle");
  const code = page.locator("input[name='code']");
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < 4) await page.waitForTimeout(left * 1000 + 300);
  await code.fill(totp(SECRET));
  await code.press("Enter");
  await page.getByRole("heading", { name: "My campus", exact: true }).first().waitFor();
  const text = await page.locator("main").innerText();
  if (!text.includes(CAMPUS)) throw new Error("the overview does not name their campus");
  for (const card of ["Open reports", "Hidden by reports", "Open appeals", "Organizations to verify", "Upcoming events", "Suspended students"]) if (!text.includes(card)) throw new Error(`no ${card} card`);
  await page.screenshot({ caret: "initial", path: SHOTS + "campus-01-overview.png", fullPage: true });
});
await step("the header shows their role and campus", async () => {
  const header = await page.locator("header").first().innerText();
  if (!/Campus admin/.test(header) || !header.includes(CAMPUS)) throw new Error(header.replace(/\s+/g, " ").slice(0, 200));
});
await step("the sidebar holds exactly what their permissions give: My campus, Users, Moderation, Content", async () => {
  const labels = await page.getByRole("navigation", { name: "Admin" }).first().locator("a span.block.font-semibold, a span.text-sm.font-semibold").allInnerTexts();
  const got = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  const want = ["My campus", "Users", "Moderation", "Content"];
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`sidebar: ${JSON.stringify(got)}`);
});
await step("every page they may open renders", async () => {
  for (const [path, heading] of [["/users", "Users"], ["/users?filter=suspended", "Users"], ["/reports", "Reports"], ["/appeals", "Appeals"], ["/flagged", "Flagged"], ["/content", "Content"], ["/events", "Events"]]) {
    await page.goto(BASE + path);
    await page.getByRole("heading", { name: heading, exact: true }).first().waitFor();
    await page.screenshot({ caret: "initial", path: SHOTS + `campus-02${path.replace(/[\/?=]/g, "-")}.png` });
  }
  const tabs = await page.goto(BASE + "/users").then(() => page.getByRole("navigation", { name: /Users pages/ }).innerText().catch(() => ""));
  if (/Staff accounts/.test(tabs)) throw new Error("the Staff accounts tab shows for a campus admin");
  // The review queue is the platform's (Phase 4b): its tab never shows for a campus admin.
  const modTabs = await page.goto(BASE + "/reports").then(() => page.getByRole("navigation", { name: /Moderation pages/ }).innerText().catch(() => ""));
  if (!/Reports/.test(modTabs)) throw new Error("the Moderation tabs did not render");
  if (/\bQueue\b/.test(modTabs)) throw new Error("the Queue tab shows for a campus admin");
});
await step("their own Security page opens (their second factor and password)", async () => {
  await page.goto(BASE + "/security");
  await page.getByText(/two-factor/i).first().waitFor();
  if (new URL(page.url()).pathname !== "/security") throw new Error(`sent to ${page.url()}`);
});
await step("every page they may not open sends them back to their overview, never rendering it", async () => {
  for (const path of ["/queue", "/staff", "/audit", "/analytics", "/business", "/universities", "/settings", "/media", "/operations/health", "/operations/email", "/support", "/support/issues"]) {
    const res = await page.goto(BASE + path);
    await page.getByRole("heading", { name: "My campus", exact: true }).first().waitFor();
    const at = new URL(page.url()).pathname;
    if (at === path) throw new Error(`${path} stayed at its own address`);
    if (res && res.status() >= 500) throw new Error(`${path}: ${res.status()}`);
  }
});
await step("no console error or CSP violation on any page", async () => {
  const real = errors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 404/.test(e));
  if (real.length) throw new Error(real.slice(0, 5).join(" | "));
});

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL CAMPUS ADMIN BROWSER CHECKS PASSED");
process.exit(failures ? 1 : 0);
