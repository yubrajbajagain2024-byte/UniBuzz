import { useEffect, useMemo, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDecay, withSpring, type SharedValue } from "react-native-reanimated";
import { useReduceMotion } from "@/lib/accessibility";

/** The furthest a photo zooms in. A pinch past it gives a little, then springs back, as Photos does. */
export const MAX_ZOOM = 4;
/** A double tap zooms in until the photo fills the screen, but at least this far and at most that far. */
const TAP_ZOOM_MIN = 2;
const TAP_ZOOM_MAX = 3;
/** Above this scale the photo counts as zoomed: one finger pans it, and nothing around it scrolls. */
const ZOOMED = 1.01;
/** Critically damped: the photo settles onto its edges and its scale without bouncing past them. */
const SETTLE = { damping: 34, stiffness: 300, mass: 1 };
/** iOS's rubber band: the further past an edge, the less the photo follows the finger. */
const RUBBER = 0.55;
/** A pan let go with speed glides on and slows like a scroll view, bouncing softly off an edge. */
const FLING = { deceleration: 0.997, rubberBandEffect: true, rubberBandFactor: 0.6 };

/** Where the picture sits inside the zoomable area (points), at rest. */
export type ZoomFrame = { left: number; top: number; width: number; height: number };

function rubber(over: number, dim: number): number {
  "worklet";
  if (over === 0 || dim <= 0) return 0;
  return Math.sign(over) * (1 - 1 / ((Math.abs(over) * RUBBER) / dim + 1)) * dim;
}

/** A pinch past the limits follows the fingers less and less: up past MAX_ZOOM, down below the photo's own size. */
function soften(raw: number): number {
  "worklet";
  if (raw > MAX_ZOOM) return MAX_ZOOM + (raw - MAX_ZOOM) * 0.25;
  if (raw < 1) return Math.max(0.6, 1 - (1 - raw) * 0.45);
  return raw;
}

/**
 * The range of translations, on one axis, that keep a picture (from `start`, `size` long, inside an area `page` long)
 * covering the area's edges once scaled by `s` about the area's middle. A picture still smaller than the area on that
 * axis cannot be moved along it: it stays where scaling put it, kept inside the area.
 */
function bounds(page: number, start: number, size: number, s: number): [number, number] {
  "worklet";
  const mid = page / 2;
  const a = mid + (start - mid) * s;
  const b = mid + (start + size - mid) * s;
  if (b - a >= page) return [page - b, -a];
  const t = Math.min(Math.max(0, -a), page - b);
  return [t, t];
}

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(hi, Math.max(lo, v));
}

/**
 * A photo you can zoom, Photos style, on the UI thread from the first touch to the last frame: pinch around the point
 * between the fingers (past the limits it gives a little and springs back), double tap to zoom in on the tapped point or
 * back out, and once zoomed, one finger pans with momentum, the photo's edges rubber-banding as a scroll view's do. The
 * area is `width` × `height` with the picture at `frame` inside it; zoomed, the picture never leaves a gap at an edge it
 * is big enough to cover. `zoomed` (a shared value, 1 while zoomed) lets the gestures around it stand down on the UI
 * thread at once, `onZoomChange` tells the screen (to stop its pager scrolling and hide its chrome), and `active` false
 * (the photo scrolled away, the viewer closing) settles it back at rest. `onTap` is a single tap, once a double tap is ruled out.
 * `doubleTapZoom` false leaves double taps to the screen around it (a feed likes with them); a pinch still zooms. Reduce Motion
 * keeps the gestures and drops the springs.
 */
