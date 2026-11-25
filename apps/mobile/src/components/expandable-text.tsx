import { Children, cloneElement, isValidElement, useState, type ReactNode } from "react";
import { Text, View, type StyleProp, type TextLayoutEvent, type TextStyle } from "react-native";
import { makeStyles } from "@/lib/theme-provider";

/** One laid-out line of text, as onTextLayout reports it. */
type TextLayoutLine = TextLayoutEvent["nativeEvent"]["lines"][number];

/** Drawn after the last word that fits, in the text's own style, before "more". */
const ELLIPSIS = "… ";
const MORE = "more";
/** How far the cut may be pulled back when the folded text still runs past its lines: enough for any line, never a loop. */
const MAX_SHAVE = 40;

/**
 * The first `budget.left` characters of inline text: plain strings and styled <Text> spans (hashtags, mentions), nested
 * or not, each span keeping its style. `budget` is spent as it goes, so siblings after the cut come back empty.
 */
function sliceInline(node: ReactNode, budget: { left: number }): ReactNode {
  if (budget.left <= 0 || node === null || node === undefined || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") {
    const s = String(node);
    if (s.length <= budget.left) {
      budget.left -= s.length;
      return s;
    }
    const out = s.slice(0, budget.left);
    budget.left = 0;
    return out;
  }
  if (Array.isArray(node)) return Children.toArray(node).map((child) => sliceInline(child, budget));
  if (isValidElement<{ children?: ReactNode }>(node)) return cloneElement(node, undefined, sliceInline(node.props.children, budget));
  return null;
}

/**
 * Where the folded text stops: every character of the first `count - 1` laid-out lines, and as much of line `count` as
 * leaves room for "… more" (its width measured in the same style) on that line, less `shave` characters, never in the
 * middle of a space or an emoji.
 */
function foldAt(laid: TextLayoutLine[], count: number, width: number, suffixWidth: number, shave: number): number {
  const before = laid.slice(0, count - 1).reduce((sum, l) => sum + l.text.length, 0);
  const last = laid[count - 1];
  const lastText = last.text.replace(/\s+$/, "");
  const room = width - suffixWidth;
  let keepLast = lastText.length;
  if (last.width > room) {
    const perChar = last.width / Math.max(1, last.text.length);
    keepLast = Math.max(0, lastText.length - Math.ceil((last.width - room) / perChar) - 1);
  }
  let keep = before + Math.max(0, keepLast - shave);
  const plain = laid.map((l) => l.text).join("");
  while (keep > 0 && /\s/.test(plain[keep - 1] ?? "")) keep--;
  // Never half an emoji: a high surrogate at the cut goes with its pair.
  if (keep > 0) {
    const code = plain.charCodeAt(keep - 1);
    if (code >= 0xd800 && code <= 0xdbff) keep--;
  }
  return keep;
}

/**
 * Text folded to its first `lines` lines, with "… more" at the end of the last of them, Instagram's way (the owner's
 * brief, 2026-11-25: never on a line of its own); a tap on "more" opens the rest, and "less" under it folds it again.
 * `children` are the inline parts (plain strings and styled <Text> spans such as hashtags and mentions). A hidden copy
 * laid out at full length gives the lines, so the fold only shows when there really is more (a short text has no "more"
 * at all) and says where to cut; a second hidden copy of the folded text checks that "… more" did fit, and the cut moves
 * back a little until it does. With `lines` 0 the text starts hidden altogether behind "more…". `expanded` starts it
 * open; with `collapsible` false (a post's own screen) it is simply all there, without "less".
 */
export function ExpandableText({ children, style, lines = 2, expanded: startOpen = false, collapsible = true, selectable, accessibilityLabel }: { children: ReactNode; style?: StyleProp<TextStyle>; lines?: number; expanded?: boolean; collapsible?: boolean; selectable?: boolean; accessibilityLabel?: string }) {
  const styles = useStyles();
  const [open, setOpen] = useState(startOpen);
  const [laid, setLaid] = useState<TextLayoutLine[] | null>(null);
  const [width, setWidth] = useState(0);
  const [suffixWidth, setSuffixWidth] = useState(0);
  const [shave, setShave] = useState(0);
  // Hidden whole: nothing to measure, the fold is always there.
  const hidden = collapsible && lines <= 0;
  const measure = collapsible && !hidden;
  const folds = measure && laid !== null && laid.length > lines;
  const keep = folds && !open && width > 0 && suffixWidth > 0 ? foldAt(laid, lines, width, suffixWidth, shave) : null;
  const folded = keep === null ? null : sliceInline(children, { left: keep });
  const more = (
    <Text style={styles.more} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="more">
      {MORE}
    </Text>
  );

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {hidden && !open ? null : folded !== null ? (
        <Text style={style} numberOfLines={lines} selectable={selectable} accessibilityLabel={accessibilityLabel}>
          {folded}
          {ELLIPSIS}
          {more}
        </Text>
      ) : (
        <Text style={style} numberOfLines={open || hidden || !measure ? undefined : lines} selectable={selectable} accessibilityLabel={accessibilityLabel}>
          {children}
        </Text>
      )}
      {measure ? (
        // Never seen, the same style and width: the whole text (its lines), "… more" alone (its width) and, once folded,
        // the folded text (does it keep to its lines?). They lie over the real text, so a View that takes no touches holds
        // them: a tappable span in them (an @mention) never catches a tap meant for what is underneath.
        <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          <Text style={style} onTextLayout={(e) => setLaid(e.nativeEvent.lines)}>
            {children}
          </Text>
          <Text style={[style, styles.oneLine]} numberOfLines={1} onTextLayout={(e) => setSuffixWidth(Math.ceil(e.nativeEvent.lines[0]?.width ?? 0))}>
            {ELLIPSIS}
            <Text style={styles.more}>{MORE}</Text>
          </Text>
          {folded !== null ? (
            <Text style={style} onTextLayout={(e) => e.nativeEvent.lines.length > lines && setShave((s) => Math.min(MAX_SHAVE, s + 2))}>
              {folded}
              {ELLIPSIS}
              <Text style={styles.more}>{MORE}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}
      {hidden || (measure && folds && open) ? (
        <Text style={[styles.toggle, hidden && !open && styles.toggleAlone]} onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={open ? "less" : "more"}>
          {open ? "less" : "more…"}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  measure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  // The suffix measured on its own, left-aligned at its natural width.
  oneLine: { alignSelf: "flex-start" },
  more: { color: colors.muted, fontWeight: "600" },
  toggle: { color: colors.muted, fontSize: 14, fontWeight: "600", paddingTop: 3, alignSelf: "flex-start" },
  // Standing in for the whole text, the fold needs no space above it.
  toggleAlone: { paddingTop: 0 },
}));
