import { memo, useCallback, useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { STORY_RING, STORY_RING_GAP, type StoryGroup } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { AnimatedPressable, usePressScale } from "@/components/ui";
import { hapticTap } from "@/lib/haptics";
import { handStories } from "@/lib/stories-store";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useCreateMenu } from "./create-menu";

/** The photo in each ring, TikTok's size (its Following page, the owner's screenshots, 2026-11-22). */
const AVATAR = 72;
const RING = AVATAR + 2 * (STORY_RING + STORY_RING_GAP);
/** Each person's place in the row: the ring with a little room either side; with the gap, about 98 points apart. */
const ITEM = RING + 8;
const ITEM_GAP = 8;
/** Under the tabs: a gap, the rings, their names, and a gap above the post. */
const ROW_TOP = 10;
const NAME_GAP = 6;
const NAME_LINE = 17;
const ROW_BOTTOM = 14;
/**
 * How much room the open row takes under Home's tabs: the post on screen sits this much lower while it is open
 * (orbit-section.tsx), and rises into it as the row closes.
 */
export const STORIES_ROW_HEIGHT = ROW_TOP + RING + NAME_GAP + NAME_LINE + ROW_BOTTOM;
/** The pill sits this far under Home's tabs. */
const PILL_TOP = 12;

/** Who is looking: their photo and name for "Your story". */
type Me = { full_name: string; avatar_url: string | null } | null;

/** How many stories this person has not seen yet (their own never count). */
export function unseenStories(groups: readonly StoryGroup[]): number {
  return groups.reduce((n, g) => n + (g.mine ? 0 : g.stories.filter((s) => !s.seen).length), 0);
}

/**
 * What the pill says, from the stories themselves, never a made-up number: "20 New Stories" while some of other
 * people's are unseen, TikTok's wording; otherwise how many there are, yours included ("1 Story" for one of your own);
 * with none at all, just "Stories". There is always a pill, so the row (with "Your story" and its "+") is one tap away
 * from any post (the owner's report, 2026-11-22: with only their own story the pill used to be missing).
 */
export function storiesPillText(groups: readonly StoryGroup[]): string {
  const unseen = unseenStories(groups);
  if (unseen > 0) return `${unseen} New ${unseen === 1 ? "Story" : "Stories"}`;
  const all = groups.reduce((n, g) => n + g.stories.length, 0);
  return all > 0 ? `${all} ${all === 1 ? "Story" : "Stories"}` : "Stories";
}

/** Opens a person's stories full screen (app/stories/[id].tsx), handing it the row's list so it goes on through the rest. */
function useOpenStories() {
  const router = useRouter();
  return useCallback(
    (list: StoryGroup[], group: StoryGroup) => {
      const index = list.indexOf(group);
      handStories(list, index < 0 ? 0 : index);
      router.push({ pathname: "/stories/[id]", params: { id: group.author.id } });
    },
    [router],
  );
}

/**
 * The stories at the top of Orbit, TikTok's Following page (the owner's screen recording, 2026-11-22): a row of rings
 * on black between Home's tabs and the post, which sits under it as a card, and, once the row has folded away, a small
 * see-through pill under the tabs, "20 New Stories ▾". Both follow `open` (1 open, 0 folded; Orbit owns it and moves
 * the feed with it on the UI thread): the row slides up under the tabs and fades as it folds, the pill fades in, and
 * the other way as it opens. A tap on the pill asks Orbit to open the row (`onOpenRow`) over whichever post is on
 * screen. `rowShown` says which of the two takes touches and VoiceOver. A ring opens that person's stories full screen,
 * going on through the rest; "Your story" opens yours, or the camera when you have none, and its "+" always the camera.
 */
