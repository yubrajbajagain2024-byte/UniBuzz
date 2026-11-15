import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import type { VideoPlayer } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { GlassBackdrop } from "@/components/glass";
import { Icon } from "@/components/icon";
import { hapticSelect } from "@/lib/haptics";
import { wantTimeUpdates } from "@/lib/video-ticks";
import { makeStyles, useColors } from "@/lib/theme-provider";

/**
 * Hold to speed up, Instagram's way: every video plays at 1× and runs at BOOST_RATE only while a finger is held on it,
 * back to 1× the moment it lifts (or the touch is taken by a scroll). A touch counts as a hold after HOLD_MS, a little
 * quicker than the system's long press, so it is felt as "press and keep pressing" rather than as a menu.
 */
export const BOOST_RATE = 2;
export const HOLD_MS = 220;

/** 125 → "2:05", 3725 → "1:02:05". */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** How often a timeline asks its player where it is (seconds). The line glides between the answers, never steps. */
const TICK = 0.25;
/** The line's thickness at rest and while a finger scrubs it (it swells under the finger, as iOS's player's does). */
const TRACK = 3;
const TRACK_SCRUB = 8;
/** The band a finger can grab the line in: taller than the line, so it is easy to hit without aiming. */
export const TIMELINE_TOUCH = 30;
/** Under the line in the "always" look: the elapsed and remaining times. */
const LABELS_ROW = 16;
const GROW = { damping: 22, stiffness: 340, mass: 0.7 };
/**
 * Scrubbing seeks at most this often (each seek replaces the one before, so the picture follows the finger), and loosely
 * while the finger moves: the nearest keyframe within SCRUB_TOLERANCE comes up at once. The final seek, as the finger
 * lifts, lands exactly.
 */
const SEEK_EVERY_MS = 50;
const SCRUB_TOLERANCE = { toleranceBefore: 0.3, toleranceAfter: 0.3 };
const EXACT = { toleranceBefore: 0, toleranceAfter: 0 };
/** Small words in rows of a fixed height grow with the text size only this far, so they never clip. */
const LABEL_SCALE = 1.4;
const BIG_LABEL_SCALE = 1.3;
/** VoiceOver's swipe up or down on the timeline: this many seconds on or back. */
const ACCESSIBLE_STEP = 5;
const ADJUST = [{ name: "increment" }, { name: "decrement" }] as const;

/** Sets a player option that an older build may not carry; nothing is lost without it but a little scrubbing speed. */
function tryOn(apply: () => void) {
  try {
    apply();
  } catch {
    // An option this build's player does not have.
  }
}

/**
 * A video's timeline: a thin line along the bottom of the picture showing how far it has played, which a finger drags
 * to fast-forward or rewind (scrubbing) and taps to jump. It follows the player on its own (four reports a second, the
 * line gliding between them on the UI thread, so it moves smoothly without re-rendering anything), and while it is
 * dragged the line swells, the video holds still on the frame under the finger and the time shows. `onScrubStart` and
 * `onScrubEnd` let the screen pause around the drag (iOS scrubs best paused) and hide what would be in the way;
 * `scrubbing` is set on the UI thread for the gestures around it (a page's sideways swipe) to stand down at once. The
 * look: "scrub" shows the time over the line only while it is dragged (Reels, posts); "always" keeps the elapsed and the
 * remaining time under it (the chat's viewer, as Photos does). VoiceOver hears it as adjustable: up and down skip
 * ACCESSIBLE_STEP seconds.
 */
