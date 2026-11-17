import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, UIManager, View, type LayoutChangeEvent } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { MaskedView } from "@/components/masked-view";
import { useReduceMotion } from "@/lib/accessibility";
import { motion } from "@/lib/theme";

/**
 * A row of words under the camera, TikTok's CAMERA | CREATE | LIVE: the chosen one sits in the middle of the screen in
 * white, the others grey beside it, and choosing another glides the row across so it comes to the middle (no bounce,
 * no haptic: it is a switch of place, see no-navigation-haptics). Used for the capture lengths above the shutter
 * (`size="small"`). With `slide` false the row stays put in the middle and a dot glides under the choice instead.
 * `fade` (the camera's BUZZ | SNAP | POST | REEL, between the Upload and Drafts buttons) dissolves the words into the
 * row's ends, as the iPhone camera's modes run off its edges, so a word beyond the chosen one's neighbours fades out of
 * sight instead of being cut off at the buttons; `dot` keeps a dot under the choice in the middle.
 */
export function ModeSwitcher<T extends string>({ options, value, onChange, disabled, size = "large", pill = false, slide = true, fade = false, dot: showDot = !slide }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; disabled?: boolean; size?: "large" | "small"; pill?: boolean; slide?: boolean; fade?: boolean; dot?: boolean }) {
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const [spots, setSpots] = useState<Record<string, { x: number; w: number }>>({});
  const shift = useSharedValue(0);
  // The first placement is instant: the row appears with the choice already in the middle.
  const placed = useRef(false);
  const ready = width > 0 && options.every((o) => spots[o.value]);

  useEffect(() => {
    if (!ready) return;
    const spot = spots[value];
    // Sliding, the row moves so the choice is in the middle; still, the dot moves under the choice.
    const target = slide ? width / 2 - (spot.x + spot.w / 2) : spot.x + spot.w / 2 - DOT / 2;
    shift.value = reduce || !placed.current ? target : withSpring(target, motion.sheet);
    placed.current = true;
  }, [ready, spots, value, width, reduce, shift, slide]);

  const row = useAnimatedStyle(() => ({ transform: [{ translateX: slide ? shift.value : 0 }] }));
  const dot = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));
  const measure = (key: T) => (e: LayoutChangeEvent) => {
    const { x, width: w } = e.nativeEvent.layout;
    setSpots((s) => (s[key]?.x === x && s[key]?.w === w ? s : { ...s, [key]: { x, w } }));
  };

  const masked = fade && slide && CAN_MASK;
  const content = (
    <Animated.View style={[styles.row, size === "small" && styles.rowSmall, !slide && styles.rowStill, fade && styles.rowFade, row, { opacity: ready ? (disabled ? 0.45 : 1) : 0 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onLayout={measure(o.value)}
            onPress={() => onChange(o.value)}
            disabled={disabled}
            hitSlop={8}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={o.label}
            style={[size === "small" ? styles.itemSmall : styles.item, pill && on && styles.pillOn]}
          >
            <Faded on={fade && slide && ready && !masked} shift={shift} center={(spots[o.value]?.x ?? 0) + (spots[o.value]?.w ?? 0) / 2} half={width / 2}>
              <Text style={[size === "small" ? styles.labelSmall : styles.label, on ? (pill ? styles.labelPillOn : styles.labelOn) : null]}>{o.label}</Text>
            </Faded>
          </Pressable>
        );
      })}
      {showDot && !slide ? <Animated.View pointerEvents="none" style={[styles.dot, dot]} /> : null}
    </Animated.View>
  );
  return (
    <View style={styles.frame} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {masked ? (
        <MaskedView style={styles.masked} maskElement={<EdgeMask />}>
          {content}
        </MaskedView>
      ) : (
        content
      )}
      {/* Sliding, the choice always comes to the middle: its dot simply stays there. */}
      {showDot && slide && ready ? <View pointerEvents="none" style={[styles.dot, { left: width / 2 - DOT / 2 }]} /> : null}
    </View>
  );
}

/**
 * Whether this build has the masked view (Expo Go and every build since it was added do; an older build reading this
 * code over the air may not, and then each word dims as a whole instead, see Faded).
 */
const CAN_MASK = (() => {
  try {
    return Boolean(UIManager.hasViewManagerConfig?.("RNCMaskedView"));
  } catch {
    return false;
  }
})();
/** How far in from each end of a `fade` row the words dissolve, in points, and in how many steps. */
const EDGE = 34;
const EDGE_STEPS = 10;

/** The `fade` row's mask: opaque in the middle, thinning to nothing over EDGE at each end (solid steps, as ProgressiveBlur's). */
function EdgeMask() {
  const steps = Array.from({ length: EDGE_STEPS }, (_, i) => (i + 0.5) / EDGE_STEPS);
  return (
    <View style={styles.mask}>
      {steps.map((a, i) => (
        <View key={`l${i}`} style={[styles.maskStep, { opacity: a }]} />
      ))}
      <View style={styles.maskMiddle} />
      {steps.map((a, i) => (
        <View key={`r${i}`} style={[styles.maskStep, { opacity: 1 - a }]} />
      ))}
    </View>
  );
}

/** Without the mask: how far in from the row's ends a word starts to dim, and where it is gone (from its middle, in points). */
const FADE_FROM = 40;
const FADE_GONE = 4;

/**
 * One word of a `fade` row where there is no mask: whole near the middle, dimming to nothing as its middle comes within
 * FADE_FROM of either end, on the UI thread as the row glides. `center` is the word's middle in the row, `half` half
 * the row's width.
 */
function Faded({ on, shift, center, half, children }: { on: boolean; shift: SharedValue<number>; center: number; half: number; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    if (!on) return { opacity: 1 };
    const away = Math.abs(shift.value + center - half);
    return { opacity: interpolate(away, [half - FADE_FROM, half - FADE_GONE], [1, 0], Extrapolation.CLAMP) };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

const DOT = 5;

const shadow = { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

const styles = StyleSheet.create({
  frame: { alignSelf: "stretch", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 26 },
  rowStill: { alignSelf: "center", gap: 22 },
  rowFade: { gap: 22 },
  masked: { alignSelf: "stretch" },
  mask: { flex: 1, flexDirection: "row", backgroundColor: "transparent" },
  maskStep: { width: EDGE / EDGE_STEPS, backgroundColor: "#000" },
  maskMiddle: { flex: 1, backgroundColor: "#000" },
  dot: { position: "absolute", left: 0, bottom: 1, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: "#ffffff" },
  rowSmall: { gap: 6 },
  item: { paddingVertical: 8 },
  itemSmall: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  pillOn: { backgroundColor: "rgba(255,255,255,0.95)" },
  label: { fontSize: 15, fontWeight: "700", letterSpacing: 0.6, color: "rgba(255,255,255,0.5)" },
  labelOn: { color: "#ffffff" },
  labelSmall: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.92)", ...shadow },
  labelPillOn: { color: "#000000", textShadowRadius: 0, textShadowColor: "transparent" },
});
