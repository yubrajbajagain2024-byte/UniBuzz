import { DEFAULT_HOME_SECTION, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";

/**
 * A page of the app's Home, left to right: Stories | Orbit | Buzz (the owner's sketch, 2026-11-21). "stories" is the
 * app's own page — a whole page of story rings, where the row across the top of the feed used to be — so it is not one
 * of the shared HOME_SECTIONS the website's Home is built from. Posts and Reels keep their sections, their feeds, their
 * data and their addresses (HIDDEN_HOME_SECTIONS, and the website's own tabs): here Orbit carries both of them, full
 * screen, so neither has a tab in the app.
 */
export type AppHomeSection = HomeSection | "stories";

const labelOf = (value: HomeSection) => HOME_SECTIONS.find((s) => s.value === value)?.label ?? value;

/** The tab row across the top left of Home, and the pages of its pager, in order. */
export const APP_HOME_TABS: readonly { value: AppHomeSection; label: string }[] = [
  { value: "stories", label: "Stories" },
  { value: "foryou", label: labelOf("foryou") },
  { value: "buzz", label: labelOf("buzz") },
];

/** Home opens on Orbit, as the shared default says. */
export const APP_HOME_START: AppHomeSection = DEFAULT_HOME_SECTION;

/** Where a page sits in the pager, or -1 for a section with no page of its own (Posts, Reels). */
export function appHomeIndex(section: AppHomeSection): number {
  return APP_HOME_TABS.findIndex((t) => t.value === section);
}
