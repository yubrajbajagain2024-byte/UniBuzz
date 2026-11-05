// An ad's whole road on a real Supabase project, the staging one: a café and an apartment business sign up through
// Supabase Auth and are approved by the UniBuzz team (an admin of the staff, signed in with a second factor); each
// builds an ad in the Ads Manager's shape with a photo uploaded to Storage, submits it, and the team approves it with
// its payment. Then, as students over the REST API: each ad runs in its own placement (For You, Reels, Housing), on the
// first page of each feed as the apps build it, for the campus it targets only; an impression and a click reach the
// business as numbers (and one from another campus does not); a pause takes the ad out at once and a resume brings it
// back; a pull-to-refresh, as the apps run it, drops a paused or ended ad and brings in a resumed or newly approved one;
// a hidden ad stays hidden for that student only. Every step goes through the apps' own code in packages/shared.
// Never run against production: it refuses the production ref and any project not named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<staging ref> node supabase/tests/staging/ad-delivery.mjs
//       the run above; everything it made is deleted at the end.
//   … ad-delivery.mjs --keep
//       the same, but the campaigns stay live for three hours (they end on their own) with their accounts, for the
//       website and the app on a phone; supabase/tests/staging/.ad-delivery.json (git-ignored) keeps the accounts.
//   … ad-delivery.mjs env       the lines that start the website and the app against staging (the anon key is public).
//   … ad-delivery.mjs verify    as the businesses, each kept ad's impressions, reach and clicks (what the devices did).
//   … ad-delivery.mjs pause for_you   (or reels, housing) the business pauses that kept ad; `resume for_you` brings it back.
//   … ad-delivery.mjs student phone   a fresh student of the campus for one device, so its impressions and clicks show
//       in `verify` (they count once per student, ad and hour); the clean-up deletes it with the rest.
//   … ad-delivery.mjs cleanup   deletes everything the kept run made.
import fs from "node:fs";
import zlib from "node:zlib";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { enrolAuthenticator, passSecondFactor } from "./mfa.mjs";

// The shared sources import their siblings without an extension, as the bundlers resolve them (see packages/shared/tests).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);
const q = await import("../../../packages/shared/src/queries/business.ts");
const { listForYou } = await import("../../../packages/shared/src/queries/for-you.ts");
const { listReels } = await import("../../../packages/shared/src/queries/feed.ts");
const { listApartments } = await import("../../../packages/shared/src/queries/apartments.ts");
const { adSlotCount, adsToCount, emptyFeedAds, interleaveAds, nextAdsRequest, receiveAds } = await import("../../../packages/shared/src/business.ts");
const { ADS_EVERY, ADS_FIRST_AFTER, REELS_PAGE_SIZE } = await import("../../../packages/shared/src/constants.ts");
const { adApprovalSchema, adDraftSchema } = await import("../../../packages/shared/src/schemas/index.ts");

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This test writes and deletes data: it never runs against production.");
const STATE = new URL("./.ad-delivery.json", import.meta.url);
const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "run";
const KEEP = process.argv.includes("--keep");

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const apiKeys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = apiKeys.find((k) => k.name === "anon")?.api_key;
const SERVICE = apiKeys.find((k) => k.name === "service_role")?.api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const anon = createClient(URL_, ANON, opts);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** A signed-in client; an account with an authenticator passes the second factor too (aal2). */
async function session(u) {
  const c = createClient(URL_, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`${u.email}: ${error.message}`);
  if (u.totp) await passSecondFactor(c, u.totp);
  return c;
}

