import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { StoryGroup } from "@apartment-book/shared";
import { ShareSheetProvider } from "@/components/share-sheet";
import { StoryPlayer } from "@/components/stories/story-player";
import { useSession } from "@/lib/session";
import { findStoryGroup, getStoryGroups, refreshStories, takeStories, useStoryGroups } from "@/lib/stories-store";

/** A pull to the right this far (or this fast) closes the viewer; less and it springs back. */
const PULL_CLOSE = 110;
const PULL_VELOCITY = 800;

/**
 * Stories full screen, over whatever opened them: a story's link, a story card in a chat, a profile. The stories
 * themselves are StoryPlayer (components/stories/story-player.tsx), the same player Home's Stories tab draws inline;
 * this screen only decides whose stories to show, closes on a pull to the right, and gives the player a Close button.
 * The way out is sideways because the player moves between people up and down (2026-11-21), and it is the way out of
 * the app's other full-screen viewer too. Opened
 * from a list with the groups it showed (handStories), so nothing loads first; opened cold it reads the store. Opened
 * by a story's id or for a person a list leaves out (muted), it shows that person's stories alone, from the story named.
 */
export default function StoriesScreen() {
  return (
    // Its own share sheet: this screen is a modal above the root layout's, which could not appear over it.
    <ShareSheetProvider>
      <StoriesViewer />
    </ShareSheetProvider>
  );
}

/** The one person's group to show when the viewer is opened by a story's id or a person outside the tray, from that story. */
function singleGroup(id: string): StoryGroup | null {
  const g = findStoryGroup(id);
  if (!g) return null;
  const at = g.stories.findIndex((s) => s.id === id);
  return at < 0 ? g : { ...g, startAt: at };
}

function StoriesViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const [handed] = useState(() => takeStories());
  const live = useStoryGroups();
  // Not the tray's: looked up in the store (loading it first when it has nothing yet), or gone.
  const [lookup, setLookup] = useState<StoryGroup | "loading" | "gone" | null>(() => (handed || getStoryGroups().some((g) => g.author.id === id) ? null : (singleGroup(id) ?? "loading")));
  const meId = user?.id ?? null;
  useEffect(() => {
    if (lookup !== "loading") return;
    if (!meId) return setLookup("gone");
    let stale = false;
    void refreshStories(meId).then(() => {
      if (!stale) setLookup(singleGroup(id) ?? "gone");
    });
    return () => {
      stale = true;
    };
  }, [lookup, meId, id]);
  const groups = useMemo(() => handed?.groups ?? (lookup === null ? live : typeof lookup === "object" ? [lookup] : []), [handed, lookup, live]);
  // Where it opened: read once, so a change to the groups never moves the page under the finger.
  const [start] = useState(() => {
    const i = groups.findIndex((g) => g.author.id === id);
    return i < 0 ? 0 : i;
  });
  const leaving = useRef(false);
  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);
  useEffect(() => {
    if (groups.length > 0 || lookup === "loading") return;
    // A story card in a chat outlives its story by days: say why nothing opens.
    if (lookup === "gone") Alert.alert("Story unavailable", "This story is no longer available.");
    close();
  }, [groups.length, lookup, close]);

  // The pull to the right: the viewer follows the finger, shrinking a little and rounding its corners as the screen
  // behind shows. Sideways, because up and down belong to the player's move between people; it fails on a vertical
  // drag so the pager keeps those.
  const pull = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetX(16)
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      pull.value = Math.max(0, e.translationX);
    })
    .onEnd((e) => {
      if (pull.value > PULL_CLOSE || e.velocityX > PULL_VELOCITY) {
        pull.value = withTiming(width, { duration: 200, easing: Easing.out(Easing.quad) });
        runOnJS(close)();
      } else {
        pull.value = withSpring(0, { damping: 26, stiffness: 300, mass: 1 });
      }
    });
  const pullStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pull.value }, { scale: 1 - Math.min(pull.value / width, 1) * 0.12 }],
    borderRadius: Math.min(pull.value, 28),
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(pull.value / (width * 0.5), 1) }));

  if (lookup === "loading") {
    return (
      <View style={[styles.root, styles.backdrop, styles.loading]}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={pan}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={[styles.root, styles.pages, pullStyle]}>
          {/* Nothing is drawn over the story here, so the bars sit just under the status bar; the last one running out closes. */}
          <StoryPlayer groups={groups} start={start} width={width} height={height} barsTop={insets.top + 8} bottomInset={insets.bottom} active onDone={close} onClose={close} />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: "#000" },
  pages: { overflow: "hidden", backgroundColor: "#000" },
  loading: { alignItems: "center", justifyContent: "center" },
});