export function VideoTimeline({
  player,
  duration: recorded,
  labels = "scrub",
  inset = 16,
  style,
  onScrubStart,
  onScrubEnd,
  scrubbing: scrubbingOut,
}: {
  player: VideoPlayer;
  /** The length the upload recorded, until the player knows its own. */
  duration?: number | null;
  labels?: "scrub" | "always";
  /** The line's inset from the view's sides. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  scrubbing?: SharedValue<number>;
}) {
  const styles = useStyles();
  const always = labels === "always";
  /** How far it has played (0 to 1), the swell (0 at rest, 1 under a finger), the line's width in points. */
  const progress = useSharedValue(0);
  const grow = useSharedValue(0);
  const lineWidth = useSharedValue(0);
  const dragging = useSharedValue(0);
  const [length, setLength] = useState(() => (player.duration > 0 ? player.duration : (recorded ?? 0)));
  /** The time shown in words: for "always" as it plays, for both while scrubbing. */
  const [now, setNow] = useState(0);
  const lengthRef = useRef(length);
  lengthRef.current = length;
  const scrubRef = useRef(false);
  // The screen's callbacks, read when they are needed: a new one each render must not rebuild the gesture mid-drag.
  const onStartRef = useRef(onScrubStart);
  onStartRef.current = onScrubStart;
  const onEndRef = useRef(onScrubEnd);
  onEndRef.current = onScrubEnd;
  /** Where the line was last put from a report, to tell a loop back to the start from the next report. */
  const lastAt = useRef(0);

  useEffect(() => {
    const letGo = wantTimeUpdates(player, TICK);
    const durationNow = () => (player.duration > 0 ? player.duration : (recorded ?? 0));
    const place = (time: number, playing: boolean) => {
      const d = durationNow();
      if (!(d > 0)) return;
      if (Math.abs(d - lengthRef.current) > 0.05) setLength(d);
      if (scrubRef.current) return;
      const at = Math.min(1, Math.max(0, time / d));
      if (playing) {
        // Aimed two reports ahead over two reports' time, so the line is always on its way to the next one and never
        // stops to wait: each report re-aims it from where it is. A loop back to the start goes straight there first.
        if (at < lastAt.current - 0.02) {
          cancelAnimation(progress);
          progress.value = at;
        }
        const ahead = Math.min(1, (time + 2 * TICK * (player.playbackRate || 1)) / d);
        progress.value = withTiming(ahead, { duration: 2 * TICK * 1000, easing: Easing.linear });
      } else {
        cancelAnimation(progress);
        progress.value = at;
      }
      lastAt.current = at;
      if (always) setNow(time);
    };
    place(player.currentTime, player.playing);
    const subs = [
      player.addListener("timeUpdate", ({ currentTime }) => place(currentTime, player.playing)),
      // A pause stops the line exactly where the video stopped; playing again sets it going.
      player.addListener("playingChange", ({ isPlaying }) => place(player.currentTime, isPlaying)),
      player.addListener("sourceLoad", ({ duration }) => {
        if (duration > 0) setLength(duration);
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      // A player handed back to the feed reports as often as it did before.
      letGo();
    };
  }, [player, recorded, always, progress]);

  const lastSeek = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTrailing = () => {
    if (trailing.current) clearTimeout(trailing.current);
    trailing.current = null;
  };
  useEffect(() => clearTrailing, []);

  const seek = useCallback(
    (fraction: number) => {
      const d = lengthRef.current;
      if (!(d > 0)) return;
      setNow(fraction * d);
      const go = () => {
        lastSeek.current = Date.now();
        tryOn(() => {
          player.currentTime = fraction * d;
        });
      };
      clearTrailing();
      const wait = SEEK_EVERY_MS - (Date.now() - lastSeek.current);
      if (wait <= 0) go();
      else trailing.current = setTimeout(go, wait);
    },
    [player],
  );

  const begin = useCallback(
    (fraction: number) => {
      scrubRef.current = true;
      hapticSelect();
      tryOn(() => {
        player.scrubbingModeOptions = { scrubbingModeEnabled: true };
      });
      tryOn(() => {
        player.seekTolerance = SCRUB_TOLERANCE;
      });
      onStartRef.current?.();
      seek(fraction);
    },
    [player, seek],
  );

  const end = useCallback(
    (fraction: number) => {
      clearTrailing();
      const d = lengthRef.current;
      tryOn(() => {
        player.seekTolerance = EXACT;
      });
      if (d > 0) {
        setNow(fraction * d);
        tryOn(() => {
          player.currentTime = fraction * d;
        });
      }
      tryOn(() => {
        player.scrubbingModeOptions = { scrubbingModeEnabled: false };
      });
      lastAt.current = fraction;
      scrubRef.current = false;
      onEndRef.current?.();
    },
    [player],
  );

  /** A tap on the line: straight to that moment, exactly. */
  const jump = useCallback(
    (fraction: number) => {
      const d = lengthRef.current;
      if (!(d > 0)) return;
      hapticSelect();
      lastAt.current = fraction;
      setNow(fraction * d);
      tryOn(() => {
        player.currentTime = fraction * d;
      });
    },
    [player],
  );

  const gesture = useMemo(() => {
    const fractionAt = (x: number) => {
      "worklet";
      const w = lineWidth.value;
      return w > 0 ? Math.min(1, Math.max(0, (x - inset) / w)) : 0;
    };
    // Sideways only: a swipe up or down that starts on the line is still the feed's next or previous page.
    const pan = Gesture.Pan()
      .activeOffsetX([-4, 4])
      .failOffsetY([-16, 16])
      .onStart((e) => {
        dragging.value = 1;
        if (scrubbingOut) scrubbingOut.value = 1;
        grow.value = withSpring(1, GROW);
        cancelAnimation(progress);
        progress.value = fractionAt(e.x);
        runOnJS(begin)(progress.value);
      })
      .onUpdate((e) => {
        const f = fractionAt(e.x);
        progress.value = f;
        runOnJS(seek)(f);
      })
      .onFinalize(() => {
        if (dragging.value !== 1) return;
        dragging.value = 0;
        if (scrubbingOut) scrubbingOut.value = 0;
        grow.value = withSpring(0, GROW);
        runOnJS(end)(progress.value);
      });
    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((e, success) => {
        if (!success) return;
        const f = fractionAt(e.x);
        cancelAnimation(progress);
        progress.value = f;
        runOnJS(jump)(f);
      });
    return Gesture.Race(pan, tap);
  }, [inset, lineWidth, dragging, scrubbingOut, grow, progress, begin, seek, end, jump]);

  const lineStyle = useAnimatedStyle(() => {
    const h = TRACK + (TRACK_SCRUB - TRACK) * grow.value;
    return { height: h, borderRadius: h / 2 };
  });
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * lineWidth.value }] }));
  const timeStyle = useAnimatedStyle(() => ({ opacity: grow.value, transform: [{ translateY: (1 - grow.value) * 6 }] }));

  function measured(e: LayoutChangeEvent) {
    lineWidth.value = Math.max(0, e.nativeEvent.layout.width);
  }

  const shownNow = Math.min(now, length || now);
  function step(seconds: number) {
    const d = lengthRef.current;
    if (!(d > 0)) return;
    const to = Math.min(d, Math.max(0, player.currentTime + seconds));
    jump(to / d);
    cancelAnimation(progress);
    progress.value = to / d;
  }

  return (
    <View
      style={[styles.box, { minHeight: TIMELINE_TOUCH + (always ? LABELS_ROW : 0) }, style]}
      pointerEvents="box-none"
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Video timeline"
      accessibilityValue={length > 0 ? { text: `${clock(shownNow)} of ${clock(length)}` } : undefined}
      accessibilityActions={ADJUST}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? ACCESSIBLE_STEP : -ACCESSIBLE_STEP)}
    >
      {!always ? (
        // Over the line while it is dragged: where the finger is, of how long, large enough to read at a glance.
        <Animated.View pointerEvents="none" style={[styles.scrubTime, timeStyle]}>
          <Text style={styles.scrubTimeText} maxFontSizeMultiplier={BIG_LABEL_SCALE}>
            {clock(shownNow)}
            <Text style={styles.scrubTimeTotal}> / {clock(length)}</Text>
          </Text>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <View style={[styles.touch, { paddingHorizontal: inset }]}>
          <View style={styles.lineShadow} onLayout={measured}>
            <Animated.View style={[styles.line, lineStyle]}>
              <Animated.View style={[StyleSheet.absoluteFill, styles.fill, fillStyle]} />
            </Animated.View>
          </View>
        </View>
      </GestureDetector>
      {always ? (
        <View pointerEvents="none" style={[styles.labels, { paddingHorizontal: inset }]}>
          <Text style={styles.label} maxFontSizeMultiplier={LABEL_SCALE}>
            {clock(shownNow)}
          </Text>
          <Text style={styles.label} maxFontSizeMultiplier={LABEL_SCALE}>
            {"\u2212"}
            {clock(Math.max(0, length - shownNow))}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The "2×" pill that shows while a video is held at double speed: clear glass on the picture, at the top in the middle,
 * springing in as the hold starts and fading as it lets go. Always mounted, so it never pops.
 */
export function SpeedBadge({ visible, style }: { visible: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const colors = useColors();
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = visible ? withSpring(1, { damping: 18, stiffness: 320, mass: 0.6 }) : withTiming(0, { duration: 160 });
    // VoiceOver hears it start (a double tap held down is VoiceOver's hold); nothing is said without a screen reader.
    if (visible) AccessibilityInfo.announceForAccessibility("Double speed");
  }, [visible, shown]);
  const badgeStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, shown.value), transform: [{ scale: 0.86 + 0.14 * shown.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.badge, badgeStyle, style]} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? "auto" : "no-hide-descendants"} accessibilityLabel="Playing at double speed">
      <GlassBackdrop variant="media" radius={BADGE / 2} />
      <Text style={styles.badgeText} maxFontSizeMultiplier={BIG_LABEL_SCALE}>
        {BOOST_RATE}×
      </Text>
      <Icon name="play-forward" sf="forward.fill" size={13} color={colors.onMedia} />
    </Animated.View>
  );
}

