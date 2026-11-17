import { useRef } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { BEAUTY_FILTERS, beautyPercent, type BeautyFilterId } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { usePressScale } from "@/components/ui";
import { hapticSelect, hapticSoft } from "@/lib/haptics";

/** The thumbnails' size and the ring that marks the one in use, as TikTok draws its effects row. */
const THUMB = 58;
const RING = 2.5;
const GAP = 3;

/**
 * The camera's beauty filters along the bottom of the stage: a round thumbnail each (None first, then Natural Glow,
 * Warm Beauty and Bright Radiance), the one in use in a white ring with its name under the row, and above them a slider
 * for how strong it is. Each thumbnail shows its own look as a disc of the colours that look makes: no faces, no
 * pictures to load. Tapping the one already in use turns it off, as TikTok's effects do.
 *
 * The slider is a plain drag: the thumb follows the finger on the UI thread (Animated, the native driver), and the value
 * reaches the camera as it moves, so the live picture answers at once.
 */
export function BeautyRow({ filter, intensity, onFilter, onIntensity }: { filter: BeautyFilterId | null; intensity: number; onFilter: (id: BeautyFilterId | null) => void; onIntensity: (value: number) => void }) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {filter ? <IntensitySlider value={intensity} onChange={onIntensity} /> : null}
      <View style={styles.row}>
        <Thumb label="None" selected={filter === null} onPress={() => onFilter(null)}>
          <View style={styles.none}>
            <Icon name="ban-outline" sf="nosign" size={24} color="#fff" />
          </View>
        </Thumb>
        {BEAUTY_FILTERS.map((f) => (
          <Thumb key={f.id} label={f.name} hint={f.hint} selected={filter === f.id} onPress={() => onFilter(filter === f.id ? null : f.id)}>
            <View style={[styles.swatch, SWATCH[f.id]]} />
          </Thumb>
        ))}
      </View>
      <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {filter ? BEAUTY_FILTERS.find((f) => f.id === filter)?.name : "No filter"}
      </Text>
    </View>
  );
}

/** Each look as a disc of its own colours: the skin tone it lends, from its shadow to its highlight. */
const SWATCH: Record<BeautyFilterId, { backgroundColor: string; experimental_backgroundImage: string }> = {
  natural: { backgroundColor: "#d8a98c", experimental_backgroundImage: "linear-gradient(145deg, #f2d7c2 0%, #d9a98a 55%, #b57f63 100%)" },
  warm: { backgroundColor: "#e0a878", experimental_backgroundImage: "linear-gradient(145deg, #ffdfb8 0%, #e8ab76 55%, #c07a45 100%)" },
  bright: { backgroundColor: "#eac6b4", experimental_backgroundImage: "linear-gradient(145deg, #fff6ee 0%, #f3cdb9 55%, #d49f87 100%)" },
};

function Thumb({ label, hint, selected, onPress, children }: { label: string; hint?: string; selected: boolean; onPress: () => void; children: React.ReactNode }) {
  const press = usePressScale(0.9, 1);
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={styles.thumbTap}
    >
      <Animated.View style={[styles.ring, selected && styles.ringOn, { transform: [{ scale: press.scale }] }]}>
        <View style={styles.thumb}>{children}</View>
      </Animated.View>
    </Pressable>
  );
}

/** How strong the look is: a line with a thumb, dragged. Its ends are 0 and 100. */
function IntensitySlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const width = useRef(0);
  const x = useRef(new Animated.Value(0)).current;
  const shown = useRef(value);
  shown.current = value;
  const place = (v: number) => {
    if (width.current > 0) x.setValue(v * width.current);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        hapticSoft();
        move(e.nativeEvent.locationX);
      },
      onPanResponderMove: (_e, g) => move(g.moveX - left.current),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  const left = useRef(0);
  function move(at: number) {
    if (!(width.current > 0)) return;
    const next = Math.min(1, Math.max(0, at / width.current));
    place(next);
    onChange(next);
  }
  const onLayout = (e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width;
    place(shown.current);
  };
  return (
    <View style={styles.sliderRow} pointerEvents="box-none">
      <Text style={styles.percent} maxFontSizeMultiplier={1.3}>
        {beautyPercent(value)}
      </Text>
      <View
        style={styles.track}
        onLayout={onLayout}
        // Where the track starts on screen, so a drag that leaves it still follows the finger.
        onTouchStart={(e) => {
          left.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Filter strength"
        accessibilityValue={{ min: 0, max: 100, now: beautyPercent(value) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === "increment" ? 0.1 : -0.1;
          const next = Math.min(1, Math.max(0, shown.current + step));
          place(next);
          onChange(next);
        }}
        {...pan.panHandlers}
      >
        <View style={styles.trackLine} />
        <Animated.View style={[styles.thumbDot, { transform: [{ translateX: x }] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 8 },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch", paddingHorizontal: 30 },
  percent: { width: 34, color: "#fff", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"], textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 3 },
  // The band a finger grabs is taller than the line, so it is easy to hit without aiming.
  track: { flex: 1, height: 28, justifyContent: "center" },
  trackLine: { height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.45)" },
  thumbDot: { position: "absolute", left: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumbTap: { padding: 2 },
  ring: { width: THUMB + (RING + GAP) * 2, height: THUMB + (RING + GAP) * 2, borderRadius: (THUMB + (RING + GAP) * 2) / 2, alignItems: "center", justifyContent: "center", borderWidth: RING, borderColor: "transparent" },
  ringOn: { borderColor: "#fff" },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.18)" },
  swatch: { flex: 1 },
  none: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  name: { color: "#fff", fontSize: 13, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 4 },
});
