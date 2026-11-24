import { createContext, memo, useContext, useEffect, useRef } from "react";
import { Pressable, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewInstance, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { muxPosterUrl, type Buzz, type BuzzMedia } from "@apartment-book/shared";
import { DOUBLE_TAP_MS, HeartBursts, type HeartBurstsHandle } from "@/components/heart-burst";
import { Icon } from "@/components/icon";
import { upvoteBuzz } from "@/lib/buzz-actions";
import { buzzAfter, buzzViewerEntry, entryOf, measureOrigin, openViewer, viewerItemFromBuzz, type BuzzViewerPages, type ViewerEntry, type ViewerSource } from "@/lib/reel-viewer";
import { OpeningBandContext } from "@/lib/viewer-chrome";
import { P, R } from "./ui";

type Photo = Extract<BuzzMedia, { type: "image" }>;
type Video = Extract<BuzzMedia, { type: "video" }>;

const GAP = 2;

/**
 * The Buzz list a buzz's media opens from (the feed, search, My buzzes: useBuzzList's `viewerPages`), so the viewer goes
 * on through it with a swipe up, and back up it with a swipe down: its buzzes with something to show full screen, as
 * loaded, then its next pages. Without one (a thread's own screen) the viewer shows the one buzz.
 */
export const BuzzViewerList = createContext<(() => BuzzViewerPages) | null>(null);

/** A picture keeps its own shape, between 3:4 and 16:9 (UniVerse's aspectOf). */
function aspectOf(m: { width: number | null; height: number | null }, fallback: number): number {
  if (m.width && m.height && m.width > 0 && m.height > 0) return Math.min(1.78, Math.max(0.75, m.width / m.height));
  return fallback;
}

/**
 * A buzz's photos or its one video (UniVerse's BuzzMediaView): up to four photos in the 1 / 2 / 3 / 4 layouts, or one
 * video's still with a play button. A tap opens them in the app's full-screen viewer, as Orbit and Reels do: the tapped
 * tile grows to the screen, a sideways swipe moves between the photos with the finger, a swipe up or down moves to the
 * next or the last buzz of the list with media (BuzzViewerList), a swipe back (or Back) shrinks the page into the tile of
 * the photo on screen (from another buzz, fading into it), and the list behind stays exactly where it was. The page is anonymous (see
 * viewerItemFromBuzz): the alias, the words and Buzz's own votes, replies and share, never a name or a profile. A double
 * tap on it upvotes the buzz instead, TikTok's double tap to like (the owner's brief, 2026-11-22), with a heart where the
 * finger landed, so a lone tap opens the viewer once a second tap is ruled out (at once on a buzz that takes no votes).
 * `repliesBehind`: shown on the thread's own screen, whose replies the viewer then closes back onto.
 */
export const BuzzMediaView = memo(function BuzzMediaView({ buzz, repliesBehind = false, style }: { buzz: Buzz; repliesBehind?: boolean; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const openingBand = useContext(OpeningBandContext);
  const listPages = useContext(BuzzViewerList);
  /** Each tile as laid out, to measure where the viewer opens from and lands. */
  const tiles = useRef<(ViewInstance | null)[]>([]);
  /** The frame the hearts are drawn over, the hearts, and the tap a second one would make a double tap of. */
  const frame = useRef<ViewInstance | null>(null);
  const hearts = useRef<HeartBurstsHandle>(null);
  const lastTap = useRef(0);
  const pendingOpen = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pendingOpen.current) clearTimeout(pendingOpen.current);
    },
    [],
  );
  const media = buzz.media;
  if (media.length === 0) return null;
  const video = media.find((m): m is Video => m.type === "video");
  const photos = video ? [] : media.filter((m): m is Photo => m.type === "image").slice(0, 4);
  const shown: BuzzMedia[] = video ? [video] : photos;
  const n = shown.length;
  if (n === 0) return null;
  // A lone picture keeps the frame's rounded corners; tiles in a grid meet square.
  const radius = n === 1 ? R.lg : 0;

  /**
   * Opens the viewer on the tapped photo or the video. Every tile is measured, so closing on another photo lands on that
   * one; under a floating bar (Home's Buzz page) only the part of a tile between the bars is opened from (OpeningBand).
   */
  async function open(index: number) {
    const item = viewerItemFromBuzz(buzz);
    if (!item) return;
    const tapped = entryOf(item, index);
    // The list around it, read now (what it has loaded, where it has got to): the buzzes before it a swipe down away,
    // those after it and the list's next pages a swipe up. A buzz's own thread screen has no list: the one page.
    let entries: ViewerEntry[] = [tapped];
    let at = 0;
    let then: ViewerSource["then"] = "end";
    const pages = repliesBehind ? null : (listPages?.() ?? null);
    if (pages) {
      const around = pages.ids.map((id) => (id === buzz.id ? tapped : buzzViewerEntry(id))).filter((e): e is ViewerEntry => e !== null);
      const i = around.indexOf(tapped);
      if (i >= 0) {
        entries = around;
        at = i;
        then = { more: buzzAfter(pages.next, new Set(pages.ids)) };
      }
    }
    const band = openingBand?.();
    const measured = await Promise.all(shown.map((_, i) => measureOrigin(tiles.current[i] ?? null, radius)));
    const origins = measured.map((m) => (m && band ? { ...m, clip: band } : m));
    openViewer(router, { entries, index: at, then, origin: origins[index], origins: n > 1 ? origins : undefined, repliesBehind });
  }

  const takesVotes = !buzz.isMine && buzz.status === "active";
  /**
   * A tap on a tile: two in quick succession upvote (never taking it back) with a heart where the second landed, each
   * further quick tap adding a heart; a lone tap opens the viewer once no second tap has come.
   */
  function onTilePress(index: number, e: GestureResponderEvent) {
    const { pageX, pageY } = e.nativeEvent;
    const now = Date.now();
    if (pendingOpen.current) {
      clearTimeout(pendingOpen.current);
      pendingOpen.current = null;
    }
    if (takesVotes && now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = now;
      if (upvoteBuzz(buzz.id)) frame.current?.measureInWindow((x, y) => hearts.current?.burst(pageX - x, pageY - y));
      return;
    }
    lastTap.current = now;
    if (!takesVotes) return void open(index);
    pendingOpen.current = setTimeout(() => {
      pendingOpen.current = null;
      void open(index);
    }, DOUBLE_TAP_MS);
  }
  /** VoiceOver's way to the double tap: an Upvote action on every tile. */
  const upvoteAction = takesVotes ? [{ name: "upvote", label: "Upvote" }] : undefined;
  const onAction = (e: { nativeEvent: { actionName: string } }) => {
    if (e.nativeEvent.actionName === "upvote") upvoteBuzz(buzz.id);
  };

  if (video) {
    const poster = video.posterUrl ?? muxPosterUrl(video.playbackId);
    return (
      <View ref={frame} style={[styles.frame, { aspectRatio: aspectOf(video, 16 / 9) }, style]}>
        <Pressable ref={(v) => void (tiles.current[0] = v)} onPress={(e) => onTilePress(0, e)} accessibilityRole="button" accessibilityLabel="Play video" accessibilityHint="Opens it full screen" accessibilityActions={upvoteAction} onAccessibilityAction={onAction} style={styles.fill}>
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={poster} />
          <View style={styles.playWrap} pointerEvents="none">
            <View style={styles.play}>
              <Icon name="play" size={26} color="#ffffff" style={{ marginLeft: 3 }} />
            </View>
          </View>
        </Pressable>
        <HeartBursts ref={hearts} size={84} />
      </View>
    );
  }

  const tile = (i: number, tileStyle: StyleProp<ViewStyle>) => {
    const p = photos[i]!;
    return (
      <Pressable
        key={p.url}
        ref={(v) => void (tiles.current[i] = v)}
        onPress={(e) => onTilePress(i, e)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Photo ${i + 1} of ${n}`}
        accessibilityHint="Opens it full screen"
        accessibilityActions={upvoteAction}
        onAccessibilityAction={onAction}
        style={[styles.tile, tileStyle]}
      >
        <Image source={{ uri: p.url }} placeholder={p.blur ? { blurhash: p.blur } : undefined} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={p.url} />
      </Pressable>
    );
  };

  let grid;
  if (n === 1) grid = <View style={{ aspectRatio: aspectOf(photos[0]!, 4 / 3) }}>{tile(0, styles.fill)}</View>;
  else if (n === 2)
    grid = (
      <View style={styles.row}>
        {tile(0, [styles.flex, { aspectRatio: 0.8 }])}
        {tile(1, [styles.flex, { aspectRatio: 0.8 }])}
      </View>
    );
  else if (n === 3)
    grid = (
      <View style={[styles.row, { aspectRatio: 1 }]}>
        {tile(0, styles.flex)}
        <View style={[styles.flex, styles.column]}>
          {tile(1, styles.flex)}
          {tile(2, styles.flex)}
        </View>
      </View>
    );
  else
    grid = (
      <View style={[styles.column, { aspectRatio: 1 }]}>
        <View style={[styles.row, styles.flex]}>
          {tile(0, styles.flex)}
          {tile(1, styles.flex)}
        </View>
        <View style={[styles.row, styles.flex]}>
          {tile(2, styles.flex)}
          {tile(3, styles.flex)}
        </View>
      </View>
    );

  return (
    <View ref={frame} style={[styles.frame, style]}>
      {grid}
      <HeartBursts ref={hearts} size={84} />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { overflow: "hidden", borderRadius: R.lg, borderCurve: "continuous", backgroundColor: P.surface2 },
  fill: { ...StyleSheet.absoluteFill },
  flex: { flex: 1 },
  row: { flexDirection: "row", gap: GAP },
  column: { flexDirection: "column", gap: GAP },
  tile: { overflow: "hidden", backgroundColor: P.surface3 },
  playWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(0,0,0,0.55)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
});
