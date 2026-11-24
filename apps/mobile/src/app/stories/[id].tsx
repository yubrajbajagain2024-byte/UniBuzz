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

/** A pull down this far (or this fast) closes the viewer; less and it springs back. */
const PULL_CLOSE = 120;
const PULL_VELOCITY = 900;

/**
 * Stories full screen, over whatever opened them: a story's link, a story card in a chat, a profile. The stories
 * themselves are StoryPlayer (components/stories/story-player.tsx), opened from a ring in the row across Orbit's top;
 * this screen only decides whose stories to show, closes on a pull down, and gives the player a Close button. The way
 * out is down, Instagram's, because sideways is how the player moves between people (for a day, 2026-11-21, people
 * moved up and down and the viewer closed sideways instead). Opened
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

  // The pull down: the viewer follows the finger, shrinking a little and rounding its corners as the screen behind
  // shows. It fails on a sideways drag, so the pager keeps those to move between people.
  const pull = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-12, 12])
    .onUpdate((e) => {
      pull.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (pull.value > PULL_CLOSE || e.velocityY > PULL_VELOCITY) {
        pull.value = withTiming(height, { duration: 200, easing: Easing.out(Easing.quad) });
        runOnJS(close)();
      } else {
        pull.value = withSpring(0, { damping: 26, stiffness: 300, mass: 1 });
      }
    });
  const pullStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pull.value }, { scale: 1 - Math.min(pull.value / height, 1) * 0.12 }],
    borderRadius: Math.min(pull.value, 28),
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(pull.value / (height * 0.5), 1) }));

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
