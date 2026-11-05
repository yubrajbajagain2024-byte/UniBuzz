// The website's refresh, after the app's pull-to-refresh fix: the site has no in-place refresh, so a page reload (F5, or a
// phone browser's pull-down) is its refresh. Signed in as a student of the kept run of
// supabase/tests/staging/ad-delivery.mjs --keep, for Home (Orbit), Reels and Housing in turn: the run's ad is on the
// page; the business pauses it and a reload no longer shows it; it resumes and a reload shows it again. The reloads add
// no impression beyond the first (the database keeps one per student, ad and hour). Fails if the browser talks to
// production. Pauses and resumes go through `ad-delivery.mjs pause|resume`, so it needs the staging credentials too.
// Usage: the kept run, a student for it (`ad-delivery.mjs student web`), the site pointed at staging, then:
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=… STUDENT=web BASE=http://localhost:3061 PLAYWRIGHT_CHANNEL=chrome \
//     node apps/web/e2e/sponsored-ads-refresh.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3061";
const PRODUCTION = "dskbzoqreandwwpxiplh";
const SCRIPT = new URL("../../../supabase/tests/staging/ad-delivery.mjs", import.meta.url).pathname;
const state = JSON.parse(fs.readFileSync(new URL("../../../supabase/tests/staging/.ad-delivery.json", import.meta.url), "utf8"));
const student = state.accounts[process.env.STUDENT || "student"];
if (!student) throw new Error(`No "${process.env.STUDENT}" in the kept run: make it with ad-delivery.mjs student ${process.env.STUDENT}`);
const [cafe, rent] = state.businesses;
const PLACES = [
  { name: "Home (Orbit)", path: "/", testId: "sponsored-post", placement: "for_you", business: cafe.name, ad: "Latte week" },
  { name: "Reels", path: "/?tab=reels", testId: "sponsored-reel", placement: "reels", business: cafe.name, ad: "Barista reel", optional: "No reels yet" },
  { name: "Housing", path: "/apartments", testId: "sponsored-listing", placement: "housing", business: rent.name, ad: "Fall leasing" },
];

/** The staging script, for pause, resume and verify (it refuses production on its own). */
const staging = (...args) => execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
/** Each kept ad's impressions as the businesses see them. */
const impressions = () => Object.fromEntries([...staging("verify").matchAll(/"([^"]+)": (\d+) impressions/g)].map((m) => [m[1], Number(m[2])]));

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
let production = 0;
page.on("request", (r) => { if (r.url().includes(PRODUCTION)) production++; });
const results = [];
const note = (place, step, ok, why = "") => results.push({ place, step, ok, why });

await page.goto(BASE + "/login");
await page.fill("#email", student.email);
await page.fill("#password", student.password);
await page.locator("button[type=submit]").first().click();
await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {});
const signedIn = !new URL(page.url()).pathname.endsWith("/login");
if (!signedIn) note("sign in", "", false, "still on the login page");

/** The run's ad on the page: shown once the feed has asked for its ads, or absent once the page has settled. */
async function shown(place, expected) {
  const ad = page.getByTestId(place.testId).filter({ hasText: place.business });
  if (expected) {
    await ad.first().waitFor({ state: "attached", timeout: 20000 });
    await ad.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1800); // half on screen for a second counts an impression
    return true;
  }
  // Absent: give the feed time to ask for its ads (they arrive after the page), then look.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(4000);
  return (await ad.count()) > 0;
}

const before = signedIn ? impressions() : {};
for (const place of signedIn ? PLACES : []) {
  try {
    await page.goto(BASE + place.path, { waitUntil: "load" });
    if (place.optional && (await page.locator("body").innerText()).includes(place.optional)) { note(place.name, "skipped", true, `"${place.optional}"`); continue; }
    await shown(place, true);
    note(place.name, "shown", true);
    staging("pause", place.placement);
    await page.reload({ waitUntil: "load" });
    const still = await shown(place, false);
    note(place.name, "paused, reloaded", !still, still ? "the paused ad is still on the page" : "gone");
    staging("resume", place.placement);
    await page.reload({ waitUntil: "load" });
    await shown(place, true);
    note(place.name, "resumed, reloaded", true, "back");
    await page.reload({ waitUntil: "load" });
    await shown(place, true);
    note(place.name, "reloaded again", true, "still there");
  } catch (e) {
    // Leave the ad running for the next placement and the phone, whatever failed.
    try { staging("resume", place.placement); } catch {}
    note(place.name, "error", false, e.message.split("\n")[0]);
  }
}
await browser.close();

// Four page loads of each ad, one student, one hour: the businesses see one impression from this run at most.
if (signedIn) {
  const after = impressions();
  for (const place of PLACES) {
    const added = (after[place.ad] ?? 0) - (before[place.ad] ?? 0);
    note(place.name, "impressions", added <= 1, `${added} added by 4 loads`);
  }
}
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.place.padEnd(13)} ${r.step.padEnd(18)} ${r.why}`);
if (production) console.log(`  ✗ ${production} requests went to production`);
const failed = results.filter((r) => !r.ok).length + (production ? 1 : 0);
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} REFRESH CHECKS PASSED`);
process.exit(failed ? 1 : 0);
