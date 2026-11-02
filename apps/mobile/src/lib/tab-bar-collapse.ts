import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { AccessibilityInfo, type NativeScrollEvent } from "react-native";
import { makeMutable, withSpring } from "react-native-reanimated";
import { createScrollCollapse, SCROLL_COLLAPSE, type ScrollCollapse } from "@apartment-book/shared";
import { reduceMotionEnabled } from "./accessibility";

/**
 * Reddit's collapsing bottom bar (iOS 26's tab bar minimising on scroll), decided by the speed of the scroll: reading at
 * any pace keeps the whole bar; a deliberate flick on, the finger pushing the page up fast, shrinks the floating bar into
 * one round button holding the tab on screen (Home's icon on Home, Explore's on Explore, and so on); scrolling back, or
 * reaching the top, brings the whole bar back where it was. What counts as a flick, and as a scroll back, is
 * `createScrollCollapse` in packages/shared (src/scroll-collapse.ts), tuned by TAB_BAR_SCROLL below. Home's For you and
 * Buzz, Explore's three pages and Events' two feed it (useCollapseOnScroll); Messages (its header scrolls away and only
 * the bar stays put) and your Profile (it keeps its whole layout, the bar included), both the owner's choice of
 * 2026-11-02, Reels and the full-screen viewers never do, and leaving a tab, or moving to another page of it, brings the
 * whole bar back.
 *
 * `tabBarCollapse` is the state on the UI thread, 0 for the whole bar and 1 collapsed, springing in between: the bar
 * (components/floating-tab-bar.tsx) and the floating create buttons, which ride down beside the collapsed bar like X's,
 * read it in their animated styles. React reads `useTabBarCollapsed` (what a tap on the bar does, what screen readers get).
 */
export const tabBarCollapse = makeMutable(0);

/**
 * The thresholds: a scroll on at 700 points a second or more, over at least 32 points, collapses the bar; 24 points back
 * restores it. A first setting, to be tuned on a phone (see ScrollCollapseConfig for each value).
 */
export const TAB_BAR_SCROLL = SCROLL_COLLAPSE;
/** Close to critically damped, as the bar's own capsule: the bar settles without a wobble. */
const SPRING = { damping: 30, stiffness: 320, mass: 0.9 };

let collapsed = false;
/** VoiceOver and TalkBack users always get the whole bar: a collapsed bar would hide four of its tabs from them. */
let screenReader = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const read = () => collapsed;

/** Collapses the bar, or brings the whole bar back; nothing when it already is so. */
export function setTabBarCollapsed(next: boolean): void {
  if (next && screenReader) return;
  if (next === collapsed) return;
  collapsed = next;
  const to = next ? 1 : 0;
  tabBarCollapse.value = reduceMotionEnabled() ? to : withSpring(to, SPRING);
  listeners.forEach((l) => l());
}

AccessibilityInfo.isScreenReaderEnabled().then(
  (on) => {
    screenReader = on;
    if (on) setTabBarCollapsed(false);
  },
  () => {},
);
AccessibilityInfo.addEventListener("screenReaderChanged", (on) => {
  screenReader = on;
  if (on) setTabBarCollapsed(false);
});

/** Whether the bar is collapsed (or on its way there), for React. */
export function useTabBarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}

/** A scroll event's own time (iOS stamps each natively, in ms), or now where a platform gives none. */
function timeOf(e: NativeScrollEvent | undefined): number {
  const stamp = (e as { timestamp?: number } | undefined)?.timestamp;
  return typeof stamp === "number" && stamp > 0 ? stamp : performance.now();
}

/**
 * Whether the list is pulled past the furthest it can rest (a rubber band, not a scroll): past its end, or anywhere below
 * its top when it is too short to scroll at all, where a flick only stretches it and the bounce back would bring the bar
 * straight back again.
 */
function pastEnd(e: NativeScrollEvent | undefined): boolean {
  if (!e) return false;
  const top = -(e.contentInset?.top ?? 0);
  const end = Math.max(top, e.contentSize.height + (e.contentInset?.bottom ?? 0) - e.layoutMeasurement.height);
  return e.contentOffset.y > end + 1;
}

/**
 * The scroll side, for one vertical list: call the returned function from the list's scroll listener with how far the
 * list is from its top (iOS content insets already taken off) and the event itself (its timestamp, its size). Only while
 * `active` (the list is the page on screen, its tab focused); when it stops being active the whole bar comes back, so a
 * list left collapsed never leaves another page without its tabs. `page`, for a screen whose pager hands one tracker
 * several lists (Explore, Events): a new page starts over with the whole bar. Horizontal scrolls (a photo
 * carousel, the pager itself) are never fed, so they never count.
 */
export function useCollapseOnScroll(active: boolean, page: number = 0): (fromTop: number, e?: NativeScrollEvent) => void {
  const tracker = useRef<ScrollCollapse | null>(null);
  tracker.current ??= createScrollCollapse(TAB_BAR_SCROLL);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    tracker.current?.reset();
    setTabBarCollapsed(false);
  }, [active, page]);
  // Leaving the screen altogether (a pushed screen, sign-out) brings the bar back too.
  useEffect(() => () => setTabBarCollapsed(false), []);
  return useCallback((fromTop: number, e?: NativeScrollEvent) => {
    const t = tracker.current;
    if (!activeRef.current || !t) return;
    // A tap on the collapsed button (or a screen reader) changed the bar: go on from there.
    if (t.collapsed !== collapsed) t.assume(collapsed);
    const change = t.sample({ fromTop, time: timeOf(e), pastEnd: pastEnd(e) });
    if (change) setTabBarCollapsed(change === "collapse");
  }, []);
}
