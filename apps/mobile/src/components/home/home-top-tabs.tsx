import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HEADER_ACTION_SIZE, HeaderActions, headerActionsWidth } from "@/components/header-actions";
import { SlidingTabs } from "@/components/sliding-tabs";
import { hapticTap } from "@/lib/haptics";
import { APP_HOME_TABS, type AppHomeSection } from "@/lib/home-tabs";
import { SCOPE_TOGGLE_SHOWN, useHomeScope } from "@/lib/home-scope";
import { useSession } from "@/lib/session";
import { auroraGradient, radius, statusShade } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { BuzzBarLayer, BuzzStatusShade, BuzzTabMask, useBuzzBar } from "./buzz-top-bar";
import { phosphor } from "@/lib/palette";
import { Icon } from "@/components/icon";
import { GlassBackdrop } from "@/components/glass";

/** The bar's one row: the tabs at its left, the three icons at its right. */
const ROW = 46;
/** The second row, while it is shown: the Campus | Global toggle, a 32pt pill with 6pt above and below. */
const TOGGLE_ROW = 44;
/**
 * Breathing room between the status bar (the safe area's top inset) and the row, so the labels and the icons sit clearly
 * under the clock on every phone, a phone whose inset is only the status bar (no notch, Android) included.
 */
const TOP_GAP = 8;
/** The row's inset from the screen's right edge, where the icons are; the labels start SIDE_PAD from the left (see `tabs`). */
const SIDE_PAD = 16;
export const HOME_TOP_BAR_HEIGHT = TOP_GAP + ROW + (SCOPE_TOGGLE_SHOWN ? TOGGLE_ROW : 0);
/** The square each icon sits in at the right, a touch wider than its glyph. */
const SIDE = 44;
/** As wide as the right side's three buttons (the compass, the bell, the magnifier) with the last one's inset from the edge. */
const ACTIONS_SLOT = headerActionsWidth(3) + (SIDE - HEADER_ACTION_SIZE) / 2;
/**
 * Half of SlidingTabs' room between labels, which the first label keeps to its left: taken off the row's own padding, so
 * "Stories" starts SIDE_PAD from the screen's edge, in line with everything else.
 */
const TABS_LEAD = 12;
const LABEL_SIZE = 17;
/**
 * Home's row sits a little higher than the gap under the status bar alone would put it: by this share of the screen's
 * height (the owner's brief, 2026-11-22), about 10 points on a 6.1-inch phone, so it scales with the phone.
 */
const ROW_LIFT = 0.012;
/** The labels at medium weight, never bold (the active one is told by its colour), and the underline a short bar under it. */
const LABEL_WEIGHTS = { active: "500", rest: "500" } as const;
const UNDERLINE_SHARE = 0.6;
/** The toggle: each segment this wide, the sliding thumb inset by the pill's padding. */
const SEGMENT = 108;
const TOGGLE_PAD = 3;
const TOGGLE_HEIGHT = 32;

/**
 * Whether the bar is drawn for the Reels video: white text and icons with a soft shadow, and touches between them going
 * through to the video. A tiny store rather than a prop: Home's scroll listener flips it the moment the pager crosses the
 * halfway point between Posts and Reels (a swipe or a label tap's scroll), and only the bar, the status bar and the
 * floating "New post" pill re-render, never Home and its pages.
 */
export type OverVideoStore = { get: () => boolean; set: (next: boolean) => void; subscribe: (listener: () => void) => () => void };

