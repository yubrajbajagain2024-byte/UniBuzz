import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type ColorValue } from "react-native";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TAB_BAR_COLLAPSED_SCALE, TAB_BAR_HEIGHT, TAB_BAR_SIDE, tabBarBottom } from "@/lib/tab-bar";
import { setTabBarCollapsed, tabBarCollapse, useTabBarCollapsed } from "@/lib/tab-bar-collapse";
import { useReduceMotion } from "@/lib/accessibility";
import { GlassBackdrop } from "@/components/glass";
import { auroraGradient } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * An action in the middle of the bar (the app's Create): its icon alone, centred in its slot (the label is for screen
 * readers). It opens something rather than going somewhere, so it is never the tab on screen and the capsule never stops on it.
 */
export type TabBarAction = { label: string; hint?: string; icon: (p: { color: ColorValue; size: number }) => ReactNode; onPress: () => void };

/**
 * The bar as it is right now (its tabs, the one on screen, their icons and badges, any middle action), for a screen drawn over the
 * tabs that keeps the bar in view: the full-screen viewer (app/reels/[id].tsx) is a modal above them, so the bar itself
 * is under it, and the viewer draws this same bar in the same place instead. Published by the tabs' own bar each time
 * it renders (a new tab, a new unread count), and gone with it.
 */
export type TabBarMirror = { props: TabBarProps; action?: TabBarAction };
/** By the navigator's first tab's route key: a screen over the tabs copies the bar of the tabs right under it. */
const mirrors = new Map<string, TabBarMirror>();
let latestMirror: string | null = null;
const mirrorListeners = new Set<() => void>();
function publishMirror(key: string, next: TabBarMirror | null) {
  if (next) {
    mirrors.set(key, next);
    latestMirror = key;
  } else {
    mirrors.delete(key);
    if (latestMirror === key) latestMirror = mirrors.size > 0 ? [...mirrors.keys()].at(-1)! : null;
  }
  mirrorListeners.forEach((l) => l());
}
function subscribeMirror(listener: () => void) {
  mirrorListeners.add(listener);
  return () => {
    mirrorListeners.delete(listener);
  };
}
/** The bar of the tabs whose first tab has this route key, or (no key known) the one that rendered last. */
export function useTabBarMirror(firstTabKey?: string | null): TabBarMirror | null {
  const read = () => (firstTabKey ? mirrors.get(firstTabKey) : undefined) ?? (latestMirror ? (mirrors.get(latestMirror) ?? null) : null);
  return useSyncExternalStore(subscribeMirror, read, read);
}

/** The system tab bars' glyph size. */
const ICON_SIZE = 26;
/** The row's inset from the bar's sides: the capsule on Home or Profile comes this close to the bar's ends. */
const ROW_INSET = 2;
/** The capsule's inset from the bar's top and bottom. */
const CAPSULE_INSET = 6;
/** The capsule's height and corner radius. */
const CAPSULE = TAB_BAR_HEIGHT - CAPSULE_INSET * 2;
/**
 * The capsule glides from the tab you were on to the one you tapped, each of its two edges on its own spring: the edge
 * in the direction of travel leads and the other follows a beat behind, so it stretches a touch in flight and settles,
 * never blinking or jumping. Critically damped or near it, so it lands without wobbling.
 */
const LEAD = { damping: 30, stiffness: 380, mass: 0.8 };
/**
 * A soft shadow under the pill, so it lifts off a white page as well as a photo. A box shadow is drawn only outside the
 * pill, so it never darkens the see-through glass.
 */
const SHADOW_LIGHT = "0px 8px 28px rgba(0,0,0,0.10), 0px 1px 3px rgba(0,0,0,0.06)";
const SHADOW_DARK = "0px 8px 28px rgba(0,0,0,0.45)";
const TRAIL = { damping: 28, stiffness: 260, mass: 0.8 };

/**
 * The floating bottom bar: a frosted glass pill (GlassBackdrop "tabs": iOS 26's liquid glass, or the system's blur
 * before it, over a see-through wash) with five equal places and no labels: Home, Explore | Create | Messages, Profile.
 * Each icon is outlined and muted grey at rest; the tab on screen is filled, in the text colour, over a capsule washed
 * with the aurora (cyan into violet, faint) that glides there when it changes (see LEAD and TRAIL), the new tab's
 * symbol bouncing once, silently. `action`, when given, takes the middle place, between the two halves of the tabs (the
 * app's Create: a plain plus in a thin aurora ring): it opens something rather than going somewhere, so the capsule
 * never stops on it. The navigator's own
 * events still fire (tabPress can be prevented, tabLongPress is sent), each tab keeps its icon, title and badge from its
 * screen options, and screen readers hear "Home, tab, 1 of 5", Create "Create, 3 of 5" and a badge with its tab
 * ("Messages, tab, 4 of 5, 3 new"): every place in the bar counts, the middle action included; the title is the label
 * they read, never drawn.
 *
 * The bar collapses like Reddit's on a fast flick down a feed (lib/tab-bar-collapse.ts): it narrows to a circle as tall
 * as itself and shrinks a little from its bottom left corner, the row sliding so the tab on screen stays in the circle's
 * middle while every other place and the capsule fade, so only that tab's icon is left. The row keeps its measured
 * width the whole time (the bar clips it), so nothing is laid out again while it moves. A tap on the circle brings the
 * whole bar back. A copy of the bar (`onSelect`, over the full-screen viewer) never collapses.
 */
