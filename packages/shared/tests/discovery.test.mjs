// Unit tests for Explore's and Events' filter row (src/discovery.ts): the quick filters of each page, a removable chip for
// every choice made in the filter sheet, the count on the filter button, and Clear. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

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

const D = await import("../src/discovery.ts");
const { DEFAULT_EXPLORE_FILTERS: DEF } = D;
const keys = (chips) => chips.map((c) => `${c.key}${c.on ? "*" : ""}`);
const tap = (chips, key) => chips.find((c) => c.key === key).next;

test("each page of Explore has its own few quick filters, none on at first", () => {
  assert.deepEqual(keys(D.exploreQuickFilters("apartments", DEF)), ["furnished", "petsAllowed", "near"]);
  assert.deepEqual(keys(D.exploreQuickFilters("roommates", DEF)), ["has_room", "needs_room"]);
  assert.deepEqual(keys(D.exploreQuickFilters("marketplace", DEF)), ["furniture", "textbooks", "electronics", "kitchen"]);
  assert.deepEqual(D.exploreActiveChips("apartments", DEF), []);
});

test("a quick filter turns on with one tap and off with another, leaving the other pages alone", () => {
  const on = tap(D.exploreQuickFilters("apartments", DEF), "furnished");
  assert.deepEqual(on.apartments, { sort: "newest", furnished: true });
  assert.equal(on.roommates, DEF.roommates);
  assert.deepEqual(keys(D.exploreQuickFilters("apartments", on)), ["furnished*", "petsAllowed", "near"]);
  assert.equal(D.exploreFilterCount("apartments", on), 1);
  const off = tap(D.exploreQuickFilters("apartments", on), "furnished");
  assert.deepEqual(off.apartments, { sort: "newest" }, "no furnished: false left behind");
  assert.equal(D.exploreFilterCount("apartments", off), 0);
});

test("Has a room and Looking for a room are one choice; a Marketplace category is one at a time", () => {
  const has = tap(D.exploreQuickFilters("roommates", DEF), "has_room");
  const looking = tap(D.exploreQuickFilters("roommates", has), "needs_room");
  assert.deepEqual(looking.roommates, { type: "needs_room" });
  const furniture = tap(D.exploreQuickFilters("marketplace", DEF), "furniture");
  const books = tap(D.exploreQuickFilters("marketplace", furniture), "textbooks");
  assert.deepEqual(books.marketplace, { sort: "newest", category: "textbooks" });
});

test("choices made in the sheet show as removable chips, but never twice", () => {
  const f = { ...DEF, apartments: { sort: "price_asc", minBedrooms: 2, minPrice: 500, maxPrice: 1200, radiusMiles: 1, furnished: true } };
  const chips = D.exploreActiveChips("apartments", f);
  assert.deepEqual(chips.map((c) => c.key), ["sort", "beds", "price"], "the 1-mile radius and Furnished are quick filters, not chips");
  assert.ok(chips.every((c) => c.on && c.removable));
  assert.equal(chips.find((c) => c.key === "beds").label, "2+ beds");
  assert.match(chips.find((c) => c.key === "price").label, /^\$500–\$1,200$/);
  assert.deepEqual(tap(chips, "price").apartments, { sort: "price_asc", minBedrooms: 2, radiusMiles: 1, furnished: true });
  assert.equal(D.exploreFilterCount("apartments", f), 6);
  // A farther radius and video tours have no quick filter, so they get a chip each, a tap from gone.
  const tours = D.exploreActiveChips("apartments", { ...DEF, apartments: { sort: "newest", radiusMiles: 5, videoOnly: true } });
  assert.deepEqual(tours.map((c) => c.label), ["Within 5 mi", "Video tour"]);
  assert.deepEqual(tap(tours, "video").apartments, { sort: "newest", radiusMiles: 5 });
});

test("the Marketplace shows a category outside the quick ones as a chip; roommates show budget, who and distance", () => {
  const m = D.exploreActiveChips("marketplace", { ...DEF, marketplace: { sort: "newest", category: "bikes_transport", condition: "like_new", maxPrice: 40 } });
  assert.deepEqual(m.map((c) => c.label), ["Bikes & transport", "Like new", "Up to $40"]);
  const r = D.exploreActiveChips("roommates", { ...DEF, roommates: { type: "has_room", maxBudget: 800, genderPreference: "female", radiusMiles: 2, videoOnly: true } });
  assert.deepEqual(r.map((c) => c.label), ["Up to $800", "Open to: Female", "Within 2 mi", "With a video"]);
});

test("Clear puts the page on screen back to its defaults and only that page", () => {
  const f = { apartments: { sort: "price_desc", furnished: true }, roommates: { type: "has_room" }, marketplace: { sort: "newest" } };
  const cleared = D.clearExploreFilters("apartments", f);
  assert.deepEqual(cleared.apartments, DEF.apartments);
  assert.equal(cleared.roommates, f.roommates);
});

test("priceRangeLabel names a range, a floor or a cap", () => {
  assert.equal(D.priceRangeLabel(undefined, undefined), null);
  assert.equal(D.priceRangeLabel(300, undefined), "$300+");
  assert.equal(D.priceRangeLabel(undefined, 900), "Up to $900");
});

test("Events: Today, This week and Weekend are one choice, a second tap is back to Upcoming; types are removable chips", () => {
  const none = D.DEFAULT_EVENT_FILTERS;
  assert.deepEqual(keys(D.eventQuickFilters(none)), ["today", "week", "weekend"]);
  const today = tap(D.eventQuickFilters(none), "today");
  assert.equal(today.dateFilter, "today");
  assert.equal(tap(D.eventQuickFilters(today), "weekend").dateFilter, "weekend");
  assert.equal(tap(D.eventQuickFilters(today), "today").dateFilter, "any");
  const typed = { dateFilter: "week", categories: ["career", "sports"] };
  assert.equal(D.eventFilterCount(typed), 3);
  const chips = D.eventActiveChips(typed);
  assert.deepEqual(chips.map((c) => c.label), ["Career", "Sports"]);
  assert.deepEqual(tap(chips, "career").categories, ["sports"]);
});
