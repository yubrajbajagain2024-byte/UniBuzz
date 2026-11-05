import { APARTMENT_SORTS, EVENT_CATEGORIES, GENDER_PREFERENCES, ITEM_CATEGORIES, ITEM_CONDITIONS, ITEM_SORTS, type ApartmentSort, type EventCategory, type HousingSection, type ItemCategoryValue, type ItemSort } from "./constants";
import type { EventDateFilter } from "./events";
import type { GenderPref, ItemCondition } from "./types/models";
import { formatPrice } from "./utils";

/*
 * Explore's and Events' filters, beyond the screens: what each page can be narrowed by, the few quick filters in the row
 * under the search box (one tap, applied at once), and a chip for every other choice in force (set in the filter sheet),
 * each a tap from being dropped. Every chip carries the filters a tap leads to, so the screens only show them. Tested
 * offline (tests/discovery.test.mjs).
 */

/** A roommate post either offers a room or looks for one. */
export type RoommateType = "has_room" | "needs_room";

/** What narrows each page of Explore. Toggles are `true` or left out, never false; a choice not made is left out. */
export type RoomFilterChoice = { sort: ApartmentSort; minBedrooms?: number; minPrice?: number; maxPrice?: number; radiusMiles?: number; furnished?: true; petsAllowed?: true; videoOnly?: true };
export type RoommateFilterChoice = { type?: RoommateType; maxBudget?: number; genderPreference?: GenderPref; radiusMiles?: number; videoOnly?: true };
export type MarketFilterChoice = { sort: ItemSort; category?: ItemCategoryValue; condition?: ItemCondition; minPrice?: number; maxPrice?: number };
export type ExploreFilters = { apartments: RoomFilterChoice; roommates: RoommateFilterChoice; marketplace: MarketFilterChoice };
export const DEFAULT_EXPLORE_FILTERS: ExploreFilters = { apartments: { sort: "newest" }, roommates: {}, marketplace: { sort: "newest" } };

/** How many of a page's choices differ from its defaults: the count on the filter button. */
export function exploreFilterCount(section: HousingSection, filters: ExploreFilters): number {
  const chosen = filters[section] as Record<string, unknown>;
  const defaults = DEFAULT_EXPLORE_FILTERS[section] as Record<string, unknown>;
  let n = 0;
  for (const k of new Set([...Object.keys(chosen), ...Object.keys(defaults)])) if (chosen[k] !== undefined && chosen[k] !== defaults[k]) n++;
  return n;
}

/**
 * A chip in the row under the search box: a quick filter (`on` when in force; a tap turns it on or off) or a choice made
 * in the filter sheet (`removable`, always on; a tap drops it). `next` is what the filters become on a tap.
 */
export type FilterChip<T> = { key: string; label: string; on: boolean; removable: boolean; next: T };

/** Drops `undefined` keys, so the count and the queries see a clean object. */
function tidy<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function withPage<S extends HousingSection>(filters: ExploreFilters, section: S, page: ExploreFilters[S]): ExploreFilters {
  return { ...filters, [section]: tidy(page) };
}

/** "$500–$1,200", "$500+" or "Up to $1,200"; null when no price is set. */
export function priceRangeLabel(min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && max !== undefined) return `${formatPrice(min)}–${formatPrice(max)}`;
  if (min !== undefined) return `${formatPrice(min)}+`;
  if (max !== undefined) return `Up to ${formatPrice(max)}`;
  return null;
}

/** The Marketplace's quick categories: the ones students reach for most; every category is in the sheet. */
export const QUICK_ITEM_CATEGORIES: readonly { value: ItemCategoryValue; label: string }[] = [
  { value: "furniture", label: "Furniture" },
  { value: "textbooks", label: "Textbooks" },
  { value: "electronics", label: "Electronics" },
  { value: "kitchen", label: "Kitchen" },
];
/** The distance a quick filter on Housing narrows to. */
export const QUICK_RADIUS_MILES = 1;

const labelOf = <V extends string>(list: readonly { value: V; label: string }[], value: V | undefined) => list.find((o) => o.value === value)?.label ?? String(value);

/**
 * The quick filters of a page of Explore, each one tap: Housing's Furnished, Pets OK and Within 1 mi; Roommate's Has a
 * room and Looking for a room (one or the other); the Marketplace's most used categories (one at a time, the sheet has
 * them all). Video tours are a choice in the sheet on Housing and Roommate.
 */
export function exploreQuickFilters(section: HousingSection, filters: ExploreFilters): FilterChip<ExploreFilters>[] {
  if (section === "apartments") {
    const a = filters.apartments;
    const toggle = (key: "furnished" | "petsAllowed", label: string): FilterChip<ExploreFilters> => ({ key, label, on: a[key] === true, removable: false, next: withPage(filters, "apartments", { ...a, [key]: a[key] ? undefined : true }) });
    return [
      toggle("furnished", "Furnished"),
      toggle("petsAllowed", "Pets OK"),
      { key: "near", label: `Within ${QUICK_RADIUS_MILES} mi`, on: a.radiusMiles === QUICK_RADIUS_MILES, removable: false, next: withPage(filters, "apartments", { ...a, radiusMiles: a.radiusMiles === QUICK_RADIUS_MILES ? undefined : QUICK_RADIUS_MILES }) },
    ];
  }
  if (section === "roommates") {
    const r = filters.roommates;
    const kind = (type: RoommateType, label: string): FilterChip<ExploreFilters> => ({ key: type, label, on: r.type === type, removable: false, next: withPage(filters, "roommates", { ...r, type: r.type === type ? undefined : type }) });
    return [kind("has_room", "Has a room"), kind("needs_room", "Looking for a room")];
  }
  const m = filters.marketplace;
  return QUICK_ITEM_CATEGORIES.map((c) => ({ key: c.value, label: c.label, on: m.category === c.value, removable: false, next: withPage(filters, "marketplace", { ...m, category: m.category === c.value ? undefined : c.value }) }));
}

