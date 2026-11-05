// The kept campaigns of supabase/tests/staging/ad-delivery.mjs --keep, seen in a browser as the student, on a desktop
// and a phone-sized screen: a Sponsored post on Home (Orbit), a Sponsored reel in Reels when the campus has reels, a
// Sponsored listing in Housing, each labelled Sponsored with the business's name; each is kept on screen long enough to
// count an impression, and its button is clicked. Afterwards `node supabase/tests/staging/ad-delivery.mjs verify` shows
// those impressions and clicks reaching the businesses. It fails if the browser talks to production.
// Usage: the kept run, then the site pointed at staging (`node supabase/tests/staging/ad-delivery.mjs env` prints the
// line), then:
//   BASE=http://localhost:3061 PLAYWRIGHT_CHANNEL=chrome node apps/web/e2e/sponsored-ads.mjs
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3061";
const PRODUCTION = "dskbzoqreandwwpxiplh";
const state = JSON.parse(fs.readFileSync(new URL("../../../supabase/tests/staging/.ad-delivery.json", import.meta.url), "utf8"));
// STUDENT=web signs in as a student made with `ad-delivery.mjs student web`, whose impressions and clicks `verify`
// shows; the run's own student has already counted its one per hour.
const student = state.accounts[process.env.STUDENT || "student"];
if (!student) throw new Error(`No "${process.env.STUDENT}" in the kept run: make it with ad-delivery.mjs student ${process.env.STUDENT}`);
const [cafe, rent] = state.businesses;
const SCREENS = [
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "phone", viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];
const PLACES = [
  { name: "Home (Orbit)", path: "/", testId: "sponsored-post", business: cafe.name },
  { name: "Reels", path: "/?tab=reels", testId: "sponsored-reel", business: cafe.name, optional: "the campus has no reels" },
  { name: "Housing", path: "/apartments", testId: "sponsored-listing", business: rent.name },
];

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const results = [];
let production = 0;
for (const screen of SCREENS) {
  const ctx = await browser.newContext({ viewport: screen.viewport, isMobile: screen.isMobile, hasTouch: screen.hasTouch, deviceScaleFactor: screen.deviceScaleFactor });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.on("request", (r) => { if (r.url().includes(PRODUCTION)) production++; });
  await page.goto(BASE + "/login");
  await page.fill("#email", student.email);
  await page.fill("#password", student.password);
  await page.locator("button[type=submit]").first().click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {});
  if (new URL(page.url()).pathname.endsWith("/login")) { results.push({ screen: screen.name, place: "sign in", ok: false, why: "still on the login page" }); await ctx.close(); continue; }
  for (const place of PLACES) {
    let ok = false, why = "";
    try {
      await page.goto(BASE + place.path, { waitUntil: "load" });
      const ad = page.getByTestId(place.testId).filter({ hasText: place.business }).first();
      // Ads are asked for once the feed has loaded; a reel ad is a page further down the pager.
      await ad.waitFor({ state: "attached", timeout: 20000 });
      await ad.scrollIntoViewIfNeeded();
      const label = await ad.getByTestId("sponsored-label").first().innerText();
      if (label.trim() !== "Sponsored") throw new Error(`label "${label}"`);
      // At least half on screen for a second counts an impression; then the button (a link out opens a new tab).
      await page.waitForTimeout(1800);
      const button = ad.locator("a[rel~=sponsored], a[href^='/businesses/'], button[type=submit]").last();
      const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null), button.click()]);
      if (popup) await popup.close();
      ok = true;
      why = popup ? "seen; its link opened in a new tab" : "seen; its button opened";
    } catch (e) {
      const text = await page.locator("body").innerText().catch(() => "");
      if (place.optional && /No reels yet/.test(text)) { ok = true; why = `skipped: ${place.optional}`; }
      else why = e.message.split("\n")[0];
    }
    results.push({ screen: screen.name, place: place.name, ok, why });
  }
  await ctx.close();
}
await browser.close();
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.screen.padEnd(8)} ${r.place.padEnd(14)} ${r.why}`);
if (production) console.log(`  ✗ ${production} requests went to production`);
const failed = results.filter((r) => !r.ok).length + (production ? 1 : 0);
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} SPONSORED AD PAGES PASSED (now run: node supabase/tests/staging/ad-delivery.mjs verify)`);
process.exit(failed ? 1 : 0);
