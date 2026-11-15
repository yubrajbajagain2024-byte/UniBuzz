import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type LayoutRectangle, type StyleProp, type TextStyle } from "react-native";
import { Icon } from "@/components/icon";

/**
 * The sliding underline is laid out this wide and scaled to each label: the native driver animates transforms but not
 * `width`, so scaleX = labelWidth / BASE_WIDTH puts it under label i as wide as the label, translateX = centre - BASE_WIDTH / 2.
 */
// Close to a typical label width, so the scaled bar keeps its rounded ends.
const BASE_WIDTH = 48;
/**
 * How far the labels follow the phone's text size: enough to read, not so far that the longest row (Explore's Housing |
 * Roommate | Marketplace) outgrows a small phone even once the room between its labels has closed up.
 */
const MAX_FONT_SCALE = 1.2;
/**
 * The room between two labels, the same in every tab row of the app (Home's Orbit | Buzz | Reels, Explore's Housing |
 * Roommate | Marketplace, Messages' Chats | Groups, Events' For you | All events): the labels sit together in the middle
 * of the row, as the website's do, rather than spreading to its edges. Each label's touch area takes half of it on
 * either side, so the targets meet and a tap between two labels still lands on one. A row too narrow for it (a small
 * phone, a large text size) closes the room up evenly until its labels fit.
 */
export const TAB_GAP = 24;
/** Between a label and what hangs before it (`leading`). */
const LEADING_GAP = 4;

/** Where one label sits in the labels row: enough to put the underline under it, as wide as it is. */
type LabelBox = Pick<LayoutRectangle, "x" | "width">;

/**
 * A row of section labels with one underline that slides between them as a horizontal pager scrolls (Home's top bar,
 * Explore, Messages, Events), X (Twitter) style: the labels sit side by side in the middle of the row, `gap` apart, the
 * active one bold, and the underline is as wide as that label and sits on the row's bottom edge (Home's bar draws no
 * line there; others may). `scrollX` is the pager's offset in points and `pageWidth` the width of one page: page i puts the underline
 * under label i, and each label fades between its active look (bold, `labelColor`) and its resting look (`dimColor`) as
 * the page under it comes and goes, so the whole row follows the finger instead of jumping once a swipe settles. Both
 * run on the native driver: nothing re-renders while the pager moves. `section` decides what screen readers hear as
 * selected (and the look until `pageWidth` is known). Fills its parent (flex 1 + stretch) whatever the bar's height;
 * `textStyle` is for extras like a text shadow over video.
 */