/** Everything a run made, for the clean-up: accounts (their rows cascade), uploads, media rows, payments. */
async function cleanup(state) {
  const ids = state.made.map(lit).join(",") || "null";
  // Through the Storage API: Supabase refuses deleting storage.objects rows in SQL (storage.protect_delete()).
  const files = (await sql(`select name from storage.objects where bucket_id = 'uploads' and name like 'posts/%/ad-delivery-${state.run}-%'`).catch(() => [])).map((r) => r.name);
  if (files.length) {
    const { error } = await admin.storage.from("uploads").remove(files);
    if (error) console.log(`  ! uploads: ${error.message}`);
  }
  // Payments stay on record when a business goes (migration 56); this run's are test rows, so they go too.
  await sql(`delete from public.listing_promotions where payment_reference like ${lit(`STAGING-${state.run}-%`)}`).catch((e) => console.log(`  ! payments: ${e.message}`));
  await sql(`delete from public.media where owner_id in (${ids})`).catch((e) => console.log(`  ! media: ${e.message}`));
  for (const id of state.made) await admin.auth.admin.deleteUser(id).catch((e) => console.log(`  ! could not delete ${id}: ${e.message}`));
  if (state.made.length) await sql(`delete from public.staff_audit_log where actor_id in (${ids}) or target_id in (${ids})`).catch(() => {});
  const left = await sql(`select count(*)::int as n from public.profiles where id in (${ids})`).catch(() => [{ n: "?" }]);
  console.log(`  cleaned up run ${state.run}: ${state.made.length} accounts (${left[0].n} left)`);
}