export function Zoomable({
  width,
  height,
  frame,
  active = true,
  zoomed,
  onZoomChange,
  onTap,
  doubleTapZoom = true,
  children,
}: {
  width: number;
  height: number;
  frame: ZoomFrame;
  active?: boolean;
  zoomed?: SharedValue<number>;
  onZoomChange?: (zoomed: boolean) => void;
  onTap?: () => void;
  doubleTapZoom?: boolean;
  children: ReactNode;
}) {
  const reduce = useReduceMotion();
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  /** At a pinch's start: the scale, and the point of the picture (unscaled) under the fingers. */
  const startScale = useSharedValue(1);
  const pointX = useSharedValue(0);
  const pointY = useSharedValue(0);
  const pinching = useSharedValue(0);
  /** Where a pan's translation is counted from, so nothing jumps as it starts, or as a pinch hands over to it. */
  const anchorX = useSharedValue(0);
  const anchorY = useSharedValue(0);
  const { left: fx, top: fy, width: fw, height: fh } = frame;
  const midX = width / 2;
  const midY = height / 2;

  // No longer the one on show (scrolled away, or the viewer closing over it): it settles back to rest, whole.
  useEffect(() => {
    if (active) return;
    cancelAnimation(scale);
    cancelAnimation(x);
    cancelAnimation(y);
    scale.value = reduce ? 1 : withSpring(1, SETTLE);
    x.value = reduce ? 0 : withSpring(0, SETTLE);
    y.value = reduce ? 0 : withSpring(0, SETTLE);
  }, [active, reduce, scale, x, y]);
  // The picture took a new shape, or the area a new size: back at rest at once.
  useEffect(() => {
    cancelAnimation(scale);
    cancelAnimation(x);
    cancelAnimation(y);
    scale.value = 1;
    x.value = 0;
    y.value = 0;
  }, [width, height, fx, fy, fw, fh, scale, x, y]);

  useAnimatedReaction(
    () => (scale.value > ZOOMED ? 1 : 0),
    (now, before) => {
      if (now === before || (before === null && now === 0)) return;
      if (zoomed) zoomed.value = now;
      if (onZoomChange) runOnJS(onZoomChange)(now === 1);
    },
  );

  // Memoized: a re-render mid-pinch (the screen hearing it zoomed) must not re-attach the gestures under the fingers.
  const gesture = useMemo(() => {
    const to = (value: number, velocity = 0) => {
      "worklet";
      return reduce ? value : withSpring(value, { ...SETTLE, velocity });
    };
    /** Springs the scale back inside its limits, keeping the point under `focal` where it is, then the edges onto the screen's. */
    const settle = (focalX: number, focalY: number) => {
      "worklet";
      const s = clamp(scale.value, 1, MAX_ZOOM);
      const px = midX + (focalX - midX - x.value) / scale.value;
      const py = midY + (focalY - midY - y.value) / scale.value;
      const [x0, x1] = bounds(width, fx, fw, s);
      const [y0, y1] = bounds(height, fy, fh, s);
      scale.value = to(s);
      x.value = to(clamp(focalX - midX - (px - midX) * s, x0, x1));
      y.value = to(clamp(focalY - midY - (py - midY) * s, y0, y1));
    };
    /** A pan let go: glides on inside the edges, or springs back onto one it was pulled past. */
    const glide = (value: SharedValue<number>, velocity: number, lo: number, hi: number) => {
      "worklet";
      if (reduce || lo === hi) value.value = clamp(value.value, lo, hi);
      else if (value.value < lo || value.value > hi) value.value = to(clamp(value.value, lo, hi), velocity);
      else value.value = withDecay({ velocity, clamp: [lo, hi], ...FLING });
    };

    const pinch = Gesture.Pinch()
      .onStart((e) => {
        cancelAnimation(scale);
        cancelAnimation(x);
        cancelAnimation(y);
        pinching.value = 1;
        startScale.value = scale.value;
        pointX.value = midX + (e.focalX - midX - x.value) / scale.value;
        pointY.value = midY + (e.focalY - midY - y.value) / scale.value;
      })
      .onUpdate((e) => {
        const s = soften(startScale.value * e.scale);
        scale.value = s;
        // The point that was under the fingers stays under them, wherever they move: a pinch pans too.
        x.value = e.focalX - midX - (pointX.value - midX) * s;
        y.value = e.focalY - midY - (pointY.value - midY) * s;
      })
      .onEnd((e) => settle(e.focalX, e.focalY))
      .onFinalize(() => {
        pinching.value = 0;
      });

    // One finger, only while zoomed: otherwise the touch belongs to whatever is around the photo (the next page).
    const pan = Gesture.Pan()
      .manualActivation(true)
      .onTouchesMove((e, manager) => {
        if (pinching.value === 1) return;
        if (scale.value <= ZOOMED) manager.fail();
        else if (e.numberOfTouches === 1) manager.activate();
      })
      .onStart((e) => {
        cancelAnimation(x);
        cancelAnimation(y);
        anchorX.value = x.value - e.translationX;
        anchorY.value = y.value - e.translationY;
      })
      .onUpdate((e) => {
        if (pinching.value === 1) {
          anchorX.value = x.value - e.translationX;
          anchorY.value = y.value - e.translationY;
          return;
        }
        const s = scale.value;
        const [x0, x1] = bounds(width, fx, fw, s);
        const [y0, y1] = bounds(height, fy, fh, s);
        const nx = anchorX.value + e.translationX;
        const ny = anchorY.value + e.translationY;
        x.value = nx < x0 ? x0 + rubber(nx - x0, width) : nx > x1 ? x1 + rubber(nx - x1, width) : nx;
        y.value = ny < y0 ? y0 + rubber(ny - y0, height) : ny > y1 ? y1 + rubber(ny - y1, height) : ny;
      })
      .onEnd((e) => {
        if (pinching.value === 1) return;
        const s = scale.value;
        const [x0, x1] = bounds(width, fx, fw, s);
        const [y0, y1] = bounds(height, fy, fh, s);
        glide(x, e.velocityX, x0, x1);
        glide(y, e.velocityY, y0, y1);
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(280)
      .maxDistance(24)
      .onEnd((e, success) => {
        if (!success) return;
        cancelAnimation(scale);
        cancelAnimation(x);
        cancelAnimation(y);
        if (scale.value > ZOOMED) {
          scale.value = to(1);
          x.value = to(0);
          y.value = to(0);
          return;
        }
        const s = clamp(Math.max(width / Math.max(fw, 1), height / Math.max(fh, 1)), TAP_ZOOM_MIN, TAP_ZOOM_MAX);
        const px = midX + (e.x - midX - x.value) / scale.value;
        const py = midY + (e.y - midY - y.value) / scale.value;
        const [x0, x1] = bounds(width, fx, fw, s);
        const [y0, y1] = bounds(height, fy, fh, s);
        scale.value = to(s);
        x.value = to(clamp(e.x - midX - (px - midX) * s, x0, x1));
        y.value = to(clamp(e.y - midY - (py - midY) * s, y0, y1));
      });

    if (!doubleTapZoom) return Gesture.Simultaneous(pinch, pan);
    if (!onTap) return Gesture.Simultaneous(pinch, pan, doubleTap);
    const singleTap = Gesture.Tap()
      .maxDistance(12)
      .onEnd((_e, success) => {
        if (success) runOnJS(onTap)();
      });
    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [reduce, width, height, fx, fy, fw, fh, midX, midY, onTap, doubleTapZoom, scale, x, y, startScale, pointX, pointY, pinching, anchorX, anchorY]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={StyleSheet.absoluteFill} collapsable={false}>
        {/* The picture takes no touches of its own: they land on the area, which the gestures above are on, so a tap's place
            is always measured from the area (a feed's double-tap heart goes there). */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
          {children}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