export function FloatingTabBar({ state, descriptors, emitter, navigateToTab, action, onSelect, ...rest }: TabBarProps & { action?: TabBarAction; onSelect?: (routeKey: string, focused: boolean) => void }) {
  const insets = useSafeAreaInsets();
  // The tabs' own bar publishes itself for the screens drawn over it (see TabBarMirror); a copy (`onSelect`) does not.
  // Under its first tab's route key, which names this navigator (the state handed to the bar carries only its routes
  // and index); a screen over these tabs finds the same key in the root stack (see app/reels/[id].tsx).
  const navigatorKey = state.routes[0]?.key ?? "tabs";
  useEffect(() => {
    if (!onSelect) publishMirror(navigatorKey, { props: { state, descriptors, emitter, navigateToTab, ...rest } as TabBarProps, action });
  });
  useEffect(() => {
    if (onSelect) return;
    return () => publishMirror(navigatorKey, null);
  }, [onSelect, navigatorKey]);
  const { colors, isDark } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const [rowWidth, setRowWidth] = useState(0);
  const count = state.routes.length;
  // The first tab after the middle place (with four tabs: Home, Explore | Create | Messages, Profile), or none.
  const middle = action ? Math.ceil(count / 2) : -1;
  /** How many places the bar has, the middle action counted: screen readers hear "Home, tab, 1 of 5", as the eye sees five. */
  const places = count + (action ? 1 : 0);
  const slotWidth = rowWidth / places;
  /** Where a tab sits in the row, counting the middle place. */
  const slotOf = (index: number) => index + (action && index >= middle ? 1 : 0);

  // The capsule's left and right edges, in points from the row's start. At rest it covers the tab on screen's place.
  const leftEdge = useSharedValue(0);
  const rightEdge = useSharedValue(0);
  const shown = useRef(state.index);
  // Measured, or measured again (a rotation): the capsule simply sits on the tab on screen.
  useLayoutEffect(() => {
    const at = slotOf(shown.current) * slotWidth;
    leftEdge.value = at;
    rightEdge.value = at + slotWidth;
    // slotOf only reads `action` and `middle`, both behind slotWidth's inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotWidth, leftEdge, rightEdge]);
  // A new tab: the capsule glides there from where it is (a second tap mid-glide simply redirects it), starting before
  // the frame is drawn, so it moves the moment the new tab's icon lights up. It waits for the navigator's state rather
  // than setting off on the tap: a tab seen for the first time is built on the UI thread too, which holds every frame
  // for a moment, so a glide begun on the tap would reappear most of the way along instead of gliding the whole way.
  useLayoutEffect(() => {
    const from = shown.current;
    const to = state.index;
    shown.current = to;
    if (from === to) return;
    const left = slotOf(to) * slotWidth;
    const right = left + slotWidth;
    if (reduceMotion || slotWidth <= 0) {
      leftEdge.value = left;
      rightEdge.value = right;
      return;
    }
    const forward = to > from;
    leftEdge.value = withSpring(left, forward ? TRAIL : LEAD);
    rightEdge.value = withSpring(right, forward ? LEAD : TRAIL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index, slotWidth, reduceMotion, leftEdge, rightEdge]);

  // Collapsing (see the note above): 0 with the whole bar, 1 collapsed. A copy of the bar stays whole.
  const collapsible = !onSelect;
  const collapsed = useTabBarCollapsed() && collapsible;
  const { width: windowWidth } = useWindowDimensions();
  const barWidth = windowWidth - TAB_BAR_SIDE * 2;
  // The tab on screen's middle in the row: the collapsed circle holds it in its own middle.
  const focusCenter = ROW_INSET + (slotOf(state.index) + 0.5) * slotWidth;
  const shrinkStyle = useAnimatedStyle(() => {
    const c = collapsible ? tabBarCollapse.value : 0;
    return { width: interpolate(c, [0, 1], [barWidth, TAB_BAR_HEIGHT]), transform: [{ scale: interpolate(c, [0, 1], [1, TAB_BAR_COLLAPSED_SCALE]) }] };
  });
  const rowSlide = useAnimatedStyle(() => ({ transform: [{ translateX: -(collapsible ? tabBarCollapse.value : 0) * (focusCenter - TAB_BAR_HEIGHT / 2) }] }));
  const capsuleStyle = useAnimatedStyle(() => ({
    left: leftEdge.value,
    width: rightEdge.value - leftEdge.value,
    opacity: 1 - (collapsible ? tabBarCollapse.value : 0),
  }));

  return (
    <Animated.View style={[styles.bar, { bottom: tabBarBottom(insets), borderColor: colors.glassEdge, boxShadow: isDark ? SHADOW_DARK : SHADOW_LIGHT }, shrinkStyle]}>
      {/* Frosted glass: what scrolls under the bar shows through it, softened, and the glass answers a touch
          (interactive), as the system's own bars do. Reduce Transparency leaves a solid bar. */}
      <GlassBackdrop variant="tabs" radius={TAB_BAR_HEIGHT / 2} interactive />
      {/* The row is measured empty first, then shared out evenly. It is as wide as the whole bar even while the bar is
          collapsed: the bar clips it, and it slides instead. */}
      <Animated.View style={[styles.row, { width: barWidth - ROW_INSET * 2 }, rowSlide]} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        {rowWidth > 0 ? <Animated.View pointerEvents="none" style={[styles.capsule, { experimental_backgroundImage: auroraGradient(colors.auroraWash, 110) }, capsuleStyle]} /> : null}
        {rowWidth <= 0 ? null : state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key]!;
          const label = options.title ?? route.name;
          const badge = options.tabBarBadge;
          // The badge is drawn inside the tab, whose label replaces what is in it: so the label says it too ("Messages, tab, 4 of 5, 3 new").
          const hasBadge = badge !== undefined && badge !== null;
          const onPress = () => {
            // A copy of the bar over another screen decides for itself what a tab does there (see TabBarMirror).
            if (onSelect) return onSelect(route.key, focused);
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (focused || event.defaultPrevented) return;
            // No haptic here: switching tabs is silent, the capsule's glide and the icon's bounce are the feedback. The
            // navigator switches by route key and keeps the tab's params, as its own bar does.
            navigateToTab(route.key);
          };
          const onLongPress = () => (onSelect ? undefined : emitter.emit({ type: "tabLongPress", target: route.key }));
          return (
            <Fragment key={route.key}>
              {index === middle && action ? (
                <Slot width={slotWidth} fades={collapsible}>
                  <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={`${action.label}, ${middle + 1} of ${places}`} accessibilityHint={action.hint} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
                    {action.icon({ color: colors.muted, size: ICON_SIZE })}
                  </Pressable>
                </Slot>
              ) : null}
              <Slot width={slotWidth} fades={collapsible && !focused}>
                <Pressable
                  onPress={onPress}
                  onLongPress={onLongPress}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: focused }}
                  accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label}, tab, ${slotOf(index) + 1} of ${places}${hasBadge ? `, ${String(badge)} new` : ""}`}
                  testID={options.tabBarButtonTestID}
                  style={({ pressed }) => [styles.tab, pressed && !focused && styles.pressed]}
                >
                  <View>
                    {options.tabBarIcon ? options.tabBarIcon({ focused, color: focused ? colors.text : colors.muted, size: ICON_SIZE }) : null}
                    {/* The system's own badge: a red pill on the icon's top right corner, nothing around it. */}
                    {hasBadge ? (
                      <View style={[styles.badge, { backgroundColor: colors.dangerFill }]}>
                        <Text style={[styles.badgeText, { color: colors.onBrand }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                          {String(badge)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              </Slot>
            </Fragment>
          );
        })}
      </Animated.View>
      {/* Collapsed, the circle is one button: a tap brings the whole bar back (the tabs under it are clipped away anyway). */}
      {collapsed ? <Pressable onPress={() => setTabBarCollapsed(false)} accessibilityRole="button" accessibilityLabel="Show all tabs" style={StyleSheet.absoluteFill} /> : null}
    </Animated.View>
  );
}

/**
 * One place in the row, its equal share of the bar. Every place but the tab on screen's fades out as the bar collapses
 * (and back as it returns), so none of them slides through the shrinking bar on its way out.
 */
function Slot({ width, fades, children }: { width: number; fades: boolean; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({ opacity: fades ? 1 - tabBarCollapse.value : 1 }));
  return <Animated.View style={[styles.slot, { width }, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  // Floating over the content: a pill with a hairline edge and a soft shadow, clipped so the glass takes its shape.
  // Its width is animated (it collapses to a circle), and it shrinks from its bottom left corner, where it stays.
  bar: { position: "absolute", left: TAB_BAR_SIDE, height: TAB_BAR_HEIGHT, borderRadius: TAB_BAR_HEIGHT / 2, borderCurve: "continuous", overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, transformOrigin: "left bottom" },
  // Absolute children are placed inside the bar's hairline border, so the hairline comes off their offsets: the row and
  // the row sits exactly ROW_INSET in from the bar's outer sides and the capsule CAPSULE_INSET from its top and bottom, and
  // every icon on its place's centre.
  row: { position: "absolute", top: 0, bottom: 0, left: ROW_INSET - StyleSheet.hairlineWidth, flexDirection: "row" },
  capsule: { position: "absolute", top: CAPSULE_INSET - StyleSheet.hairlineWidth, height: CAPSULE, borderRadius: CAPSULE / 2, borderCurve: "continuous" },
  slot: { height: "100%", flexGrow: 0, flexShrink: 0 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.55 },
  badge: { position: "absolute", top: -4, right: -9, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
