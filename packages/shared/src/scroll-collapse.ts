/**
 * Reddit's collapsing bottom bar, decided by the speed of a scroll rather than by its mere direction: from a vertical
 * list's scroll events, whether the app's floating tab bar collapses into its one round button or comes back whole.
 *
 * - Slow scrolling (reading, a gentle drag, a slight nudge) never collapses the bar, however far it goes.
 * - A deliberate flick on (the content moving up the screen) collapses it, once the list has moved `collapseTravel`
 *   the same way at `collapseSpeed` or more: the flick's own drag, or the momentum it leaves.
 * - Scrolling back, at any speed, brings the whole bar back after `expandTravel`; smaller turns are ignored.
 * - The top of a list always shows the whole bar; a bounce past the end of the list is not a scroll back.
 * - Once the bar has come back it cannot collapse again for `holdMs`, so one gesture never flickers it. A turn back is
 *   never held: wobbles never travel `expandTravel`, so one that does is meant.
 *
 * The speed is measured, not guessed: the distance over the events' own timestamps across the last `speedWindowMs`
 * (iOS stamps each scroll event natively, so a late or bunched delivery to JavaScript cannot fake a flick), started over
 * whenever the direction turns or the list pauses. The thresholds are a first setting, to be tuned on a phone; they are
 * not Reddit's own. The app feeds the events (apps/mobile/src/lib/tab-bar-collapse.ts); this only decides, so it is
 * tested offline (tests/scroll-collapse.test.mjs).
 */
export type ScrollCollapseConfig = {
  /** The speed on, in points per second, a scroll must reach (with `collapseTravel`) to collapse the bar. */
  collapseSpeed: number;
  /** How far a scroll must have moved on, in one direction, before it may collapse the bar. */
  collapseTravel: number;
  /** How far a scroll back, at any speed, has to go to bring the whole bar back. */
  expandTravel: number;
  /** Within this distance of a list's top the bar is always whole. */
  nearTop: number;
  /** The speed is measured over the events of this last stretch of time (ms). */
  speedWindowMs: number;
  /** A speed measured over less time than this (ms) is not trusted: two events close together say little. */
  minSpanMs: number;
  /** A pause longer than this (ms) between two events starts a new movement: its distance and speed start over. */
  pauseMs: number;
  /** After the bar comes back it cannot collapse again for this long (ms). */
  holdMs: number;
};

export const SCROLL_COLLAPSE: ScrollCollapseConfig = {
  collapseSpeed: 700,
  collapseTravel: 32,
  expandTravel: 24,
  nearTop: 24,
  speedWindowMs: 80,
  minSpanMs: 30,
  pauseMs: 180,
  holdMs: 250,
};

/** One scroll event: how far the list is from its top, when (ms, on a clock that only goes forward), and whether it is bouncing past its end. */
export type ScrollSample = { fromTop: number; time: number; pastEnd?: boolean };

export type ScrollCollapseChange = "collapse" | "expand";

export type ScrollCollapse = {
  /** Feeds one scroll event; returns the change it makes to the bar, if any. */
  sample(s: ScrollSample): ScrollCollapseChange | null;
  /** The bar was collapsed or brought back by something else (a tap on it): go on from there, with a fresh movement. */
  assume(collapsed: boolean): void;
  /** Starts over, with the whole bar (another page, the list left the screen). */
  reset(): void;
  /** Whether this has the bar collapsed. */
  readonly collapsed: boolean;
};

export function createScrollCollapse(config: ScrollCollapseConfig = SCROLL_COLLAPSE): ScrollCollapse {
  let collapsed = false;
  let last: ScrollSample | null = null;
  /** How far the list has moved in its current direction: positive on, negative back, 0 for no movement yet. */
  let run = 0;
  /** This direction's events, oldest first, trimmed to the speed window: the first is where the speed is measured from. */
  let recent: ScrollSample[] = [];
  let changedAt = -Infinity;

  const startOver = (s: ScrollSample | null) => {
    run = 0;
    recent = s ? [s] : [];
  };
  const change = (to: boolean, time: number): ScrollCollapseChange => {
    collapsed = to;
    changedAt = time;
    // Either way has to be travelled in full from here.
    startOver(last);
    return to ? "collapse" : "expand";
  };

  return {
    get collapsed() {
      return collapsed;
    },
    assume(next) {
      if (next === collapsed) return;
      collapsed = next;
      changedAt = -Infinity;
      startOver(last);
    },
    reset() {
      collapsed = false;
      last = null;
      changedAt = -Infinity;
      startOver(null);
    },
    sample(s) {
      if (s.fromTop <= config.nearTop) {
        last = s;
        startOver(s);
        return collapsed ? change(false, s.time) : null;
      }
      // The list springing back from past its end is not the person scrolling back.
      if (s.pastEnd) return null;
      const before = last;
      last = s;
      if (!before || s.time < before.time || s.time - before.time > config.pauseMs) {
        startOver(s);
        return null;
      }
      const delta = s.fromTop - before.fromTop;
      if (delta === 0) return null;
      if (run !== 0 && Math.sign(delta) !== Math.sign(run)) {
        // The direction turned: the new one is measured from the turning point.
        run = delta;
        recent = [before, s];
      } else {
        run += delta;
        recent.push(s);
      }
      // Keep, as the first event, the latest one at least a window old.
      while (recent.length > 2 && s.time - recent[1]!.time >= config.speedWindowMs) recent.shift();
      const first = recent[0]!;
      const span = s.time - first.time;
      const speed = span >= config.minSpanMs ? ((s.fromTop - first.fromTop) / span) * 1000 : 0;
      if (!collapsed && s.time - changedAt >= config.holdMs && run >= config.collapseTravel && speed >= config.collapseSpeed) return change(true, s.time);
      if (collapsed && run <= -config.expandTravel) return change(false, s.time);
      return null;
    },
  };
}