const BADGE = 32;

// Everything here sits on a photo or a video, so it uses the media colours, the same in both themes.
const useStyles = makeStyles((colors) => {
  const shadow = { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
  return {
    box: { justifyContent: "flex-start" },
    touch: { height: TIMELINE_TOUCH, justifyContent: "center" },
    // The line's soft shadow lives on a wrapper: the line itself clips its fill to its rounded ends.
    lineShadow: { height: TRACK_SCRUB, justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.3, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
    line: { width: "100%", overflow: "hidden", backgroundColor: "rgba(255,255,255,0.32)", borderCurve: "continuous" },
    fill: { backgroundColor: colors.onMedia },
    scrubTime: { position: "absolute", left: 0, right: 0, bottom: TIMELINE_TOUCH + 4, alignItems: "center" },
    scrubTimeText: { color: colors.onMedia, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: -0.3, ...shadow },
    scrubTimeTotal: { color: colors.onMediaMuted, fontWeight: "600" },
    labels: { minHeight: LABELS_ROW, flexDirection: "row", justifyContent: "space-between", marginTop: -6 },
    label: { color: colors.onMediaMuted, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], ...shadow },
    badge: { position: "absolute", alignSelf: "center", height: BADGE, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, borderRadius: BADGE / 2, borderCurve: "continuous", overflow: "hidden" },
    badgeText: { color: colors.onMedia, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  };
});
