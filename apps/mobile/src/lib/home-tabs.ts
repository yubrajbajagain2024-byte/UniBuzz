import { DEFAULT_HOME_SECTION, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";

/**
 * A page of the app's Home, left to right: Orbit | Buzz. Posts and Reels keep their sections, their feeds, their data
 * and their addresses (HIDDEN_HOME_SECTIONS, and the website's own tabs): here Orbit carries both of them (a card feed
 * again since 2026-11-24, each post opening full screen on a tap), so neither has a tab in the app. Stories had a tab
 * of their own between 2026-11-21 and 2026-11-22; they are a tray of rings at the top of Orbit's feed now
 * (components/home/stories-tray.tsx), as on Instagram. It stays the app's own list rather than the shared HOME_TABS
 * because the website keeps its Reels tab.
 */
export type AppHomeSection = HomeSection;

const labelOf = (value: HomeSection) => HOME_SECTIONS.find((s) => s.value === value)?.label ?? value;

/** The tab row across the top left of Home, and the pages of its pager, in order. */
export const APP_HOME_TABS: readonly { value: AppHomeSection; label: string }[] = [
  { value: "foryou", label: labelOf("foryou") },
  { value: "buzz", label: labelOf("buzz") },
];

/** Home opens on Orbit, as the shared default says. */
export const APP_HOME_START: AppHomeSection = DEFAULT_HOME_SECTION;

/** Where a page sits in the pager, or -1 for a section with no page of its own (Posts, Reels). */
export function appHomeIndex(section: AppHomeSection): number {
  return APP_HOME_TABS.findIndex((t) => t.value === section);
}