/**
 * A chip for each choice made in the filter sheet that no quick filter shows (a price, a sort, bedrooms, a distance, video
 * tours, a category outside the quick ones...), so what narrows the page is always in sight and a tap drops it.
 */
export function exploreActiveChips(section: HousingSection, filters: ExploreFilters): FilterChip<ExploreFilters>[] {
  const chips: FilterChip<ExploreFilters>[] = [];
  const add = (key: string, label: string, next: ExploreFilters) => chips.push({ key, label, on: true, removable: true, next });
  if (section === "apartments") {
    const a = filters.apartments;
    if (a.sort !== "newest") add("sort", labelOf(APARTMENT_SORTS, a.sort), withPage(filters, "apartments", { ...a, sort: "newest" }));
    if (a.minBedrooms !== undefined) add("beds", `${a.minBedrooms}+ beds`, withPage(filters, "apartments", { ...a, minBedrooms: undefined }));
    const price = priceRangeLabel(a.minPrice, a.maxPrice);
    if (price) add("price", price, withPage(filters, "apartments", { ...a, minPrice: undefined, maxPrice: undefined }));
    if (a.radiusMiles !== undefined && a.radiusMiles !== QUICK_RADIUS_MILES) add("radius", `Within ${a.radiusMiles} mi`, withPage(filters, "apartments", { ...a, radiusMiles: undefined }));
    if (a.videoOnly) add("video", "Video tour", withPage(filters, "apartments", { ...a, videoOnly: undefined }));
  } else if (section === "roommates") {
    const r = filters.roommates;
    if (r.maxBudget !== undefined) add("budget", `Up to ${formatPrice(r.maxBudget)}`, withPage(filters, "roommates", { ...r, maxBudget: undefined }));
    if (r.genderPreference !== undefined) add("gender", `Open to: ${labelOf(GENDER_PREFERENCES, r.genderPreference)}`, withPage(filters, "roommates", { ...r, genderPreference: undefined }));
    if (r.radiusMiles !== undefined) add("radius", `Within ${r.radiusMiles} mi`, withPage(filters, "roommates", { ...r, radiusMiles: undefined }));
    if (r.videoOnly) add("video", "With a video", withPage(filters, "roommates", { ...r, videoOnly: undefined }));
  } else {
    const m = filters.marketplace;
    if (m.category !== undefined && !QUICK_ITEM_CATEGORIES.some((c) => c.value === m.category)) add("category", labelOf(ITEM_CATEGORIES, m.category), withPage(filters, "marketplace", { ...m, category: undefined }));
    if (m.sort !== "newest") add("sort", labelOf(ITEM_SORTS, m.sort), withPage(filters, "marketplace", { ...m, sort: "newest" }));
    if (m.condition !== undefined) add("condition", labelOf(ITEM_CONDITIONS, m.condition), withPage(filters, "marketplace", { ...m, condition: undefined }));
    const price = priceRangeLabel(m.minPrice, m.maxPrice);
    if (price) add("price", price, withPage(filters, "marketplace", { ...m, minPrice: undefined, maxPrice: undefined }));
  }
  return chips;
}

/** The page's filters back to its defaults (Clear in the row, Reset in the sheet). */
export function clearExploreFilters(section: HousingSection, filters: ExploreFilters): ExploreFilters {
  return { ...filters, [section]: DEFAULT_EXPLORE_FILTERS[section] };
}

/** What narrows the Events tab beyond its search box: when, and which types of event (any of them; none is every type). */
export type EventFilterChoice = { dateFilter: EventDateFilter; categories: readonly EventCategory[] };
export const DEFAULT_EVENT_FILTERS: EventFilterChoice = { dateFilter: "any", categories: [] };

/** How many choices differ from the defaults: the count on the filter button. Each event type picked counts. */
export function eventFilterCount(choice: EventFilterChoice): number {
  return (choice.dateFilter === DEFAULT_EVENT_FILTERS.dateFilter ? 0 : 1) + choice.categories.length;
}

/** Events' quick filters: Today, This week, Weekend (one at a time; Upcoming, the default, is none of them). */
export function eventQuickFilters(choice: EventFilterChoice): FilterChip<EventFilterChoice>[] {
  const when = (value: Exclude<EventDateFilter, "any">, label: string): FilterChip<EventFilterChoice> => ({ key: value, label, on: choice.dateFilter === value, removable: false, next: { ...choice, dateFilter: choice.dateFilter === value ? "any" : value } });
  return [when("today", "Today"), when("week", "This week"), when("weekend", "Weekend")];
}

/** A chip for each event type picked in the sheet, a tap from being dropped. */
export function eventActiveChips(choice: EventFilterChoice): FilterChip<EventFilterChoice>[] {
  return choice.categories.map((c) => ({ key: c, label: labelOf(EVENT_CATEGORIES, c), on: true, removable: true, next: { ...choice, categories: choice.categories.filter((x) => x !== c) } }));
}
