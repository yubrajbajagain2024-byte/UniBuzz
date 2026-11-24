import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { useColors } from "@/lib/theme-provider";

/** Two taps this close together (ms) are a double tap; each further tap as quick adds another heart, TikTok's way. */
export const DOUBLE_TAP_MS = 270;

/** Spawns a heart where a double tap landed (points, in the area HeartBursts covers). */
export type HeartBurstsHandle = { burst: (x: number, y: number) => void };

/** How long one heart is on screen, from its pop to the end of its fade. */
const LIFE_MS = 1000;
/** At most this many at once: a frantic run of taps never piles up more. */
const MAX_HEARTS = 6;
/** How far either way a heart may lean, TikTok's way, so a run of them never stacks into one shape. */
const TILT = 22;

type Burst = { id: number; x: number; y: number; tilt: number };

/**
 * TikTok's double-tap hearts (the owner's brief, 2026-11-22): each one appears where the finger landed, leaning a little,
 * pops past its size and settles, holds for a beat, then floats up, grows and fades. Each tap of a quick run adds its own.
 * Drawn over the area it fills, taking no touches and hidden from VoiceOver (the like itself is announced by the heart
 * button it fills). Under Reduce Motion a heart only fades in and out where it landed.
 */
export const HeartBursts = forwardRef<HeartBurstsHandle, { size?: number }>(function HeartBursts({ size = 100 }, ref) {
  const [hearts, setHearts] = useState<Burst[]>([]);
  const next = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      burst(x: number, y: number) {
        const id = ++next.current;
        const tilt = (Math.random() * 2 - 1) * TILT;
        setHearts((list) => [...list.slice(-(MAX_HEARTS - 1)), { id, x, y, tilt }]);
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          setHearts((list) => list.filter((h) => h.id !== id));
        }, LIFE_MS);
        timers.current.add(timer);
      },
    }),
    [],
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {hearts.map((h) => (
        <Heart key={h.id} x={h.x} y={h.y} tilt={h.tilt} size={size} />
      ))}
    </View>
  );
});

function Heart({ x, y, tilt, size }: { x: number; y: number; tilt: number; size: number }) {
  const colors = useColors();
  const reduce = useReduceMotion();
  const scale = useSharedValue(reduce ? 1 : 0.2);
  const opacity = useSharedValue(reduce ? 0 : 1);
  const rise = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      opacity.value = withSequence(withTiming(1, { duration: 120 }), withDelay(480, withTiming(0, { duration: 260 })));
      return;
    }
    // Pop past full size and settle (about a quarter second), hold, then float up, growing as it fades.
    scale.value = withSequence(
      withTiming(1.25, { duration: 150, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 110, easing: Easing.inOut(Easing.quad) }),
      withDelay(260, withTiming(1.65, { duration: 400, easing: Easing.in(Easing.quad) })),
    );
    opacity.value = withDelay(540, withTiming(0, { duration: 380, easing: Easing.in(Easing.quad) }));
    rise.value = withDelay(520, withTiming(-size * 0.85, { duration: 420, easing: Easing.in(Easing.quad) }));
  }, [reduce, scale, opacity, rise, size]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: rise.value }, { rotate: `${tilt}deg` }, { scale: scale.value }],
  }));
  return (
    <Animated.View style={[styles.heart, { left: x - size / 2, top: y - size / 2, width: size, height: size }, style]}>
      <Icon name="heart" size={size} color={colors.like} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  heart: { position: "absolute", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
});