export function StoriesHeader({ topInset, open, rowShown, onOpenRow, groups, me }: { topInset: number; open: Readonly<SharedValue<number>>; rowShown: boolean; onOpenRow: () => void; groups: StoryGroup[]; me: Me }) {
  const styles = useStyles();
  const create = useCreateMenu();
  const openStories = useOpenStories();
  const text = storiesPillText(groups);
  // The row rides up under the tabs (clipped there, so it never crosses the labels), fading as it goes. It leads the
  // motion a little (an ease-out of `open`), so a pull down shows it from the first points rather than at the end.
  const rowStyle = useAnimatedStyle(() => {
    const lead = 1 - (1 - open.value) * (1 - open.value);
    return {
      opacity: interpolate(lead, [0.15, 0.85], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: (lead - 1) * STORIES_ROW_HEIGHT }],
    };
  });
  // The pill is gone soon after the row starts to come, drifting down a touch as it goes, as if the row took its place.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(open.value, [0, 0.3], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: Math.min(1, open.value / 0.3) * 10 }],
  }));
  return (
    <>
      <View style={[styles.rowClip, { top: topInset }]} pointerEvents={rowShown ? "box-none" : "none"} accessibilityElementsHidden={!rowShown} importantForAccessibility={rowShown ? "auto" : "no-hide-descendants"}>
        <Reanimated.View style={[styles.rowInner, rowStyle]}>
          <StoriesRingRow groups={groups} me={me} onOpen={openStories} onCreate={() => create()} />
        </Reanimated.View>
      </View>
      <Reanimated.View style={[styles.pillSpot, { top: topInset + PILL_TOP }, pillStyle]} pointerEvents={rowShown ? "none" : "box-none"}>
        <StoriesPill text={text} hidden={rowShown} onPress={onOpenRow} />
      </Reanimated.View>
    </>
  );
}

/** A ring or the pill: held, it sinks a little and dims on a quick spring, as every control in the app does (usePressScale). */
function Sink({ style, to = 0.94, children, ...props }: Omit<PressableProps, "style" | "children"> & { style?: StyleProp<ViewStyle>; to?: number; children: ReactNode }) {
  const press = usePressScale(to, 0.85);
  return (
    <AnimatedPressable {...props} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[style, { opacity: press.opacity, transform: [{ scale: press.scale }] }]}>
      {children}
    </AnimatedPressable>
  );
}

/**
 * The row itself: "Your story" first with its "+", then everyone whose stories this person may see, the unseen in the
 * aurora ring and the rest in a quiet grey one, a first name under each, scrolling sideways. White on black.
 */
export const StoriesRingRow = memo(function StoriesRingRow({ groups, me, onOpen, onCreate }: { groups: StoryGroup[]; me: Me; onOpen: (list: StoryGroup[], group: StoryGroup) => void; onCreate: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const mine = useMemo(() => groups.find((g) => g.mine) ?? null, [groups]);
  const others = useMemo(() => groups.filter((g) => !g.mine), [groups]);
  const list = useMemo(() => (mine ? [mine, ...others] : others), [mine, others]);
  const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
  const lit = { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="list" accessibilityLabel="Stories">
      <Sink
        onPress={() => (mine ? onOpen(list, mine) : onCreate())}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel={mine ? `Your story, ${mine.stories.length} ${mine.stories.length === 1 ? "story" : "stories"}` : "Your story"}
        accessibilityHint={mine ? "Opens your stories" : "Share a photo or video that disappears after 24 hours"}
      >
        <View style={[styles.ring, mine ? lit : styles.ringNone]}>
          <View style={styles.ringGap}>
            <Avatar name={me?.full_name} url={me?.avatar_url ?? null} size={AVATAR} online={false} />
          </View>
          {/* The "+" to share: on its own once you have stories (a tap on the photo opens them), on the whole ring otherwise. */}
          <Pressable onPress={onCreate} hitSlop={6} accessibilityRole="button" accessibilityLabel="Add to your story" style={styles.plus}>
            <Icon name="add" size={17} color="#fff" weight="bold" />
          </Pressable>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          Your story
        </Text>
      </Sink>
      {others.map((g) => (
        <Sink
          key={g.author.id}
          onPress={() => {
            hapticTap();
            onOpen(list, g);
          }}
          style={styles.item}
          accessibilityRole="button"
          accessibilityLabel={`${g.author.full_name}'s story${g.seen ? ", seen" : ""}`}
        >
          <View style={[styles.ring, g.seen ? styles.ringSeen : lit]}>
            <View style={styles.ringGap}>
              <Avatar name={g.author.full_name} url={g.author.avatar_url} size={AVATAR} online={false} />
            </View>
          </View>
          <Text style={[styles.name, g.seen && styles.nameSeen]} numberOfLines={1}>
            {firstName(g.author.full_name)}
          </Text>
        </Sink>
      ))}
    </ScrollView>
  );
});

/**
 * The pill in the row's place, TikTok's quiet one (the owner's brief, 2026-11-22): "25 Stories" in soft white and a
 * small, dim down arrow on a lightly see-through dark fill with no edge at all, so it sits in the video rather than on
 * it. Its tap is a native tap gesture rather than a press, and opens the row the moment the finger lifts: a press can be
 * taken away by the feed while it is still settling after a swipe (the first tap after a swipe was lost that way, seen
 * in the Simulator), a tap gesture cannot. It sinks a touch while the finger is on it. VoiceOver opens it through its
 * own activation (onAccessibilityTap).
 */
export function StoriesPill({ text, hidden = false, onPress }: { text: string; hidden?: boolean; onPress: () => void }) {
  const styles = useStyles();
  const sink = useSharedValue(1);
  const fire = useCallback(() => {
    hapticTap();
    onPress();
  }, [onPress]);
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(24)
        .hitSlop({ top: 12, bottom: 12, left: 16, right: 16 })
        .onBegin(() => {
          sink.value = withTiming(PILL_SINK, { duration: 90, easing: Easing.out(Easing.quad) });
        })
        .onFinalize((_e, ok) => {
          sink.value = withSpring(1, { damping: 18, stiffness: 320, mass: 0.6 });
          if (ok) runOnJS(fire)();
        }),
    [sink, fire],
  );
  const sinkStyle = useAnimatedStyle(() => ({ transform: [{ scale: sink.value }], opacity: 0.85 + 0.15 * ((sink.value - PILL_SINK) / (1 - PILL_SINK)) }));
  return (
    <GestureDetector gesture={tap}>
      <Reanimated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint="Shows the row of stories"
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
        onAccessibilityTap={fire}
        style={[styles.pill, sinkStyle]}
      >
        <Text style={styles.pillText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {text}
        </Text>
        <Icon name="caret-down" sf="arrowtriangle.down.fill" size={6} color={PILL_ARROW} />
      </Reanimated.View>
    </GestureDetector>
  );
}

const shadow = { textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } } as const;
/** The pill's words and arrow: white, a little see-through, so they read without standing out. */
const PILL_TEXT = "rgba(255,255,255,0.8)";
const PILL_ARROW = "rgba(255,255,255,0.62)";
/** How far the pill sinks while a finger is on it. */
const PILL_SINK = 0.94;