export function SlidingTabs<T extends string>({
  sections,
  section,
  onSelect,
  scrollX,
  pageWidth,
  tint,
  tintGradient,
  labelColor,
  dimColor,
  textStyle,
  gap = TAB_GAP,
  fontSize = 15,
  caret,
  badges,
  leading,
}: {
  sections: readonly { value: T; label: string }[];
  section: T;
  onSelect: (s: T) => void;
  scrollX: Animated.Value;
  pageWidth: number;
  tint: string;
  /** A gradient for the underline (the aurora), drawn over `tint`; leave it out for a plain line (white over video). */
  tintGradient?: string;
  labelColor: string;
  dimColor: string;
  textStyle?: StyleProp<TextStyle>;
  /** The room between two labels (TAB_GAP unless a row needs its own), and the labels' size. */
  gap?: number;
  fontSize?: number;
  /** The section(s) whose label carries a small chevron: it opens a menu. */
  caret?: T | readonly T[];
  /**
   * A red count after a label (Messages' Chats and Groups), raised like a superscript; none at 0. It takes its own room
   * in the row (so the next label keeps the full gap from it) but stays out of the label's box, so the underline keeps
   * the label's width.
   */
  badges?: Partial<Record<T, number>>;
  /**
   * A small mark hung just before a label (Buzz's lime mask on Home), out of the layout like a badge: the label stays
   * where it is and the underline keeps its width. Decorative; screen readers skip it.
   */
  leading?: Partial<Record<T, ReactNode>>;
}) {
  const [boxes, setBoxes] = useState<(LabelBox | undefined)[]>(() => sections.map(() => undefined));
  // Same array unless a label really moved, so the interpolation below is not rebuilt on every layout pass.
  const measure = (i: number, { x, width }: LayoutRectangle) => setBoxes((prev) => (prev[i]?.x === x && prev[i]?.width === width ? prev : prev.map((b, j) => (j === i ? { x, width } : b))));
  // Each tab is wider than its label (its share of the room on either side): the label's box is its own offset inside
  // the tab plus the tab's place in the row.
  const tabX = useRef<number[]>([]);
  const labelBox = useRef<(LabelBox | undefined)[]>([]);
  const measureLabel = (i: number) => {
    const x = tabX.current[i];
    const b = labelBox.current[i];
    if (x !== undefined && b) measure(i, { x: x + b.x, width: b.width, y: 0, height: 0 });
  };

  // The room between labels, closed up evenly when the labels and the full gap would not fit the row. It depends only
  // on the labels' widths (never on where they sit), so placing the labels again never changes it.
  const [rowWidth, setRowWidth] = useState(0);
  const labelsWidth = boxes.every((b) => b && b.width > 0) ? boxes.reduce((sum, b) => sum + (b?.width ?? 0), 0) : null;
  const room = rowWidth > 0 && labelsWidth !== null ? Math.max(0, Math.min(gap, (rowWidth - labelsWidth) / sections.length)) : gap;
  const pad = room / 2;

  // Page i (offset i * pageWidth) puts the underline under label i, scaled to its width. Only once every label is
  // measured and pageWidth > 0 (so the input range is strictly increasing); until then the static underline below stands in.
  const slide = useMemo(() => {
    if (pageWidth <= 0 || boxes.length !== sections.length) return null;
    const centres: number[] = [];
    const widths: number[] = [];
    for (const b of boxes) {
      if (!b || b.width <= 0) return null;
      centres.push(b.x + b.width / 2);
      widths.push(b.width);
    }
    const inputRange = centres.map((_, i) => i * pageWidth);
    return {
      translateX: scrollX.interpolate({ inputRange, outputRange: centres.map((c) => c - BASE_WIDTH / 2), extrapolate: "clamp" }),
      scaleX: scrollX.interpolate({ inputRange, outputRange: widths.map((w) => w / BASE_WIDTH), extrapolate: "clamp" }),
    };
  }, [boxes, pageWidth, scrollX, sections.length]);

  // Each label is drawn in both looks, one over the other, and the two crossfade with the pager: label i keeps its active
  // look within a quarter page of page i and its resting look from three quarters of a page away, crossfading over the
  // middle half of a swipe (where the page under the finger changes), so the two weights spend little time half-drawn over each other.
  // Only once pageWidth > 0 (strictly increasing input range).
  const count = sections.length;
  const fades = useMemo(() => {
    if (pageWidth <= 0) return null;
    return Array.from({ length: count }, (_, i) => {
      const inputRange = [i - 0.75, i - 0.25, i + 0.25, i + 0.75].map((p) => p * pageWidth);
      return {
        on: scrollX.interpolate({ inputRange, outputRange: [0, 1, 1, 0], extrapolate: "clamp" }),
        off: scrollX.interpolate({ inputRange, outputRange: [1, 0, 0, 1], extrapolate: "clamp" }),
      };
    });
  }, [count, pageWidth, scrollX]);

  return (
    <View
      style={styles.labels}
      accessibilityRole="tablist"
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setRowWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
      }}
    >
      {sections.map((s, i) => {
        const active = s.value === section;
        const fade = fades?.[i];
        const mark = leading?.[s.value];
        return (
          <Pressable
            key={s.value}
            onPress={() => onSelect(s.value)}
            onLayout={(e) => {
              tabX.current[i] = e.nativeEvent.layout.x;
              measureLabel(i);
            }}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="tab"
            accessibilityLabel={badges?.[s.value] ? `${s.label}, ${badges[s.value]} unread` : s.label}
            accessibilityState={{ selected: active }}
            style={[styles.tab, { paddingHorizontal: pad }]}
          >
            <View
              style={styles.labelBox}
              onLayout={(e) => {
                labelBox.current[i] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
                measureLabel(i);
              }}
            >
              {mark ? (
                <View pointerEvents="none" style={styles.leading} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {mark}
                </View>
              ) : null}
              <View>
                {/* An invisible bold copy gives every label the width of its bold form: nothing shifts when the active one changes weight, and the underline fits it exactly. */}
                <Text style={[styles.label, { fontSize }, styles.bold, styles.ghost, textStyle]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE} aria-hidden>
                  {s.label}
                </Text>
                {fade ? (
                  <>
                    <Animated.Text style={[styles.label, { fontSize }, styles.text, { color: dimColor }, textStyle, { opacity: fade.off }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>{s.label}</Animated.Text>
                    <Animated.Text style={[styles.label, { fontSize }, styles.text, styles.bold, { color: labelColor }, textStyle, { opacity: fade.on }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>{s.label}</Animated.Text>
                  </>
                ) : (
                  <Text style={[styles.label, { fontSize }, styles.text, { color: active ? labelColor : dimColor }, active && styles.bold, textStyle]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>{s.label}</Text>
                )}
              </View>
              {(Array.isArray(caret) ? (caret as readonly T[]).includes(s.value) : caret === s.value) ? <Icon name="chevron-down" size={14} color={active ? labelColor : dimColor} style={[styles.caret, textStyle]} /> : null}
              {slide ? null : <View style={[styles.underline, styles.staticUnderline, active ? { backgroundColor: tint, experimental_backgroundImage: tintGradient } : { backgroundColor: "transparent" }]} />}
            </View>
            {badges?.[s.value] ? (
              <View style={styles.badge} pointerEvents="none">
                <Text style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  {(badges[s.value] ?? 0) > 99 ? "99+" : String(badges[s.value])}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {slide ? <Animated.View pointerEvents="none" style={[styles.underline, styles.slidingUnderline, { backgroundColor: tint, experimental_backgroundImage: tintGradient, transform: [{ translateX: slide.translateX }, { scaleX: slide.scaleX }] }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The labels together in the middle of the row; the room between them is each tab's own padding (see TAB_GAP).
  labels: { flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "stretch", justifyContent: "center" },
  // The label's box, then its badge if it has one, side by side; stretched to the row's height.
  tab: { flexDirection: "row", alignItems: "stretch" },
  // The label and, for one section, the chevron after it: what the underline is measured against. Stretched to the
  // row's height, so the static underline drawn in it sits on the row's bottom edge whatever the bar's height.
  labelBox: { flexDirection: "row", alignItems: "center", gap: 1 },
  caret: { marginTop: 1 },
  // Just before the label, centred on it, outside its box.
  leading: { position: "absolute", top: 0, bottom: 0, right: "100%", marginRight: LEADING_GAP, justifyContent: "center" },
  // The tab bar's own badge: red, white count, just past the label's top-right corner (raised from the row's middle).
  badge: { alignSelf: "center", marginLeft: 3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: "#e41e3f", alignItems: "center", justifyContent: "center", transform: [{ translateY: -8 }] },
  badgeText: { color: "#ffffff", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  label: { fontSize: 15, fontWeight: "600" },
  bold: { fontWeight: "700" },
  ghost: { opacity: 0 },
  text: { position: "absolute", top: 0, left: 0, right: 0, textAlign: "center" },
  // The same bottom edge for the static underline (spanning its label) and the sliding one (scaled to the label), so nothing jumps when one replaces the other.
  underline: { position: "absolute", bottom: 0, height: 3, borderRadius: 2 },
  staticUnderline: { left: 0, right: 0 },
  slidingUnderline: { left: 0, width: BASE_WIDTH },
});
