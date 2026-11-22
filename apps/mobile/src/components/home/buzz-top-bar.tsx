import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useIsFocused } from "expo-router";
import { Animated, StyleSheet } from "react-native";
import { MaskGlyph } from "@/components/buzz/ui";
import { buzzState } from "@/lib/buzz-store";
import { appHomeIndex, type AppHomeSection } from "@/lib/home-tabs";
import { phosphor } from "@/lib/palette";
import { statusShade } from "@/lib/theme";

/*
 * Home's top bar near Buzz (UniVerse's HomeTopBar on the Buzz pane): the bar turns Phosphor as the pager comes to Buzz,
 * its words light and its underline lime, and the Buzz label carries the small lime mask while Buzz is near. Nothing on
 * the bar shows who is looking (the bar is the tabs and the three icons: see HomeTopTabs), and while the pager rests on
 * Buzz the tab bar's Profile tab stands a neutral glyph in for your photo too (useHomeRestingOnBuzz). Everything that
 * moves follows the pager on the native driver; the few flags that change what is drawn flip only when the pager
 * crosses a threshold (halfway, at rest), like the bar's look over the Orbit feed.
 */

/** Where Buzz sits in the pager (-1 if it has no page). */
export const BUZZ_PAGE_INDEX = appHomeIndex("buzz");

type Flags = { near: boolean; atRest: boolean };

/** At this distance from Buzz (in pages) or closer, the pager counts as resting on it. */
const AT_REST = 0.01;

function flagsFor(distance: number): Flags {
  return { near: distance < 0.5, atRest: distance <= AT_REST };
}

function distanceOf(section: AppHomeSection): number {
  const i = appHomeIndex(section);
  return i < 0 || BUZZ_PAGE_INDEX < 0 ? 1 : Math.abs(i - BUZZ_PAGE_INDEX);
}

export type BuzzBar = {
  /** Within half a page of Buzz: the bar's words and underline take the Phosphor look. */
  near: boolean;
  /** 1 on Buzz, 0 a page away: the Phosphor layer's opacity and the mask's. */
  layer: Animated.AnimatedInterpolation<number> | null;
};

/*
 * Whether Home is the screen on show and its pager rests on Buzz: anything else that draws your photo while Buzz is on
 * screen (the tab bar's Profile tab) can stand a neutral glyph in for it. Kept by useBuzzBar.
 */
let restingOnBuzz = false;
const restingListeners = new Set<() => void>();
function setRestingOnBuzz(next: boolean) {
  if (next === restingOnBuzz) return;
  restingOnBuzz = next;
  restingListeners.forEach((l) => l());
}
function subscribeResting(listener: () => void) {
  restingListeners.add(listener);
  return () => {
    restingListeners.delete(listener);
  };
}
const readResting = () => restingOnBuzz;

/** True while Home is on screen resting on its Buzz page (nothing there may show who is looking). */
export function useHomeRestingOnBuzz(): boolean {
  return useSyncExternalStore(subscribeResting, readResting, readResting);
}

/** The Buzz look of Home's bar, from the pager's offset (`scrollX`) and the section it last settled on. */
export function useBuzzBar(scrollX: Animated.Value, pageWidth: number, section: AppHomeSection): BuzzBar {
  const [flags, setFlags] = useState<Flags>(() => flagsFor(distanceOf(section)));
  const focused = useIsFocused();
  useEffect(() => setRestingOnBuzz(focused && flags.atRest), [focused, flags.atRest]);
  useEffect(() => () => setRestingOnBuzz(false), []);

  // The section the pager settled on is the truth at rest.
  useEffect(() => {
    const next = flagsFor(distanceOf(section));
    setFlags((f) => (f.near === next.near && f.atRest === next.atRest ? f : next));
    // Remember the last section that was not Buzz: the guidelines gate's "Not now" goes back there. Stories is the app's
    // own page, not one of the shared sections the gate knows, so Orbit stands for it.
    if (section !== "buzz") buzzState.setPreviousSection(section === "stories" ? "foryou" : section);
  }, [section]);

  // While the pager moves: flip only at the thresholds (a native-driven value still reports to JS listeners).
  useEffect(() => {
    if (BUZZ_PAGE_INDEX < 0 || pageWidth <= 0) return;
    const id = scrollX.addListener(({ value }) => {
      const next = flagsFor(Math.abs(value / pageWidth - BUZZ_PAGE_INDEX));
      setFlags((f) => (f.near === next.near && f.atRest === next.atRest ? f : next));
    });
    return () => scrollX.removeListener(id);
  }, [scrollX, pageWidth]);

  const layer = useMemo(() => {
    if (BUZZ_PAGE_INDEX < 0 || pageWidth <= 0) return null;
    const at = BUZZ_PAGE_INDEX * pageWidth;
    return scrollX.interpolate({ inputRange: [at - pageWidth, at, at + pageWidth], outputRange: [0, 1, 0], extrapolate: "clamp" });
  }, [scrollX, pageWidth]);

  return { near: flags.near, layer };
}

/**
 * The bar's Phosphor background, over its usual one, as opaque as Buzz is near (`layer`): Buzz's own canvas, with no
 * line under it, so the tabs and the Buzz feed read as one surface, as the other pages' do.
 */
export function BuzzBarLayer({ layer }: { layer: BuzzBar["layer"] }) {
  if (!layer) return null;
  return <Animated.View pointerEvents="none" style={[styles.layer, { opacity: layer }]} />;
}

/**
 * Buzz's shade behind the status bar (see HomeTopTabs): Phosphor, as Buzz is near (`layer`), and only as far as the bar
 * has slid away (`away`).
 */
export function BuzzStatusShade({ layer, away, height }: { layer: BuzzBar["layer"]; away: Animated.AnimatedInterpolation<number>; height: number }) {
  if (!layer) return null;
  return <Animated.View pointerEvents="none" style={[styles.shade, { height, opacity: Animated.multiply(layer, away) }]} />;
}

/**
 * The lime mask before the Buzz label, fading in as Buzz comes near: SlidingTabs hangs it just before the label (its
 * `leading`), so it follows the label wherever the row puts it.
 */
export function BuzzTabMask({ layer, fontSize }: { layer: BuzzBar["layer"]; fontSize: number }) {
  if (!layer || BUZZ_PAGE_INDEX < 0) return null;
  const glyph = Math.round(fontSize * 0.85);
  return (
    <Animated.View style={[styles.mask, { width: glyph, opacity: layer }]}>
      <MaskGlyph size={glyph} color={phosphor.accent} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Opaque: under it sits the bar's own colour (white in Light), which a see-through Phosphor would turn grey.
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: -StyleSheet.hairlineWidth, backgroundColor: phosphor.canvas },
  shade: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 12, experimental_backgroundImage: statusShade(phosphor.canvas) },
  mask: { alignItems: "center", justifyContent: "center" },
});
