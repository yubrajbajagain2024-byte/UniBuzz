// The whole road of an ad, from UniBuzz Business to the student apps, against PGlite in production's order: a business
// signs up and is approved, builds an ad in the Ads Manager and submits it, the UniBuzz team approves it with its
// payment, and students on the campus get it in For You, Reels and Housing, in the first page of each feed. Every step
// goes through the apps' own code in packages/shared (createAdDraft, submitAd, adminApproveAd, listFeedAds,
// interleaveAds…) over a small stand-in for the REST API, so a renamed argument or a column the database refuses fails
// here. Also: the ad stops and starts with the business's pause and resume and the team's pause, a hidden ad stays
// hidden for that student only, and a student's impression reaches the business as a number.
import { register } from "node:module";
import { boot, expectOk, done } from "./harness.mjs";

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
const q = await import("../../packages/shared/src/queries/business.ts");
const { adSlotCount, adsToCount, emptyFeedAds, interleaveAds, nextAdsRequest, receiveAds } = await import("../../packages/shared/src/business.ts");
const { ADS_EVERY, ADS_FIRST_AFTER, DEFAULT_PAGE_SIZE, FOR_YOU_PAGE, REELS_PAGE_SIZE } = await import("../../packages/shared/src/constants.ts");
const { adApprovalSchema, adDraftSchema } = await import("../../packages/shared/src/schemas/index.ts");

const check = (cond, message) => { if (!cond) throw new Error(message); };
const minutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

const { db, mk, as } = await boot({ live: true });
const one = async (p) => (await p).rows[0];

/**
 * What supabase-js does over the REST API, for the calls this suite makes: rpc() with named arguments (a set of rows, one
 * row, a value or nothing, as PostgREST returns them) and from(table).insert(row).select("*").single(). Each call runs as
 * the signed-in person (`aal2` for the UniBuzz team, who sign in with a second factor).
 */