const useStyles = makeStyles((colors) => ({
  // The open row's room under the tabs: it clips the row as it rides up, so the rings never pass over the labels.
  rowClip: { position: "absolute", left: 0, right: 0, height: STORIES_ROW_HEIGHT, overflow: "hidden" },
  rowInner: { paddingTop: ROW_TOP },
  row: { paddingHorizontal: 12, gap: ITEM_GAP, alignItems: "flex-start" },
  item: { width: ITEM, alignItems: "center", gap: NAME_GAP },
  ring: { width: RING, height: RING, borderRadius: RING / 2, alignItems: "center", justifyContent: "center" },
  ringSeen: { backgroundColor: "rgba(255,255,255,0.45)" },
  ringNone: { backgroundColor: "rgba(255,255,255,0.3)" },
  ringGap: { width: RING - 2 * STORY_RING, height: RING - 2 * STORY_RING, borderRadius: (RING - 2 * STORY_RING) / 2, backgroundColor: colors.mediaBg, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  plus: { position: "absolute", right: 0, bottom: 2, width: 25, height: 25, borderRadius: 12.5, borderWidth: 2.5, borderColor: colors.mediaBg, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 13, lineHeight: NAME_LINE, fontWeight: "600", color: colors.onMedia, maxWidth: ITEM, textAlign: "center", ...shadow },
  nameSeen: { color: colors.onMediaMuted, fontWeight: "500" },
  // TikTok's: small and centred under the tabs, a lightly see-through dark fill (a shade darker than the picture under
  // it) and no edge at all (2026-11-22): over black only its words show.
  pillSpot: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, height: 23, paddingHorizontal: 10, borderRadius: 11.5, borderCurve: "continuous", backgroundColor: "rgba(0,0,0,0.2)" },
  pillText: { color: PILL_TEXT, fontSize: 13, fontWeight: "600", letterSpacing: 0.1, textShadowColor: "rgba(0,0,0,0.25)", textShadowRadius: 3, textShadowOffset: { width: 0, height: 0.5 } },
}));