export function createOverVideoStore(initial: boolean): OverVideoStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The current value of an OverVideoStore; re-renders the caller when it flips. */
export function useOverVideo(store: OverVideoStore): boolean {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * How solid the bar's background is on each page: fully on Orbit's card feed and on Buzz, gone only over full-screen
 * video (Reels, which has no tab in the app). Orbit had it gone too while it was the full-screen feed (2026-11-21 to
 * 2026-11-24).
 */
const SOLID = APP_HOME_TABS.map((s) => (s.value === "reels" ? 0 : 1));
/** The Following choice opens the Posts page, so it is offered only while Posts has a tab (it has none: see HIDDEN_HOME_SECTIONS). */
const POSTS_SHOWN = APP_HOME_TABS.some((s) => s.value === "posts");

/** One choice of the Campus | Global toggle (and Following, while Posts has a tab). */
export type ScopeSegment = { key: "mine" | "all" | "following"; label: string; icon: keyof typeof Ionicons.glyphMap; hint: string };
type Segment = ScopeSegment;

/**
 * The choices every feed offers: the person's own campus (named after the university for screen readers), when they have
 * one, and every campus. Home's bar adds Following to these while Posts has a tab; the Reels viewer shows just these.
 * One choice alone (no university) is nothing to choose: callers draw no toggle then.
 */
export function campusSegments(profile: { university_id: string | null; university?: { name: string } | null } | null | undefined): ScopeSegment[] {
  const segments: ScopeSegment[] = [];
  if (profile?.university_id) segments.push({ key: "mine", label: "Campus", icon: "school-outline", hint: profile.university?.name ?? "Your university" });
  segments.push({ key: "all", label: "Global", icon: "globe-outline", hint: "Every university" });
  return segments;
}

/**
 * Floating top bar of Home, the owner's sketch (2026-11-21): one row, the Home tabs along its left — Orbit | Buzz,
 * side by side with X's sliding underline (violet, as wide as the label), Buzz's lime mask hung just before its
 * label while Buzz is near — and at its right the three icons of HeaderActions: the compass (Explore: housing,
 * roommates and the marketplace, a screen of its own since Events took its place in the bottom bar), the Notifications
 * bell (its badge counts the unread) and the magnifier (the search screen: people, topics, posts and what is popular).
 * Your photo and its menu are not here: Profile is the last tab of the bottom bar, and it carries the same menu
 * (Settings and privacy, Saved, the legal pages, Log out). Creating starts from Create in the middle of the bottom bar.
 * No line under the bar: it is the screen's own colour, so the tabs and the page under them read as one surface. While
 * it is shown (SCOPE_TOGGLE_SHOWN), a second row holds the Campus | Global toggle, a small segmented pill whose thumb
 * slides to the choice (see useHomeScope: it scopes Orbit, Buzz, Posts and Reels alike; Campus is the person's own
 * university, Global every university). Someone without a university has nothing to choose, so that row is not drawn for
 * them.
 *
 * `scrollX` is the pager's offset in points and `pageWidth` the width of one page: the underline slides, the labels
 * crossfade (see SlidingTabs) and the bar's solid background (colors.bar) would fade out towards a full-screen video page
 * with the finger (SOLID; there is none today), all on the native driver. `overVideo` says when the labels and the icons
 * turn white and glassy over such a page: Home flips it halfway between it and the page beside it. `section` is the
 * section committed once the pager settles: what screen readers hear as selected follows it. `translateY` slides the
 * whole bar up out of the way as Orbit or Buzz scrolls down and back as soon as it scrolls up, Instagram style (see
 * useCollapsingHeader). Memoized: Home mounting a page ahead of time leaves it alone.
 */
export const HomeTopTabs = memo(function HomeTopTabs({ section, onSelect, overVideo: overVideoStore, onPosts: onPostsStore, onLayout, scrollX, pageWidth, translateY, hidden = false }: { section: AppHomeSection; onSelect: (s: AppHomeSection) => void; overVideo: OverVideoStore; onPosts: OverVideoStore; onLayout: (e: LayoutChangeEvent) => void; scrollX: Animated.Value; pageWidth: number; translateY: Animated.AnimatedInterpolation<number>; /** Orbit's post on screen is clear (a pinch: TikTok's clear mode): the whole bar fades away and takes no touches. */ hidden?: boolean }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { user, profile } = useSession();
  const [scope, setScope] = useHomeScope();
  const colors = useColors();
  const styles = useStyles();
  const overVideo = useOverVideo(overVideoStore);
  // A clear post on Orbit: the bar fades away with everything else over it, and back.
  const fade = useRef(new Animated.Value(hidden ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: hidden ? 0 : 1, duration: hidden ? 160 : 220, useNativeDriver: true }).start();
  }, [hidden, fade]);
  // Whether the page under the finger is Posts: flipped halfway, like overVideo, so the title and the toggle follow the swipe, not the settle.
  const onPosts = useOverVideo(onPostsStore);
  // Page i (offset i * pageWidth) shows SOLID[i]; in between the background follows the finger. Only once pageWidth > 0
  // (strictly increasing input range); until then it simply matches `overVideo`.
  const solid = useMemo(() => (pageWidth > 0 ? scrollX.interpolate({ inputRange: SOLID.map((_, i) => i * pageWidth), outputRange: SOLID, extrapolate: "clamp" }) : null), [pageWidth, scrollX]);
  // Near Buzz the bar is Phosphor (see useBuzzBar): light words, a lime underline, no photo of you at rest.
  const buzzBar = useBuzzBar(scrollX, pageWidth, section);
  /**
   * Nothing opaque stays under the status bar: once the bar slides away the feed runs on to the screen's top edge, under
   * the clock, as Reddit's does, clearly visible. Only a faint tint of the bar's colour (statusShade) stays behind the
   * status bar's icons, and only while something is under them: it fades in as the bar's own background leaves the status
   * bar (`away`, 0 to 1 over the last status-bar height of its slide), in the theme's colour, Buzz's near Buzz, and not at
   * all over Reels' video (`solid`).
   */
  const [barHeight, setBarHeight] = useState(insets.top + HOME_TOP_BAR_HEIGHT);
  const measure = (e: LayoutChangeEvent) => {
    onLayout(e);
    const h = e.nativeEvent.layout.height;
    setBarHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
  };
  const away = useMemo(() => {
    const status = Math.max(insets.top, 1);
    const height = Math.max(barHeight, status + 1);
    return translateY.interpolate({ inputRange: [-height, status - height, 0], outputRange: [1, 0, 0], extrapolate: "clamp" });
  }, [translateY, barHeight, insets.top]);
  const shadeOpacity = useMemo(() => {
    const look = solid ?? new Animated.Value(overVideo ? 0 : 1);
    // Near Buzz its own shade takes over (BuzzStatusShade): the two never mix to grey.
    const plain = buzzBar.layer ? Animated.subtract(1, buzzBar.layer) : 1;
    return Animated.multiply(Animated.multiply(away, look), plain);
  }, [away, solid, overVideo, buzzBar.layer]);
  const onBuzz = buzzBar.near && !overVideo;
  const fg = overVideo ? colors.onMedia : onBuzz ? phosphor.ink : colors.text;
  const dim = overVideo ? colors.onMediaMuted : onBuzz ? phosphor.ink3 : colors.muted;
  const ink = overVideo ? colors.onMedia : onBuzz ? phosphor.accent : colors.accent;
  // Signed out there is nobody you follow: the Posts page drops the filter too (see PostsSection).
  const following = Boolean(user) && scope.following;
  // Only Posts can filter by follows, and it has no page here: on every other section the toggle shows the campus the
  // page is really showing.
  const followingShown = following && onPosts;

  // The person's own campus (by its name for screen readers), every campus, and the people they follow while Posts has a tab.
  const segments: Segment[] = campusSegments(profile);
  if (user && POSTS_SHOWN) segments.push({ key: "following", label: "Following", icon: "people-outline", hint: "Posts by the people you follow" });
  const chosen: Segment["key"] = followingShown ? "following" : profile?.university_id && scope.campus === "mine" ? "mine" : "all";

  function choose(key: Segment["key"]) {
    if (key === chosen) return;
    if (key === "following") {
      setScope({ following: true });
      // Only Posts can show the people you follow: picking it from another section goes there, silently like every section change.
      if (section !== "posts") return onSelect("posts");
    } else {
      setScope({ campus: key, following: false });
    }
    hapticTap();
  }

  return (
    <>
      <Animated.View onLayout={measure} pointerEvents={hidden ? "none" : overVideo ? "box-none" : "auto"} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"} style={[styles.bar, { paddingTop: Math.max(0, insets.top + TOP_GAP - Math.round(windowHeight * ROW_LIFT)), opacity: fade, transform: [{ translateY }] }]}>
        <Animated.View pointerEvents="none" style={[styles.solid, { opacity: solid ?? (overVideo ? 0 : 1) }]} />
        <BuzzBarLayer layer={buzzBar.layer} />
        <View style={styles.row}>
          {/* The tabs from the row's left edge; the icons at its right. */}
          <View style={styles.tabs}>
            <SlidingTabs
              sections={APP_HOME_TABS}
              section={section}
              onSelect={onSelect}
              scrollX={scrollX}
              pageWidth={pageWidth}
              tint={ink}
              tintGradient={overVideo || onBuzz ? undefined : auroraGradient(colors.auroraGlow, 90)}
              labelColor={fg}
              dimColor={dim}
              textStyle={overVideo ? styles.shadow : undefined}
              align="start"
              fontSize={LABEL_SIZE}
              weights={LABEL_WEIGHTS}
              underlineShare={UNDERLINE_SHARE}
              leading={{ buzz: <BuzzTabMask layer={buzzBar.layer} fontSize={LABEL_SIZE} /> }}
            />
          </View>
          <View style={styles.actions}>
            <HeaderActions explore weight="bold" color={fg} iconStyle={overVideo ? styles.shadow : undefined} />
          </View>
        </View>
        {/* Temporarily hidden everywhere (SCOPE_TOGGLE_SHOWN): the bar is then its one row, as it is for anyone with
            no university to choose. */}
        {SCOPE_TOGGLE_SHOWN && segments.length > 1 ? (
          <View style={styles.toggleRow}>
            <ScopeToggle segments={segments} value={chosen} onChange={choose} overVideo={overVideo} shadow={overVideo ? styles.shadow : undefined} />
          </View>
        ) : null}
      </Animated.View>
      {/* Behind the status bar, only a faint tint (see `away`): the feed passes under the clock, to the screen's top edge. */}
      <Animated.View pointerEvents="none" style={[styles.statusShade, { height: insets.top, opacity: shadeOpacity }]} />
      <BuzzStatusShade layer={buzzBar.layer} away={away} height={insets.top} />
    </>
  );
});