const shapes = new Map();
async function shapeOf(fn) {
  if (!shapes.has(fn)) {
    const r = await one(db.query(`select p.proretset as set, t.typtype as kind, t.typname as name from pg_proc p join pg_type t on t.oid = p.prorettype
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]));
    if (!r) throw new Error(`no function public.${fn}`);
    shapes.set(fn, r);
  }
  return shapes.get(fn);
}
function client(uid, claims = {}) {
  const run = async (work) => {
    try {
      return { data: await as(uid, work, claims), error: null };
    } catch (e) {
      return { data: null, error: { message: e.message, code: e.code ?? null } };
    }
  };
  return {
    async rpc(fn, args = {}) {
      const shape = await shapeOf(fn);
      const names = Object.keys(args);
      const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
      const values = names.map((n) => args[n]);
      return run(async () => {
        if (shape.set) return (await db.query(`select to_jsonb(t) as r from ${call} t`, values)).rows.map((x) => x.r);
        if (shape.kind === "c") return (await one(db.query(`select to_jsonb(t) as r from ${call} t`, values)))?.r ?? null;
        if (shape.name === "void") return void (await db.query(`select ${call}`, values));
        return (await one(db.query(`select to_jsonb(${call}) as r`, values))).r;
      });
    },
    from(table) {
      return {
        insert: (row) => ({
          select: () => ({
            single: () => {
              const cols = Object.keys(row).map((c) => `"${c}"`).join(", ");
              return run(async () => (await one(db.query(
                `insert into public.${table} (${cols}) select ${cols} from jsonb_populate_record(null::public.${table}, $1::jsonb) returning to_jsonb(${table}.*) as r`,
                [JSON.stringify(row)],
              ))).r);
            },
          }),
        }),
      };
    },
  };
}

// --- The people ------------------------------------------------------------------------------------------------------
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const UTSA = (await one(db.query("select id from public.universities where name = 'University of Texas at San Antonio'"))).id;
const adminId = await mk("ann@txstate.edu", "Ann Avery");
await db.query("select public.grant_role($1, 'admin')", [adminId]);
// On production's schema an admin is a staff owner or admin, not suspended, signed in with a second factor (migration
// 67): the role alone is not enough. The aal2 session below brings the verified factor.
await db.query("select public.admin_bootstrap_owner('ann@txstate.edu')");
const team = client(adminId, { aal: "aal2" });
const benId = await mk("ben@txstate.edu", "Ben Brooks");
const ben = client(benId);
const cyId = await mk("cy@txstate.edu", "Cy Chen");
const cy = client(cyId);
const umaId = await mk("uma@txstate.edu", "Uma Utsa");
await db.query("update public.profiles set university_id = $2 where id = $1", [umaId, UTSA]);
const uma = client(umaId);

/** A business signing up on /business/signup (its campus picked), confirming its address: [owner id, business id]. */
async function signUpBusiness(email, name, category) {
  const meta = { account_type: "business", full_name: `${name} Owner`, business_name: name, business_category: category, business_university_id: TX };
  const owner = (await one(db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2, now()) returning id", [email, JSON.stringify(meta)]))).id;
  return [owner, (await one(db.query("select id from public.businesses where owner_id = $1", [owner]))).id];
}
/** A file the team really uploaded to this project's storage (ads take photos from there only). */
async function upload(owner, name) {
  await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2, $3)", [`posts/${owner}/${name}.jpg`, owner, owner]);
  return { type: "image", url: `https://proj.supabase.co/storage/v1/object/public/uploads/posts/${owner}/${name}.jpg` };
}
/** A vertical video the business uploaded, as Mux leaves it once ready. */
const verticalVideo = async (owner) =>
  (await one(db.query("insert into public.media (owner_id, status, width, height, duration_seconds, playback_id, poster_url) values ($1, 'ready', 1080, 1920, 20, 'pb-' || gen_random_uuid(), 'https://image.mux.com/x/thumbnail.jpg') returning id", [owner]))).id;

/** The Ads Manager's form, parsed as the portal parses it, saved as a draft, checked and submitted. */
async function buildAndSubmit(owner, businessId, form) {
  const c = client(owner);
  const input = adDraftSchema.parse({ objective: "awareness", universityIds: [TX], budget: "50", startsAt: minutes(-1), endsAt: minutes(60 * 24 * 7), ...form });
  const draft = await q.createAdDraft(c, businessId, owner, input);
  check(draft.status === "draft", `saved as ${draft.status}`);
  const problems = await q.getAdProblems(c, draft.id);
  check(problems.length === 0, `not ready: ${problems.join("; ")}`);
  const submitted = await q.submitAd(c, draft.id);
  check(submitted.status === "pending_review", `submitted as ${submitted.status}`);
  return submitted;
}
/** The UniBuzz team's approval (the website's /business/admin/ads and CampConnect Admin both call adminApproveAd). */
const approve = (adId, extra = {}) => q.adminApproveAd(team, adId, adApprovalSchema.parse({ amount: "50", currency: "USD", paymentReference: `INV-${adId.slice(0, 6)}`, fairHousingChecked: false, ...extra }));

/** A feed's first page as a student's app shows it: the ads it asks for, placed between `organic` rows. */
async function firstPage(student, placement, organic) {
  const items = Array.from({ length: organic }, (_, i) => ({ id: `${placement}-${i}` }));
  const spacing = { first: ADS_FIRST_AFTER, ended: false };
  const ads = await q.listFeedAds(student, placement, adSlotCount(items.length, ADS_EVERY, spacing), 0);
  return interleaveAds(items, ads, ADS_EVERY, spacing).filter((r) => r.kind === "ad").map((r) => r.ad);
}
const served = async (student, placement) => (await q.listFeedAds(student, placement, 10, 0)).map((a) => a.id);

// --- Business to student --------------------------------------------------------------------------------------------
const [cafeOwner, cafe] = await signUpBusiness("hi@beanthere.example", "Bean There", "food");
const [rentOwner, rent] = await signUpBusiness("hi@riverrock.example", "River Rock", "housing");
let forYouAd, reelsAd, housingAd;

await expectOk("a business waiting for review cannot submit an ad; once the UniBuzz team approves it, it can", async () => {
  const early = await q.createAdDraft(client(cafeOwner), cafe, cafeOwner, adDraftSchema.parse({ name: "Too early", placements: ["for_you"], universityIds: [TX], media: [await upload(cafeOwner, "early")], cta: "learn_more", budget: "50", startsAt: minutes(-1), endsAt: minutes(600) }));
  let refused = false;
  try { await q.submitAd(client(cafeOwner), early.id); } catch (e) { refused = /approved business/.test(e.message); }
  check(refused, "a business under review submitted an ad");
  await q.adminReviewBusiness(team, cafe, "approved");
  await q.adminReviewBusiness(team, rent, "approved");
});

await expectOk("For You: built in the Ads Manager, submitted, approved with its payment; live at once (its start has passed)", async () => {
  forYouAd = await buildAndSubmit(cafeOwner, cafe, { name: "Latte week", placements: ["for_you"], headline: "Half-price lattes", caption: "Show your student ID.", media: [await upload(cafeOwner, "latte")], cta: "order_now", ctaUrl: "https://beanthere.example/order" });
  check((await served(ben, "for_you")).length === 0, "served while waiting for review");
  const approved = await approve(forYouAd.id);
  check(approved.status === "active", `approved as ${approved.status}`);
});

await expectOk("Reels: a vertical video ad, approved, served with what the apps need to play it", async () => {
  reelsAd = await buildAndSubmit(cafeOwner, cafe, { name: "Barista reel", placements: ["reels"], caption: "Meet the baristas.", media: [{ type: "video", media_id: await verticalVideo(cafeOwner) }], cta: "visit_profile" });
  check((await approve(reelsAd.id)).status === "active", "not active");
  const [ad] = await q.listFeedAds(ben, "reels", 1, 0);
  const video = ad?.media.find((m) => m.type === "video");
  check(ad?.id === reelsAd.id && video?.playback_id, `served ${JSON.stringify(ad)}`);
});

await expectOk("Housing: a housing business's ad promoting its listing, approved with the Fair Housing check, served with the listing", async () => {
  const listing = (await as(rentOwner, () => one(db.query("insert into public.apartments (owner_id, business_id, title, description, price_per_month, address, university_id, images) values ($1, $2, 'Two-bed by the river', 'Pool and gym', 1200, '1 River Rd', $3, array['https://proj.supabase.co/storage/v1/object/public/uploads/apartments/r/1.jpg']) returning id", [rentOwner, rent, TX])))).id;
  housingAd = await buildAndSubmit(rentOwner, rent, { name: "Fall leasing", placements: ["housing"], caption: "Two-bed by the river, pool and gym.", media: [], cta: "view_listing", promoted: `apartment:${listing}` });
  let refused = false;
  try { await approve(housingAd.id); } catch (e) { refused = /Fair Housing/.test(e.message); }
  check(refused, "approved without the Fair Housing check");
  check((await approve(housingAd.id, { fairHousingChecked: "on" })).status === "active", "not active");
  const [ad] = await q.listFeedAds(ben, "housing", 1, 0);
  check(ad?.id === housingAd.id && ad.promoted?.type === "apartment" && ad.promoted.title === "Two-bed by the river", `served ${JSON.stringify(ad)}`);
});

await expectOk("each ad runs only where it was placed: For You, Reels and Housing each get their own", async () => {
  check(JSON.stringify(await served(ben, "for_you")) === JSON.stringify([forYouAd.id]), "For You");
  check(JSON.stringify(await served(ben, "reels")) === JSON.stringify([reelsAd.id]), "Reels");
  check(JSON.stringify(await served(ben, "housing")) === JSON.stringify([housingAd.id]), "Housing");
});

await expectOk("the first page of each feed shows the ad (8 rows of For You, 8 reels, 12 listings); the old rule asked for none", async () => {
  const pages = { for_you: FOR_YOU_PAGE.posts + FOR_YOU_PAGE.reels, reels: REELS_PAGE_SIZE, housing: DEFAULT_PAGE_SIZE };
  const expected = { for_you: forYouAd.id, reels: reelsAd.id, housing: housingAd.id };
  for (const [placement, rows] of Object.entries(pages)) {
    check(adSlotCount(rows, ADS_EVERY) === 0 || placement === "housing", `${placement}: the old rule had a slot`);
    const ads = await firstPage(ben, placement, rows);
    check(ads.length === 1 && ads[0].id === expected[placement], `${placement}: ${JSON.stringify(ads.map((a) => a.id))}`);
  }
});

await expectOk("a campus with only two posts still shows the ad, at the end of the feed", async () => {
  const items = [{ id: "p1" }, { id: "p2" }];
  const spacing = { first: ADS_FIRST_AFTER, ended: true };
  const ads = await q.listFeedAds(ben, "for_you", adSlotCount(items.length, ADS_EVERY, spacing), 0);
  const rows = interleaveAds(items, ads, ADS_EVERY, spacing).map((r) => (r.kind === "ad" ? `ad:${r.ad.id}` : r.item.id));
  check(JSON.stringify(rows) === JSON.stringify(["p1", "p2", `ad:${forYouAd.id}`]), JSON.stringify(rows));
});

await expectOk("a Housing feed of five listings, the promoted one among them: the ad runs and the listing shows once, as the ad", async () => {
  // What staging found on 2026-11-04: skipping the ad for its listing left the only slot empty.
  const [ad] = await q.listFeedAds(ben, "housing", 1, 0);
  check(ad?.promoted?.type === "apartment", "the Housing ad came without its listing");
  const items = [{ id: "l1" }, { id: ad.promoted.id }, { id: "l3" }, { id: "l4" }, { id: "l5" }];
  const spacing = { first: ADS_FIRST_AFTER, ended: true };
  const ads = await q.listFeedAds(ben, "housing", adSlotCount(items.length, ADS_EVERY, spacing), 0);
  const rows = interleaveAds(items, ads, ADS_EVERY, spacing).map((r) => (r.kind === "ad" ? `ad:${r.ad.id}` : r.item.id));
  check(JSON.stringify(rows) === JSON.stringify(["l1", "l3", `ad:${housingAd.id}`, "l4", "l5"]), JSON.stringify(rows));
});

await expectOk("campus targeting: a student on another campus gets none; the business's own session gets none", async () => {
  check((await served(uma, "for_you")).length === 0, "another campus saw it");
  check((await served(client(cafeOwner), "for_you")).length === 0, "a business session got ads");
});

// --- What happens next ------------------------------------------------------------------------------------------------
await expectOk("the business pauses its ad: gone at once; it resumes: back", async () => {
  check((await q.pauseAd(client(cafeOwner), forYouAd.id)).status === "paused", "not paused");
  check((await served(ben, "for_you")).length === 0, "a paused ad was served");
  check((await q.resumeAd(client(cafeOwner), forYouAd.id)).status === "active", "not resumed");
  check((await served(ben, "for_you"))[0] === forYouAd.id, "not back after resuming");
});

await expectOk("the UniBuzz team pauses it: gone; the business cannot resume it, the team can", async () => {
  await q.adminPauseAd(team, forYouAd.id, "Checking the offer with the business.");
  check((await served(ben, "for_you")).length === 0, "served while paused by the team");
  let refused = false;
  try { await q.resumeAd(client(cafeOwner), forYouAd.id); } catch { refused = true; }
  check(refused, "the business resumed the team's pause");
  await q.adminResumeAd(team, forYouAd.id);
  check((await served(ben, "for_you"))[0] === forYouAd.id, "not back after the team resumed it");
});

await expectOk("a pull-to-refresh, as the apps run it, asks for the ads again: paused gone, resumed back, a newly approved one in, an ended one gone, each counted once", async () => {
  // A long feed, so every live For You ad has a slot; each refresh is a new round of the apps' feed-ads state.
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
  check((await refresh()).includes(forYouAd.id), "not there at first");
  await q.pauseAd(client(cafeOwner), forYouAd.id);
  check(!(await refresh()).includes(forYouAd.id), "a paused ad stayed after a refresh");
  await q.resumeAd(client(cafeOwner), forYouAd.id);
  check((await refresh()).includes(forYouAd.id), "a resumed ad did not come back");
  // The team approves a second ad mid-session: it comes in on the next refresh.
  const flash = await buildAndSubmit(cafeOwner, cafe, { name: "Flash sale", placements: ["for_you"], headline: "Two for one", caption: "Today only.", media: [await upload(cafeOwner, "flash")], cta: "learn_more", ctaUrl: "https://beanthere.example/flash" });
  check(!(await refresh()).includes(flash.id), "served before its approval");
  await approve(flash.id);
  check((await refresh()).includes(flash.id), "a newly approved ad did not come in on the next refresh");
  // Its end passes. An ad must end at least an hour after it is submitted (ad_problems), so the clock is moved instead of
  // waited for: its ends_at set into the past the way the database's own transitions write (app.ad_transition).
  await db.exec(`begin; select set_config('app.ad_transition', 'on', true); update public.ads set ends_at = now() - interval '1 second' where id = '${flash.id}'; commit;`);
  const after = await refresh();
  check(!after.includes(flash.id) && after.includes(forYouAd.id), `an ended ad stayed after a refresh: ${JSON.stringify(after)}`);
  check(sent.filter((id) => id === forYouAd.id).length === 1, "an ad on screen through five refreshes was counted more than once");
});

await expectOk("a student who hides the ad no longer gets it; the student beside them still does", async () => {
  await q.hideAd(ben, forYouAd.id);
  check((await served(ben, "for_you")).length === 0, "hidden but served");
  check((await served(cy, "for_you"))[0] === forYouAd.id, "hidden for everyone");
});

await expectOk("a student's impression and click reach the business as numbers", async () => {
  await q.recordBusinessEvent(cy, "impression", { adId: forYouAd.id, placement: "for_you" });
  await q.recordBusinessEvent(cy, "click", { adId: forYouAd.id, placement: "for_you" });
  const stats = (await q.getAdStats(client(cafeOwner), cafe)).find((s) => s.ad_id === forYouAd.id);
  check(stats?.impressions === 1 && stats.clicks === 1, JSON.stringify(stats));
});

await db.close();
done("AD DELIVERY");