if (command === "env") {
  console.log(`# The website against staging (from the repo root; the variables win over apps/web/.env.local):`);
  console.log(`NEXT_PUBLIC_SUPABASE_URL=${URL_} NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON} NEXT_PUBLIC_SITE_URL=http://localhost:3061 npm run dev -w web -- -p 3061`);
  // --clear: Metro caches the bundle with the variables written into it, so without it a bundle built for production
  // can be served again.
  console.log(`# The app in Expo Go on a phone (from apps/mobile; the variables win over apps/mobile/.env):`);
  console.log(`EXPO_PUBLIC_SUPABASE_URL=${URL_} EXPO_PUBLIC_SUPABASE_ANON_KEY=${ANON} npx expo start --go --tunnel --clear`);
  process.exit(0);
}
if (["verify", "cleanup", "pause", "resume", "student"].includes(command)) {
  if (!fs.existsSync(STATE)) throw new Error("No kept run: start one with --keep");
  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  if (command === "student") {
    // A student of the kept run's campus for one device. An impression and a click count once per student, ad and
    // hour, so a device signed in as the run's own student adds nothing to `verify` within the hour of the run.
    const label = process.argv[3] ?? "device";
    if (!/^[a-z]{2,12}$/.test(label)) throw new Error("A label of 2 to 12 lowercase letters, e.g. web or phone");
    if (state.accounts[label]) throw new Error(`"${label}" already exists in the kept run`);
    const email = `${label}.ads.${state.run}@txstate.edu`;
    const password = `Pw-${state.run}-${Math.random().toString(36).slice(2, 10)}!`;
    const fullName = `${label[0].toUpperCase()}${label.slice(1)} Student`;
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "signup", email, password, options: { data: { full_name: fullName } } });
    if (error) throw new Error(error.message);
    // Kept before it is confirmed, so the clean-up deletes it whatever happens next.
    state.made.push(link.user.id);
    state.accounts[label] = { id: link.user.id, email, password };
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
    const { error: e2 } = await createClient(URL_, ANON, opts).auth.verifyOtp({ type: "signup", token_hash: link.properties.hashed_token });
    if (e2) throw new Error(e2.message);
    console.log(`  ${label}: ${email} (${fullName}; password in supabase/tests/staging/.ad-delivery.json)`);
    process.exit(0);
  }
  if (command === "cleanup") {
    await cleanup(state);
    fs.rmSync(STATE);
    process.exit(0);
  }
  if (command === "pause" || command === "resume") {
    // The phone's pause check: the business pauses one kept ad, as in its Ads Manager, and the student's next refresh
    // no longer gets it; resume brings it back.
    const placement = process.argv[3] ?? "for_you";
    const b = state.businesses.find((x) => x.ads.some((a) => a.placement === placement));
    if (!b) throw new Error(`No kept ad in "${placement}" (for_you, reels or housing)`);
    const ad = b.ads.find((a) => a.placement === placement);
    const owner = await session(b.owner);
    const row = command === "pause" ? await q.pauseAd(owner, ad.id) : await q.resumeAd(owner, ad.id);
    console.log(`  ${placement} "${ad.name}" (${b.name}): ${row.status}`);
    process.exit(0);
  }
  for (const b of state.businesses) {
    const stats = await q.getAdStats(await session(b.owner), b.id);
    for (const ad of b.ads) {
      const s = stats.find((x) => x.ad_id === ad.id);
      console.log(`  ${ad.placement.padEnd(8)} "${ad.name}": ${s?.impressions ?? 0} impressions, ${s?.reach ?? 0} reached, ${s?.clicks ?? 0} clicks (status ${s?.status ?? "?"})`);
    }
  }
  console.log(`  The test run counted 1 impression and 1 click per ad; anything above that came from the browser or the phone.`);
  process.exit(0);
}

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${e?.message ?? e}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const must = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code ?? ""} ${error.message}`); return data; };

/** A solid picture with a band across it, as a PNG: what the ads show, so a card is visibly there on a screen. */
function png(width, height, [r, g, b]) {
  const row = Buffer.alloc(1 + width * 3);
  const rows = [];
  for (let y = 0; y < height; y++) {
    const band = y > height * 0.42 && y < height * 0.58;
    for (let x = 0; x < width; x++) row.set(band ? [255, 255, 255] : [r, g, b], 1 + x * 3);
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const run = Date.now().toString(36);
const state = { run, made: [], businesses: [], accounts: {} };
/** A sign-up as Supabase Auth does it (the triggers run), confirmed with its link instead of an email. */
async function signUp(email, data) {
  const password = `Pw-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "signup", email, password, options: { data } });
  if (error) throw new Error(error.message);
  state.made.push(link.user.id);
  const { error: e2 } = await createClient(URL_, ANON, opts).auth.verifyOtp({ type: "signup", token_hash: link.properties.hashed_token });
  if (e2) throw new Error(e2.message);
  return { id: link.user.id, email, password };
}
/** The Ads Manager: a photo uploaded by the team, the form parsed as the portal parses it, saved, checked, submitted. */
async function buildAndSubmit(owner, businessId, form) {
  const c = await session(owner);
  const input = adDraftSchema.parse({ objective: "traffic", universityIds: [state.txstate], budget: "50", startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + (KEEP ? 3 : 24) * 3600_000).toISOString(), ...form });
  const draft = await q.createAdDraft(c, businessId, owner.id, input);
  const problems = await q.getAdProblems(c, draft.id);
  expect(problems.length === 0, `not ready: ${problems.join("; ")}`);
  const submitted = await q.submitAd(c, draft.id);
  expect(submitted.status === "pending_review", `submitted as ${submitted.status}`);
  return submitted;
}
async function upload(owner, name, color, size = [480, 600]) {
  const c = await session(owner);
  const path = `posts/${owner.id}/ad-delivery-${run}-${name}.png`;
  await must(c.storage.from("uploads").upload(path, png(size[0], size[1], color), { contentType: "image/png" }));
  return { type: "image", url: c.storage.from("uploads").getPublicUrl(path).data.publicUrl, width: size[0], height: size[1] };
}