/**
 * The segmented pill: a thumb that slides on a soft spring to the chosen segment, each segment an icon and a word. Over
 * the Reels video (Home's bar over Reels, the Reels viewer) it goes white and glassy like the rest of the bar. Screen
 * readers hear it as a group of radio buttons, the campus one named after the university.
 */
export function ScopeToggle({ segments, value, onChange, overVideo, shadow }: { segments: Segment[]; value: Segment["key"]; onChange: (key: Segment["key"]) => void; overVideo: boolean; shadow: StyleProp<TextStyle> }) {
  const styles = useStyles();
  const colors = useColors();
  const index = Math.max(0, segments.findIndex((s) => s.key === value));
  const x = useRef(new Animated.Value(index * SEGMENT)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: index * SEGMENT, useNativeDriver: true, damping: 20, stiffness: 220, mass: 0.8 }).start();
  }, [index, x]);
  const on = overVideo ? colors.onMedia : colors.text;
  const off = overVideo ? colors.onMediaMuted : colors.muted;
  return (
    <View style={[styles.toggle, overVideo && styles.toggleOverVideo]} accessibilityRole="radiogroup" accessibilityLabel="Whose posts to show">
      {/* Over video the pill is clear Liquid Glass on a dark dimming layer, in both themes, so its white words always read. */}
      {overVideo ? <GlassBackdrop variant="media" radius={TOGGLE_HEIGHT / 2} /> : null}
      <Animated.View pointerEvents="none" style={[styles.thumb, overVideo && styles.thumbOverVideo, { transform: [{ translateX: x }] }]} />
      {segments.map((s) => {
        const active = s.key === value;
        return (
          <Pressable key={s.key} onPress={() => onChange(s.key)} accessibilityRole="radio" accessibilityLabel={s.label} accessibilityHint={s.hint} accessibilityState={{ checked: active }} hitSlop={{ top: 6, bottom: 6 }} style={styles.segment}>
            <Icon name={s.icon} size={14} color={active ? on : off} style={shadow} />
            <Text style={[styles.segmentText, { color: active ? on : off }, active && styles.segmentTextOn, shadow]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors, scheme) => ({
  // The bar itself is see-through; its transparent hairline keeps the height the same as when the solid look was drawn on it.
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent" },
  // The solid look behind the rows, safe area included, down over the bar's (transparent) bottom edge: no divider under
  // the tabs, the bar and the stories under it are one surface. Faded by the pager (see `solid`).
  solid: { position: "absolute", top: 0, left: 0, right: 0, bottom: -StyleSheet.hairlineWidth, backgroundColor: colors.bar },
  statusShade: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 11, experimental_backgroundImage: statusShade(colors.bar) },
  row: { height: ROW, flexDirection: "row", alignItems: "stretch", paddingLeft: SIDE_PAD - TABS_LEAD, paddingRight: SIDE_PAD - (SIDE - HEADER_ACTION_SIZE) / 2 },
  // The labels take the room the icons leave; a row too narrow for them closes their gaps up (see SlidingTabs).
  tabs: { flex: 1, alignSelf: "stretch", flexDirection: "row" },
  actions: { width: ACTIONS_SLOT, alignItems: "flex-end", justifyContent: "center" },
  // Under the white words and icons over the full-screen feed: dark and soft enough to hold them on a bright frame.
  shadow: { textShadowColor: colors.mediaTextShadow, textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  // The toggle sits centred in its row, just under the labels.
  toggleRow: { height: TOGGLE_ROW, alignItems: "center", justifyContent: "center" },
  // The pill on the input fill; over video a glass fill instead. The thumb is a card with a whisper of shadow in light.
  toggle: { flexDirection: "row", padding: TOGGLE_PAD, borderRadius: radius.pill, backgroundColor: colors.input },
  toggleOverVideo: { backgroundColor: "transparent", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.mediaControlEdge },
  thumb: { position: "absolute", top: TOGGLE_PAD, bottom: TOGGLE_PAD, left: TOGGLE_PAD, width: SEGMENT, borderRadius: radius.pill, backgroundColor: colors.card, shadowColor: colors.shadow, shadowOpacity: scheme === "dark" ? 0 : 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: scheme === "dark" ? 0 : 2 },
  thumbOverVideo: { backgroundColor: colors.mediaControlActive, shadowOpacity: 0, elevation: 0 },
  segment: { width: SEGMENT, height: TOGGLE_HEIGHT - 2 * TOGGLE_PAD, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  segmentText: { fontSize: 13, fontWeight: "600" },
  segmentTextOn: { fontWeight: "700" },
}));