try {
  state.txstate = (await sql("select id from public.universities where email_domain = 'txstate.edu'"))[0].id;
  const other = (await sql(`select id, name from public.universities where id <> ${lit(state.txstate)} order by name limit 1`))[0];
  console.log(`Staging project ${project.name}, run ${run}${KEEP ? " (kept for three hours)" : ""}`);

  // --- People ---------------------------------------------------------------------------------------------------------
  const annU = await signUp(`ann.ads.${run}@txstate.edu`, { full_name: "Ann Admin" });
  const benU = await signUp(`ben.ads.${run}@txstate.edu`, { full_name: "Ben Student" });
  const catU = await signUp(`cat.ads.${run}@txstate.edu`, { full_name: "Cat Student" });
  const umaU = await signUp(`uma.ads.${run}@txstate.edu`, { full_name: "Uma Othercampus" });
  if (other) await sql(`update public.profiles set university_id = ${lit(other.id)} where id = ${lit(umaU.id)}`);
  await sql(`select public.grant_role(${lit(annU.id)}, 'admin')`);
  await sql(`do $$ begin
    if to_regclass('public.staff') is not null then insert into public.staff (user_id, role) values (${lit(annU.id)}, 'admin') on conflict (user_id) do update set role = excluded.role;
    else insert into public.staff_members (user_id, role) values (${lit(annU.id)}, 'admin') on conflict (user_id) do update set role = excluded.role; end if;
  end $$`);
  annU.totp = await enrolAuthenticator(await session(annU), "Ad delivery check");
  const team = await session(annU), ben = await session(benU), cat = await session(catU), uma = await session(umaU);
  const business = async (email, name, category) => {
    const owner = await signUp(email, { account_type: "business", full_name: `${name} Owner`, business_name: name, business_category: category, business_university_id: state.txstate });
    const id = (await sql(`select id from public.businesses where owner_id = ${lit(owner.id)}`))[0].id;
    return { owner, id, name, ads: [] };
  };
  const cafe = await business(`cafe.ads.${run}@beanthere-staging.example`, `Bean There ${run}`, "food");
  const rent = await business(`rent.ads.${run}@riverrock-staging.example`, `River Rock ${run}`, "housing");
  state.businesses = [cafe, rent];
  state.accounts = { student: benU, otherCampusStudent: umaU, cafeOwner: cafe.owner, housingOwner: rent.owner };

  await check("the UniBuzz team approves both businesses (admin of the staff, second factor)", async () => {
    await q.adminReviewBusiness(team, cafe.id, "approved");
    await q.adminReviewBusiness(team, rent.id, "approved");
  });

  // A first page to put the ads on: three posts on the campus, and a listing of the apartment business.
  await check("the campus feed has posts and the apartment business a listing", async () => {
    for (const body of ["Study group at Alkek tonight?", "Best tacos near the Square", "Anyone selling a mini fridge?"])
      await must(cat.from("feed_posts").insert({ author_id: catU.id, university_id: state.txstate, kind: "post", body: `${body} (${run})` }));
    const photo = await upload(rent.owner, "listing", [46, 125, 50], [640, 480]);
    await must((await session(rent.owner)).from("apartments").insert({ owner_id: rent.owner.id, business_id: rent.id, title: `Two-bed by the river ${run}`, description: "Pool, gym, shuttle to campus.", price_per_month: 1200, address: "1 River Rd", university_id: state.txstate, images: [photo.url] }));
  });

  // --- The campaigns --------------------------------------------------------------------------------------------------
  await check("For You: the café's ad, built in the Ads Manager's shape and approved with its payment, is live", async () => {
    const ad = await buildAndSubmit(cafe.owner, cafe.id, { name: "Latte week", placements: ["for_you"], headline: "Half-price lattes", caption: "Show your student ID at the counter. (UniBuzz staging test)", media: [await upload(cafe.owner, "latte", [24, 119, 242])], cta: "learn_more", ctaUrl: "https://example.com/unibuzz-staging-ad" });
    const approved = await q.adminApproveAd(team, ad.id, adApprovalSchema.parse({ amount: "50", currency: "USD", paymentReference: `STAGING-${run}-1`, fairHousingChecked: false }));
    expect(approved.status === "active", `approved as ${approved.status}`);
    cafe.ads.push({ id: ad.id, name: "Latte week", placement: "for_you" });
  });
  await check("Reels: the café's vertical video ad is live (a ready staging video when there is one)", async () => {
    // A ready vertical video already on staging plays on a phone; copied as the café's own upload, as ads require.
    const real = (await sql(`select playback_id, poster_url from public.media where status = 'ready' and playback_id is not null and height > width and coalesce(duration_seconds, 0) between 1 and 60 order by created_at desc limit 1`))[0];
    const media = (await sql(`insert into public.media (owner_id, status, width, height, duration_seconds, playback_id, poster_url) values (${lit(cafe.owner.id)}, 'ready', 1080, 1920, 20, ${lit(real?.playback_id ?? `staging-${run}`)}, ${real?.poster_url ? lit(real.poster_url) : "null"}) returning id`))[0].id;
    if (!real) console.log("    (no ready vertical video on staging: the ad runs, but its video will not play on a phone)");
    const ad = await buildAndSubmit(cafe.owner, cafe.id, { name: "Barista reel", placements: ["reels"], caption: "Meet the baristas. (UniBuzz staging test)", media: [{ type: "video", media_id: media }], cta: "visit_profile" });
    const approved = await q.adminApproveAd(team, ad.id, adApprovalSchema.parse({ amount: "50", currency: "USD", paymentReference: `STAGING-${run}-2`, fairHousingChecked: false }));
    expect(approved.status === "active", `approved as ${approved.status}`);
    cafe.ads.push({ id: ad.id, name: "Barista reel", placement: "reels" });
  });
  await check("Housing: the apartment business's ad, approved with the Fair Housing check, is live", async () => {
    const ad = await buildAndSubmit(rent.owner, rent.id, { name: "Fall leasing", placements: ["housing"], headline: "Fall leasing is open", caption: "Two-bed by the river, pool and gym. (UniBuzz staging test)", media: [await upload(rent.owner, "leasing", [123, 31, 162])], cta: "learn_more", ctaUrl: "https://example.com/unibuzz-staging-housing" });
    let refused = false;
    try { await q.adminApproveAd(team, ad.id, adApprovalSchema.parse({ amount: "50", currency: "USD", paymentReference: `STAGING-${run}-3x`, fairHousingChecked: false })); } catch (e) { refused = /Fair Housing/.test(e.message); }
    expect(refused, "approved without the Fair Housing check");
    const approved = await q.adminApproveAd(team, ad.id, adApprovalSchema.parse({ amount: "50", currency: "USD", paymentReference: `STAGING-${run}-3`, fairHousingChecked: "on" }));
    expect(approved.status === "active", `approved as ${approved.status}`);
    rent.ads.push({ id: ad.id, name: "Fall leasing", placement: "housing" });
  });
  const [forYouAd, reelsAd] = cafe.ads, [housingAd] = rent.ads;
  const served = async (c, placement) => (await q.listFeedAds(c, placement, 10, 0)).map((a) => a.id);

  // --- What students get ------------------------------------------------------------------------------------------------
  await check("each ad is served in its own placement only, with the business's name and nothing of its budget", async () => {
    for (const [ad, placement] of [[forYouAd, "for_you"], [reelsAd, "reels"], [housingAd, "housing"]]) {
      const rows = await q.listFeedAds(ben, placement, 10, 0);
      const mine = rows.find((r) => r.id === ad.id);
      expect(mine && mine.business_name && !("budget_cents" in mine), `${placement}: ${JSON.stringify(rows.map((r) => r.id))}`);
      for (const elsewhere of ["for_you", "reels", "housing"].filter((p) => p !== placement)) expect(!(await served(ben, elsewhere)).includes(ad.id), `${ad.name} also in ${elsewhere}`);
    }
    const video = (await q.listFeedAds(ben, "reels", 10, 0)).find((r) => r.id === reelsAd.id).media.find((m) => m.type === "video");
    expect(video?.playback_id, "the Reels ad came without its playback id");
  });
  await check("For You's first page, as the apps build it, has an ad in it", async () => {
    const page = await listForYou(ben, { universityId: state.txstate });
    const spacing = { first: ADS_FIRST_AFTER, ended: !page.hasMore };
    const ads = await q.listFeedAds(ben, "for_you", adSlotCount(page.items.length, ADS_EVERY, spacing), 0);
    const placed = interleaveAds(page.items, ads, ADS_EVERY, spacing).filter((r) => r.kind === "ad");
    console.log(`    ${page.items.length} posts and reels on the first page; ads placed: ${placed.map((r) => (r.ad.id === forYouAd.id ? "this run's" : "another session's")).join(", ") || "none"}`);
    expect(placed.length >= 1, `no ad on a first page of ${page.items.length}`);
  });
  await check("Reels' first page has an ad in it when the campus has reels", async () => {
    const reels = await listReels(ben, { universityId: state.txstate, limit: REELS_PAGE_SIZE, offset: 0 });
    const spacing = { first: ADS_FIRST_AFTER, ended: reels.length < REELS_PAGE_SIZE };
    const ads = await q.listFeedAds(ben, "reels", adSlotCount(reels.length, ADS_EVERY, spacing), 0);
    const placed = interleaveAds(reels.map((r) => ({ id: r.sourceId })), ads, ADS_EVERY, spacing).filter((r) => r.kind === "ad");
    console.log(`    ${reels.length} reels on the first page; ads placed: ${placed.length}${reels.length === 0 ? " (no reels: the page shows its empty state, and no ad, by design)" : ""}`);
    expect(reels.length === 0 || placed.length >= 1, `no ad on a first page of ${reels.length} reels`);
  });
  await check("Housing's first page has an ad in it", async () => {
    const page = await listApartments(ben, { universityId: state.txstate, page: 1 });
    const spacing = { first: ADS_FIRST_AFTER, ended: page.totalPages <= 1 };
    const ads = await q.listFeedAds(ben, "housing", adSlotCount(page.data.length, ADS_EVERY, spacing), 0);
    const rows = interleaveAds(page.data, ads, ADS_EVERY, spacing);
    const placed = rows.filter((r) => r.kind === "ad");
    const promoted = placed.map((r) => r.ad.promoted?.id).filter(Boolean);
    const onPage = page.data.some((l) => promoted.includes(l.id));
    console.log(`    ${page.data.length} listings on the first page; ads placed: ${placed.length}${onPage ? " (its listing was on the page: shown once, as the ad)" : ""}`);
    expect(placed.length >= 1, `no ad on a first page of ${page.data.length} listings`);
    expect(!rows.some((r) => r.kind === "item" && promoted.includes(r.item.id)), "the promoted listing showed twice");
  });
  await check("targeting: a student on another campus, a business session and a signed-out visitor get none of them", async () => {
    expect(other, "staging has one campus only: nothing to compare with");
    for (const p of ["for_you", "reels", "housing"]) {
      const theirs = await served(uma, p);
      expect(![forYouAd.id, reelsAd.id, housingAd.id].some((id) => theirs.includes(id)), `${other.name} got ${p}`);
      expect((await served(await session(cafe.owner), p)).length === 0, `a business session got ${p} ads`);
    }
    const { error } = await anon.rpc("ads_for_feed", { p_placement: "for_you", p_limit: 1, p_offset: 0 });
    expect(error, "signed out got ads");
  });
  await check("an impression and a click from a student reach each business as numbers; another campus's do not count", async () => {
    for (const ad of [...cafe.ads, ...rent.ads]) {
      await q.recordBusinessEvent(ben, "impression", { adId: ad.id, placement: ad.placement });
      await q.recordBusinessEvent(ben, "click", { adId: ad.id, placement: ad.placement });
      await q.recordBusinessEvent(uma, "impression", { adId: ad.id, placement: ad.placement });
      await q.recordBusinessEvent(uma, "click", { adId: ad.id, placement: ad.placement });
    }
    for (const b of [cafe, rent]) {
      const stats = await q.getAdStats(await session(b.owner), b.id);
      for (const ad of b.ads) {
        const s = stats.find((x) => x.ad_id === ad.id);
        expect(s?.impressions === 1 && s.clicks === 1 && s.reach === 1, `${ad.name}: ${JSON.stringify(s)}`);
      }
    }
  });
  await check("the business pauses its For You ad: gone at once; it resumes: back", async () => {
    const owner = await session(cafe.owner);
    expect((await q.pauseAd(owner, forYouAd.id)).status === "paused", "not paused");
    expect(!(await served(ben, "for_you")).includes(forYouAd.id), "a paused ad was served");
    expect((await q.resumeAd(owner, forYouAd.id)).status === "active", "not resumed");
    expect((await served(ben, "for_you")).includes(forYouAd.id), "not back");
  });
  await check("a pull-to-refresh, as the apps run it, asks for the ads again: paused gone, resumed back, a newly approved one in, an ended one gone, each counted once", async () => {
    // A long feed, so every live For You ad has a slot; each refresh is a new round of the apps' feed-ads state.
    const owner = await session(cafe.owner);
    const slots = adSlotCount(90, ADS_EVERY, { first: ADS_FIRST_AFTER, ended: true });
    let state = emptyFeedAds(), round = 0;
    const seen = new Set(), sent = [];
    const refresh = async () => {
      round += 1;
      for (let r = nextAdsRequest(state, round, slots); r; r = nextAdsRequest(state, round, slots)) state = receiveAds(state, r, await q.listFeedAds(ben, "for_you", r.limit, r.offset));
      const ids = state.ads.map((a) => a.id);
      sent.push(...adsToCount(seen, ids));
      return ids;
    };
    expect((await refresh()).includes(forYouAd.id), "not there at first");
    await q.pauseAd(owner, forYouAd.id);
    expect(!(await refresh()).includes(forYouAd.id), "a paused ad stayed after a refresh");
    await q.resumeAd(owner, forYouAd.id);
    expect((await refresh()).includes(forYouAd.id), "a resumed ad did not come back");
    // The team approves a second ad mid-session: it comes in on the next refresh.
    const flash = await buildAndSubmit(cafe.owner, cafe.id, { name: "Flash sale", placements: ["for_you"], headline: "Two for one", caption: "Today only. (UniBuzz staging test)", media: [await upload(cafe.owner, "flash", [242, 119, 24])], cta: "learn_more", ctaUrl: "https://example.com/unibuzz-staging-flash" });
    expect(!(await refresh()).includes(flash.id), "served before its approval");
    await q.adminApproveAd(team, flash.id, adApprovalSchema.parse({ amount: "20", currency: "USD", paymentReference: `STAGING-${run}-4`, fairHousingChecked: false }));
    expect((await refresh()).includes(flash.id), "a newly approved ad did not come in on the next refresh");
    // Its end passes. An ad must end at least an hour after it is submitted, so the clock is moved instead of waited for:
    // its ends_at set into the past the way the database's own transitions write (app.ad_transition), on this test ad only.
    await sql(`begin; select set_config('app.ad_transition', 'on', true); update public.ads set ends_at = now() - interval '1 second' where id = ${lit(flash.id)}; commit;`);
    const after = await refresh();
    expect(!after.includes(flash.id) && after.includes(forYouAd.id), `an ended ad stayed after a refresh: ${JSON.stringify(after)}`);
    expect(sent.filter((id) => id === forYouAd.id).length === 1, "an ad on screen through five refreshes was counted more than once");
  });
  await check("a student who hides the ad stops getting it; the student beside them still does", async () => {
    await q.hideAd(cat, forYouAd.id);
    expect(!(await served(cat, "for_you")).includes(forYouAd.id), "hidden but served");
    expect((await served(ben, "for_you")).includes(forYouAd.id), "hidden for everyone");
  });
} finally {
  if (KEEP && failures === 0) {
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
    console.log(`\n  Kept for the website and the phone until ${new Date(Date.now() + 3 * 3600_000).toLocaleTimeString()} (the ads end on their own then).`);
    console.log(`  Sign in as the student: ${state.accounts.student?.email} (password in supabase/tests/staging/.ad-delivery.json).`);
    console.log(`  Start the website and the app against staging: node supabase/tests/staging/ad-delivery.mjs env`);
    console.log(`  Afterwards: … ad-delivery.mjs verify (the devices' impressions and clicks), then … ad-delivery.mjs cleanup`);
  } else {
    if (KEEP) console.log("  A check failed, so nothing is kept.");
    await cleanup(state);
  }
}
console.log(failures ? `${failures} FAILED, ${passes} passed` : `ALL ${passes} AD DELIVERY STAGING CHECKS PASSED`);
process.exit(failures ? 1 : 0);
